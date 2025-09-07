import { createLogger } from './logger.js';
import { createLoadBalancer } from './load-balancer.js';
import { isFailed, markAsFailed } from './failover-manager.js';

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const extractDomain = (target) => {
  if (!target) return '';
  let host = String(target);
  // strip port if present
  if (host.startsWith('[')) {
    // IPv6 like [::1]:443
    const idx = host.indexOf(']');
    if (idx !== -1) return host.slice(1, idx);
  }
  const col = host.lastIndexOf(':');
  if (col > -1) host = host.slice(0, col);
  // strip scheme if any
  host = host.replace(/^https?:\/\//i, '');
  return host;
};

const connectViaWebSocket = (target, socket, options, connection) => {
  return new Promise((resolve, reject) => {
    const log = createLogger(options);
    const loadBalancer = createLoadBalancer(options.workers, options.strategy);

    let attempts = 0;
    const retryEnabled = options.retry_enabled === undefined ? true : !!options.retry_enabled;
    const maxRetries = Number.isFinite(options.max_retries) ? options.max_retries : 5;
    const initialBackoff = Number.isFinite(options.retry_initial_backoff) ? options.retry_initial_backoff : 1000;
    const factor = Number.isFinite(options.retry_factor) ? options.retry_factor : 2;

    let opened = false; // track if the connection has been opened

    const connectOnce = () => {
      attempts += 1;
      const worker = loadBalancer.getNextWorker();
      if (!worker) {
        log.error('[!] No worker endpoints available. Cannot connect.');
        try { socket.shutdown(); } catch (_) { /* ignore */ }
        reject(new Error('No worker endpoints available'));
        return;
      }
      log.info(`Proxying connection to ${target} via ${worker} (attempt ${attempts})`);

      const ws = new WebSocket(`wss://${worker}`, {
        headers: {
          Authorization: options.authorization,
          'X-Proxy-Target': target,
        }
      });

      connection._ws = ws;

      ws.onopen = () => {
        opened = true;
        log.debug('WebSocket onopen');
        if (options.type === 'HTTP')
          socket.write('HTTP/1.1 200 OK\r\n\r\n');
        else
          socket.write(Buffer.from([0x5, 0x00, 0x00, 0x01, 0x7f, 0x00, 0x00, 0x01, 0x00, 0x00]));
        log.info('[Debug] WebSocket opened, resolving promise.');
        resolve();
      };

      ws.onerror = async (e) => {
        const msg = e?.message || e;
        log.error('WebSocket onerror', msg);

        if (!opened && retryEnabled && attempts <= maxRetries) {
          const delay = initialBackoff * factor ** (attempts - 1);
          log.warn(`[Retry] Attempt ${attempts} failed. Retrying in ${delay}ms...`);
          await sleep(delay);
          connectOnce();
          return;
        }

        if (!opened && attempts > maxRetries) {
          log.error(`[!] Worker connection failed after ${attempts - 1} retries.`);
          reject(new Error(`Worker connection failed after ${attempts - 1} retries`));
        } else {
          reject(new Error('WebSocket error'));
        }

        try { socket.shutdown(); } catch (_) { /* ignore */ }
      };

      ws.onclose = (e) => {
        log.warn('WebSocket onclose', { code: e.code, reason: e.reason, opened: opened });

        if (!opened) {
          // connection closed before open (e.g., handshake fail)
          if (retryEnabled && attempts <= maxRetries) {
            const delay = initialBackoff * factor ** (attempts - 1);
            log.warn(`[Retry] Attempt ${attempts} closed. Retrying in ${delay}ms...`);
            sleep(delay).then(connectOnce);
            return;
          }

          if (e.reason === "Expected 101 status code") {
            if (options.type === 'HTTP')
              socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
            else
              socket.write(Buffer.from([0x5, 0x05, 0x00, 0x01, 0x7f, 0x00, 0x00, 0x01, 0x00, 0x00]));
            log.error('[!] Worker connection failed!', { code: e.code, reason: e.reason });
          }

          reject(new Error(`WebSocket closed: ${e.reason}`));
          try { socket.shutdown(); } catch (_) {}
          return;
        }

        // If already opened, do not retry; close path remains the same as before
        if (e.reason === "Expected 101 status code") {
          if (options.type === 'HTTP')
            socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
          else
            socket.write(Buffer.from([0x5, 0x05, 0x00, 0x01, 0x7f, 0x00, 0x00, 0x01, 0x00, 0x00]));
          log.error('[!] Worker connection failed!', { code: e.code, reason: e.reason });
        }

        try { socket.shutdown(); } catch (_) {}
      };

      ws.onmessage = (e) => {
        log.debug('WebSocket onmessage', { bytes: e?.data?.byteLength ?? (e?.data?.length ?? 'unknown') });
        socket.write(e.data);
      };
    };

    // kick off first attempt
    connectOnce();
  });
};

const parseHttpRequest = (chunk) => {
  try {
    const str = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    const sep = str.indexOf('\r\n\r\n');
    if (sep === -1) return null;
    const head = str.slice(0, sep);
    const bodyStart = sep + 4;
    const lines = head.split('\r\n');
    const [method, path, httpver] = lines[0].split(' ');
    const headers = {};
    for (let i = 1; i < lines.length; i++) {
      const idx = lines[i].indexOf(':');
      if (idx === -1) continue;
      const k = lines[i].slice(0, idx).trim();
      const v = lines[i].slice(idx + 1).trim();
      headers[k.toLowerCase()] = v;
    }
    return { method, path, httpver, headers, bodyChunk: Buffer.from(str.slice(bodyStart), 'utf-8') };
  } catch (_) { return null; }
};

const connectViaNetlifyTunnel = async (target, socket, options, connection, initialData) => {
  const log = createLogger(options);
  if (!initialData) {
    // Cannot build an HTTP request without headers; fallback
    log.warn('[Tunnel] Missing initial HTTP data, falling back to worker path');
    return connectViaWebSocket(target, socket, options, connection);
  }

  const parsed = parseHttpRequest(initialData);
  if (!parsed) {
    log.warn('[Tunnel] Failed to parse initial HTTP request, falling back to worker path');
    return connectViaWebSocket(target, socket, options, connection);
  }

  const { method, path, headers, bodyChunk } = parsed;
  // CONNECT method (HTTP tunneling) requires raw TCP, fallback to Worker path
  if (String(method).toUpperCase() === 'CONNECT') {
    log.info('[Tunnel] CONNECT method detected, using Worker (WebSocket) path');
    return connectViaWebSocket(target, socket, options, connection);
  }
  const hostHeader = headers.host || extractDomain(target);
  if (!hostHeader) {
    log.warn('[Tunnel] Missing Host header, falling back to worker path');
    return connectViaWebSocket(target, socket, options, connection);
  }

  // Build full target URL
  let targetUrl;
  if (/^https?:\/\//i.test(path)) targetUrl = path;
  else targetUrl = `http://${hostHeader}${path || '/'}`;

  // Prepare forwarding headers (exclude hop-by-hop and internal)
  const hopByHop = new Set(['authorization', 'proxy-authorization', 'proxy-connection', 'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'host']);
  const forwardHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!hopByHop.has(k)) forwardHeaders[k] = v;
  }

  // Create a readable stream for request body when needed
  let bodyController;
  const bodyStream = new ReadableStream({
    start(controller) {
      bodyController = controller;
      if (bodyChunk?.length) controller.enqueue(bodyChunk);
    }
  });

  // Wire up connection.send to stream more body data
  connection._mode = 'tunnel';
  connection.send = (data) => {
    try {
      if (bodyController && data && data.length) bodyController.enqueue(data);
    } catch (e) {
      log.error('[Tunnel] send failed', e?.message || e);
    }
  };

  try {
    const reqInit = {
      method,
      headers: {
        ...forwardHeaders,
        Authorization: `Bearer ${options.netlify_tunnel_token}`,
        'X-Target-URL': targetUrl,
        'X-Target-Method': method,
      },
    };

    if (!/^(GET|HEAD)$/i.test(method)) {
      reqInit.body = bodyStream;
    }

    const res = await fetch(options.netlify_tunnel_url, reqInit);

    // Write status line
    const statusText = res.statusText || 'OK';
    socket.write(`HTTP/1.1 ${res.status} ${statusText}\r\n`);

    // Forward headers except transfer-encoding/content-length (Bun will handle)
    const denied = new Set(['transfer-encoding']);
    res.headers.forEach((v, k) => {
      if (!denied.has(k.toLowerCase())) socket.write(`${k}: ${v}\r\n`);
    });
    socket.write('\r\n');

    if (res.body) {
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        socket.write(value);
      }
    }
  } catch (e) {
    log.error('[Tunnel] Error forwarding via Netlify', e?.stack || e);
    try { socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch (_) {}
  } finally {
    try { socket.shutdown(); } catch (_) {}
    try { if (bodyController) bodyController.close(); } catch (_) {}
  }
};

export const proxyConnect = (target, socket, options, initialData) => {
  const log = createLogger(options);
  const connection = {
    send: (data) => {
      try {
        if (connection._ws) connection._ws.send(data);
      } catch (e) {
        log.error('Send on connection failed', e?.message || e);
      }
    }
  };

  // Async path decision so we can return synchronously for backward compatibility
  (async () => {
    const domain = extractDomain(target);
    const supportsTunnel = !!options.netlify_tunnel_url && !!options.netlify_tunnel_token;

    // If domain is already marked as failed, use Netlify tunnel directly
    if (supportsTunnel && isFailed(domain)) {
      log.info(`[Tunnel] Domain ${domain} is marked as failed, using Netlify tunnel`);
      await connectViaNetlifyTunnel(target, socket, options, connection, initialData);
      return;
    }

    // Try primary WebSocket connection first
    try {
      await connectViaWebSocket(target, socket, options, connection);
    } catch (error) {
      log.error(`[Failover] PROMISE REJECTED. Primary connection to ${target} failed:`, error?.message || error);
      
      // Mark domain as failed
      markAsFailed(domain);
      
      // Failover to Netlify tunnel if supported
      if (supportsTunnel) {
        log.info(`[Failover] Falling back to Netlify tunnel for ${domain}`);
        await connectViaNetlifyTunnel(target, socket, options, connection, initialData);
      }
    }
  })();

  return connection;
};

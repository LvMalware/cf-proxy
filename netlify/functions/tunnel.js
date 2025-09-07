import net from 'net';

/**
 * @param {Request} req
 * @returns {Promise<Response>}
 */
async function handleRequest(req) {
  // 1. Auth
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const expectedToken = process.env.TUNNEL_TOKEN || '';
  if (!token || token !== expectedToken) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 2. Validate target URL
  const targetUrl = req.headers.get('x-target-url');
  if (!targetUrl) {
    return new Response('Missing X-Target-URL header', { status: 400 });
  }
  let url;
  try {
    url = new URL(targetUrl);
  } catch (_) {
    return new Response('Invalid X-Target-URL', { status: 400 });
  }

  // 3. SSRF Protections
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
    return new Response('Invalid protocol', { status: 400 });
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return new Response('Blocked host', { status: 400 });
  }
  // Basic private IP range check; a robust solution would resolve the DNS
  const blockedPrefixes = [
    '127.',
    '10.',
    '192.168.',
    '169.254.',
    '172.16.',
    '172.17.',
    '172.18.',
    '172.19.',
    '172.2', // Covers 172.20-29
    '172.30.',
    '172.31.',
    '::1',
    'fc',
    'fd',
  ];
  if (blockedPrefixes.some((prefix) => hostname.startsWith(prefix))) {
    return new Response('Blocked IP range', { status: 400 });
  }

  const method = (req.headers.get('x-target-method') || 'GET').toUpperCase();

  // Handle CONNECT method for TCP tunneling
  if (method === 'CONNECT') {
    try {
      const { readable, writable } = new TransformStream();
      const socket = new net.Socket();
      
      // Set a 30-second timeout for the socket
      socket.setTimeout(30000);
      
      socket.connect({ host: url.hostname, port: url.port }, () => {
        if (req.body) {
          req.body.pipeTo(new WritableStream({
            write(chunk) {
              socket.write(chunk);
            },
            close() {
              socket.end();
            },
            abort(err) {
              socket.destroy(err);
            },
          })).catch(err => {
              socket.destroy(err);
          });
        }
      });

      const writer = writable.getWriter();
      socket.on('data', (chunk) => {
        writer.write(chunk);
      });
      socket.on('end', () => {
        writer.close();
      });
      socket.on('error', (err) => {
        writer.abort(err);
        socket.destroy();
      });
      // Handle socket timeout
      socket.on('timeout', () => {
        socket.destroy(new Error('Socket timeout'));
      });

      return new Response(readable, {
        status: 200,
        statusText: 'Connection Established'
      });

    } catch (error) {
      return new Response('Bad Gateway', { status: 502 });
    }
  }

  // 5. Forward regular HTTP requests
  const fwdHeaders = new Headers();
  const hopByHop = new Set([
    'authorization',
    'host',
    'connection',
    'keep-alive',
    'proxy-authorization',
    'proxy-authentication',
    'proxy-connection',
    'transfer-encoding',
    'te',
    'trailer',
    'upgrade',
  ]);
  for (const [key, value] of req.headers.entries()) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.startsWith('x-target-')) continue;
    if (hopByHop.has(lowerKey)) continue;
    fwdHeaders.set(key, value);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const upstreamResponse = await fetch(url, {
      method,
      headers: fwdHeaders,
      body: req.body,
      signal: controller.signal,
      redirect: 'manual',
    });
    clearTimeout(timeoutId);

    const respHeaders = new Headers();
    for (const [key, value] of upstreamResponse.headers.entries()) {
      if (key.toLowerCase() !== 'transfer-encoding') {
        respHeaders.set(key, value);
      }
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: respHeaders,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return new Response('Gateway Timeout', { status: 504 });
    }
    return new Response('Bad Gateway', { status: 502 });
  }
}

/**
 * Netlify Function handler.
 * @param {Request} request
 * @param {import('@netlify/functions').Context} context
 * @returns {Promise<Response>}
 */
export default async function handler(request, context) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  return handleRequest(request);
}

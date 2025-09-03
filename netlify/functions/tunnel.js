async function handleRequestLike(req) {
  try {
    // Only allow POST
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Auth
    const auth = req.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const expected = (typeof process !== 'undefined' && process.env && process.env.TUNNEL_TOKEN) || '';
    if (!token || token !== expected) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Validate target
    const targetUrl = req.headers.get('x-target-url');
    const method = (req.headers.get('x-target-method') || 'GET').toUpperCase();
    if (!targetUrl) return new Response('Missing X-Target-URL', { status: 400 });

    let url;
    try { url = new URL(targetUrl); } catch (_) { return new Response('Invalid URL', { status: 400 }); }

    // SSRF protections
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return new Response('Invalid protocol', { status: 400 });
    }

    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
      return new Response('Blocked host', { status: 400 });
    }

    // Disallow direct IPs to private ranges
    const isIp = /^[0-9.]+$/.test(hostname) || /^[0-9a-f:]+$/i.test(hostname);
    if (isIp) {
      // A conservative block list; in a real deployment, resolve and check ranges
      const blocked = ['127.', '10.', '192.168.', '169.254.', '172.16.', '172.17.', '172.18.', '172.19.', '172.2', '::1', 'fc', 'fd'];
      if (blocked.some((p) => hostname.startsWith(p))) {
        return new Response('Blocked IP range', { status: 400 });
      }
    }

    // Build headers for upstream
    const hopByHop = new Set(['authorization', 'proxy-authorization', 'proxy-connection', 'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade']);
    const fwdHeaders = new Headers();
    req.headers.forEach((v, k) => {
      const kl = k.toLowerCase();
      if (kl.startsWith('x-target-')) return;
      if (kl === 'authorization') return; // our own auth
      if (hopByHop.has(kl)) return;
      fwdHeaders.set(k, v);
    });

    const controller = new AbortController();
    const timeoutMs = 30000;
    const t = setTimeout(() => controller.abort(), timeoutMs);

    const upstreamInit = {
      method,
      headers: fwdHeaders,
      signal: controller.signal,
      body: ['GET', 'HEAD'].includes(method) ? undefined : req.body,
    };

    const upstream = await fetch(url, upstreamInit);
    clearTimeout(t);

    const respHeaders = new Headers();
    upstream.headers.forEach((v, k) => {
      if (k.toLowerCase() === 'transfer-encoding') return;
      respHeaders.set(k, v);
    });

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  } catch (e) {
    const msg = e?.name === 'AbortError' ? 'Gateway Timeout' : 'Bad Gateway';
    const code = e?.name === 'AbortError' ? 504 : 502;
    return new Response(msg, { status: code });
  }
}

// Edge/Request-style default export (some runtimes support this for functions)
export default async function handler(req) {
  return handleRequestLike(req);
}

// Node/Netlify Functions classic interface
export async function handler(event) {
  // Build Request-like object from event
  const headers = new Headers(event.headers || {});
  const method = event.httpMethod || event.requestContext?.http?.method || 'POST';
  const body = event.isBase64Encoded ? Uint8Array.from(Buffer.from(event.body || '', 'base64')) : event.body;
  const req = new Request('https://functions.local/tunnel', { method, headers, body });
  const res = await handleRequestLike(req);

  // Convert Response to Netlify Function result
  const resHeaders = {};
  res.headers.forEach((v, k) => { resHeaders[k] = v; });
  const arrayBuf = await res.arrayBuffer();
  const base64Body = Buffer.from(arrayBuf).toString('base64');
  return {
    statusCode: res.status,
    headers: resHeaders,
    body: base64Body,
    isBase64Encoded: true,
  };
}

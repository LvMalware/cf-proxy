import dns from 'node:dns/promises';

const CF_NS_SUFFIXES = [
  '.ns.cloudflare.com',
  'cloudflare.com',
];

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const cache = new Map(); // key: domain, value: { ts, result }

const withTimeout = async (p, ms) => {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const res = await p;
    clearTimeout(t);
    return res;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
};

const isPrivateHostname = (host) => {
  try {
    // crude check; detailed SSRF protection is at Netlify function
    if (!host) return true;
    const h = String(host).toLowerCase();
    return h === 'localhost' || h.endsWith('.localhost');
  } catch (_) { return false; }
};

export function clearCache() {
  cache.clear();
}

/**
 * Checks if a domain is protected by Cloudflare.
 * Uses DNS NS records and falls back to HTTP header probe if available.
 * @param {string} domain
 * @param {{ cacheTtl?: number, timeout?: number, methods?: string[], verbose?: boolean }} options
 * @returns {Promise<boolean>}
 */
export async function isCloudflareProtected(domain, options = {}) {
  const cacheTtl = Number.isFinite(options.cacheTtl) ? options.cacheTtl : DEFAULT_CACHE_TTL_MS;
  const timeoutMs = Number.isFinite(options.timeout) ? options.timeout : 5000;
  const methods = Array.isArray(options.methods) && options.methods.length > 0
    ? options.methods
    : ['dns', 'http'];

  if (!domain || isPrivateHostname(domain)) return false;

  const now = Date.now();
  const hit = cache.get(domain);
  if (hit && (now - hit.ts) < cacheTtl) return hit.result;

  let result = false;

  const tryDns = async () => {
    try {
      const ns = await withTimeout(dns.resolveNs(domain), timeoutMs);
      if (!Array.isArray(ns)) return false;
      const lower = ns.map(n => String(n).toLowerCase());
      return lower.some(n => CF_NS_SUFFIXES.some(suf => n.endsWith(suf)));
    } catch (_) {
      return false;
    }
  };

  const tryHttp = async () => {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      const url = new URL(`https://${domain}/`);
      const res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: controller.signal });
      clearTimeout(id);
      const server = res.headers.get('server')?.toLowerCase?.() || '';
      if (server.includes('cloudflare')) return true;
      const hasCF = ['cf-ray', 'cf-request-id', 'cf-cache-status'].some(h => res.headers.has(h));
      return hasCF;
    } catch (_) {
      return false;
    }
  };

  for (const m of methods) {
    if (m === 'dns') {
      result = await tryDns();
    } else if (m === 'http') {
      result = await tryHttp();
    }
    if (result) break;
  }

  cache.set(domain, { ts: now, result });
  return result;
}

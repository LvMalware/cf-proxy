/**
 * Failover manager for tracking domains that have failed to connect.
 * Uses an in-memory cache with a 1-hour TTL for entries.
 */

// Default TTL: 1 hour in milliseconds
const DEFAULT_TTL = 3600 * 1000;

// In-memory cache: domain -> failure timestamp
const failoverCache = new Map();

/**
 * Checks if a domain is currently in a failed state.
 * @param {string} domain - The domain to check
 * @returns {boolean} True if the domain is in the cache and TTL has not expired, otherwise false
 */
export function isFailed(domain) {
  const failureTime = failoverCache.get(domain);
  
  // If domain is not in cache, it's not failed
  if (failureTime === undefined) {
    return false;
  }
  
  // Check if the entry has expired
  const now = Date.now();
  if (now - failureTime > DEFAULT_TTL) {
    // Expired entry, remove it and return false
    failoverCache.delete(domain);
    return false;
  }
  
  // Still valid failed entry
  return true;
}

/**
 * Adds or updates a domain in the cache with the current timestamp.
 * @param {string} domain - The domain to mark as failed
 */
export function markAsFailed(domain) {
  failoverCache.set(domain, Date.now());
}

/**
 * Clears all entries from the cache.
 */
export function clearCache() {
  failoverCache.clear();
}

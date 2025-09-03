# Cloudflare Detector Module Design

## Purpose
This module will detect whether a given domain is protected by Cloudflare, allowing the proxy to route requests appropriately.

## Implementation Approach
We'll use multiple methods to detect Cloudflare protection:

1. DNS lookup for Cloudflare nameservers
2. HTTP header checking for Cloudflare-specific headers
3. WHOIS lookup for Cloudflare-specific information

## Module Interface

```javascript
// cloudflare-detector.js

/**
 * Checks if a domain is protected by Cloudflare
 * @param {string} domain - The domain to check
 * @param {Object} options - Configuration options
 * @returns {Promise<boolean>} - True if domain is Cloudflare-protected
 */
export async function isCloudflareProtected(domain, options = {}) {
  // Implementation details
}

/**
 * Clears the detection cache
 */
export function clearCache() {
  // Implementation details
}
```

## Implementation Details

### Method 1: DNS Lookup
Check if the domain's nameservers are Cloudflare nameservers:
- `ns1.cloudflare.com`
- `ns2.cloudflare.com`
- etc.

### Method 2: HTTP Header Check
Make a request to the domain and check for Cloudflare-specific headers:
- `server: cloudflare`
- `cf-ray`
- `cf-request-id`
- `cf-cache-status`

### Method 3: WHOIS Lookup
Check WHOIS records for Cloudflare-specific information.

## Caching Strategy
To prevent excessive lookups and improve performance:
- Cache results for a configurable time (default: 1 hour)
- Use a simple in-memory Map for caching
- Provide a method to clear the cache

## Configuration Options
- `cacheTtl`: Time-to-live for cached results (milliseconds)
- `timeout`: Timeout for detection requests (milliseconds)
- `methods`: Array of detection methods to use

## Error Handling
- Gracefully handle network errors
- Return false for domains that cannot be determined
- Log errors for debugging purposes

## Usage Example
```javascript
import { isCloudflareProtected } from './cloudflare-detector.js';

const isProtected = await isCloudflareProtected('example.com');
if (isProtected) {
  // Route through Netlify tunnel
} else {
  // Route through normal Cloudflare Worker
}
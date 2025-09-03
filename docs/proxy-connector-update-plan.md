# Proxy Connector Update Plan

## Current Implementation Overview
The proxy connector currently:
1. Takes a target and socket
2. Creates a WebSocket connection to a Cloudflare Worker
3. Forwards data between the client socket and WebSocket

## Required Changes
We need to modify the proxy connector to:
1. Detect if the target is Cloudflare-protected
2. For Cloudflare targets, use HTTP connection to Netlify tunnel
3. For non-Cloudflare targets, maintain existing WebSocket functionality

## Detailed Implementation Plan

### Step 1: Import Cloudflare Detection
Add import for Cloudflare detection module:
```javascript
import { isCloudflareProtected } from './cloudflare-detector.js';
```

### Step 2: Modify proxyConnect Function Signature
Update the function to accept additional options:
```javascript
export const proxyConnect = (target, socket, options) => {
  // New parameter: options will include netlify_tunnel_url, netlify_tunnel_token, etc.
}
```

### Step 3: Add Cloudflare Detection Logic
Before creating connections, check if target is Cloudflare-protected:
```javascript
// Extract domain from target
const domain = extractDomain(target);
const isCloudflare = options.cloudflare_detection_enabled 
  ? await isCloudflareProtected(domain, options)
  : false;
```

### Step 4: Implement Conditional Connection Logic
Create separate connection paths:
```javascript
if (isCloudflare) {
  // Use Netlify tunnel connection
  return connectViaNetlifyTunnel(target, socket, options);
} else {
  // Use existing WebSocket connection
  return connectViaWebSocket(target, socket, options);
}
```

### Step 5: Implement Netlify Tunnel Connection
Create a new function to handle Netlify tunnel connections:
```javascript
const connectViaNetlifyTunnel = (target, socket, options) => {
  // Implementation details
}
```

### Step 6: Maintain WebSocket Connection
Keep the existing WebSocket connection logic:
```javascript
const connectViaWebSocket = (target, socket, options) => {
  // Existing implementation
}
```

## New Connection Method: Netlify Tunnel

### Implementation Details
1. Parse target to extract URL components
2. Make HTTP request to Netlify tunnel function
3. Stream data between client socket and Netlify response

### Error Handling
- Handle authentication errors (401)
- Handle target errors (502, 504)
- Handle network errors
- Gracefully close connections on error

### Data Flow
1. Client sends data to local proxy
2. Proxy forwards to Netlify function
3. Netlify function requests target
4. Target response flows back through Netlify to proxy
5. Proxy sends response to client

## Updated Function Structure
```javascript
export const proxyConnect = (target, socket, options) => {
  const log = createLogger(options);
  
  // New connection object that can handle both WebSocket and HTTP
  const connection = {
    send: (data) => {
      // Implementation depends on connection type
    }
  };
  
  // Determine connection method
  const connectOnce = async () => {
    const domain = extractDomain(target);
    const isCloudflare = options.cloudflare_detection_enabled 
      ? await isCloudflareProtected(domain, options)
      : false;
      
    if (isCloudflare) {
      // Netlify tunnel connection
      await connectViaNetlifyTunnel(target, socket, options, connection);
    } else {
      // WebSocket connection
      connectViaWebSocket(target, socket, options, connection);
    }
  };
  
  connectOnce();
  return connection;
};
```

## Configuration Requirements
The proxy connector will need access to:
- `netlify_tunnel_url`: URL of the Netlify function
- `netlify_tunnel_token`: Authentication token for the Netlify function
- `cloudflare_detection_enabled`: Boolean to enable/disable Cloudflare detection

## Backward Compatibility
Ensure that existing configurations continue to work:
- If Netlify tunnel settings are not provided, skip Cloudflare detection
- If Cloudflare detection is disabled, use WebSocket connection for all targets

## Testing Considerations
- Test with Cloudflare-protected targets
- Test with non-Cloudflare targets
- Test error conditions
- Test configuration variations
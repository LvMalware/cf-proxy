# Netlify Tunnel Function Design

## Purpose
This Netlify function will act as an HTTPS tunnel to bypass the Cloudflare-to-Cloudflare limitation by making requests to Cloudflare-protected sites from a non-Cloudflare environment.

## Implementation Approach
The function will:
1. Accept HTTPS requests with target information
2. Validate the request and authentication
3. Make the actual request to the target
4. Return the response to the client

## Function Interface

### Request
- **Endpoint**: `/tunnel`
- **Method**: POST
- **Headers**:
  - `Authorization`: Bearer token for authentication
  - `X-Target-URL`: The complete target URL to proxy
  - `X-Target-Method`: HTTP method (GET, POST, etc.)
  - All other headers will be forwarded to the target
- **Body**: Request body to send to the target (for POST, PUT, etc.)

### Response
- **Status Code**: Same as the target response
- **Headers**: Same as the target response
- **Body**: Same as the target response

## Implementation Details

### Authentication
- Check for valid Bearer token in Authorization header
- Tokens should be configured as environment variables
- Return 401 for invalid or missing authentication

### Request Validation
- Validate that X-Target-URL is present and is a valid URL
- Validate that X-Target-Method is a valid HTTP method
- Prevent access to internal networks (localhost, private IP ranges)
- Return 400 for invalid requests

### Target Request
- Use fetch API to make request to target
- Forward all headers except Authorization and X-Target-* headers
- Forward request body for methods that support it
- Handle timeouts appropriately
- Stream response back to client

### Security Considerations
- Validate target URLs to prevent SSRF (Server-Side Request Forgery)
- Block access to:
  - localhost and loopback addresses
  - Private IP ranges (10.x.x.x, 172.16.x.x-172.31.x.x, 192.168.x.x)
 - Metadata service endpoints (169.254.169.254)
- Implement rate limiting
- Use HTTPS only

## Environment Variables
- `TUNNEL_TOKEN`: Bearer token for authentication
- `DEBUG`: Enable debug logging (optional)

## Error Handling
- Network errors: Return 502 Bad Gateway
- Timeout errors: Return 504 Gateway Timeout
- Authentication errors: Return 401 Unauthorized
- Validation errors: Return 400 Bad Request
- Other errors: Return 500 Internal Server Error

## Usage Example
```javascript
// Client request to Netlify function
const response = await fetch('https://your-netlify-function.netlify.app/.netlify/functions/tunnel', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer your-token',
    'X-Target-URL': 'https://cloudflare-protected-site.com/api/data',
    'X-Target-Method': 'GET',
    'User-Agent': 'Mozilla/5.0...'
  }
});

// Response from target site will be returned directly
const data = await response.json();
```

## Implementation Plan

### Step 1: Basic Function Structure
- Create Netlify function handler
- Implement basic request parsing
- Add authentication check

### Step 2: Request Validation
- Implement URL validation
- Implement SSRF protection
- Add input sanitization

### Step 3: Target Request Implementation
- Implement fetch to target
- Forward headers and body
- Handle different HTTP methods

### Step 4: Response Handling
- Stream response back to client
- Forward status codes and headers
- Handle errors appropriately

### Step 5: Security Hardening
- Implement rate limiting
- Add comprehensive SSRF protection
- Add logging for debugging

### Step 6: Testing
- Test with various Cloudflare-protected sites
- Test error conditions
- Test security measures
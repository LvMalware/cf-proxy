# Deployment Guide for Cloudflare Bypass Solution

## Overview
This guide explains how to deploy the enhanced warpify solution that bypasses the Cloudflare-to-Cloudflare limitation.

## Prerequisites
- Bun (for running the local proxy)
- Wrangler (for deploying Cloudflare Workers)
- Netlify account (for deploying the tunnel function)
- Cloudflare account (for deploying Workers)

## Deployment Steps

### 1. Deploy Cloudflare Workers
Follow the existing deployment process:
```bash
cd worker/
bun install
wrangler deploy
```

### 2. Deploy Netlify Function
1. Create a new Netlify site or use an existing one
2. Create the tunnel function in `netlify/functions/tunnel.js`
3. Set the `TUNNEL_TOKEN` environment variable in Netlify
4. Deploy the function:
```bash
netlify deploy
```

### 3. Configure the Local Proxy
Update your `config.json` with the new settings:
```json
{
  "worker": [
    "your-worker-1.workers.dev",
    "your-worker-2.workers.dev"
  ],
  "authorization": "your-auth-token",
  "port": 1080,
  "type": "socks",
  "netlify_tunnel_url": "https://your-site.netlify.app/.netlify/functions/tunnel",
  "netlify_tunnel_token": "your-netlify-token",
  "cloudflare_detection_enabled": true
}
```

### 4. Run the Local Proxy
```bash
bun run start
```

## Configuration Options

### Required Settings
- `worker`: Array of Cloudflare Worker URLs
- `authorization`: Token for authenticating with Workers
- `netlify_tunnel_url`: URL of the Netlify tunnel function
- `netlify_tunnel_token`: Token for authenticating with the tunnel function

### Optional Settings
- `cloudflare_detection_enabled`: Enable/disable Cloudflare detection (default: true)
- `port`: Port for the local proxy (default: 1080 for SOCKS, 8080 for HTTP)
- `type`: Proxy type (socks or http)
- `verbose`: Enable verbose logging

## Environment Variables

### Netlify Function
- `TUNNEL_TOKEN`: Authentication token for the tunnel function

### Local Proxy
- All configuration can be set in `config.json` or via command line arguments

## Testing the Deployment

### Test Non-Cloudflare Sites
```bash
curl -x socks5h://localhost:1080 https://httpbin.org/ip
```

### Test Cloudflare Sites
```bash
curl -x socks5h://localhost:1080 https://cloudflare.com
```

## Troubleshooting

### Common Issues
1. **Authentication failures**: Verify tokens match between proxy and services
2. **Connection timeouts**: Check firewall and network settings
3. **Cloudflare detection failures**: Verify DNS resolution is working

### Logs
- Enable verbose logging with `--verbose` flag
- Check Netlify function logs in the Netlify dashboard
- Check Cloudflare Worker logs in the Cloudflare dashboard

## Security Considerations

### Token Management
- Use strong, random tokens
- Rotate tokens periodically
- Restrict token scope where possible

### Access Control
- The Netlify function should only be accessible via the tunnel
- Use HTTPS for all connections
- Implement rate limiting

### Network Security
- Restrict the Netlify function to only access external sites
- Prevent SSRF attacks through proper URL validation
- Monitor for unusual traffic patterns

## Performance Optimization

### Caching
- Cloudflare detection results are cached for 1 hour by default
- Adjust cache settings based on your usage patterns

### Load Balancing
- Use multiple Cloudflare Workers for better performance
- Configure appropriate load balancing strategy (random or round-robin)

### Retry Logic
- Configure appropriate retry settings for your network conditions
- Balance between reliability and performance

## Monitoring and Maintenance

### Health Checks
- Regularly test connectivity to both Cloudflare and non-Cloudflare sites
- Monitor Netlify function performance
- Check Cloudflare Worker logs for errors

### Updates
- Keep Bun and Wrangler updated
- Monitor for updates to the warpify project
- Regularly rotate authentication tokens

## Rollback Procedure
If issues occur:
1. Revert to the previous configuration without Netlify tunnel settings
2. Disable Cloudflare detection
3. Use only the original WebSocket proxy functionality
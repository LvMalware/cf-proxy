**Goal:** Debug a failing `fetch()` call in a Cloudflare Worker.

**Context:**
- The project is a WebSocket proxy running as a Cloudflare Worker.
- It has a failover mechanism that uses a Netlify tunnel.
- The `deploy.sh` script deploys the worker and a Netlify function for the tunnel.
- The script captures the Netlify tunnel URL from the Netlify CLI output.

**Problem:**
- The `fetch()` call within `src/proxy-connector.js` to the Netlify tunnel URL is failing with `TypeError: fetch() URL is invalid`.
- The root cause is that the URL string contains ANSI escape codes from the Netlify CLI output.

**What has been tried:**
1.  A diagnostic log was added in `src/proxy-connector.js` to inspect the URL being used by `fetch()`. The log confirmed the presence of ANSI codes (e.g., `\u001b[39m`).
2.  The `deploy.sh` script was modified to strip these ANSI codes and whitespace from the captured URL using `sed`.
3.  The initial `sed` command was ineffective.
4.  A revised, more robust `sed` command was applied to `deploy.sh`: `sed 's/\x1b\[[0-9;]*m//g; s/^[[:space:]]*//; s/[[:space:]]*$//'`.
5.  The deployment script (`./deploy.sh`) was re-run to test the fix, but the process was manually interrupted (SIGINT) before completion, so the result is unknown.

**Request for Advice:**
- What is the best way to proceed with debugging this issue?
- Should I simply re-run the `./deploy.sh` script to completion to see if the latest `sed` fix works?
- Are there alternative or better ways to capture the Netlify URL cleanly, without ANSI codes? For example, does Netlify CLI have a `--json` or similar flag for machine-readable output?
- Suggest any other potential points of failure or debugging steps I should consider if the problem persists. For instance, could there be an encoding issue between the shell script and the Node.js environment where the `fetch` is called?
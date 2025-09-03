#!/usr/bin/env bash
# Deploy two Cloudflare workers (warpify0 and warpify1), set a shared TOKEN secret,
# generate config.json with their URLs, try to deploy the Netlify function tunnel,
# auto-configure the proxy, and start the proxy client.
#
# This script is designed to be safely re-runnable:
# - It always resets worker/wrangler.toml back to name = "warpify0" at the end.
# - It updates/overwrites the TOKEN secret for both workers on each run.
#
# Prereqs (see README for details):
# - Bun installed and available on PATH
# - Wrangler installed (bun i -g wrangler) and authenticated (wrangler login)
# - (Optional) Netlify CLI installed and site linked if you want automatic function deployment

set -euo pipefail

WORKER_DIR="worker"
WRANGLER_TOML="$WORKER_DIR/wrangler.toml"
NAME0="warpify0"
NAME1="warpify1"

EMPTY_DIR="tmp_rovodev_empty"

# Cross-platform function to set the name in wrangler.toml without relying on sed -i
set_worker_name() {
  local new_name="$1"
  if [[ ! -f "$WRANGLER_TOML" ]]; then
    echo "[!] Missing $WRANGLER_TOML"
    exit 1
  fi
  awk -v name="$new_name" '
    BEGIN { replaced = 0 }
    /^[[:space:]]*name[[:space:]]*=/ {
      print "name = \"" name "\""; replaced = 1; next
    }
    { print }
    END {
      if (!replaced) {
        print "name = \"" name "\""
      }
    }
  ' "$WRANGLER_TOML" > "$WRANGLER_TOML.tmp" && mv "$WRANGLER_TOML.tmp" "$WRANGLER_TOML"
}

# Deploy current worker defined in wrangler.toml and extract the workers.dev URL from wrangler output
# Returns the URL on stdout (like https://warpify0.<subdomain>.workers.dev)
wrangler_deploy_and_get_url() {
  pushd "$WORKER_DIR" >/dev/null
  # Capture output; tee to stderr for user visibility while capturing to variable
  local output
  if ! output=$(wrangler deploy 2>&1 | tee /dev/stderr); then
    echo "[!] wrangler deploy failed" >&2
    popd >/dev/null || true
    return 1
  fi
  popd >/dev/null

  # Extract the last workers.dev URL from output
  local url
  url=$(printf '%s\n' "$output" | grep -Eo 'https://[^ ]+\.workers\.dev' | tail -n 1 || true)
  if [[ -z "${url:-}" ]]; then
    echo "[!] Could not detect workers.dev URL from wrangler output." >&2
    echo "[i] You can still proceed; please edit config.json manually with your worker hostnames." >&2
  fi
  printf '%s\n' "$url"
}

# Set the TOKEN secret for a given worker name using stdin to avoid interactive prompt
set_secret_for_worker() {
  local name="$1"
  local token="$2"
  pushd "$WORKER_DIR" >/dev/null
  # Use echo -n to avoid trailing newline in the secret value
  if ! printf '%s' "$token" | wrangler secret put TOKEN --name "$name" >/dev/null 2>&1; then
    echo "[!] Failed to set TOKEN secret for worker: $name" >&2
    popd >/dev/null || true
    return 1
  fi
  popd >/dev/null
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[!] Required command not found on PATH: $1" >&2
    exit 1
  fi
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

# Try to deploy the Netlify function and return the tunnel url on stdout if successful
# Also sets Netlify env var TUNNEL_TOKEN to the given token if possible
maybe_deploy_netlify() {
  local token="$1"

  if ! have_cmd netlify; then
    echo "" # no url
    return 0
  fi

  # Detect if this repo is linked to a Netlify site
  # We consider it linked if either netlify.toml or .netlify/state.json exists
  if [[ ! -f "netlify.toml" && ! -f ".netlify/state.json" ]]; then
    echo "[i] Netlify CLI detected but no linked site (missing netlify.toml or .netlify/state.json)." >&2
    if [[ -t 0 ]]; then
      read -r -p "[?] Would you like to run 'netlify init' now to link or create a site? [y/N] " ans
      case "${ans:-}" in
        [Yy]*)
          echo "[+] Running 'netlify init'..."
          if ! netlify init; then
            echo "[!] 'netlify init' failed or was cancelled. Skipping Netlify deployment." >&2
            echo ""
            return 0
          fi
          ;;
        *)
          echo "[i] Skipping Netlify deployment." >&2
          echo ""
          return 0
          ;;
      esac
    else
      echo "[i] Non-interactive terminal detected; cannot run 'netlify init'. Skipping Netlify deployment." >&2
      echo ""
      return 0
    fi
  fi

  echo "[+] Attempting Netlify function deployment..."

  # Create an empty dir to satisfy --dir requirement for deploy
  mkdir -p "$EMPTY_DIR"
  : > "$EMPTY_DIR/index.html"

  # Set env var for function auth
  if ! netlify env:set TUNNEL_TOKEN "$token" >/dev/null 2>&1; then
    echo "[!] Failed to set Netlify env var TUNNEL_TOKEN (site may not be linked)." >&2
    # continue anyway
  fi

  # Try production deploy first, then fallback to draft
  local output url
  if output=$(netlify deploy --prod --functions netlify/functions --dir "$EMPTY_DIR" 2>&1 | tee /dev/stderr); then
    :
  else
    echo "[i] Production deploy failed, trying draft deploy..." >&2
    if ! output=$(netlify deploy --functions netlify/functions --dir "$EMPTY_DIR" 2>&1 | tee /dev/stderr); then
      echo "[!] Netlify deploy failed. Continuing without tunnel." >&2
      echo ""
      return 0
    fi
  fi

  # Parse Website URL (prod) or Website Draft URL (draft)
  url=$(printf '%s\n' "$output" | awk -F': ' '/Website (Draft )?URL:/ {print $2}' | tail -n1 | sed 's/[[:space:]]*$//')
  if [[ -z "${url:-}" ]]; then
    echo "[!] Could not parse Netlify site URL from deploy output. Continuing without tunnel." >&2
    echo ""
    return 0
  fi

  # Construct tunnel function URL
  if [[ "$url" != *".netlify/functions/"* ]]; then
    url="${url%/}/.netlify/functions/tunnel"
  fi
  printf '%s\n' "$url"
}

# Always restore wrangler.toml to warpify0 and remove temp files on exit
cleanup() {
  {
    set_worker_name "$NAME0"
    rm -rf "$EMPTY_DIR" 2>/dev/null || true
  } || true
}
trap cleanup EXIT

main() {
  echo "[+] Checking prerequisites..."
  require_cmd bun
  require_cmd wrangler

  # Generate a secure token
  if command -v openssl >/dev/null 2>&1; then
    TOKEN=$(openssl rand -hex 32)
  elif command -v uuidgen >/dev/null 2>&1; then
    # Fallback to uuidgen if openssl is not available, though less ideal for a secret
    TOKEN=$(uuidgen | tr -d '-')
  else
    echo "[!] Neither openssl nor uuidgen is available to generate a token."
    exit 1
  fi
  echo "[+] Generated authorization token for workers (and Netlify function)."

  # Proxy settings (defaults)
  TYPE="http"   # can be "socks" or "http"
  PORT=8080       # 1080 for SOCKS, 8080 for HTTP usually

  echo "[+] Deploying $NAME0..."
  set_worker_name "$NAME0"
  URL0=$(wrangler_deploy_and_get_url || true)

  echo "[+] Setting TOKEN secret on $NAME0..."
  set_secret_for_worker "$NAME0" "$TOKEN"

  echo "[+] Deploying $NAME1..."
  set_worker_name "$NAME1"
  URL1=$(wrangler_deploy_and_get_url || true)

  echo "[+] Setting TOKEN secret on $NAME1..."
  set_secret_for_worker "$NAME1" "$TOKEN"

  # Reset back to warpify0 for safe re-runs (also handled by trap, but we do it explicitly before starting proxy)
  echo "[+] Resetting wrangler.toml name back to $NAME0 for re-runnability..."
  set_worker_name "$NAME0"

  # Derive hosts (no scheme) from URLs, if found; otherwise fall back to worker name with .workers.dev
  host_from_url() { printf '%s' "$1" | sed -E 's#^https?://##; s#/$##' ; }
  HOST0=${URL0:+$(host_from_url "$URL0")}
  HOST1=${URL1:+$(host_from_url "$URL1")}
  if [[ -z "${HOST0:-}" ]]; then HOST0="$NAME0.workers.dev"; fi
  if [[ -z "${HOST1:-}" ]]; then HOST1="$NAME1.workers.dev"; fi

  # Find a free port
  is_port_in_use() {
    local port=$1
    if command -v lsof >/dev/null 2>&1; then
      lsof -i :"$port" >/dev/null 2>&1
    elif command -v netstat >/dev/null 2>&1; then
      netstat -an | grep LISTEN | grep ":$port " >/dev/null 2>&1
    else
      return 1
    fi
  }

  find_free_port() {
    local start_port=${1:-1024}
    local max_port=65535
    local port

    if ! is_port_in_use "$PORT"; then
      echo "$PORT"; return 0
    fi
    echo "[!] Port $PORT is in use. Searching for a free port..." >&2
    for i in $(seq 1 100); do
      port=$((start_port + RANDOM % (max_port - start_port + 1)))
      if ! is_port_in_use "$port"; then echo "$port"; return 0; fi
    done
    echo "[!] Could not find a free port after 100 attempts." >&2
    return 1
  }

  FREE_PORT=$(find_free_port)
  if [[ -z "$FREE_PORT" ]]; then
    echo "[!] Failed to find a free port. Exiting."
    exit 1
  fi
  if [[ "$FREE_PORT" != "$PORT" ]]; then echo "[+] Using free port: $FREE_PORT"; fi

  # Optionally deploy Netlify function tunnel
  NETLIFY_TUNNEL_URL=""
  if have_cmd netlify; then
    NETLIFY_TUNNEL_URL=$(maybe_deploy_netlify "$TOKEN") || NETLIFY_TUNNEL_URL=""
    if [[ -n "$NETLIFY_TUNNEL_URL" ]]; then
      echo "[+] Netlify tunnel available at: $NETLIFY_TUNNEL_URL"
    else
      echo "[i] Netlify tunnel not configured. The proxy will still work for non-Cloudflare sites."
    fi
  else
    echo "[i] Netlify CLI not found; skipping tunnel deployment."
  fi

  echo "[+] Writing config.json with the new workers and token..."
  # Always write worker config and add Netlify settings if available
  {
    cat <<JSON
{
  "worker": [
    "${HOST0}",
    "${HOST1}"
  ],
  "authorization": "${TOKEN}",
  "port": ${FREE_PORT},
  "type": "${TYPE}",
  "verbose": false,
  "load_balancing_strategy": "random"$(
    if [[ -n "$NETLIFY_TUNNEL_URL" ]]; then
      printf ',\n  "netlify_tunnel_url": "%s",\n  "netlify_tunnel_token": "%s",\n  "cloudflare_detection_enabled": true' "$NETLIFY_TUNNEL_URL" "$TOKEN"
    fi
  )
}
JSON
  } > config.json

  echo "[+] Configuration written to config.json"
  echo "    Workers: ${HOST0}, ${HOST1}"
  echo "    Type: ${TYPE}, Port: ${FREE_PORT}"
  if [[ -n "$NETLIFY_TUNNEL_URL" ]]; then
    echo "    Tunnel: ${NETLIFY_TUNNEL_URL} (cloudflare_detection_enabled=true)"
  fi

  echo "[+] Starting proxy client..."
  echo "    Press Ctrl+C to stop the proxy."
  echo "[i] Running command: bun proxy.js $TYPE -a $TOKEN -p $FREE_PORT --worker $HOST0 --worker $HOST1"
  bun proxy.js "$TYPE" -a "$TOKEN" -p "$FREE_PORT" --worker "$HOST0" --worker "$HOST1"
}

main "$@"

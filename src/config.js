const parseBool = (v, fallback = undefined) => {
  if (v === undefined) return fallback;
  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes' || s === 'y') return true;
  if (s === 'false' || s === '0' || s === 'no' || s === 'n') return false;
  return fallback;
};

const parseNum = (v, fallback = undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const loadConfig = (argv = []) => {
  // Load configuration from command-line arguments only
  let options = {
    workers: [],
  };

  // CLI parsing
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '-h':
      case '--help':
        return { help: true };
      case '-v':
      case '--verbose':
        options.verbose = true;
        break;
      case '-p':
      case '--port':
        options.port = Number.parseInt(argv[++i], 10);
        break;
      case '-a':
      case '--auth':
        options.authorization = argv[++i];
        break;
      case '--retry-enabled': {
        const next = argv[i + 1];
        const parsed = parseBool(next, true);
        if (next && (next.toLowerCase?.() === 'true' || next.toLowerCase?.() === 'false')) {
          i += 1;
          options.retry_enabled = parsed;
        } else {
          options.retry_enabled = true; // flag without value defaults to true
        }
        break;
      }
      case '--max-retries':
        options.max_retries = Number.parseInt(argv[++i], 10);
        break;
      case '--retry-initial-backoff':
        options.retry_initial_backoff = Number.parseInt(argv[++i], 10);
        break;
      case '--retry-factor':
        options.retry_factor = parseNum(argv[++i]);
        break;
      case 'socks':
      case 'SOCKS':
      case 'SOCKS5':
        options.type = 'SOCKS5';
        break;
      case 'http':
      case 'HTTP':
        options.type = 'HTTP';
        break;
      case '--worker':
        options.workers.push(argv[++i]);
        break;
      case '--strategy':
        options.strategy = argv[++i];
        break;
      case '--function':
        options.netlify_tunnel_url = argv[++i];
        break;
      case '--netlify-tunnel-token':
        options.netlify_tunnel_token = argv[++i];
        break;
      case '--cloudflare-detection-enabled':
        options.cloudflare_detection_enabled = true;
        break;
      default:
        if (/^[\w\-]+(\.[\w\-]+)+$/.test(argv[i])) {
          options.workers.push(argv[i]);
        } else {
          console.log(`Invalid option: ${argv[i]}`);
          return null;
        }
        break;
    }
  }

  return options;
};

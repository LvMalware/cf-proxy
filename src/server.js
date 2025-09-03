import { proxyConnect } from './proxy-connector.js';
import { createLogger } from './logger.js';

const parseTarget = (data) => {
  try {
    return String(data).toLowerCase().split('\n')
      .filter(l => l.startsWith('host: ')).pop().split(': ')
      .pop().trim();
  } catch (e) {
    // log
  }

  return '';
};

export const httpServer = (options) => {
  const log = createLogger(options);
  return Bun.listen({
  port: options.port || 8080,
  hostname: '0.0.0.0',
  socket: {
    async data(socket, data) {
      try {
        if (!socket.proxy) {
          const target = parseTarget(data);
          // Pass initialData so proxy can decide tunnel vs websocket and reuse the bytes
          socket.proxy = await proxyConnect(target, socket, options, data);
        } else {
          socket.proxy.send(data);
        }
      } catch (err) {
        log.error('[HTTP] Socket data error:', err?.stack || err);
        try { socket.shutdown(); } catch (_) {}
      }
    }
  }
  });
}

export const socks5Server = (options) => {
  const log = createLogger(options);
  return Bun.listen({
  port: options.port || 1080,
  hostname: '0.0.0.0',
  socket: {
    async open(socket) {
      try {
        socket.step = 0;
      } catch (err) {
        log.error('[SOCKS5] Socket open error:', err?.stack || err);
        try { socket.shutdown(); } catch (_) {}
      }
    },
    async data(socket, data) {
      try {
      if (socket.proxy) {
        socket.proxy.send(data);
        return;
      }

      switch (socket.step) {
        case 0: {
          if (data[0] !== 0x05) {
            log.warn('SOCKS version mismatch');
            socket.shutdown();
          }

          if (!data.slice(2).includes(0x00)) {
            // either is not a real socks client, or it needs to be authenticated somehow
            log.warn('SOCKS client error');
            socket.shutdown();
          }

          // no auth required
          socket.write(Buffer.from([0x5, 0x00]));
          socket.step++;

          break;
        }

        case 1: {
          if (data[0] !== 0x05 || data[2] !== 0x00) {
            if (options.verbose) console.log('[!] SOCKS version mismatch');
            socket.shutdown();
          }

          // we only allow connect (0x01) requests
          if (data[1] !== 0x01) {
            if (options.verbose) console.log('[!] Client request could not be satisfied');
            socket.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
            socket.shutdown();
          }

          // now we parse the target information
          let target = '';

          if (data[3] === 0x1) {
            // ipv4
            target = data.slice(4, 8).map(n => n.toString()).join('.');
          } else if (data[3] === 0x3) {
            // domain
            target = String(Buffer.from(data.slice(5, 5 + data[4])));
          } else if (data[3] === 0x4) {
            // ipv6
            const ipv6 = Array.from(data.slice(4, 20)).map(b => b.toString(16).padStart(2, 0));

            for (let i = 0; i < ipv6.length; i += 2) {
              if (i !== 0) target += ':';
              target += ipv6.slice(i, i + 2).join('');
            }

            // ipv6 short form
            target = target.replaceAll(':00', ':').replaceAll(':00', ':');
            target = `[${target.replaceAll(':::', ':')}]`;
          } else {
            // unknown
            if (options.verbose)
              console.log('[!] Client request could not be satisfied');
            socket.shutdown();
          }

          const port = data.at(-1) + data.at(-2) * 256;
          target = `${target}:${port}`;
          socket.proxy = proxyConnect(target, socket, options);

          break;
        }
      }
      } catch (err) {
        log.error('[SOCKS5] Socket data error:', err?.stack || err);
        try { socket.shutdown(); } catch (_) {}
      }
    }
  }
  });
}

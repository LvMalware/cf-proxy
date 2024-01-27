const parseTarget = (data) => {
    try {
        return String(data).toLowerCase().split('\n')
            .filter( l => l.startsWith('host: ') ).pop().split(': ').pop();
    } catch(e) {
        // log
    }
    return '';
};

const proxyConnect = (target, socket, options) => {
    if (options.verbose)
        console.log(`[+] Proxying connection to ${target} via ${options.worker}`);
    const ws = new WebSocket(`wss://${options.worker}`, {
        headers: {
            Authorization: options.authorization,
            'X-Proxy-Target': target,
        }
    });

    ws.onopen = (e) => {
        if (options.type == 'HTTP')
            socket.write('HTTP/1.1 200 OK\r\n\r\n');
        else
            socket.write(Buffer.from([0x5, 0x00, 0x00, 0x01, 0x7f, 0x00, 0x00, 0x01, 0x00, 0x00]));
    }

    ws.onerror = (e) => socket.shutdown();

    ws.onclose = (e) => {
        if (e.reason == "Expected 101 status code") {
            if (options.type == 'HTTP')
                socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
            else
                socket.write(Buffer.from([0x5, 0x05, 0x00, 0x01, 0x7f, 0x00, 0x00, 0x01, 0x00, 0x00]));
            if (options.verbose) console.log('[!] Worker connection failed!');
        }
        socket.shutdown();
    };

    ws.onmessage = (e) => {
        socket.write(e.data);
    };

    return ws;
};

const httpServer = (options) => Bun.listen({
    port: options.port || 8080,
    hostname: '0.0.0.0',
    socket: {
        async data(socket, data) {
            if (!socket.proxy) {
                const target = parseTarget(data);
                socket.proxy = proxyConnect(target, socket, options);
            } else {
                socket.proxy.send(data);
            }
        }
    }
});

const socks5Server = (options) => Bun.listen({
    port: options.port || 1080,
    hostname: '0.0.0.0',
    socket: {
        async open(socket) {
            socket.step = 0;
        },
        async data(socket, data) {
            if (socket.proxy) {
                socket.proxy.send(data);
                return;
            }
            switch (socket.step) {
                case 0:
                    if (data[0] != 0x05) {
                        if (options.verbose) console.log('[!] SOCKS version mismatch');
                        socket.shutdown();
                    }
                    if (!data.slice(2).includes(0x00)) {
                        // either is not a real socks client, or it needs to be authenticated somehow
                        if (options.verbose) console.log('[!] SOCKS client error');
                        socket.shutdown();
                    }
                    // no auth required
                    socket.write(Buffer.from([0x5, 0x00]));
                    socket.step ++;
                    break;
                case 1:
                    if (data[0] != 0x05 || data[2] != 0x00) {
                        if (options.verbose) console.log('[!] SOCKS version mismatch');
                        socket.shutdown();
                    }

                    // we only allow connect (0x01) requests
                    if (data[1] != 0x01) {
                        if (options.verbose) console.log('[!] Client request could not be satisfied');
                        socket.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
                        socket.shutdown();
                    }

                    // now we parse the target information
                    let target = '';

                    if (data[3] == 0x1) {
                        // ipv4
                        target = data.slice(4,8).map(n => n.toString()).join('.');
                    } else if (data[3] == 0x3) {
                        // domain
                        target = String(Buffer.from(data.slice(5, 5 + data[4])));
                    } else if (data[3] == 0x4) {
                        // ipv6
                        const ipv6 = Array.from(data.slice(4,20)).map(b => b.toString(16).padStart(2,0));
                        for (let i = 0; i < ipv6.length; i += 2) {
                            if (i != 0) target += ':';
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
    }
});

const parseOptions = (argv) => {
    // poor man's arg parser

    if (argv.length < 2) {
        return {help: true};
    }

    const options = { };

    for (let i = 0; i < argv.length; i ++) {
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
                options.port = parseInt(argv[++i]);
                break;
            case '-a':
            case '--auth':
                options.authorization = argv[++i];
                break;
            case 'socks':
                options.type = 'SOCKS5';
                options.server = socks5Server;
                break;
            case 'http':
                options.type = 'HTTP';
                options.server = httpServer;
                break;
            default:
                if (/^\w+(\.\w+)+$/.test(argv[i])) {
                    options.worker = argv[i];
                } else {
                    console.log(`Invalid option: ${argv[i]}`);
                    return null;
                }
                break;
        }
    }
    return options;
};

function main() {
    const options = parseOptions(Bun.argv.slice(2));
    if (!options) return -1;
    if (options.help) {
        console.log(`${import.meta.file} - Proxy requests through CloudFlare workers`);
        console.log(`Usage: bun ${import.meta.file} [options] <socks|http> <worker>`);
        console.log('')
        console.log('Options:');
        console.log('')
        console.log('-h, --help         Show this help message and exit');
        console.log('-p, --port         Port to listen on (defaults to 1080 for socks and 8080 for http)');
        console.log('-a, --auth         Authorization header');
        console.log('-v, --verbose      Enable verbose mode (default: false)');
        console.log('')
        console.log(`Example: bun ${import.meta.file} -v -a auth-secret socks my-instance.workers.dev`);
        console.log('')
        console.log('By Lucas V. Araujo <root@lva.sh>');
        console.log('More at https://github.com/lvmalware');
        return 0;
    }

    const server = options.server(options);
    console.log(`[+] ${options.type} proxy server listening on ${server.hostname}:${server.port}`);
    return 0;
}

if (import.meta.main) {
    main();
}

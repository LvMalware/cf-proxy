const parseTarget = (data) => {
    let addr = String(data).split('\n').shift().split(' ')[1].split(':');
    let host = addr[0];
    let port = addr[1];
    if (addr[1].startsWith('//')) {
        host = addr[1].replaceAll('/', '');
        port = addr[2] || ((addr[0] == 'http') ? 80 : 443);
    }
    return `${host}:${port}`;
};

const httpServer = Bun.listen({
    port: 8080,
    hostname: '0.0.0.0',
    socket: {
        async data(socket, data) {
            if (!socket.proxy) {
                const target = parseTarget(data);
                console.log(`[+] Proxying connection to ${target} via Cloudflare`);
                socket.proxy = new WebSocket('wss://<YOUR-WORKER-DOMAIN>.workers.dev', {
                    headers: {
                        Authorization: '<YOUR-AUTH-TOKEN>',
                        'X-Proxy-Target': target,
                    }
                });

                socket.proxy.addEventListener('open', e => {
                    socket.write('HTTP/1.1 200 OK\r\n\r\n');
                });

                socket.proxy.addEventListener('close', e => console.log(e));
                
                socket.proxy.addEventListener('message', e => socket.write(e.data));
            } else {
                socket.proxy.send(data);
            }
        }
    }
});

console.log(`[+] HTTP Proxy server listening on ${httpServer.hostname}:${httpServer.port}`);

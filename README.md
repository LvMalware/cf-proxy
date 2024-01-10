# cf-proxy

> Proxy requests through Cloudflare workers

A simple worker that acts as proxy to tunnel requests over the internet, forwarding them through Cloudflare's global network of servers. This way, we can archieve automatic IP address rotation, all coming from a trusted ASN (as CF is used by a hude number of websites, their ASNs are usually whitelisted on firewalls :stuck_out_tongue_winking_eye: ).

## Usage

You will need [bun](https://bun.sh/) to run the client script `proxy.js`. You can install it by running:

```bash
curl -fsSL https://bun.sh/install | bash
. ~/.bashrc
```

You also need a Cloudflare account to deply the worker. A free account is fine, but you might experience some issues with page loading with slow website connections as the workers have a limitation of 10ms CPU time per request on the free tier, but as long as you don't try to download any big files this should be enough to navigate the internet.

Once you have bun installed, go ahead and install `wrangler` using:

```bash
bun i -g wrangler
```

Login to CF with `wrangler`:

```bash
wrangler login
```

Then, cd into `worker/` directory and install dependences with:

```bash
cd worker/
bun i
```

Now, edit the file at `src/index.js` to include an authorization token (necessary to avoid other people from using it). Just change the following line:

```javascript
         if (request.headers.get('Authorization') !== '<YOUR-AUTH-TOKEN>')
             return new Response('Unauthorized', { status: 401 });
```

Replace `<YOUR-AUTH-TOKEN>` with a token/password and also edit the `proxy.js` to include the same token in the authorization header.

Now, you can deploy the worker with
```bash
cd worker/
wrangler deploy
```

Take note of the URL assigned to your worker and edit the `proxy.js` script again to replace `<YOUR-WORKER-DOMAIN>` with the hostname assigned to your deployment.

Now simply run `bun proxy.js` and configure your browser to use `127.0.0.1:8080` as an HTTP proxy and enjoy the automatic ip address rotation :wink:.


## Notes

Your ip address will rotate at each request, since the worker runs on the so-called serverless architecture, spawned in a distributed global network of servers owned by cloudflare. Each time you invoke a worker, a different server might be provisioned depending on the current availability. These servers might be located on your region (which is usually the case) or even in another country.

This project is just an example to showcase an application that I developed while learning javascript and [Workers](https://workers.cloudflare.com/). I'm not related to the company, nor I endorse or otherwise discourage the usage their services. And finally, this project is intended only for educational purposes and I won't be responsible for any bad actions or abuse of this service. 


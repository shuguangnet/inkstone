# Docker deployment on a VPS

This deployment runs the built Inkstone Worker in the local workerd runtime managed by Wrangler. D1, KV, attachment data, OAuth state, and Durable Object state are stored in one persistent Docker volume.

## Requirements

- Linux VPS with Docker Engine and Docker Compose
- 2 CPU cores, 2 GB RAM, and 5 GB free disk space or more
- A domain name with HTTPS termination through Caddy, Nginx, Traefik, or another reverse proxy
- A single running application replica; the local state volume is not designed for horizontal scaling

Workers AI is not available in this mode, so semantic search stays disabled. Lexical full-text search, attachments, MCP, sharing, WebDAV backups, and S3 backups remain available.

## Start the service

```bash
git clone https://github.com/shuguangnet/inkstone.git
cd inkstone
cp .env.example .env
sed -i "s/^INKSTONE_SCHEDULE_TOKEN=.*/INKSTONE_SCHEDULE_TOKEN=$(openssl rand -hex 32)/" .env
```

Edit `.env` and set the public HTTPS origin:

```dotenv
INKSTONE_PUBLIC_URL=https://notes.example.com
INKSTONE_PORT=7712
INKSTONE_APP_NAME=Inkstone
INKSTONE_LOG_LEVEL=info
INKSTONE_SCHEDULE_TOKEN=generated-random-value
```

`INKSTONE_PUBLIC_URL` must match the URL used in the browser. It controls secure cookies, public share links, and MCP OAuth metadata.

Build and start the containers:

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:7712/api/health
```

The Compose stack contains:

- `app`: built Worker bundle running in local workerd with persistent state under `/data`
- `scheduler`: invokes the two configured Cloudflare-style cron triggers at `00`, `15`, and `45` minutes UTC
- `gateway`: exposes only `127.0.0.1:7712` and blocks public access to the internal scheduler endpoint

## Configure HTTPS

The bundled gateway intentionally listens on loopback only. Point the VPS reverse proxy at it.

Caddy example:

```caddyfile
notes.example.com {
  reverse_proxy 127.0.0.1:7712
}
```

Nginx example:

```nginx
server {
    listen 443 ssl http2;
    server_name notes.example.com;

    location / {
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_pass http://127.0.0.1:7712;
    }
}
```

Do not publish the `app` service or its internal scheduler endpoint directly.

## Upgrade

Create a current Inkstone backup, then rebuild from the new revision:

```bash
git pull --ff-only
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:7712/api/health
```

Schema migrations run automatically on the first request after startup.

## Back up and restore

Use Inkstone's built-in WebDAV or S3 backup for portable Markdown snapshots. Also snapshot the `inkstone_data` Docker volume as part of the VPS backup policy because it contains accounts, sessions, settings, attachments, and local runtime state.

Stop writes before taking a raw filesystem snapshot:

```bash
docker compose stop gateway scheduler app
```

After the volume snapshot completes:

```bash
docker compose start app scheduler gateway
```

Restore a volume snapshot only while all three services are stopped.

## Operations

```bash
docker compose logs -f app
docker compose logs -f scheduler
docker compose restart app
docker compose down
```

`docker compose down` preserves the named data volume. Do not add `--volumes` unless the local Inkstone data is intentionally being deleted.

## Security notes

- Keep the published port bound to `127.0.0.1` and expose Inkstone only through HTTPS.
- Keep `.env` out of Git and restrict it to the deployment owner.
- Back up the persistent volume and test restore procedures.
- This is a single-node runtime. It does not provide Cloudflare's distributed availability, managed storage durability, or Workers AI binding.

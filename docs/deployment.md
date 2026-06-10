# Deployment

## Docker (Recommended)

### Dockerfile

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
COPY . .
RUN mkdir -p /data/storage src/DataFiles
EXPOSE 3000
CMD ["node", "server.js"]
```

Key details:
- Based on `node:22-alpine` (lightweight)
- Production dependencies only (`npm ci --production`)
- Creates `/data/storage` and `src/DataFiles` directories
- Seeds example data files from `*.example.json` if no existing files
- Exposes port 3000

### Docker Compose

```yaml
services:
  docpilot:
    build: .
    container_name: docpilot
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file:
      - .env
    volumes:
      - geggos-storage:/data/storage       # Project files
      - geggos-appdata:/app/src/DataFiles   # User data, settings, logs
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000"]
      interval: 30s
      timeout: 5s
      retries: 3
```

**Volumes:**
- `geggos-storage` — All project files (maps to `STORAGE_ROOT`)
- `geggos-appdata` — JSON data files (users, projects, ACL, logs, etc.)

> **Important:** If `STORAGE_ROOT` in `.env` is `./storage` (relative), it resolves to `/app/storage` inside the container. The Docker Compose volume maps to `/data/storage`. Make sure `STORAGE_ROOT=/data/storage` in your `.env` when using Docker, or adjust the volume mount.

### Build & Run

```bash
docker compose up -d --build
```

### Traefik Integration

The `docker-compose.yml` includes Traefik labels:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.docpilot.rule=Host(`geggos.ai`)"
  - "traefik.http.routers.docpilot.entrypoints=websecure"
  - "traefik.http.routers.docpilot.tls.certresolver=letsencrypt"
  - "traefik.http.services.docpilot.loadbalancer.server.port=3000"
```

This assumes Traefik is running separately and handling:
- SSL/TLS termination via Let's Encrypt
- HTTP → HTTPS redirect
- Reverse proxying to port 3000

### Caddy Alternative

A `Caddyfile` is provided:

```
geggos.ai {
    reverse_proxy geggos-app:3000
    request_body {
        max_size 50MB
    }
}
```

Caddy provides automatic HTTPS with Let's Encrypt by default.

## Manual Deployment (No Docker)

```bash
# Install Node.js 18+ (e.g., via nvm)
nvm install 22
nvm use 22

# Clone and install
git clone <repo-url>
cd Docpilot-V3
npm install

# Configure
cp .env.example .env
# Edit .env

# Start
node server.js
# Or with a process manager:
pm2 start server.js --name docpilot
```

## Environment Variables

See [Getting Started](./getting-started.md) for the full `.env` reference.

## Port

The server always listens on port **3000** (hardcoded in `server.js`). To change it, modify the `PORT` constant in `server.js`.

## Graceful Shutdown

On `SIGTERM` or `SIGINT`:
1. Super logger flushes remaining entries to disk
2. All open SQLite chat DB connections are closed
3. HTTP server closes (stops accepting new connections)
4. Process exits

## Health Check

The Docker healthcheck uses `wget` to check `http://localhost:3000`. The server responds to any GET request to `/` with the `index.html` page (via `express.static`).

## Backup Strategy

### With NAS Sync

If NAS sync is enabled, all project files are automatically replicated to the NAS server. Local copies are cleaned after 48 hours (verified against NAS before deletion).

### Without NAS Sync

Back up these directories:
1. `src/DataFiles/` — All user data, settings, ACL, logs
2. `storage/` (or wherever `STORAGE_ROOT` points) — All project files and chat databases

### Recommended

```bash
# Daily backup of data files
tar -czf backup-data-$(date +%Y%m%d).tar.gz src/DataFiles/

# Weekly backup of project storage
tar -czf backup-storage-$(date +%Y%m%d).tar.gz storage/
```

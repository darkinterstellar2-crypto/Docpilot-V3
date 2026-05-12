# Hosting & Deployment

> Complete guide to the VPS, Docker setup, Traefik reverse proxy, and deployment operations.

---

## VPS Details

| Field | Value |
|---|---|
| Provider | Hostinger |
| IP | 187.124.164.237 |
| OS | Linux (Ubuntu) |
| Domain | geggos.ai |
| DNS provider | Porkbun |
| SSL | Auto via Traefik + Let's Encrypt |

---

## Domain & DNS Setup

**Registrar:** Porkbun

**DNS Record:**
```
Type: A
Host: @       (or geggos.ai)
Value: 187.124.164.237
TTL: 600
```

This points `geggos.ai` directly to the VPS IP.

**Why no www subdomain?** The Traefik rule matches `Host("geggos.ai")` only. If you want `www.geggos.ai` too, add a second Traefik router or a CNAME DNS record.

---

## Architecture: What Runs Where

```
VPS (187.124.164.237)
├── Traefik (reverse proxy, runs as Docker container or host service)
│   ├── Handles SSL termination (Let's Encrypt ACME)
│   ├── Routes geggos.ai → docpilot container port 3000
│   └── Docker socket access to discover containers via labels
│
└── docpilot (Docker container)
    ├── Node.js Express server on port 3000
    ├── Volume: geggos-storage → /data/storage
    └── Volume: docpilotdata → /app/src/DataFiles
```

Traefik listens on port 80 (HTTP, redirect to HTTPS) and port 443 (HTTPS). Port 3000 is NOT exposed to the internet — only Traefik can reach it.

---

## Dockerfile (Annotated)

```dockerfile
FROM node:22-alpine
# Use Node.js 22 LTS on Alpine Linux (minimal image, ~5MB base)

WORKDIR /app
# All app files will live at /app inside the container

COPY package.json package-lock.json ./
RUN npm ci --production
# Copy lockfiles first for better Docker layer caching.
# npm ci (clean install) uses exact versions from lockfile.
# --production: skip devDependencies (none in this project anyway)

COPY . .
# Copy all app source code (excluding what's in .dockerignore)
# .dockerignore excludes: node_modules, .env, .git, storage/, *.db, docs/

RUN mkdir -p /data/storage src/DataFiles
# Pre-create the data directories so volume mounts work correctly
# /data/storage → overridden by geggos-storage named volume
# src/DataFiles → overridden by docpilotdata named volume

EXPOSE 3000
# Document that the app listens on port 3000

CMD ["node", "server.js"]
# Start the server directly (no process manager needed inside container)
```

### .dockerignore explanation
```
node_modules     ← Must exclude — re-installed in container by npm ci
.env             ← Never copy secrets into image
.git             ← Git history not needed in container
.gitignore       ← Not needed
*.md             ← Docs not needed
docs/            ← Docs not needed
storage/         ← Data is in volumes, not image
*.db, *.db-wal, *.db-shm  ← SQLite files in volumes
.DS_Store        ← macOS cruft
```

---

## docker-compose.yml (Annotated)

```yaml
services:
  docpilot:
    build: .
    # Build from Dockerfile in current directory

    container_name: docpilot
    # Fixed container name (used by Traefik service discovery)

    restart: unless-stopped
    # Auto-restart on crash or VPS reboot; stops only when manually stopped

    ports:
      - "3000:3000"
    # Map host:container port. Even though Traefik handles external traffic,
    # this allows direct access on VPS for debugging (not exposed publicly by firewall)

    env_file:
      - .env
    # Load all environment variables from .env file (NOT committed to git)

    volumes:
      - geggos-storage:/data/storage
      # Named volume for all project files. Persists across container rebuilds.
      # STORAGE_ROOT must be set to /data/storage in .env

      - docpilotdata:/app/src/DataFiles
      # Named volume for users.json, projects.json, logs, etc.
      # Persists across container rebuilds.

    labels:
      - "traefik.enable=true"
      # Tell Traefik to route traffic to this container

      - "traefik.http.routers.geggos.rule=Host(`geggos.ai`)"
      # Only route requests for geggos.ai domain

      - "traefik.http.routers.geggos.entrypoints=websecure"
      # Use the HTTPS (443) entrypoint

      - "traefik.http.routers.geggos.tls.certresolver=letsencrypt"
      # Use Let's Encrypt for SSL cert (Traefik handles renewal)

      - "traefik.http.services.geggos.loadbalancer.server.port=3000"
      # Forward to port 3000 inside container

    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000"]
      # Use wget (pre-installed on Alpine) to check if server is up
      interval: 30s   # Check every 30 seconds
      timeout: 5s     # Consider unhealthy after 5s no response
      retries: 3      # Mark unhealthy after 3 consecutive failures

volumes:
  geggos-storage:
  # Named Docker volume for STORAGE_ROOT (/data/storage)
  # Contents survive: container stop, remove, rebuild
  # Contents lost on: docker volume rm geggos-storage (manual)

  docpilotdata:
  # Named Docker volume for src/DataFiles
  # Contains: users.json, projects.json, logs, ACL, shares, sessions
  # Contents survive: container stop, remove, rebuild
```

---

## Traefik: Reverse Proxy

### Why Traefik (not Nginx or Caddy)?

The VPS already had Traefik running as the primary reverse proxy for other services. Using a second proxy would have caused a **port conflict** (two services cannot bind to port 80/443 simultaneously).

- Caddy (`Caddyfile` is in the repo) was the original plan, but was abandoned
- Nginx would have the same conflict problem
- Traefik was already on the VPS → easiest integration via Docker labels

### How Traefik discovers services

Traefik watches the Docker socket (`/var/run/docker.sock`) for containers. When it sees a container with `traefik.enable=true`, it reads the labels and auto-configures routing rules.

**No Traefik config file needs editing** — just deploy the container with correct labels.

### SSL/HTTPS

Traefik uses **ACME (Let's Encrypt)** via the `letsencrypt` cert resolver:
1. Traefik registers a cert for `geggos.ai` automatically on first start
2. HTTP-01 or TLS-ALPN-01 challenge is used for domain verification
3. Cert is stored in Traefik's ACME storage (managed by Traefik, not our app)
4. Cert renewals happen automatically (Let's Encrypt certs expire every 90 days)

### Traefik config requirements on VPS

The VPS Traefik instance must have:
```toml
# or equivalent YAML / CLI flags
[entryPoints]
  [entryPoints.web]
    address = ":80"
  [entryPoints.websecure]
    address = ":443"

[certificatesResolvers.letsencrypt.acme]
  email = "admin@geggos.ai"
  storage = "/etc/traefik/acme.json"
  [certificatesResolvers.letsencrypt.acme.httpChallenge]
    entryPoint = "web"

[providers.docker]
  exposedByDefault = false
```

---

## .env File on VPS

The `.env` file lives at `/path/to/docpilot/.env` on the VPS (NOT in the Docker image — listed in `.dockerignore`).

`docker-compose.yml` loads it via `env_file: - .env`.

**Example production .env:**
```ini
# Storage
STORAGE_ROOT=/data/storage

# SMTP
SMTP_HOST=w017f912.kasserver.com
SMTP_PORT=465
SMTP_USER=m07e22c0
SMTP_PASS=your_smtp_password_here
SMTP_FROM=noreply@geggos.com

# NAS Sync (enable when NAS is accessible from VPS)
NAS_SYNC_ENABLED=true
NAS_WEBDAV_URL=http://100.x.x.x:5005
NAS_USERNAME=webdav_user
NAS_PASSWORD=webdav_password
NAS_SYNC_INTERVAL=300000
NAS_REMOTE_BASE=/Supreme
```

See [environment.md](./environment.md) for complete variable documentation.

---

## Container Management Commands

### Start (first time or after code changes)
```bash
cd /path/to/docpilot
docker compose up -d --build
```

### View logs
```bash
docker compose logs -f docpilot
```

### Stop
```bash
docker compose down
```

### Restart
```bash
docker compose restart docpilot
```

### Rebuild (after code changes)
```bash
docker compose up -d --build docpilot
```

### Shell into container
```bash
docker exec -it docpilot sh
```

### Check health
```bash
docker ps
# Look for Status: Up X hours (healthy)
```

---

## How to Update the App

```bash
# 1. SSH into VPS
ssh user@187.124.164.237

# 2. Navigate to app directory
cd /path/to/docpilot

# 3. Pull latest code from GitHub
git pull origin main

# 4. Rebuild and restart container
docker compose up -d --build

# 5. Verify it started correctly
docker compose logs -f docpilot
```

The named volumes (`geggos-storage`, `docpilotdata`) are NOT affected by rebuilds — all project data and user accounts are preserved.

---

## How to Edit users.json (in Container)

The users database lives in the `docpilotdata` volume at `/app/src/DataFiles/users.json` inside the container.

### Option 1: Via admin panel
Log in as admin/superadmin → `/admin` page → manage users there.

### Option 2: Directly edit in container
```bash
# Open shell in container
docker exec -it docpilot sh

# Navigate to DataFiles
cd /app/src/DataFiles

# View users
cat users.json

# Edit (vi is available in Alpine)
vi users.json
```

### Option 3: Copy out, edit, copy back
```bash
# Copy out
docker cp docpilot:/app/src/DataFiles/users.json ./users.json

# Edit on host machine
nano users.json

# Copy back
docker cp ./users.json docpilot:/app/src/DataFiles/users.json
```

### Creating a superadmin user
There is no registration endpoint for superadmin. Add directly to `users.json`:
```json
{
  "id": "1712345678902",
  "name": "Admin Name",
  "username": "superadmin",
  "email": "admin@company.de",
  "password": "SecureP@ss1",
  "role": "superadmin",
  "isVerified": true,
  "isApproved": true,
  "createdAt": "2026-04-04T21:00:00.000Z"
}
```
> **Note:** The `otp` field is a legacy artifact. New registrations do **not** store OTPs in `users.json` — OTPs are held in an in-memory map only until email verification completes. You can omit `otp` when creating accounts manually. If you see `"otp": null` in existing entries, that is a backward-compatible remnant from the old flow and can be safely ignored.
The app reads `users.json` on every request — no restart needed.

---

## Volume Persistence

### What survives container recreation
- `geggos-storage` volume → all project data, files, chat databases, NAS sync manifest
- `docpilotdata` volume → users, projects, logs, ACL rules, shares, sessions

### What does NOT survive container recreation
- `/app/node_modules` → re-installed by `npm ci` on build
- Any files written to the container filesystem outside of volumes
- Environment variables → must be in `.env` file

### Backup considerations

**Critical data to back up:**
1. `geggos-storage` Docker volume → all project data
2. `docpilotdata` Docker volume → users + project registry

**Backup commands:**
```bash
# Backup storage volume
docker run --rm -v geggos-storage:/data -v $(pwd):/backup alpine \
  tar czf /backup/geggos-storage-$(date +%Y%m%d).tar.gz -C /data .

# Backup appdata volume
docker run --rm -v docpilotdata:/data -v $(pwd):/backup alpine \
  tar czf /backup/docpilotdata-$(date +%Y%m%d).tar.gz -C /data .
```

**NAS integration as backup:** When NAS sync is enabled, all project files in `geggos-storage` are mirrored to the UGREEN NAS automatically. This serves as an effective off-site backup for project files, but NOT for `docpilotdata` (users.json, projects.json, etc.).

---

## The Caddyfile

The `Caddyfile` in the repo is **not used in production**. It was the original reverse proxy plan before discovering Traefik was already running on the VPS.

```caddyfile
geggos.ai {
  reverse_proxy docpilot:3000
  request_body {
    max_size 50MB
  }
}
```

Kept for reference / future use if Caddy replaces Traefik.

# Environment Variables

> Complete reference for all environment variables used by docpilot.

---

## Overview

Environment variables are loaded from a `.env` file at app startup via `dotenv` (`require('dotenv').config()` at the top of `server.js`).

- **Template:** `.env.example` (committed to git, safe — contains no secrets)
- **Actual file:** `.env` (gitignored, must be created manually on each environment)
- **Docker:** `docker-compose.yml` loads `.env` via `env_file: - .env`

---

## All Environment Variables

### Storage

| Variable | Required | Default | Description |
|---|---|---|---|
| `STORAGE_ROOT` | No | `./storage` | Absolute or relative path to the storage root directory. All project data lives here. |

**Example:**
```ini
# Local development (relative path)
STORAGE_ROOT=./storage

# Docker / VPS production (absolute path in volume)
STORAGE_ROOT=/data/storage
```

**Where it's used:** `controllers/storageConfig.js`  
**Impact:** All path helper functions resolve relative to this value. Changing it after data exists requires moving the data directory.

---

### SMTP (Email)

Used for OTP registration emails and approval notification emails.

| Variable | Required | Default | Description |
|---|---|---|---|
| `SMTP_HOST` | Yes (if email needed) | — | SMTP server hostname |
| `SMTP_PORT` | No | `465` | SMTP port (465 = SSL/TLS, 587 = STARTTLS) |
| `SMTP_USER` | Yes (if email needed) | — | SMTP authentication username |
| `SMTP_PASS` | Yes (if email needed) | — | SMTP authentication password |
| `SMTP_FROM` | Yes (if email needed) | — | From address shown in emails |

**Current values (from `.env.example`):**
```ini
SMTP_HOST=w017f912.kasserver.com
SMTP_PORT=465
SMTP_USER=m07e22c0
SMTP_PASS=                         ← Must be filled in .env
SMTP_FROM=noreply@geggos.com
```

**What happens without SMTP config:**
- OTP is still generated and **printed to server terminal** — admin can read it there
- Registration workflow still works; users just won't receive OTP via email
- `transporter.sendMail()` error is caught and swallowed — no crash
- Approval emails fail silently too

**Where it's used:** `routes/authRoutes.js`, `routes/adminRoutes.js`

**Security note:** SMTP_PASS should never be committed. It's in `.gitignore` via `.env`.

---

### NAS Sync

Used by the WebDAV background sync engine.

| Variable | Required | Default | Description |
|---|---|---|---|
| `NAS_SYNC_ENABLED` | No | `false` | Enable NAS sync. Must be exactly `'true'` to activate. |
| `NAS_WEBDAV_URL` | If enabled | — | Full WebDAV endpoint URL (e.g. `http://100.64.0.5:5005`) |
| `NAS_USERNAME` | If enabled | — | WebDAV authentication username |
| `NAS_PASSWORD` | If enabled | — | WebDAV authentication password |
| `NAS_SYNC_INTERVAL` | No | `300000` | Sync cycle interval in milliseconds. Default = 5 minutes. |
| `NAS_REMOTE_BASE` | No | `/Supreme` | Root directory path on the NAS WebDAV server |

**Example (production):**
```ini
NAS_SYNC_ENABLED=true
NAS_WEBDAV_URL=http://100.64.0.5:5005
NAS_USERNAME=geggos_sync
NAS_PASSWORD=SecureWebDAVPassword
NAS_SYNC_INTERVAL=300000
NAS_REMOTE_BASE=/Supreme
```

**What happens without NAS config (or `NAS_SYNC_ENABLED=false`):**
- All sync functions return immediately (no-op)
- App works entirely with local storage
- `ensureLocalFile()` throws if a cleaned file is accessed (never happens without sync)
- Sync status endpoint returns `{ enabled: false }`

**Where it's used:** `controllers/nasSync.js`, `controllers/nasOnDemand.js`

---

## Local Development vs VPS Differences

### Local development `.env`
```ini
# Storage: relative path (created automatically)
STORAGE_ROOT=./storage

# SMTP: can be blank — OTP is printed to terminal
SMTP_HOST=w017f912.kasserver.com
SMTP_PORT=465
SMTP_USER=m07e22c0
SMTP_PASS=
SMTP_FROM=noreply@geggos.com

# NAS: disabled — data stays local
NAS_SYNC_ENABLED=false
NAS_WEBDAV_URL=
NAS_USERNAME=
NAS_PASSWORD=
NAS_SYNC_INTERVAL=300000
NAS_REMOTE_BASE=/Supreme
```

### VPS production `.env`
```ini
# Storage: absolute path in Docker volume
STORAGE_ROOT=/data/storage

# SMTP: must be filled in with real password
SMTP_HOST=w017f912.kasserver.com
SMTP_PORT=465
SMTP_USER=m07e22c0
SMTP_PASS=RealPasswordHere
SMTP_FROM=noreply@geggos.com

# NAS: enabled with real NAS credentials
NAS_SYNC_ENABLED=true
NAS_WEBDAV_URL=http://100.x.x.x:5005
NAS_USERNAME=webdav_user
NAS_PASSWORD=WebDAVPasswordHere
NAS_SYNC_INTERVAL=300000
NAS_REMOTE_BASE=/Supreme
```

---

## Complete .env.example (for reference)

```ini
# Storage
STORAGE_ROOT=./storage

# SMTP (email)
SMTP_HOST=w017f912.kasserver.com
SMTP_PORT=465
SMTP_USER=m07e22c0
SMTP_PASS=
SMTP_FROM=noreply@geggos.com

# NAS Sync
NAS_SYNC_ENABLED=false
NAS_WEBDAV_URL=
NAS_USERNAME=
NAS_PASSWORD=
NAS_SYNC_INTERVAL=300000
NAS_REMOTE_BASE=/Supreme
```

---

## Verifying Config on Startup

At startup, `server.js` logs:
```
[storage] STORAGE_ROOT: /data/storage
[nas-sync] NAS_SYNC_ENABLED=true — starting sync engine...
[nas-sync] Connected to NAS at http://100.x.x.x:5005 (remote base: /Supreme)
--- Server running at http://localhost:3000 ---
```

Or if NAS is disabled:
```
[storage] STORAGE_ROOT: ./storage
[nas-sync] NAS_SYNC_ENABLED not set — sync disabled.
--- Server running at http://localhost:3000 ---
```

---

## Security Notes

1. **Never commit `.env`** — it's in `.gitignore`
2. **Never put `.env` in the Docker image** — it's in `.dockerignore`
3. **Passwords are plain text** — SMTP and WebDAV passwords are passed as env vars; protect the `.env` file with `chmod 600 .env`
4. **User passwords in users.json are plain text** — known limitation, acceptable for internal tool
5. **NAS_WEBDAV_URL should be on a private network** — local LAN IP or Tailscale IP; never expose WebDAV to the internet without auth

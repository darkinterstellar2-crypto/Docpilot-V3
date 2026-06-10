# Getting Started

## Prerequisites

- **Node.js** v18 or later (v22 recommended — used in Docker image)
- **npm** (comes with Node.js)
- **Git**

No external database server is required. DocPilot uses JSON files for most data and SQLite (via `better-sqlite3`) for chat — both embedded.

## Installation

### 1. Clone the Repository

```bash
git clone git@github.com:darkinterstellar2-crypto/Docpilot-V3.git
cd Docpilot-V3
```

### 2. Install Dependencies

```bash
npm install
```

This installs all packages listed in `package.json`:

| Package | Version | Purpose |
|---------|---------|---------|
| `express` | ^5.2.1 | HTTP server framework |
| `better-sqlite3` | ^12.8.0 | SQLite database for per-project chat |
| `bcryptjs` | ^3.0.3 | Password hashing (12 salt rounds) |
| `jsonwebtoken` | ^9.0.3 | JWT session tokens |
| `multer` | ^1.4.5 | File upload middleware |
| `nodemailer` | ^8.0.3 | Email sending (SMTP) |
| `cors` | ^2.8.6 | Cross-Origin Resource Sharing |
| `dotenv` | ^17.4.0 | Environment variable loading |
| `body-parser` | ^2.2.2 | Request body parsing (10MB limit) |
| `archiver` | ^7.0.1 | ZIP file creation for project downloads |
| `xlsx` | ^0.18.5 | Excel file generation |
| `webdav` | ^5.9.0 | WebDAV client for NAS sync |

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
# ── AI Assistant (DoBo) ──────────────────────────────────────────
AI_ENABLED=true                            # Enable/disable DoBo
AI_API_KEY=your-gemini-api-key-here        # Google Gemini API key (Light mode)
AI_MODEL=gemini-2.5-pro                    # Light mode model

AI_API_KEY_ANTHROPIC=your-anthropic-key    # Anthropic API key (Heavy mode)
AI_MODEL_PRO=claude-sonnet-4-20250514      # Heavy mode model

# ── Storage ──────────────────────────────────────────────────────
STORAGE_ROOT=./storage                     # Where project files are stored

# ── SMTP (Email) ─────────────────────────────────────────────────
SMTP_HOST=your-smtp-host
SMTP_PORT=465
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM=noreply@yourdomain.com

# ── NAS Sync (Optional) ──────────────────────────────────────────
NAS_SYNC_ENABLED=false                     # Enable WebDAV NAS sync
NAS_WEBDAV_URL=                            # WebDAV endpoint URL
NAS_USERNAME=                              # WebDAV username
NAS_PASSWORD=                              # WebDAV password
NAS_SYNC_INTERVAL=300000                   # Sync interval in ms (default: 5 min)
NAS_REMOTE_BASE=/Supreme                   # Remote base path on NAS
```

**Minimum required for basic operation:** Only `STORAGE_ROOT` is essential. Everything else can be left at defaults or empty:
- Without SMTP: OTP codes print to the server console (for development)
- Without AI keys: DoBo AI assistant is disabled
- Without NAS: Files stored locally only (no backup sync)

### 4. Start the Server

```bash
npm start
# or directly:
node server.js
```

Output:
```
[storage] STORAGE_ROOT: ./storage
[nas-sync] NAS_SYNC_ENABLED not set — sync disabled.
--- Server running at http://localhost:3000 ---
```

The server listens on **port 3000** (hardcoded in `server.js`, line ~7).

### 5. First Login

1. Open `http://localhost:3000` in your browser
2. You'll be redirected to the login page
3. **First-time setup:** You need to manually create a superadmin user

#### Creating the First Superadmin

Since there are no users yet, you need to manually create one in `src/DataFiles/users.json`:

```json
[
  {
    "id": "1",
    "name": "Admin",
    "username": "admin",
    "email": "admin@example.com",
    "password": "your-password-here",
    "role": "superadmin",
    "isVerified": true,
    "isApproved": true,
    "createdAt": "2026-01-01T00:00:00.000Z"
  }
]
```

> **Note:** The password will be plain text initially. On first login, DocPilot automatically detects this and migrates it to a bcrypt hash (see `passwordHelper.js`). After login, check `users.json` — the password field will now contain a `$2b$...` hash.

After the first superadmin exists, all subsequent users register through the UI and go through the approval flow:
1. Register → receive OTP via email (or console) → verify → wait for admin approval → login

---

## Docker Deployment

### Using Docker Compose (Recommended)

```bash
docker compose up -d --build
```

This creates:
- A `docpilot` container running Node.js on port 3000
- Two Docker volumes:
  - `geggos-storage` → `/data/storage` (project files)
  - `geggos-appdata` → `/app/src/DataFiles` (user data, settings, logs)

The `docker-compose.yml` includes Traefik labels for automatic HTTPS:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.docpilot.rule=Host(`geggos.ai`)"
  - "traefik.http.routers.docpilot.entrypoints=websecure"
  - "traefik.http.routers.docpilot.tls.certresolver=letsencrypt"
```

### Using Caddy (Alternative)

A `Caddyfile` is included for Caddy reverse proxy:

```
geggos.ai {
    reverse_proxy geggos-app:3000
    request_body {
        max_size 50MB
    }
}
```

See [Deployment](./deployment.md) for full production setup details.

---

## What Happens on Startup

When `server.js` starts, the following happens in order (see the async IIFE starting at line ~93):

1. **`ensureStorageRoot()`** — Creates the `STORAGE_ROOT` directory if it doesn't exist
2. **`ensureDataFiles()`** — Creates `src/DataFiles/` and initializes any missing JSON files with empty defaults:
   - `users.json` → `[]`
   - `projects.json` → `[]`
   - `logs.json` → `[]`
   - `schema.json` → `[]`
   - `super-log.json` → `[]`
   - `access-control.json` → `{}`
   - `project-info.json` → `{}`
3. **`migrateLegacyDataFiles()`** — One-time migration: moves any `.txt` project data files from `src/DataFiles/` to the new `storage/<ProjectName>/Doku/Aufmass/datafile/` structure
4. **`startSync()`** — Starts the NAS background sync engine (no-op if `NAS_SYNC_ENABLED` is not `true`)

After these steps, routes are registered and the HTTP server starts listening.

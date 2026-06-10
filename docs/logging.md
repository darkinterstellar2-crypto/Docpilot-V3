# Logging

DocPilot has a three-tier logging system:

## 1. Action Logs (`controllers/logger.js`)

**Storage:** `src/DataFiles/logs.json`

Business-level audit trail of user actions. Max 1000 entries (oldest dropped on overflow).

Each entry:
```json
{
  "id": "1718000000000",
  "timestamp": "2026-06-01T14:30:00.000Z",
  "user": "admin@example.com",
  "action": "Data Saved",
  "details": "Row \"ROW-7\" | Cluster: SUPPN\n  - \"Status\": \"\" → \"Done\""
}
```

### What Gets Logged

| Action | Details |
|--------|---------|
| `Data Saved` | Cell-level diff (old → new values) with cluster/knotenpunkt context |
| `Aufmass Row Updated` | Single-row updates from module pages |
| `Project Created` | Project name + location count |
| `Project Deleted` | Project name |
| `Cluster Created/Auto-Created` | Cluster name + project |
| `Knotenpunkt Created/Auto-Created` | Knotenpunkt + cluster + project |
| `File Upload` | File names + destination |
| `Folder Created` | Folder name + destination |
| `Renamed` | Old → new name |
| `Moved to Trash` | Item name + source path |
| `Restored from Trash` | Item name + restore path |
| `Module File Upload` | Module upload details |
| `Login Success` / `Login Failed` | User + remaining attempts |
| `Email Verified` | OTP verification |
| `User Approved/Revoked/Rejected` | Admin action on user |
| `ACL Updated/Removed` | Access control changes |
| `User Updated` | Username/password changes |
| `Session Terminated` | Force-terminated user |
| `Share Created/Revoked` | Share link details |
| `Password Changed` | Self-service password change |
| `Profile Updated` | Name/username changes |
| `2FA Updated` | 2FA enable/disable |

### API

- `GET /api/admin/logs` — Get all logs
- `GET /api/admin/logs/search?query=X` — Search logs

## 2. Super Logs (`controllers/superLogger.js`)

**Storage:** `src/DataFiles/super-log.json` (disk) + in-memory ring buffer

System-level event capture for superadmin diagnostics. Max 5000 entries in memory, flushed to disk every 30 seconds or every 100 new entries.

Each entry:
```json
{
  "id": 12345,
  "timestamp": "2026-06-01T14:30:00.000Z",
  "type": "request",
  "level": "info",
  "message": "GET /api/data 200 45ms admin@example.com",
  "meta": {
    "method": "GET",
    "url": "/api/data",
    "status": 200,
    "responseTime": 45,
    "ip": "192.168.1.100",
    "userEmail": "admin@example.com"
  }
}
```

### Log Types

| Type | What It Captures |
|------|-----------------|
| `request` | Every HTTP request (method, path, status, response time, user, IP) |
| `auth` | Login/logout/2FA/OTP events |
| `file` | File uploads, downloads, renames, deletes, shares |
| `sync` | NAS sync events (upload, cleanup, errors) |
| `chat` | Chat messages and media uploads |
| `error` | Unhandled errors |
| `system` | Server start/stop events |
| `admin` | Admin panel actions |

### Log Levels

| Level | Used For |
|-------|---------|
| `info` | Normal operations |
| `warn` | Failed logins, rate limiting, 4xx responses |
| `error` | Unhandled errors, 5xx responses, sync failures |
| `debug` | (Available but rarely used) |

### Request Logger Middleware

The `requestLogger` middleware (`superLogger.js`) logs every HTTP request:
- Captures method, path, status code, response time, user email, IP
- Skips requests to `/super-logs` (to avoid self-referential noise)
- Determines log level from status code: 5xx = error, 4xx = warn, else = info

### API

- `GET /api/admin/super-logs` — Query with `after_id, types, level, limit, search` (superadmin only)
- `GET /api/admin/super-logs/stats` — 24-hour statistics by type and level

### Crash Safety

Super logger **never crashes the app** — all operations are wrapped in try/catch. If disk flush fails, it's logged to console but doesn't affect the application.

## 3. Session Logs (`controllers/sessionLogger.js`)

**Storage:** `src/DataFiles/sessions-log.json`

Tracks login, logout, and force-termination events with device information. Max 10,000 entries.

Each entry:
```json
{
  "email": "user@example.com",
  "name": "Max Mustermann",
  "action": "login",
  "timestamp": "2026-06-01T14:30:00.000Z",
  "ip": "192.168.1.100",
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)...",
  "device": "Chrome on Windows"
}
```

### Device Parsing

User-Agent strings are parsed into friendly labels using regex matching:
- **OS detection:** ChromeOS, Android, iOS, Windows, macOS, Linux
- **Browser detection:** Edge, Opera, Samsung Browser, Chrome, Firefox, Safari

### API

- `GET /api/admin/user-sessions/:email` — Session history for a user
- `GET /api/admin/user-stats/:email` — Login counts, last login, devices

### Force Termination

When a superadmin terminates a user's sessions:
1. Entry added to `terminated-sessions.json`
2. Session event logged as `force_terminated`
3. Middleware in `server.js` rejects all API requests from that user
4. Termination cleared on next successful login

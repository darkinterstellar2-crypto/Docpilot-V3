# Changelog: Super Logs — Live System Monitor

**Date:** 2026-04-04  
**Author:** Mr. O  
**Commit:** feat: super logs — live terminal-style system monitor (superadmin only)

---

## Summary

Added a full-stack live system event monitor accessible only to `superadmin`. Provides a real-time terminal-style log viewer showing every HTTP request, auth event, file operation, chat message, NAS sync, error, and system event happening in the app.

---

## New Files

### `controllers/superLogger.js`
- In-memory ring buffer (last 5000 entries)
- Persistent storage to `src/DataFiles/super-log.json` (flush every 30s or every 100 new entries)
- Log entry structure: `{ id, timestamp, type, level, message, meta }`
- **Exports:**
  - `superLog(type, level, message, meta)` — add a log entry
  - `getSuperLogs({ after_id, types, level, limit, search })` — query with filters
  - `getLogStats()` — counts by type and level for last 24h
  - `requestLogger` — Express middleware (auto-logs every HTTP request)
  - `shutdownFlush()` — final disk flush on shutdown
- Skips super-logs polling requests from logging themselves (noise reduction)
- Logger failures never crash the app (all errors swallowed internally)

### `superlog.html`
- Terminal-style UI (`#0d1117` background, JetBrains Mono font)
- **Auth guard:** redirects immediately if `userRole !== 'superadmin'`
- **Controls:** type checkboxes (REQUEST/AUTH/FILE/SYNC/CHAT/ERROR/SYSTEM), level dropdown, search box
- **Stats bar:** live counts per type (24h window)
- **Auto-scroll:** scrolls to bottom on new entries; pauses when user scrolls up; resumes on scroll-to-bottom
- **Pause/Resume button** and **Clear display** (doesn't delete server logs)
- **Live polling:** every 2s via `GET /api/admin/super-logs?after_id=X`
- **Performance:** max 2000 DOM entries (prunes oldest when limit exceeded)
- **Color scheme:** timestamps=dim, type labels=cyan, info=green, warn=amber, error=red, emails=blue

---

## Modified Files

### `server.js`
- Added `superRequestLogger` middleware early in the pipeline (before routes)
- Added global error handler (logs `error` events before 500 response)
- Logs `system` event on server start
- Logs `system` event on graceful shutdown
- Calls `shutdownFlush()` on shutdown
- Added `super-log.json` to ensureDataFiles defaults

### `routes/adminRoutes.js`
- Added `superadminOnly` middleware — enforces `x-user-role === 'superadmin'` ONLY (not admin, not administrator)
- `GET /api/admin/super-logs` — query logs (superadmin only)
  - Params: `after_id`, `types` (comma-separated), `level`, `limit` (default 100, max 500), `search`
  - Returns: `{ success, logs, total }`
- `GET /api/admin/super-logs/stats` — 24h stats (superadmin only)
  - Returns: `{ success, total, byType, byLevel, since }`

### `routes/authRoutes.js`
- `superLog('auth', ...)` on: register, OTP verify, OTP fail, login success, login fail, logout

### `routes/fileRoutes.js`
- `superLog('file', ...)` on: upload, delete (trash), rename, copy, move, share creation, download

### `routes/chatRoutes.js`
- `superLog('chat', ...)` on: message sent, media uploaded

### `controllers/nasSync.js`
- Lazy-loaded `superLog` (avoids circular dep at startup)
- `superLog('sync', ...)` on: sync engine start, full sync complete, cleanup complete, all errors

### `admin.html`
- Added `#superLogsSection` div (hidden by default)
- JS shows it only when `userRole === 'superadmin'`
- Terminal-themed button linking to `superlog.html`

---

## Security

- **Triple-checked:** All API endpoints use `superadminOnly` middleware checking `x-user-role === 'superadmin'` exactly
- `admin` and `administrator` roles are explicitly NOT permitted
- Frontend auth guard in `superlog.html` also checks `localStorage.userRole === 'superadmin'`
- No sensitive data logged: no passwords, no OTP codes, no request/response bodies
- Request timing and status codes only (no payloads)

---

## Log Types Reference

| Type | What's logged |
|------|--------------|
| `request` | Every HTTP request: method, URL, status, response time, IP, user email |
| `auth` | Login, logout, login_failed, register, OTP verify/fail |
| `file` | Upload, download, delete, rename, move, copy, share |
| `sync` | NAS sync start, complete, cleanup, errors |
| `chat` | Message sent, media uploaded |
| `error` | Unhandled server errors (caught by global error handler) |
| `system` | Server start, shutdown |

## Log Levels

| Level | Color | When |
|-------|-------|------|
| `debug` | Gray | Low-level diagnostic info |
| `info` | Green | Normal operations |
| `warn` | Amber | Non-fatal issues (login fail, 4xx, etc.) |
| `error` | Red | Exceptions, 5xx, sync errors |

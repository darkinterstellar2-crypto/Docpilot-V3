# QA Report — Part 2: Super Logs
**Date:** 2026-04-04  
**Scope:** `controllers/superLogger.js`, `superlog.html`, `routes/adminRoutes.js`, `server.js`, `routes/authRoutes.js`, `routes/fileRoutes.js`, `routes/chatRoutes.js`, `controllers/nasSync.js`, `admin.html`  
**Result:** ✅ PASS (1 bug fixed)

---

## Checklist Results

### 1. Superadmin ONLY — Role Check ✅

| Location | Check | Result |
|---|---|---|
| `adminRoutes.js` `superadminOnly` middleware | `role !== 'superadmin'` | ✅ Exact string |
| Both `/api/admin/super-logs` and `/api/admin/super-logs/stats` | Use `superadminOnly` | ✅ Both protected |
| `superlog.html` client-side guard | `userRole !== 'superadmin'` | ✅ Exact string |

No use of `admin`, `administrator`, or any other alias. Correct on both server and client.

---

### 2. Logger Never Crashes App ✅

- `superLog()` has top-level `try/catch`; errors are swallowed and logged to stderr only.
- `flushToDisk()` has `try/catch`; disk failures do not propagate.
- `getSuperLogs()` and `getLogStats()` have `try/catch` returning safe defaults on error.
- `requestLogger` middleware uses `res.on('finish')` callback wrapped in `try/catch`; the `next()` call is unconditional.
- Boot-time disk load is wrapped in `try/catch`; corrupt/missing file starts fresh.
- All `superLog()` calls in `authRoutes.js`, `fileRoutes.js`, `chatRoutes.js`, `nasSync.js` benefit from the internal catch; no additional wrapping needed.

---

### 3. No Sensitive Data Logged ✅

**`requestLogger` middleware:** Logs `method`, `path`, `query`, `status`, `responseTime`, `ip`, `userEmail` — no request body, no credentials.

**`authRoutes.js` superLog calls:**
- Register: `email, username, role, ip` — no password, no OTP value ✅
- OTP verify: `email, ip` only — OTP value never captured ✅
- Login failed: `identifier, ip, userAgent` — no password ✅
- Login success: `email, role, ip, userAgent` — no password ✅
- Logout: `email, ip` ✅

**`fileRoutes.js`:** Logs filenames, paths, userEmail — no file content.

**`chatRoutes.js`:** Logs `userEmail`, `project`, `messageLength` (text length, not content) or filename for media. ✅

---

### 4. Ring Buffer — 5000 Entry Limit ✅

```js
const RING_SIZE = 5000;
// On push:
if (ring.length > RING_SIZE) {
    ring = ring.slice(ring.length - RING_SIZE); // oldest trimmed
}
// On boot load from disk:
ring = parsed.slice(-RING_SIZE); // cap at RING_SIZE
```

Correct. Oldest entries are trimmed. Boot load also enforces the cap.

---

### 5. File Persistence ✅

- **Periodic flush:** `setInterval(flushToDisk, 30000)` with `.unref()` to avoid blocking process exit.
- **Entry-count flush:** `pendingSinceFlush >= 100` → `flushToDisk()` called immediately.
- **Graceful shutdown:** `shutdownFlush()` clears the interval and does a final synchronous write.
- **Directory creation:** `flushToDisk()` creates `src/DataFiles/` if missing.
- **`super-log.json` init:** `server.js` `ensureDataFiles()` seeds the file with `'[]'` on first run.

No file size management beyond the ring buffer cap (5000 × ~200 bytes avg ≈ 1 MB max). Acceptable for this use case.

---

### 6. Request Middleware — Non-Blocking ✅

- `requestLogger` is registered **before all route handlers** in `server.js` (line 15, before any `app.use('/api/...')`).
- Logging happens in `res.on('finish')` — fires **after** the response is sent; zero impact on response latency.
- Self-skipping: requests to paths containing `/super-logs` are excluded to prevent polling noise.
- No blocking I/O in the middleware itself.

---

### 7. superlog.html — Auth, Polling, Filters, XSS ✅ (1 bug fixed)

**Auth guard:**
- `localStorage.getItem('userRole')` checked against `'superadmin'` exactly.
- Non-superadmin: auth guard overlay visible; app hidden; `initApp()` never called (no API calls made).
- 🐛 **BUG FIXED:** Auth guard showed "Access Denied" but never redirected automatically. Added 1.5s auto-redirect: admin/administrator → `admin.html`, others → `login.html`. "Back" button also updated to be context-aware.

**Polling:**
- `startPolling()` uses `setInterval(poll, 2000)` with `clearInterval` on pause/cleanup.
- On 403 response: redirects to `login.html`.
- Network errors caught; `setConnected(false)` updates UI; polling continues.

**Filters:**
- Type checkboxes send `types=...` param only when not all checked.
- Level filter `<option value="">all</option>` — empty string is falsy; no level param sent when "all" selected. Server correctly omits filter when `level` is undefined/empty.
- Search: debounced 300ms; `onFilterChange()` resets `lastId=0` and re-polls.
- `entryMatchesFilters()` applies type/level/search client-side correctly.

**XSS protection:**
- `esc(s)` escapes `&`, `<`, `>` before any string is inserted into innerHTML.
- `highlightMessage()` calls `esc(msg)` first, then applies safe regex replacing only the email pattern with a `<span>`.
- `entry.level` in `el.className` and `entry.type`/`entry.level` in `el.dataset` are not execution vectors.

---

### 8. Admin Page — Super Logs Link Visibility ✅

```js
// admin.html line 339
if (userRole === 'superadmin') {
    const sec = document.getElementById('superLogsSection');
    // shows the section
}
```

`#superLogsSection` has class `hidden` by default. Only removed for `userRole === 'superadmin'`. Admins and regular users never see the section.

---

### 9. Server Startup — Clean ✅

- `superLogger` required at top of `server.js` before routes — ring buffer loads from disk synchronously before any request can arrive.
- `super-log.json` seeded by `ensureDataFiles()` at startup.
- `superLog('system', 'info', 'Server started ...')` fires after `app.listen()`.
- Global error handler logs unhandled errors to super log before sending 500.
- Graceful shutdown: `SIGTERM`/`SIGINT` → `superLog('system', 'info', 'Server shutting down')` → `shutdownFlush()` → `server.close()`.

---

### 10. No Circular Dependencies ✅

`nasSync.js` uses lazy-load pattern:
```js
let _superLog = null;
function getSuperLog() {
    if (!_superLog) {
        try { _superLog = require('./superLogger').superLog; } catch (_) { _superLog = () => {}; }
    }
    return _superLog;
}
```
`superLogger.js` does **not** require `nasSync.js`. No circular path. Confirmed by verifying neither file's top-level `require()` calls create a cycle.

---

## Bug Fixed

| # | File | Issue | Fix | Commit |
|---|---|---|---|---|
| 1 | `superlog.html` | Auth guard showed "Access Denied" but no auto-redirect. Non-superadmin user stuck on dead screen. | Added 1.5s auto-redirect: admins → `admin.html`, others → `login.html`. "Back" button updated to be role-aware. | `e38da82` |

---

## Notes & Observations

- **Passwords stored plaintext** in `users.json` — noted in existing comments as a known architectural decision; out of scope for this QA.
- **OTP printed to terminal** in register route (`console.log`) — intentional for local dev; no change needed.
- **Debug level in UI** (`<option value="debug">debug</option>`) — no code currently logs at `debug` level. Unused but harmless.
- **Search not sent to server in poll** — search filtering is client-side only. Server supports `search` param in `getSuperLogs()` but client never sends it. Acceptable design; client-side filtering over loaded entries works correctly.

---

*QA performed by Mr. O (subagent) — 2026-04-04*

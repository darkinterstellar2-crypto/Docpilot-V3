# QA Report — 2026-04-04: User Management & Session Tracking (Part 1)

**QA performed by:** Mr. O (subagent)  
**Commit reviewed:** prior to `4bc58dd`  
**Fixes committed:** `4bc58dd`

---

## Summary

Part 1 implementation is solid overall — session tracking, admin endpoints, and superadmin protection are all correct. **Four bugs** were found and fixed, all in frontend files. No backend regressions detected. Server starts clean.

---

## Checklist Results

### ✅ 1. Session Logging (`controllers/sessionLogger.js`)

- **login, logout, login_failed** all correctly logged in `authRoutes.js`
- **IP** captured via `req.ip` ✓
- **User-Agent** captured via `req.headers['user-agent']` ✓
- **Device parsing** (no external libs): detects OS (Android/iOS/Windows/macOS/ChromeOS/Linux) and Browser (Edge/Opera/Samsung/Chrome/Firefox/Safari) with correct order of precedence ✓
- **File size management**: trims to MAX_ENTRIES (10,000) on every write — `sessions.slice(sessions.length - MAX_ENTRIES)` keeps newest ✓
- **Graceful degradation**: `readSessions()` returns `[]` on any error; write errors are caught and logged without crashing the server ✓

### ✅ 2. Admin Endpoints (`routes/adminRoutes.js`)

| Endpoint | Status |
|---|---|
| `GET /api/admin/user-sessions/:email` | ✅ Works — returns session history, lastLogin, devices |
| `POST /api/admin/user/update` | ✅ Works — username uniqueness check, min-length validation |
| `GET /api/admin/user-stats/:email` | ✅ Works — totalLogins, totalLogouts, lastLogin, lastLogout, devices, createdAt |

**Note (pre-existing architecture):** Admin-only protection relies on `x-user-role` header sent by the client (from localStorage). There is no server-side session/token validation. This is a pre-existing design constraint and not introduced by Part 1 — flagged for future hardening.

### ✅ 3. Superadmin Protection

- `POST /api/admin/user/update`: checks `targetUser.role === 'superadmin' && requesterRole !== 'superadmin'` → returns 403 ✓
- `GET /api/admin/users`: filters out `role === 'superadmin'` from the list entirely ✓
- `POST /api/admin/approve`: blocks modification of superadmin status ✓

### 🐛 4. Logout Coverage — **FIXED**

**Bug found:** `new-project.html` had NO logout button and no `doLogout()` function.

**Additional issue:** `admin.html` had an inline copy of `doLogout()` instead of using the shared `src/js/logout.js`. Functionally identical but a maintenance risk (code duplication).

**Fix:** 
- Added logout button to `new-project.html` header + `<script src="src/js/logout.js"></script>`
- Replaced inline `doLogout()` in `admin.html` with `<script src="src/js/logout.js"></script>`

**Post-fix coverage (13 app pages, excluding login.html / register.html):**

| Page | Has Logout |
|---|---|
| admin.html | ✅ (now via logout.js) |
| apl.html | ✅ |
| aufmass.html | ✅ |
| dashboard.html | ✅ |
| druckprufung.html | ✅ |
| einblasen.html | ✅ |
| files.html | ✅ |
| index.html | ✅ |
| kalibrieren.html | ✅ |
| knotenpunkt-vorbereitung.html | ✅ |
| new-project.html | ✅ (fixed) |
| otdr.html | ✅ |
| splicing.html | ✅ |

**Logout URL:** `logout.js` calls `POST /api/logout` — correct, since `authRoutes` is mounted at `/api` (not `/api/auth`). The comment in `logout.js` says `/api/auth/logout` but the actual fetch URL is `/api/logout`. **Comment is wrong, code is right.** Minor documentation bug, not functional.

### ✅ 5. Admin UI — Modal Conflicts

- `editModal`, `sessionsModal`, `statsModal` are new IDs — no conflicts with existing elements
- NAS sync section uses inline card layout (no modal), so z-index/overlay stacking is not an issue
- All three modals have distinct open/close functions: `openEditModal/closeEditModal`, `openSessionsModal/closeSessionsModal`, `openStatsModal/closeStatsModal`

### ✅ 6. Password Update — Login Flow Integrity

- `POST /api/admin/user/update` writes plaintext password directly to `users.json` (consistent with existing architecture — no bcrypt in this project)
- Login route checks `u.password === password`, so updated password will work immediately ✓
- Minimum 4-character validation on update — weaker than registration (8 chars), but acceptable for admin-initiated reset

### ✅ 7. No Regressions — Server Start

```
--- Server running at http://localhost:3000 ---
[storage] STORAGE_ROOT: /data/.openclaw/workspace/docpilot/storage
[nas-sync] NAS_SYNC_ENABLED not set — sync disabled.
[nas-sync] Disabled (NAS_SYNC_ENABLED not set to true). Skipping.
[chatDb] All connections closed.
```

Server starts clean. All existing routes (data, projects, admin, files, modules, chat) load without errors. NAS sync, share downloads, and legacy migration paths unaffected.

### 🐛 8. XSS — **FIXED**

Multiple stored XSS vulnerabilities found in `admin.html` where user-controlled data was inserted directly into `innerHTML`:

| Location | Vulnerable Field | Fix |
|---|---|---|
| User cards | `u.name`, `u.email`, `u.username` | `escapeHtml()` |
| Edit modal onclick | `u.username` (no quote escaping) | JS escape (`\\'`) |
| Log cards | `log.action`, `log.user` | `escapeHtml()` |
| Sessions modal | `s.device`, `s.ip` | `escapeHtml()` |
| Stats modal | `s.lastDevice`, `s.devices.join(', ')` | `escapeHtml()` |

**Fix:** Added `escapeHtml()` helper at top of admin.html script block:
```javascript
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}
```

Applied to all user-controlled data in innerHTML. Onclick string arguments use proper JS escaping (backslash + quote) instead of HTML escaping.

**Existing good practice noted:** `log.details` was already manually HTML-escaped before insertion — that logic preserved as-is.

### ✅ 9. File Size Management

`writeSessions()` in `sessionLogger.js`:
```javascript
if (sessions.length > MAX_ENTRIES) {
    sessions = sessions.slice(sessions.length - MAX_ENTRIES);
}
```
MAX_ENTRIES = 10,000. Trims on every write, keeping newest entries. ✓

---

## Bugs Fixed (this QA pass)

| # | File | Bug | Severity | Fix |
|---|---|---|---|---|
| 1 | `new-project.html` | No logout button or `doLogout()` function | Medium | Added header button + logout.js script |
| 2 | `admin.html` | Inline `doLogout()` instead of shared `logout.js` | Low | Replaced with `<script src="src/js/logout.js">` |
| 3 | `admin.html` | Stored XSS in user cards (`u.name`, `u.email`, `u.username`) | High | Applied `escapeHtml()` |
| 4 | `admin.html` | Stored XSS in log cards (`log.action`, `log.user`) | High | Applied `escapeHtml()` |
| 5 | `admin.html` | Stored XSS in sessions modal (`s.device`, `s.ip`) | Medium | Applied `escapeHtml()` |
| 6 | `admin.html` | Stored XSS in stats modal (`s.lastDevice`, `s.devices`) | Medium | Applied `escapeHtml()` |
| 7 | `admin.html` | `u.username` not quote-escaped in `openEditModal` onclick | Medium | Added proper JS string escaping |

---

## Minor Notes (Not Fixed — Design Decisions)

- **No server-side auth middleware**: Admin endpoints trust `x-user-role` header from client. Pre-existing pattern; not introduced in Part 1. Recommend JWT/session middleware in a future hardening pass.
- **Plaintext passwords**: `users.json` stores passwords in plaintext. Pre-existing; consistent throughout codebase.
- **Misleading comment in `logout.js`**: Comment says `POST /api/auth/logout` but code correctly calls `POST /api/logout`. Minor doc issue.
- **Password update min-length**: Admin update requires 4 chars vs registration's 8 chars. Acceptable intentional difference.

---

## Verdict

**Part 1 passes QA** after the 7 bug fixes committed in `4bc58dd`. Backend logic (session tracking, admin endpoints, superadmin protection) is correct and well-implemented. Fixes were frontend-only (XSS hardening + logout coverage).

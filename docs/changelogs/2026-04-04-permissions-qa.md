# QA Report — Part 3: User Permissions
**Date:** 2026-04-04  
**Scope:** Role-based access control for `user`, `admin`/`administrator`, and `superadmin` roles  
**Commit:** `6dade21`

---

## Summary

Two bugs were found and fixed. All other permission checks passed.

---

## Bugs Fixed

### 🐛 Bug 1 — Module pages had no user-role guard (CRITICAL)
**Affected files:** `einblasen.html`, `druckprufung.html`, `apl.html`, `otdr.html`, `kalibrieren.html`, `splicing.html`, `knotenpunkt-vorbereitung.html`

**Problem:**  
The dashboard correctly hides module cards for the `user` role via CSS (`display: none`). However, none of the 7 module pages themselves contained any authentication or role guard. A `user` could bypass the dashboard by navigating directly to the URL (e.g. `einblasen.html?project=X`) and access the full module UI.

**Fix:**  
Added an IIFE guard script immediately after the `<body>` tag in all 7 module pages:
```html
<script>
    (function() {
        var role = localStorage.getItem('userRole');
        if (!role) { window.location.href = 'login.html'; }
        else if (role === 'user') { window.location.href = 'index.html'; }
    })();
</script>
```
This is consistent with the pattern used in `new-project.html`.

---

### 🐛 Bug 2 — Upload role check ran AFTER multer saved files to disk
**Affected file:** `routes/fileRoutes.js` → `POST /api/files/upload`

**Problem:**  
The route was structured as:
```javascript
router.post('/upload', upload.array('files', 50), async (req, res) => {
    // ... multer already wrote files to disk here ...
    const uploadRole = (req.headers['x-user-role'] || '').toLowerCase();
    if (uploadRole === 'user') return res.status(403).json(...);
```
Because `multer.diskStorage` saves files synchronously during the middleware phase, files were physically written to the project folder before the role check returned 403. The response was correct (403 was sent), but the files lingered on disk — a data integrity issue.

**Fix:**  
Added a `requireNonUserRole` middleware that runs BEFORE `upload.array()`:
```javascript
function requireNonUserRole(req, res, next) {
    const role = (req.headers['x-user-role'] || '').toLowerCase();
    if (role === 'user') return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    next();
}
router.post('/upload', requireNonUserRole, upload.array('files', 50), async (req, res) => { ... });
```
Now `user` role requests are rejected before any file is written.

---

## Full Permission Audit Results

### 1. `user` Role — Page Access

| Page | Expected | Result |
|------|----------|--------|
| `aufmass.html` | ✅ Allowed (view only, edit button hidden) | ✅ PASS |
| `files.html` | ✅ Allowed (view/download only) | ✅ PASS |
| `dashboard.html` | ✅ Allowed (module cards hidden) | ✅ PASS |
| `einblasen.html` (direct URL) | ❌ Redirect to index.html | ✅ FIXED |
| `druckprufung.html` (direct URL) | ❌ Redirect to index.html | ✅ FIXED |
| `apl.html` (direct URL) | ❌ Redirect to index.html | ✅ FIXED |
| `otdr.html` (direct URL) | ❌ Redirect to index.html | ✅ FIXED |
| `kalibrieren.html` (direct URL) | ❌ Redirect to index.html | ✅ FIXED |
| `splicing.html` (direct URL) | ❌ Redirect to index.html | ✅ FIXED |
| `knotenpunkt-vorbereitung.html` (direct URL) | ❌ Redirect to index.html | ✅ FIXED |
| `admin.html` | ❌ Redirect to index.html | ✅ PASS (guard exists) |
| `new-project.html` | ❌ Redirect to index.html | ✅ PASS (guard exists) |
| `superlog.html` | ❌ Redirect (admin→admin.html, others→login.html) | ✅ PASS (guard exists) |

### 2. `user` Role — Backend 403s

| Endpoint | Expected | Result |
|----------|----------|--------|
| `POST /api/modules/upload` | 403 | ✅ PASS |
| `POST /api/modules/aufmass-update` | 403 | ✅ PASS |
| `POST /api/files/upload` | 403 (no file written) | ✅ FIXED (pre-multer check) |
| `POST /api/files/folder` | 403 | ✅ PASS |
| `POST /api/files/rename` | 403 | ✅ PASS |
| `DELETE /api/files` | 403 | ✅ PASS |
| `POST /api/files/copy` | 403 | ✅ PASS (via `isAdmin()`) |
| `POST /api/files/move` | 403 | ✅ PASS (via `isAdmin()`) |
| `POST /api/files/share` | 403 | ✅ PASS (via `isAdmin()`) |
| `POST /api/projects/create` | 403 | ✅ PASS |
| `POST /api/projects/remove` | 403 | ✅ PASS |
| `POST /api/files/trash/restore` | 403 | ✅ PASS |
| `DELETE /api/files/trash/purge` | 403 | ✅ PASS |

> Note: The spec referenced `DELETE /api/projects/:name` — this route does not exist. Project deletion uses `POST /api/projects/remove`, which is correctly gated.

### 3. `user` Role — Frontend Hiding

| Feature | Expected | Result |
|---------|----------|--------|
| Dashboard module cards (7 pages) | Hidden | ✅ PASS (`.module-direct-link` → `display: none`) |
| files.html upload button / New dropdown | Hidden | ✅ PASS (`if (isAdmin)` check) |
| files.html context menu | Download + Details only | ✅ PASS |
| files.html checkboxes / batch delete | Hidden | ✅ PASS |
| aufmass.html edit button | Hidden | ✅ PASS |
| index.html New Project button | Hidden | ✅ PASS |
| dashboard.html Admin nav link | Hidden | ✅ PASS |

### 4. `user` Role — Share Links

| Action | Expected | Result |
|--------|----------|--------|
| Access `/share/:id` (public route) | ✅ Allowed (no auth required) | ✅ PASS (mounted before auth middleware in server.js) |
| Create share via `POST /api/files/share` | ❌ 403 | ✅ PASS (uses `isAdmin()`) |

### 5. `admin` / `administrator` Role

| Feature | Expected | Result |
|---------|----------|--------|
| All module pages | ✅ Full access | ✅ PASS (guards only block `user`) |
| `admin.html` | ✅ Access | ✅ PASS |
| `superlog.html` | ❌ Redirected to admin.html | ✅ PASS |
| All file operations | ✅ Full access | ✅ PASS (`isAdmin()` includes both) |
| Super logs API (`/api/admin/super-logs`) | ❌ 403 | ✅ PASS (`superadminOnly` middleware) |
| Project create/delete | ✅ Allowed | ✅ PASS |

### 6. `superadmin` Role — Zero Restrictions

| Feature | Expected | Result |
|---------|----------|--------|
| All module pages | ✅ Full access | ✅ PASS |
| `admin.html` | ✅ Full access | ✅ PASS |
| `superlog.html` | ✅ Full access | ✅ PASS |
| All file operations | ✅ Full access | ✅ PASS (`isAdmin()` includes superadmin) |
| Super logs API | ✅ Full access | ✅ PASS (`superadminOnly` allows superadmin) |
| Module upload/update | ✅ Full access | ✅ PASS (only `user` is blocked) |
| Project create/delete | ✅ Full access | ✅ PASS (only `user` is blocked) |
| Trash restore/purge | ✅ Full access | ✅ PASS (only `user` is blocked) |
| `clear-files` (OTDR) | ✅ Full access | ✅ PASS (explicit superadmin allowlist) |

---

## No Regressions

- Server starts clean with no errors
- Route loading verified with `node -e "require('./routes/...')"` for all route modules
- The `requireNonUserRole` middleware is additive and does not change any existing admin/superadmin behavior
- The module page guard scripts are identical in pattern to the existing `new-project.html` guard

---

## Files Changed

| File | Change |
|------|--------|
| `einblasen.html` | Added user role guard |
| `druckprufung.html` | Added user role guard |
| `apl.html` | Added user role guard |
| `otdr.html` | Added user role guard |
| `kalibrieren.html` | Added user role guard |
| `splicing.html` | Added user role guard |
| `knotenpunkt-vorbereitung.html` | Added user role guard |
| `routes/fileRoutes.js` | Added `requireNonUserRole` middleware before multer in `POST /upload` |

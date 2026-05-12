# Changelog — 2026-04-04: User Role Permission Restrictions

## Summary

Implemented role-based access control restricting the `user` role to **Aufmass (read)** and **Files (view/download only)**. All other features remain fully accessible to `superadmin`, `administrator`, and `admin`.

---

## Permission Matrix

| Feature | superadmin | admin / administrator | user |
|---|---|---|---|
| Aufmass page | ✅ | ✅ | ✅ |
| Files (view + download) | ✅ | ✅ | ✅ |
| Files (upload/delete/rename/move/copy/share) | ✅ | ✅ | ❌ |
| Dashboard module cards | ✅ | ✅ | ❌ (hidden) |
| Module pages (druckprufung, kalibrieren, einblasen, APL, splicing, knotenpunkt, OTDR) | ✅ | ✅ | ❌ (redirect to dashboard) |
| Admin page | ✅ | ✅ | ❌ |
| New project creation | ✅ | ✅ | ❌ |
| User management | ✅ | ✅ | ❌ |
| Chat (send messages) | ✅ | ✅ | ✅ |

---

## Frontend Changes

### `dashboard.html`
- Module cards with class `module-direct-link` (Einblasen, Druckprüfung, APL, OTDR, Kalibrieren, Splicing, Knotenpunkt Vorbereitung) are hidden for `user` role via JS on DOMContentLoaded.
- Aufmass card (`.module-link`) and Files card (`.files-link`) remain visible.

### Module JS files (all 7)
Added role redirect guard after auth guard in:
- `src/js/apl.js`
- `src/js/druckprufung.js`
- `src/js/einblasen.js`
- `src/js/kalibrieren.js`
- `src/js/knotenpunkt-vorbereitung.js`
- `src/js/otdr.js`
- `src/js/splicing.js`

Pattern applied:
```js
if (userRole === 'user') { window.location.href = `dashboard.html?project=${encodeURIComponent(projectName)}`; return; }
```

### `files.html`
- Context menu **Share** button now only rendered if `isAdmin` (was shown for all roles).
- `x-user-role` header added to all write fetch calls: upload (XHR), folder creation, rename, delete (single + batch).
- Existing `isAdmin` variable (derived from localStorage) already correctly hid: New button, Recycle Bin, copy/move/rename/delete context menu items, checkboxes, and batch action bar for non-admin roles.

### `index.html`
- `newProjectBtn` starts hidden (`style="display:none"`).
- Added `id="adminNavBtn"` to Admin nav button.

### `src/js/dashboard.js`
- Shows `newProjectBtn` only if `userRole !== 'user'`.
- Hides `adminNavBtn` for `user` role.

### `new-project.html`
- Added inline auth guard script at body start: redirects `user` role to `index.html`.

---

## Backend Changes

### `routes/moduleRoutes.js`
- `POST /api/modules/upload` — returns 403 for `user` role.
- `POST /api/modules/aufmass-update` — returns 403 for `user` role.
- `DELETE /api/modules/clear-files` — fixed existing check to properly allow `administrator` and `superadmin` (was only allowing `admin`).

### `routes/fileRoutes.js`
- `POST /api/files/upload` — returns 403 for `user` role.
- `POST /api/files/folder` — returns 403 for `user` role.
- `POST /api/files/rename` — returns 403 for `user` role.
- `DELETE /api/files/` — returns 403 for `user` role.
- `POST /api/files/trash/restore` — returns 403 for `user` role.
- `DELETE /api/files/trash/purge` — returns 403 for `user` role.
- Copy (`POST /api/files/copy`) and Move (`POST /api/files/move`) already had `isAdmin` guard via `x-user-role` header.
- Share creation (`POST /api/files/share`) already had `isAdmin` guard.

### `routes/projectRoutes.js`
- `POST /api/projects/create` — returns 403 for `user` role.
- `POST /api/projects/remove` — returns 403 for `user` role.

---

## Error Response Format (403)
```json
{ "success": false, "message": "Insufficient permissions" }
```

---

## Important Notes
- `superadmin` has **zero restrictions** — no check ever blocks superadmin.
- `administrator` and `admin` are treated identically as admin-level.
- Frontend hides UI elements (not just disables them) for clean UX.
- Backend enforces the same restrictions independently for security.

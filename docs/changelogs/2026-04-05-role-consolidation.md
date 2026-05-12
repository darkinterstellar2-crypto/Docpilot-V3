# Changelog — 2026-04-05 — Role Consolidation

## fix: remove duplicate 'admin' role (5fda5c0)

### Problem
Two admin-level roles existed (`admin` and `administrator`) with identical permissions, causing confusion in the admin panel.

### Changes
- Removed `admin` role entirely from codebase
- Three roles remain: `user`, `administrator`, `superadmin`
- Updated role selector dropdown in admin panel (removed "Admin" option)
- Updated role badge display function
- Updated ALLOWED_ROLES in backend role-change endpoint
- Fixed admin panel button visibility in dashboard (now shows for `administrator` + `superadmin`)
- Fixed OTDR admin controls (was checking `admin`, now checks `administrator` + `superadmin`)

### Files Changed
- `admin.html` — role dropdown, badge function, role labels, page guard
- `routes/adminRoutes.js` — ALLOWED_ROLES array
- `src/js/dashboard.js` — admin button visibility check
- `src/js/otdr.js` — admin control visibility check

# Changelog — 2026-04-05 — Permissions Rework

## Overview
Complete redesign of the permission system. Replaced role-based access with a pure ACL model.

## Commits (oldest → newest)

### 5fda5c0 — Remove duplicate 'admin' role
- Only 3 roles remain: `user`, `administrator`, `superadmin`
- Cleaned all references across 4 files

### cbf0cf1 — Pure ACL permissions
- Removed `administrator` role — only `user` and `superadmin`
- Zero access by default for all new users
- ACL is the sole permission system
- Auto-create zero-access ACL on user approval
- Project management: superadmin only
- Admin panel: superadmin only
- Registration: no role selection
- Search clear button added to aufmass

### 1505f10 — Password rules + UI cleanup
- Password: any format, just 8+ characters
- Strength indicator: Too short → Weak → Fair → Strong → Very strong
- Removed "User" labels (no need to state it when everyone is a user)

### 2e83741 — Fix abandoned registrations
- Pending registrations stored in memory only (not users.json)
- Data only saved to disk after OTP verification
- Auto-expire after 15 minutes if abandoned
- No logs written for unverified registrations

### 17a1aa3 — Granular permission system
- **Bug fix:** loadProjects now sends auth headers (was causing empty project list)
- **Bug fix:** Admin ACL panel no longer shows deleted projects
- **New ACL structure:**
  - `fullAccess` toggle — complete read+write to everything
  - `dashboard` permissions — create project, delete project, change status, reorder, download ZIP
  - Per-project: `access` (visibility), `canEdit` (read-only vs read+write), per-module toggles
- **New endpoint:** `GET /api/access/permissions` — returns effective permissions
- **Dashboard:** context-aware menus, only shows permitted actions
- **Backend:** all write ops check canEditProject, dashboard actions check canDashboard
- **Admin panel:** complete ACL UI redesign with hierarchical toggles

## Files Changed
- `controllers/accessControl.js` — complete rewrite with new functions
- `routes/accessRoutes.js` — new permissions endpoint
- `routes/projectRoutes.js` — granular ACL checks
- `routes/dataRoutes.js` — canEdit enforcement
- `routes/moduleRoutes.js` — canEdit enforcement
- `routes/fileRoutes.js` — canEdit enforcement
- `routes/adminRoutes.js` — new ACL format on approval
- `routes/authRoutes.js` — in-memory pending registrations, relaxed password
- `src/js/dashboard.js` — permissions-aware UI
- `admin.html` — ACL panel redesign
- `register.html` — password strength indicator, no role dropdown
- All module .html + .js files — removed role-based checks
- 31+ files total

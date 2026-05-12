# 2026-04-10 — Major Feature Update (16 commits)

## Overview
Massive feature day: 15 tasks completed covering permissions, UI/UX, chat, project management, file operations, and module restructuring.

---

## 1. Generator Per-User Permissions
- **New field:** `generatorAllowedUsers` array in `settings.json`
- **New endpoint:** `GET /api/settings/generator-access` — checks user permission + returns URLs
- Superadmin always has access
- **Two-layer auth:** permission toggle (admin controls who) → code gate (proof of authorization)
- Generator section completely hidden for unauthorized users (no error messages)

## 2. Searchable Generator User Picker
- Replaced flat scrollable user list with searchable dropdown
- Search input filters by name/email, shows top 8 matches
- Click to add user, X to remove
- Compact list shows only users WITH access + superadmins as "Always"
- Auto-saves on every add/remove

## 3. Authority Permissions (formerly Dashboard Permissions)
- Renamed `DASHBOARD_PERMS` → `AUTHORITY_PERMS` across admin panel
- ACL data key: `authority` (reads both `authority` and `dashboard` for backward compat)
- Glassmorphism confirmation modal on toggle ON: "Grant Permission?" with warning
- Toggle OFF requires no confirmation (revoking is safe)
- Backend returns both `authority` and `dashboard` keys

## 4. Files Permission — canEdit Grants Full Access
- `fileRoutes.js`: replaced `isAdmin()` (superadmin-only) with `canEditFiles()` 
- Checks: superadmin OR `canEditProject` ACL permission
- Copy, move, share, trash restore/purge now accessible to users with canEdit
- `files.html`: `isAdmin` derived from `/api/access/permissions` instead of role
- Users without canEdit limited to view/download only
- All operations remain fully tracked (logAction, setFileMeta, superLog)

## 5. UI: "Can Edit" → "Edit"
- Simple label rename in ACL panel

## 6. Chat — Message Grouping (WhatsApp-style)
- Sender name shown only on first message in consecutive group
- Reduced spacing between grouped messages (`.grouped` class)
- Grouping resets on date change or different sender

## 7. Chat — Profile Pictures
- Avatar shown beside first message in each group (left side for others' messages)
- Loads user avatars from `/api/admin/users` on chat init
- Falls back to initial letter circle when no avatar uploaded
- Spacer div maintains alignment for consecutive messages
- Messages wrapped in `msg-row` for avatar + bubble layout

## 8. ProjectInfo System
- **Storage:** `src/DataFiles/project-info.json` — per-project description + custom key-value fields
- **New routes:** `routes/projectInfoRoutes.js` — `GET/PUT /api/project-info/:project`
- **New project form:** description textarea + dynamic custom fields (add/remove)
- **Dashboard:** ℹ️ button opens slide-out drawer with project details
- Edit mode: editable description + fields, Save/Cancel, permission-gated
- Auto-created on startup

## 9. editProjectInfo Authority Permission
- New "Edit Project Details" toggle in Authority Permissions
- Dashboard ℹ️ edit button requires this specific permission
- Backend enforces via `getEffectivePermissions()`
- Separate from `canEdit` (which is for file operations)

## 10. ZIP Download — NAS Pre-Sync
- `nasSync.js`: new `syncProjectFromNAS()` — recursive WebDAV listing, fetches missing files
- `projectRoutes.js`: ZIP route pre-syncs with 60s timeout, falls back to local on failure
- Toast banner shows "Syncing from NAS..." during download
- NAS disabled = unchanged behavior (zips local as-is)

## 11. Merged NVT & Splicing Module
- Single "NVT & Splicing" page replaces both separate modules
- **Navigation:** Cluster → Knotenpunkt → clean choice screen:
  - "Upload for NVT" button (with file count badge)
  - Address list below for per-address splice uploads
- Both upload forms have back navigation
- `splicing.html` and `src/js/splicing.js` deleted
- Dashboard: single "NVT & Splicing" card
- ACL: single module entry

## 12. Team Member List
- `accessControl.js`: new `getProjectMembers(projectName)` function
- `GET /api/project-info/:project/members` endpoint
- Returns superadmins + ACL members with names, avatars, roles
- "Team Members" section in ℹ️ info panel with avatars and role badges

## 13. In-App Image/PDF Viewer
- Images (jpg/png/gif/webp): fullscreen lightbox with dark backdrop
- PDFs: iframe-based viewer filling viewport
- Other files: download only (unchanged)
- Close via X button, ESC key, or backdrop click
- Context menu: "Preview" option for previewable files
- Download button always available in viewer header

## 14. Folder Sharing — Public Browsable Links
- `POST /api/files/share` now accepts folders (`type: 'folder'`)
- Folder shares render self-contained HTML browse page
- Breadcrumb navigation, click to enter subfolders, click to download files
- `GET /share/:shareId/browse?path=` — JSON directory listing
- `GET /share/:shareId/download?file=` — file download within shared folder
- Path traversal protection, expiry enforcement
- Context menu for folders now shows "Share" option

## 15. Folder Download as ZIP
- `GET /api/files/download-folder?project=X&path=folder/path`
- Zips folder on-the-fly and streams as download
- "Download ZIP" option in folder context menu
- ACL enforced, path traversal protected, logged via superLog

---

## Files Modified (across all commits)
- `admin.html` — authority perms, generator access UI, ACL toggle sync, module list
- `dashboard.html` — chat grouping, avatars, project info panel, members, module cards
- `files.html` — permissions, viewer, folder share/download
- `index.html` — NAS sync toast
- `knotenpunkt-vorbereitung.html` — merged module styles
- `src/js/knotenpunkt-vorbereitung.js` — full rewrite (merged NVT + Splicing)
- `src/js/dashboard.js` — superadmin-only project mgmt, authority perms
- `src/js/einblasen.js` — generator permission + code gate
- `src/js/apl.js`, `otdr.js` — show uploaded files when done
- `src/js/module-shared.js` — files view for done status
- `src/js/table.js` — folder location link fix
- `src/js/new-project.js` — project info fields
- `routes/fileRoutes.js` — canEdit files, folder zip, folder share
- `routes/projectRoutes.js` — superadmin enforcement, NAS sync zip
- `routes/settingsRoutes.js` — generator access endpoint
- `routes/accessRoutes.js` — authority perms, module list update
- `routes/projectInfoRoutes.js` — NEW (project info + members)
- `controllers/accessControl.js` — getProjectMembers, authority compat
- `controllers/nasSync.js` — syncProjectFromNAS
- `src/DataFiles/settings.json` — generatorAllowedUsers
- `src/DataFiles/project-info.json` — NEW
- `new-project.html` — project info fields in creation form
- Deleted: `splicing.html`, `src/js/splicing.js`

## Commit History
| Commit | Description |
|--------|-------------|
| `bad5b09` | Hide generator when no permission |
| `3723ff2` | Searchable generator user picker |
| `b461af8` | Authority Permissions + confirmation dialogs |
| `5aa31db` | canEdit grants full file operations |
| `6ce4586` | Rename "Can Edit" → "Edit" |
| `7b25b29` | Chat message grouping |
| `2fc9a23` | Chat profile pictures |
| `73664ad` | ProjectInfo system + ℹ️ button |
| `eb969c7` | editProjectInfo authority permission |
| `ebdaab4` | ZIP download NAS sync |
| `4bcfd69` | Merged NVT & Splicing module |
| `f2176dc` | Team member list |
| `842b3a9` | In-app image/PDF viewer |
| `2914b15` | Folder sharing public links |
| `3520711` | Folder download as ZIP |
| `210657f` | NVT clean navigation screen |

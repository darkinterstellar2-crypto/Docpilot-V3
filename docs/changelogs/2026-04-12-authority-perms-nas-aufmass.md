# 2026-04-12 — Authority Permissions Fix, NAS File Listing, Aufmass Plan Update

## Summary

Major session covering three areas: fixing the broken authority permissions system, implementing smart NAS↔VPS file listing, and updating the Rauhenebrach aufmass data with new contractor plans.

---

## 1. Authority Permissions — Complete Fix

### Problem
Authority permissions (Create Project, Delete Project, Change Status, Reorder, Download ZIP, Edit Project Info) were completely non-functional for non-superadmin users, even when granted via the admin panel.

### Root Causes Found
1. **Admin panel → backend key mismatch**: `admin.html` sends `authority` key, backend only read `dashboard` key → permissions always saved as `false`
2. **Dashboard.js hardcoded overrides**: Lines 49-52 forced `createProject/deleteProject/changeStatus/reorderProjects = isSuperadmin`, overwriting whatever ACL returned
3. **Dashboard.js fullAccess path**: Hardcoded all permissions to `false` except `downloadZip`
4. **Backend routes (projectRoutes.js)**: All 4 project management routes (`/create`, `/status`, `/reorder`, `/remove`) checked `role !== 'superadmin'` → 403, never consulted ACL
5. **`getEffectivePermissions()` missing `editProjectInfo`**: Function in `accessControl.js` built output with only 5 keys — `editProjectInfo` was never included in either the regular or `fullAccess: true` paths
6. **`canDashboard()` only reading `entry.dashboard`**: Missed the `authority` key entirely

### Fixes Applied

#### `routes/adminRoutes.js`
- Added `authority` to destructured `req.body`
- Uses `authSource = authority || dashboard || {}` for backward compat
- Saves permissions under **both** `authority` and `dashboard` keys
- Includes `editProjectInfo` in saved permissions
- POST handler: syncs project-info.json `members` array based on ACL changes
- DELETE handler: removes user from all project member lists

#### `controllers/accessControl.js`
- `getEffectivePermissions()`: Added `editProjectInfo: true` to `fullAccess` return path
- `getEffectivePermissions()`: Added `editProjectInfo: !!(authEntry.editProjectInfo)` to regular path
- `canDashboard()`: Now reads `entry.authority || entry.dashboard` (was `entry.dashboard` only)

#### `src/js/dashboard.js`
- Removed hardcoded superadmin overrides (lines 49-52 deleted)
- `fullAccess` path now grants all permissions: `{ createProject: true, deleteProject: true, changeStatus: true, reorderProjects: true, downloadZip: true, editProjectInfo: true }`
- Authority permissions are now fully ACL-driven

#### `routes/projectRoutes.js`
- `/create`: `canDashboard(email, 'createProject')` replaces `role !== 'superadmin'` check
- `/status`: `canDashboard(email, 'changeStatus')`
- `/reorder`: `canDashboard(email, 'reorderProjects')`
- `/remove`: `canDashboard(email, 'deleteProject')`
- Superadmin still bypasses all checks (first condition)

#### `routes/projectInfoRoutes.js`
- PUT handler preserves `members` array when updating project description/fields (prevents race condition with ACL sync)
- Members endpoint reads from `project-info.json` first, falls back to ACL-based computation

### Full Access Toggle Sync

#### Problem
Toggling Full Access OFF in admin panel left all sub-toggles (authority + project + module) still checked.

#### Fix (`admin.html`)
- Full Access ON: Now shows a red confirmation dialog ("Grant Full Access?") before enabling
- Full Access OFF: Turns off all authority toggles, project access toggles, canEdit toggles, and module toggles
- Cancel/backdrop click reverts the toggle

---

## 2. NAS ↔ VPS Unified File Listing

### Problem
Server synced files to NAS then cleaned them locally (48h TTL). The Files module only read from local filesystem → showed empty directories even though files existed on NAS.

### Solution: Virtual Union Listing

Instead of downloading all files from NAS just to list them, we build a **merged directory listing**:

#### How It Works

**Browsing (listing a directory):**
1. Read local VPS directory entries → add to Map
2. Query NAS for same directory (1 lightweight WebDAV PROPFIND call — metadata only, no file content)
3. Merge: NAS-only items added to Map (local items take priority for duplicates)
4. NAS-only folders get a local stub directory created so navigation works
5. Return unified list — user sees everything seamlessly

**Opening/downloading a file:**
1. `ensureLocalFile()` checks VPS first → serves if present
2. If missing locally → fetches that single file from NAS → caches locally → serves
3. Next request → file already cached on VPS

**Key principle: Files are NEVER bulk-downloaded during browsing. Only fetched individually when actually opened.**

#### Files Changed

**`controllers/nasSync.js`**
- Added `listNASDirectory(relDir)` — returns `[{name, isDir, size, mtime}]` from NAS via PROPFIND
- Added `fetchNASDirectory(relDir)` — recursive fetch (available for ZIP downloads)
- Both handle NAS errors gracefully (return null/0 on failure)

**`routes/fileRoutes.js`**
- `GET /api/files`: Map-based union of local + NAS entries
- `GET /share/:id` (file share): `ensureLocalFile()` before serving
- `GET /share/:id/browse` (folder share browse): Same Map union approach
- `GET /share/:id/download` (folder share file download): `ensureLocalFile()` before serving

#### Edge Cases Handled
- NAS unreachable → graceful degradation, shows local files only
- Both empty but dir exists → empty list (not 404)
- Both missing → proper 404
- Race condition (concurrent requests) → harmless double-fetch of same data
- NAS-only dir navigation → stub dir allows seamless drill-down

---

## 3. Aufmass Data Update — Rauhenebrach Plan Revision

### Context
New contractor plans received (260407 v4 Los1) replacing the original 241127 Bestückungsliste. RK requested a comparison and data update.

### Plan Comparison Results
- **Scope:** New plan is Los 1 only (279 addresses). Old plan had all 3 Lose (712 addresses).
- **Los 1 clusters:** Fürnbach (109), Prölsdorf (124), Schindelsee (31), Spielhof (27)
- **Splice formula confirmed:** `2 + (4 × WE)` — 100% match across all 254 addresses with data
- **48 WE changes** — more households discovered (WE counts went up)
- **22 fiber type changes** — mostly 12→24 upgrades
- **277 cable designations** — all V-numbers newly assigned
- **276 network reference numbers** — operator data filled in
- **53 SVt/NVt changes** — Knotenpunkte reassigned
- **5 new addresses** — infrastructure points + Rothstr. 7a

### Schema Changes Applied
1. **Los column** added to Location group (position 0, before Cluster) — `col-2-0: Los`
2. **Wohneinheiten column** added to Eigentümerdaten group — `col-11-3: Wohneinheiten`
3. **Change notes column** added to Notes group — `col-12-1: Änderungen Auftragnehmer 09.04.2026`

### Data Changes Applied (285 total rows)
- **Los filled:** 276 addresses → "Los 1"
- **Wohneinheiten filled:** 275 addresses (WE 1-4)
- **Splices updated:** 52 addresses (based on new WE values)
- **Fiber type changed:** 21 addresses (12→24)
- **Cable designations:** 275 addresses got V-numbers
- **Knotenpunkte updated:** 51 addresses
- **5 new addresses added** with full data
- **Change notes:** Every modified row has German documentation, e.g.:
  `"Spleißanzahl: 6 → 14 (basierend auf WE=3); Faseranzahl: 12 → 24; Kabelbezeichnung: (leer) → V102775"`

### Address Matching
Used normalized street name matching (`Straße` ↔ `Str.` normalization) to achieve 270/279 matches between aufmass and Bestückungsliste.

---

## 4. APL Contact Card — Multiple Eigentümer Names

### Change
Names in Eigentümerdaten can contain multiple owners (separated by "o.", commas, or "und"). Previously shown as a single text line.

### Fix
- `src/js/apl.js`: `buildCustomerHTML()` now splits names on `o.`, `,`, `und` patterns
- Each name displayed as an individual amber pill badge (`.customer-owner` class)
- `apl.html`: Added CSS for `.customer-owner` (amber background `#fef3c7`, brown text `#92400e`)

---

## 5. Files Module — canEdit / fullAccess Permission Fix

### Problem
Users with `fullAccess` or `canEdit` permission couldn't see file operation buttons (upload, rename, delete, copy, move, share, recycle bin) in the Files module. Only superadmins saw them.

### Root Cause
`files.html` line 715: only checked `permData.superadmin` — never checked `permData.fullAccess`. Since fullAccess users aren't superadmin, they were treated as read-only.

### Fix
```javascript
// Before (broken)
if (permData.superadmin) { isAdmin = true; }

// After (fixed)
if (permData.superadmin || permData.fullAccess) { isAdmin = true; }
```

Three paths now grant full file operations:
1. `userRole === 'superadmin'` in localStorage (before API call)
2. `permData.superadmin || permData.fullAccess` from API
3. `permData.projects[projectName].canEdit === true` for project-specific edit rights

Backend already handled all three correctly via `canEditProject()` / `canEditFiles()` — both check `fullAccess` before per-project ACL. This was purely a frontend gate issue.

---

## Commits
| Hash | Description |
|------|-------------|
| `e064d14` | fix: authority permissions save + team member sync with ACL |
| `4bdee63` | fix: authority permissions now actually control project actions |
| `a768559` | fix: Full Access toggle OFF now turns off all sub-toggles |
| `2033e67` | feat: APL contact card shows multiple Eigentümer names as pills |
| `d47746d` | fix: file listing falls back to NAS when local dir is empty/missing |
| `bca6573` | refactor: file listing shows union of VPS + NAS (no bulk download) |
| `6fa9fa6` | fix: files module respects fullAccess + canEdit for all file operations |

## Deploy
```bash
cd /opt/docpilot && git pull && docker compose up -d --build
```

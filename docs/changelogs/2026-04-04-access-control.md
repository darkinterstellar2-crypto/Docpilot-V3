# Changelog — 2026-04-04: Granular Access Control

## Feature: Per-User, Per-Project, Per-Module Access Control (Superadmin Only)

---

### Summary

Introduced a full ACL (Access Control List) engine that allows the superadmin to restrict specific users from accessing specific projects and/or modules within those projects. All enforcement is additive on top of existing role-based restrictions — it cannot grant more than the role allows.

---

### New Files

#### `controllers/accessControl.js`
The ACL engine. Reads/writes `src/DataFiles/access-control.json`.

**Exported functions:**
- `getUserAccess(email)` — returns full ACL entry or null (full access)
- `setUserAccess(email, accessData)` — saves ACL entry
- `removeUserAccess(email)` — deletes ACL entry (restores full access)
- `getAllAccessRules()` — returns entire ACL object
- `canAccessProject(email, projectName)` — boolean
- `canAccessModule(email, projectName, moduleName)` — boolean
- `getAccessibleProjects(email, allProjects)` — filtered array

**ACL Rules:**
- `superadmin` role → ALWAYS full access. Never blocked by ACL.
- No ACL entry → full access (backward compatible, no breaking change).
- `defaultProjectAccess: true` → all projects accessible unless explicitly blocked.
- `defaultProjectAccess: false` → no projects accessible unless explicitly granted.

#### `src/DataFiles/access-control.json`
Storage file for ACL rules. Starts empty (`{}`). Created automatically on startup.

#### `routes/accessRoutes.js`
User-facing permission endpoint. Available to all authenticated users.

- `GET /api/access/my-permissions?project=X`
  - Returns: `{ success: true, permissions: { aufmass: true, files: true, druckprufung: false, ... } }`
  - Superadmin always gets all `true`.
  - Used by `dashboard.html` to hide inaccessible module cards.

---

### Modified Files

#### `routes/adminRoutes.js`
Added 4 new endpoints, all **SUPERADMIN ONLY**:

- `GET /api/admin/access-control` — get all ACL rules
- `GET /api/admin/access-control/:email` — get ACL for specific user (null = full access)
- `POST /api/admin/access-control/:email` — set/overwrite ACL for a user
- `DELETE /api/admin/access-control/:email` — remove ACL (restore full access)

All write operations are logged via `logAction`.

#### `routes/projectRoutes.js`
- `GET /api/projects` now filters project list through `getAccessibleProjects()` for non-superadmin users.
- Superadmin always sees all projects.

#### `routes/dataRoutes.js`
- `GET /api/data` and `POST /api/data` now check `canAccessProject` + `canAccessModule('aufmass')`.
- Returns `403` if either check fails.
- Superadmin always bypasses these checks.

#### `routes/moduleRoutes.js`
- `GET /api/modules/navigation` — checks project + `aufmass` module access.
- `POST /api/modules/upload` — checks project + `files` module access.
- `POST /api/modules/aufmass-update` — checks project + `aufmass` module access.
- `GET /api/modules/aufmass-row` — checks project + `aufmass` module access.
- `GET /api/modules/list-files` — checks project + `files` module access.

#### `routes/fileRoutes.js`
- `GET /api/files` (file listing) — checks project + `files` module access.
- `POST /api/files/upload` — checks project + `files` module access.

#### `routes/chatRoutes.js`
- `GET /api/chat/:project` — checks project + `chat` module access.
- `POST /api/chat/:project` — checks project + `chat` module access.

#### `server.js`
- Registered `accessRoutes` at `/api/access`.
- Added `access-control.json` to the list of default data files created on startup.

#### `dashboard.html`
- Added `data-module` attributes to all 9 module cards (aufmass, einblasen, druckprufung, apl, otdr, kalibrieren, splicing, knotenpunkt, files).
- On page load, fetches `/api/access/my-permissions?project=X` and hides cards for modules the user cannot access.
- Chat FAB is also hidden if the `chat` module is not accessible.
- Existing role-based restrictions (`user` role hiding non-aufmass/files cards) are preserved and unchanged.

#### `admin.html`
- Added "Access Control" section (superadmin only, hidden for all other roles).
- User dropdown populated from `/api/admin/users`.
- Per-user panel shows:
  - **Default Access** toggle (controls `defaultProjectAccess`)
  - Per-project on/off toggles (expandable rows)
  - Per-module checkboxes with **Select All** / **Deselect All**
  - **Save Changes** button (POST to API)
  - **Reset to Full Access** button (DELETE from API)
  - Success/error feedback inline

---

### ACL Data Structure

```json
{
  "john@geggos.de": {
    "defaultProjectAccess": true,
    "projects": {
      "Laich-Suppingen": {
        "access": true,
        "modules": {
          "aufmass": true,
          "files": true,
          "druckprufung": false,
          "kalibrieren": true,
          "einblasen": false,
          "apl": true,
          "splicing": false,
          "knotenpunkt": false,
          "otdr": false,
          "chat": true
        }
      }
    }
  }
}
```

---

### Module Names Reference

| Key | Module |
|---|---|
| `aufmass` | Aufmass (measurement table) |
| `files` | Files (file manager) |
| `druckprufung` | Druckprüfung |
| `kalibrieren` | Kalibrieren |
| `einblasen` | Einblasen |
| `apl` | APL |
| `splicing` | Splicing |
| `knotenpunkt` | Knotenpunkt Vorbereitung |
| `otdr` | OTDR |
| `chat` | Project Chat |

---

### Important Notes

- **Superadmin is never restricted** — every enforcement point skips ACL checks when `x-user-role` is `superadmin`.
- **No breaking change** — users without an ACL entry get full access exactly as before.
- **ACL is additive** — it cannot grant more than the role allows. A `user` role user is still restricted to aufmass + files by the role check, regardless of ACL.
- **Frontend + Backend enforcement** — the dashboard hides cards client-side for UX, but all API endpoints independently enforce ACL server-side.

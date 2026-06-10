# Access Control (ACL)

DocPilot has a granular, per-user, per-project, per-module access control system. All ACL logic lives in `controllers/accessControl.js`, with CRUD endpoints in `routes/adminRoutes.js` and user-facing permission queries in `routes/accessRoutes.js`.

## Permission Hierarchy

```
1. superadmin role      → ALWAYS full access. ACL is NEVER checked.
2. fullAccess: true     → Same as superadmin for ACL purposes
3. No ACL entry         → NO access (zero access by default)
4. dashboard[action]    → Controls dashboard-level actions
5. projects[name].access → Controls project visibility
6. projects[name].canEdit → Controls write permission within a project
7. projects[name].modules[mod] → Controls module visibility
```

> **Critical:** The default is **zero access**. If a user has no ACL entry, they can see nothing. When a user is approved, a zero-access ACL entry is automatically created by `ensureZeroAccessACL()` in `adminRoutes.js`.

## ACL Data Structure

**File:** `src/DataFiles/access-control.json`

```json
{
  "user@example.com": {
    "fullAccess": false,
    "authority": {
      "createProject": false,
      "deleteProject": false,
      "changeStatus": false,
      "reorderProjects": false,
      "downloadZip": false,
      "editProjectInfo": false
    },
    "dashboard": {
      "createProject": false,
      "deleteProject": false,
      "changeStatus": false,
      "reorderProjects": false,
      "downloadZip": false,
      "editProjectInfo": false
    },
    "projects": {
      "ProjectName": {
        "access": true,
        "canEdit": false,
        "modules": {
          "aufmass": true,
          "files": true,
          "druckprufung": true,
          "kalibrieren": true,
          "einblasen": true,
          "apl": true,
          "knotenpunkt": true,
          "otdr": true,
          "chat": true,
          "planner": true
        }
      }
    }
  }
}
```

### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `fullAccess` | boolean | If `true`, user has access to everything (like superadmin for ACL purposes) |
| `authority` / `dashboard` | object | Controls dashboard-level actions (both keys are read — `authority` takes priority, `dashboard` is backward compat) |
| `authority.createProject` | boolean | Can create new projects |
| `authority.deleteProject` | boolean | Can delete projects |
| `authority.changeStatus` | boolean | Can change project status (Active/Completed/etc.) |
| `authority.reorderProjects` | boolean | Can reorder projects on the Hub page |
| `authority.downloadZip` | boolean | Can download project as ZIP backup |
| `authority.editProjectInfo` | boolean | Can edit project description and custom fields |
| `projects` | object | Per-project access rules (keyed by project name) |
| `projects[name].access` | boolean | Can this user see the project? |
| `projects[name].canEdit` | boolean | Can this user write/edit data in the project? |
| `projects[name].modules` | object | Per-module visibility within this project |

### Module Names

The following module names are used in the ACL system:

| Module Key | Description |
|-----------|-------------|
| `aufmass` | Aufmass measurement table |
| `files` | File browser |
| `druckprufung` | Pressure testing |
| `kalibrieren` | Calibration |
| `einblasen` | Fiber blowing |
| `apl` | APL/Splicing |
| `knotenpunkt` | Junction preparation |
| `otdr` | OTDR testing |
| `chat` | Per-project chat |
| `planner` | Planner/calendar |

## How ACL Checks Work in Routes

Every route that accesses project data follows this pattern:

```javascript
// Skip ACL for superadmin
if (userRole !== 'superadmin') {
    const projectOk = await canAccessProject(userEmail, projectName);
    if (!projectOk) return res.status(403).json({ message: 'Access denied' });

    const moduleOk = await canAccessModule(userEmail, projectName, 'aufmass');
    if (!moduleOk) return res.status(403).json({ message: 'Module not accessible' });

    // For write operations:
    const editOk = await canEditProject(userEmail, projectName);
    if (!editOk) return res.status(403).json({ message: 'Read-only access' });
}
```

## Available Check Functions

| Function | Purpose |
|----------|---------|
| `hasFullAccess(email)` | Does the user have `fullAccess: true`? |
| `canAccessProject(email, projectName)` | Can user see this project? |
| `canEditProject(email, projectName)` | Can user write/edit in this project? |
| `canAccessModule(email, projectName, moduleName)` | Can user see this module? |
| `canDashboard(email, action)` | Can user perform this dashboard action? |
| `getAccessibleProjects(email, allProjects)` | Filter project list to accessible ones |
| `getEffectivePermissions(email)` | Return full permissions object for frontend |
| `getProjectMembers(projectName)` | List emails with access to a project |

## Frontend Permission Usage

The dashboard (`src/js/dashboard.js`) fetches permissions on load:

```javascript
const res = await fetch('/api/access/permissions');
const data = await res.json();
// data = { fullAccess, authority, dashboard, projects }
```

This data is used to:
- Show/hide the "New Project" button (`createProject`)
- Show/hide delete buttons (`deleteProject`)
- Show/hide status change dropdowns (`changeStatus`)
- Enable/disable drag-to-reorder (`reorderProjects`)
- Show/hide ZIP download buttons (`downloadZip`)
- Show/hide module cards based on per-project module access

## Thread Safety

ACL reads/writes use a promise-chain mutex (`_writeLock`) to prevent race conditions on concurrent `setUserAccess` / `removeUserAccess` calls:

```javascript
let _writeLock = Promise.resolve();
async function setUserAccess(email, accessData) {
    _writeLock = _writeLock.then(async () => {
        const acl = await readACL();
        acl[email] = accessData;
        await writeACL(acl);
    });
    return _writeLock;
}
```

## Admin ACL Management

Superadmins manage ACL via:
- `GET /api/admin/access-control` — Get all rules
- `GET /api/admin/access-control/:email` — Get user's rules
- `POST /api/admin/access-control/:email` — Set user's rules
- `DELETE /api/admin/access-control/:email` — Remove all restrictions (grants full access)

When ACL is updated, the `project-info.json` member lists are automatically synced to match.

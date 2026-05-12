# Druckprüfung (Pressure Testing) Module

## Overview

### What it does

**For the field worker:** Druckprüfung is the pressure test step. Before fiber cables can be put into service, every conduit segment must be pressure-tested to confirm there are no leaks. The worker opens this module, navigates to their address (from→to house), selects the conduit configuration (e.g. 12×10 = 12 micro-ducts of 10mm each), and uploads the pressure test report PDF. That's it — the system marks the row as Done.

**For the developer:** This is the simplest ModuleNavigator instance in DocPilot. It uses no custom logic — just the standard three-level navigation (Cluster → Knotenpunkt → Address) plus the standard PDF upload form. The module writes to a `druckprufung` schema group in the aufmass data file: status, type, and file path columns.

### Why it exists in the workflow

Fiber conduits are blown/drawn under compressed air. Any defect (loose joint, damaged conduit) will show up as pressure loss during the test. This test happens **before** cable blowing (Einblasen) and **before** any splicing work. The PDF report from the pressure testing machine is the physical proof that the conduit segment is intact. DocPilot captures this document digitally and links it to the exact cable segment row in the aufmass data.

### Domain terms

| Term | Meaning |
|------|---------|
| **Druckprüfung** | Pressure test — a compressed-air integrity test on fiber conduit segments |
| **Knotenpunkt** | Junction point / distribution node — a cabinet or vault where multiple cable runs meet |
| **NVT** | Netzverteilertechnik — network distribution technology; sometimes used interchangeably with Knotenpunkt |
| **Cluster** | Logical grouping of Knotenpunkte in a project (e.g. a neighborhood or deployment phase) |
| **12×10, 4×20** | Conduit bundle configs — "12 micro-ducts of 10mm diameter" or "4 ducts of 20mm" |
| **Aufmass** | Measurement/documentation data file — the master record for the project (`.txt` file storing JSON) |

---

## User Journey (Step by Step)

### 1. Dashboard → Module

User is on `dashboard.html?project=PROJECTNAME`. They click the **Druckprüfung** card. Browser navigates to:
```
druckprufung.html?project=PROJECTNAME
```

The page initializes, reads `projectName` from `URLSearchParams`, and checks `localStorage.getItem('userRole')`. If either is missing, redirects to `index.html` / `login.html`.

The header shows: project name (set via `#projectNameDisplay`). Back button (`#backBtn`) returns to dashboard.

### 2. Cluster List

`ModuleNavigator.init()` fetches:
```
GET /api/modules/navigation?project=PROJECTNAME&module=druckprufung
```

On success, renders a grid of **Cluster cards**. Each card shows:
- Folder icon (amber)
- Cluster name
- Count: "N Knotenpunkte"

### 3. Knotenpunkt List

User clicks a Cluster card. `renderKnotenpunkte()` renders a new grid showing all Knotenpunkte in that cluster. Each card shows:
- Folder icon
- Knotenpunkt name (e.g. "NVt-14")
- Count: "N Adressen"

Breadcrumb updates to: `[Cluster name]`

### 4. Address List

User clicks a Knotenpunkt card. `renderAddresses()` renders a vertical list of address rows. Each row shows:
- **Address end** (the "to" address — typically a house or endpoint, e.g. "Zeilerweg 11")
- **Cable name** (e.g. "K-NVt14-01") and fiber type
- Status badge: **Done** (green) or **Pending** (gray)

Breadcrumb updates to: `[Cluster] > [Knotenpunkt]`

### 5. Upload Form

User clicks an address row. If status is already Done, `_renderFilesViewAsync()` is called instead (shows existing files with Re-upload option). Otherwise, `renderUploadForm()` renders:

**Form elements:**
- Address info card (cable name, address, fiber type)
- **Type select** dropdown: `12x10`, `4x20`, `custom`
  - If `custom` selected: text input appears for custom type string
- **Drop zone** with "Browse" button — PDF files only (drag & drop or click to pick)
  - File selected: shows filename and a "✕ Remove" button
- **Upload button** (disabled until file + type are selected)
- Status message area (shows success/error after upload)

Breadcrumb updates to: `[Cluster] > [Knotenpunkt] > [address]`

### 6. Upload & Save

User drops/selects a PDF and clicks Upload.

1. `handleUpload()` fires
2. File is POSTed to `/api/modules/upload` with the **original filename** (because `useOriginalFilename: true`)
3. On success: `aufmass-update` is called to write `status=Done`, `type=<selected>`, `file=<path>`
4. Address status badge in the list updates to Done
5. After 1.6s, navigator returns to the Knotenpunkt address list

---

## Technical Architecture

### Frontend Files

| File | Role |
|------|------|
| `druckprufung.html` | Page shell — header, breadcrumb container, content container |
| `src/js/module-shared.js` | `ModuleNavigator` class — all navigation + upload logic |
| `src/js/druckprufung.js` | Config-only: instantiates `ModuleNavigator` with Druckprüfung-specific config |

**Script load order in HTML:**
```html
<script src="src/js/api.js"></script>
<script src="src/js/modal.js"></script>
<script src="src/js/module-shared.js"></script>
<script src="src/js/druckprufung.js"></script>
<script src="src/js/logout.js"></script>
<script src="src/js/i18n.js"></script>
<script src="src/js/idle-logout.js"></script>
```

### ModuleNavigator Config

```js
const nav = new ModuleNavigator({
    project:             projectName,       // from URL param
    moduleName:          'Druckprüfung',    // used in filenames (legacy, overridden by useOriginalFilename)
    moduleKey:           'druckprufung',    // ACL key — must match access-control.json
    targetFolder:        'Druckprufung',    // subfolder under Cluster/ in file storage
    groupLabel:          'druckprufung',    // schema group label to resolve column IDs
    typeOptions:         ['12x10', '4x20', 'custom'],
    useOriginalFilename: true,              // skip filenamePattern, use the file's own name
    containers: {
        content:    document.getElementById('moduleContent'),
        breadcrumb: document.getElementById('moduleBreadcrumb'),
    }
});
nav.init();
```

`useOriginalFilename: true` means the file is stored with whatever name the PDF already has. No renaming happens.

### Backend Endpoints

#### GET /api/modules/navigation

```
GET /api/modules/navigation?project=SUPPN&module=druckprufung
Headers: x-user-email, x-user-role
```

**Response:**
```json
{
  "success": true,
  "schema": [
    {
      "id": "grp-0",
      "label": "Identification",
      "cols": [
        { "id": "col-0-0", "label": "Row ID" },
        { "id": "col-0-1", "label": "Cluster" },
        { "id": "col-0-2", "label": "Knotenpunkt" }
      ]
    },
    {
      "id": "grp-5",
      "label": "Druckprufung",
      "cols": [
        { "id": "col-5-0", "label": "Status Druckprufung" },
        { "id": "col-5-1", "label": "Type Druckprufung" },
        { "id": "col-5-2", "label": "File Druckprufung" }
      ]
    }
  ],
  "clusters": [
    {
      "name": "SUPPN",
      "knotenpunkte": [
        {
          "name": "NVt-14",
          "addresses": [
            {
              "id": "ROW-0042",
              "start": "SUPPN, Hauptstr 5",
              "end": "SUPPN, Zeilerweg 11",
              "cableName": "K-NVt14-01",
              "fiberType": "12G50",
              "data": {
                "col-5-0": "Done",
                "col-5-1": "12x10",
                "col-5-2": "Doku/SUPPN/Druckprufung/NVt-14/test_report.pdf"
              }
            }
          ]
        }
      ]
    }
  ]
}
```

ACL is enforced: project must be accessible, and `druckprufung` module must be enabled in access-control for the requesting user.

#### POST /api/modules/upload

```
POST /api/modules/upload
Headers: x-user-email, x-user-role
Content-Type: multipart/form-data

fields:
  project    = "SUPPN"
  targetPath = "SUPPN/Druckprufung/NVt-14"
  module     = "druckprufung"    (for ACL check)
  files[]    = <PDF file>
  (no customName — useOriginalFilename means original name is kept)
```

**Response:**
```json
{
  "success": true,
  "files": [
    {
      "name": "Drucktest_NVt14_Zeilerweg11.pdf",
      "path": "Doku/SUPPN/Druckprufung/NVt-14/Drucktest_NVt14_Zeilerweg11.pdf",
      "size": 204800
    }
  ]
}
```

File is written to: `STORAGE_ROOT/SUPPN/Doku/SUPPN/Druckprufung/NVt-14/<filename>`

#### POST /api/modules/aufmass-update

```
POST /api/modules/aufmass-update
Headers: Content-Type: application/json, x-user-email
Body:
{
  "project": "SUPPN",
  "rowId": "ROW-0042",
  "updates": {
    "col-5-0": "Done",
    "col-5-1": "12x10",
    "col-5-2": "Doku/SUPPN/Druckprufung/NVt-14/Drucktest_NVt14_Zeilerweg11.pdf"
  },
  "module": "druckprufung"
}
```

**Response:**
```json
{ "success": true }
```

The server reads the `.txt` data file, finds the row by `rowId` (matched against `row[0][0]`), writes the updates into the correct positions (using the `col-X-Y` keys as group/column index), then writes the file back. A versioned copy is also saved. NAS sync fires asynchronously.

### Data Flow Diagram (text)

```
User selects PDF on druckprufung.html
    │
    ▼
module-shared.js: handleUpload(file, addr, type)
    │
    ├─► POST /api/modules/upload
    │       └─ writes PDF to STORAGE_ROOT/PROJECT/Doku/CLUSTER/Druckprufung/KNOTEN/
    │          returns { success, files[{ name, path }] }
    │
    └─► POST /api/modules/aufmass-update
            └─ opens PROJECT.txt, finds rowId, writes:
               col-X-0 = "Done"
               col-X-1 = "<type>"
               col-X-2 = "<filePath>"
               saves file, versions it, fires NAS sync
```

---

## Data Model

### Schema Groups

Druckprüfung expects a schema group whose label contains `"druckprufung"` (case-insensitive match via `findColumnId`). Within that group, the columns are resolved by position:

| Position | `_resolveColumnIds()` assigns | Expected label (not enforced — positional) |
|----------|-------------------------------|-------------------------------------------|
| `grp.cols[0]` | `statusColId` | e.g. "Status Druckprufung" |
| `grp.cols[1]` | `typeColId` | e.g. "Type Druckprufung" |
| `grp.cols[2]` | `fileColId` | e.g. "File Druckprufung" |

> **Note:** Column detection is purely positional within the resolved group. Labels don't need to match exactly — only the group label needs to contain "druckprufung".

### Status Behavior

| `statusColId` value | Address list badge |
|--------------------|--------------------|
| `"Done"` (case-insensitive) | Green "Done" badge |
| Anything else (including empty) | Gray "Pending" badge |

### File Naming

`useOriginalFilename: true` — the PDF keeps its original name. No renaming.

### Storage Path

```
STORAGE_ROOT/
└── {PROJECT}/
    └── Doku/
        └── {CLUSTER}/
            └── Druckprufung/
                └── {KNOTENPUNKT}/
                    └── {original_filename}.pdf
```

Example:
```
/data/storage/SUPPN/Doku/SUPPN/Druckprufung/NVt-14/Drucktest_K01.pdf
```

The `targetPath` sent to the upload endpoint is: `SUPPN/Druckprufung/NVt-14`

The stored `filePath` written to aufmass is: `Doku/SUPPN/Druckprufung/NVt-14/Drucktest_K01.pdf`

---

## Error Reporting

Druckprüfung does **not** implement error reporting (no `btnReportError`). If the upload fails, the error is shown inline in the upload form's status area (`#uploadStatus`) as a red message. No aufmass column is written on upload failure.

---

## Permissions / ACL

### What's required

The user must have:
1. Project access (any role with the project in their ACL)
2. The `druckprufung` module enabled in their ACL entry for the project

### How the ACL check works

1. **Frontend:** No role-based redirect (removed per comment in code). Module key `'druckprufung'` is sent with the navigation request.

2. **Backend navigation check:**
```js
// moduleRoutes.js — /navigation
const aclModule = (req.query.module || 'aufmass').toLowerCase(); // "druckprufung"
const projectOk = await canAccessProject(navEmail, project);
const moduleOk  = await canAccessModule(navEmail, project, aclModule);
```

3. **Backend upload check:**
```js
// moduleRoutes.js — /upload
const callingModule = (req.body.module || 'files').toLowerCase(); // "druckprufung"
const moduleOk = await canAccessModule(uploadEmail, project, callingModule)
              || await canAccessModule(uploadEmail, project, 'files');
const editOk   = await canEditProject(uploadEmail, project);
```

Upload requires both module access AND edit permission (read-only users cannot upload).

**Superadmin** bypasses all ACL checks.

---

## Dependencies

- **Aufmass data file** must exist at `STORAGE_ROOT/{PROJECT}/Doku/Aufmass/datafile/{PROJECT}.txt`
- Schema must have a group whose label contains `"druckprufung"` with at least 3 columns
- Schema must have `"Cluster"` and `"Knotenpunkt"` (or `"NVT"`) columns for navigation to work

No dependency on other modules. Druckprüfung can run independently.

---

## Code Walkthrough

### druckprufung.js (entire file, effectively)

```js
(function () {
    const urlParams   = new URLSearchParams(window.location.search);
    const projectName = urlParams.get('project');
    const userRole    = localStorage.getItem('userRole');

    if (!projectName) { window.location.href = 'index.html'; return; }
    if (!userRole)    { window.location.href = 'login.html'; return; }

    const nav = new ModuleNavigator({
        project:             projectName,
        moduleName:          'Druckprüfung',
        moduleKey:           'druckprufung',
        targetFolder:        'Druckprufung',
        groupLabel:          'druckprufung',
        typeOptions:         ['12x10', '4x20', 'custom'],
        useOriginalFilename: true,
        containers: {
            content:    document.getElementById('moduleContent'),
            breadcrumb: document.getElementById('moduleBreadcrumb'),
        }
    });

    nav.init().catch(err => console.error('Druckprüfung init error:', err));
})();
```

This is literally the entire module-specific logic. Everything else is in `module-shared.js`.

### module-shared.js: Key Methods

#### `_resolveColumnIds()`

Called after navigation data loads. Finds the schema group matching `this.groupLabel` and assigns positional column IDs:

```js
_resolveColumnIds() {
    const grp = this.schema.find(g =>
        g.label && g.label.toLowerCase().includes(this.groupLabel.toLowerCase())
    );
    // grp.cols[0] → statusColId
    // grp.cols[1] → typeColId  (if no extraFields)
    // grp.cols[2] → fileColId  (if no extraFields)
}
```

Since Druckprüfung has no `extraFields`, all three positions are assigned.

#### `renderUploadForm(addr)`

Checks if `addr.data[statusColId] === 'done'` (case-insensitive). If yes, calls `_renderFilesViewAsync(addr)` instead. Otherwise, renders the full upload form with type select and drop zone.

#### `handleUpload(file, addr, type)`

Orchestrates the two-step save:
1. `POST /api/modules/upload` — sends the file
2. `POST /api/modules/aufmass-update` — writes status/type/file to aufmass

```js
async handleUpload(file, addr, type, extraValues = {}) {
    const filename   = this.useOriginalFilename ? file.name : this.filenamePattern(addr, type);
    const targetPath = `${this.currentCluster.name}/${this.targetFolder}/${this.currentKnoten.name}`;

    // Step 1: Upload
    const fd = new FormData();
    fd.append('files', file);
    fd.append('project', this.project);
    fd.append('targetPath', targetPath);
    // No customName when useOriginalFilename=true

    // Step 2: Aufmass update
    const updates = {
        [this.statusColId]: 'Done',
        [this.typeColId]:   type,
        [this.fileColId]:   filePath,
    };
    // POST to /api/modules/aufmass-update ...
}
```

#### `_renderFilesViewAsync(addr)`

When status is Done, fetches existing files from the storage path and renders them as a list with download buttons. Also renders an "Edit / Re-upload" option to undo Done and re-enter upload mode.

#### `renderAddresses(cluster, kn, addresses)`

Renders the address list. Status badge is derived purely from `addr.data[this.statusColId]`:
- `"done"` (case-insensitive) → green "Done"
- anything else → gray "Pending"

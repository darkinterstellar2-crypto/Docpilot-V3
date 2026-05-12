# Kalibrieren (Calibration) Module

## Overview

### What it does

**For the field worker:** Kalibrieren is the calibration step — before a conduit section is pressure-tested or blown, the test equipment (typically a pressure testing device and blowing machine) must be calibrated for that specific conduit configuration. The worker navigates to their address, selects the conduit type (e.g. 12×10), and uploads the calibration report PDF. The row is marked Done.

**For the developer:** Functionally identical to Druckprüfung — a straight `ModuleNavigator` config-only module. Same three-level navigation, same upload form, same status model. The only differences are the `moduleKey`, `groupLabel`, `targetFolder`, and `moduleName`.

### Why it exists in the workflow

In German fiber construction standards (AGFW/DIN), test equipment calibration must be documented before pressure tests and before cable blowing. The calibration certificate proves the measurement equipment was set correctly for the conduit diameter and material. DocPilot captures this PDF alongside the pressure test report to satisfy quality assurance requirements.

### Domain terms

| Term | Meaning |
|------|---------|
| **Kalibrieren** | Calibration — configuring and verifying measuring equipment accuracy |
| **Cluster** | A named group of Knotenpunkte within a project (e.g. a deployment zone) |
| **Knotenpunkt** | A junction / distribution cabinet where cable segments originate or terminate |
| **12×10, 4×20** | Conduit bundle configurations matching the tubes that will be tested |
| **Aufmass** | The project's master data file (JSON-in-.txt), one row per cable segment |

---

## User Journey (Step by Step)

### 1. Dashboard → Module

From `dashboard.html?project=PROJECTNAME`, user clicks the **Kalibrieren** card. Browser navigates to:
```
kalibrieren.html?project=PROJECTNAME
```

Auth check: `localStorage.getItem('userRole')` and `projectName` from URL. Missing either → redirect.

Header shows project name (`#projectNameDisplay`). Back button (`#backBtn`) → dashboard.

### 2. Cluster List

`ModuleNavigator.init()` calls:
```
GET /api/modules/navigation?project=PROJECTNAME&module=kalibrieren
```
Renders Cluster cards (folder icon + name + knotenpunkt count).

### 3. Knotenpunkt List

Clicking a Cluster renders Knotenpunkt cards. Breadcrumb updates to: `[Cluster]`.

### 4. Address List

Clicking a Knotenpunkt renders address rows with status badges (Done / Pending).

Breadcrumb updates to: `[Cluster] > [Knotenpunkt]`

### 5. Upload Form

Clicking an address renders the upload form (or files view if already Done):

**Form elements:**
- Address info card
- **Type select**: `12x10`, `4x20`, `custom` (custom reveals text input)
- **Drop zone** — PDF files only (drag & drop or Browse button)
- **Upload button** (disabled until file + type selected)
- Status message area

### 6. Upload & Save

Same flow as Druckprüfung:
1. POST file to `/api/modules/upload`
2. POST status/type/file to `/api/modules/aufmass-update`
3. After 1.6s → return to address list with Done badge

---

## Technical Architecture

### Frontend Files

| File | Role |
|------|------|
| `kalibrieren.html` | Page shell |
| `src/js/module-shared.js` | `ModuleNavigator` class |
| `src/js/kalibrieren.js` | Config-only instantiation |

**Script load order:**
```html
<script src="src/js/api.js"></script>
<script src="src/js/modal.js"></script>
<script src="src/js/module-shared.js"></script>
<script src="src/js/kalibrieren.js"></script>
<script src="src/js/logout.js"></script>
<script src="src/js/i18n.js"></script>
<script src="src/js/idle-logout.js"></script>
```

### ModuleNavigator Config

```js
const nav = new ModuleNavigator({
    project:             projectName,
    moduleName:          'Kalibrieren',
    moduleKey:           'kalibrieren',
    targetFolder:        'kalibrieren',    // note: lowercase (unlike Druckprufung which uses TitleCase)
    groupLabel:          'kalibrieren',
    typeOptions:         ['12x10', '4x20', 'custom'],
    useOriginalFilename: true,
    containers: {
        content:    document.getElementById('moduleContent'),
        breadcrumb: document.getElementById('moduleBreadcrumb'),
    }
});
nav.init();
```

> **Note:** `targetFolder` is `'kalibrieren'` (lowercase), not `'Kalibrieren'`. This is the actual subfolder name on disk. Be consistent — the storage path will use exactly this value.

### Backend Endpoints

All identical to Druckprüfung except the module key changes:

#### GET /api/modules/navigation
```
GET /api/modules/navigation?project=SUPPN&module=kalibrieren
Headers: x-user-email, x-user-role
```

Response structure is identical. Schema group expected to contain `"kalibrieren"` label.

#### POST /api/modules/upload
```
POST /api/modules/upload
Content-Type: multipart/form-data

project    = "SUPPN"
targetPath = "SUPPN/kalibrieren/NVt-14"   ← note lowercase folder
module     = "kalibrieren"
files[]    = <PDF>
```

**Response:**
```json
{
  "success": true,
  "files": [{ "name": "Kali_NVt14_K01.pdf", "path": "Doku/SUPPN/kalibrieren/NVt-14/Kali_NVt14_K01.pdf", "size": 102400 }]
}
```

#### POST /api/modules/aufmass-update
```json
{
  "project": "SUPPN",
  "rowId": "ROW-0042",
  "updates": {
    "col-6-0": "Done",
    "col-6-1": "4x20",
    "col-6-2": "Doku/SUPPN/kalibrieren/NVt-14/Kali_NVt14_K01.pdf"
  },
  "module": "kalibrieren"
}
```

### Data Flow Diagram

```
User selects PDF on kalibrieren.html
    │
    ▼
module-shared.js: handleUpload(file, addr, type)
    │
    ├─► POST /api/modules/upload
    │       └─ writes PDF to STORAGE_ROOT/PROJECT/Doku/CLUSTER/kalibrieren/KNOTEN/
    │
    └─► POST /api/modules/aufmass-update
            └─ writes col-X-0="Done", col-X-1=type, col-X-2=filePath
```

---

## Data Model

### Schema Group

Group label must contain `"kalibrieren"` (case-insensitive substring).

| Position | Assigned to | Typical label |
|----------|-------------|---------------|
| `cols[0]` | `statusColId` | "Status Kalibrieren" |
| `cols[1]` | `typeColId` | "Type Kalibrieren" |
| `cols[2]` | `fileColId` | "File Kalibrieren" |

### Status Behavior

| `statusColId` value | Badge displayed |
|--------------------|-----------------|
| `"Done"` (case-insensitive) | Green "Done" |
| Anything else | Gray "Pending" |

### File Naming

`useOriginalFilename: true` — file stored with its original name, no renaming.

### Storage Path

```
STORAGE_ROOT/
└── {PROJECT}/
    └── Doku/
        └── {CLUSTER}/
            └── kalibrieren/         ← lowercase
                └── {KNOTENPUNKT}/
                    └── {original}.pdf
```

Example:
```
/data/storage/SUPPN/Doku/SUPPN/kalibrieren/NVt-14/Kalibrierung_K01.pdf
```

---

## Error Reporting

None. Upload errors are shown inline in the form status area only (no aufmass column written on failure).

---

## Permissions / ACL

Identical mechanism to Druckprüfung:
- Project access required
- `kalibrieren` module access required
- Write permission required for uploads

Backend checks (`/navigation`):
```js
const aclModule = 'kalibrieren';
await canAccessProject(email, project);
await canAccessModule(email, project, 'kalibrieren');
```

Backend checks (`/upload`):
```js
await canAccessModule(email, project, 'kalibrieren') || canAccessModule(email, project, 'files');
await canEditProject(email, project);
```

---

## Dependencies

- Aufmass data file must exist
- Schema must have a group label containing `"kalibrieren"` with 3+ columns
- Schema must have `"Cluster"` and `"Knotenpunkt"` columns

No dependency on other modules. Runs independently in the workflow (typically done alongside or just before Druckprüfung).

---

## Code Walkthrough

### kalibrieren.js (complete module)

```js
(function () {
    const urlParams   = new URLSearchParams(window.location.search);
    const projectName = urlParams.get('project');
    const userRole    = localStorage.getItem('userRole');

    if (!projectName) { window.location.href = 'index.html'; return; }
    if (!userRole)    { window.location.href = 'login.html'; return; }

    const displayEl = document.getElementById('projectNameDisplay');
    if (displayEl) displayEl.textContent = projectName;

    const backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.onclick = () => window.location.href = `dashboard.html?project=${encodeURIComponent(projectName)}`;

    const nav = new ModuleNavigator({
        project:             projectName,
        moduleName:          'Kalibrieren',
        moduleKey:           'kalibrieren',
        targetFolder:        'kalibrieren',
        groupLabel:          'kalibrieren',
        typeOptions:         ['12x10', '4x20', 'custom'],
        useOriginalFilename: true,
        containers: {
            content:    document.getElementById('moduleContent'),
            breadcrumb: document.getElementById('moduleBreadcrumb'),
        }
    });

    nav.init().catch(err => console.error('Kalibrieren init error:', err));
})();
```

Everything else is delegated to `ModuleNavigator` in `module-shared.js`.

### Differences from Druckprüfung

| Config key | Druckprüfung | Kalibrieren |
|------------|-------------|-------------|
| `moduleName` | `'Druckprüfung'` | `'Kalibrieren'` |
| `moduleKey` | `'druckprufung'` | `'kalibrieren'` |
| `targetFolder` | `'Druckprufung'` (TitleCase) | `'kalibrieren'` (lowercase) |
| `groupLabel` | `'druckprufung'` | `'kalibrieren'` |

The `targetFolder` casing difference is intentional and stored on disk exactly as configured.

### module-shared.js behavior (shared with Druckprüfung)

All logic is identical — see the Druckprüfung doc for detailed walkthroughs of `_resolveColumnIds()`, `handleUpload()`, `renderUploadForm()`, and `_renderFilesViewAsync()`. The only runtime difference is which schema group and which storage folder are used.

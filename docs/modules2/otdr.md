# OTDR (Optical Time Domain Reflectometry) Module

## Overview

### What it does

**For the field worker:** OTDR is the fiber measurement step. After cables are spliced at both the APL (endpoint) and Knotenpunkt (junction), a technician uses an OTDR device to shoot a laser pulse through each fiber and measure reflections — this proves the fiber is intact, correctly spliced, and within loss tolerance. The measurement data comes out as `.sor` files (vendor OTDR format) and a summary PDF. This module lets the worker upload all these files for a specific address and tracks whether the expected number of files have been received.

**For the developer:** The OTDR module uses `ModuleNavigator` with `customUploadForm: true`. It replaces both the address list and the upload form with custom renderers. Key unique features: only shows addresses where OTDR status is `Waiting`, `Incomplete`, or `Done` (addresses with status `Pending` are hidden — they're not ready); expected file count = `spliceCount × 4` (1 PDF + 3 SOR per splice point); upload mode `add` vs `replace` (admin only); status is `Done` vs `Incomplete` depending on whether file count meets the expected threshold.

### Why it exists in the workflow

An OTDR test is a mandatory acceptance test in German fiber construction — every fiber path must be measured end-to-end before customer handover. The `.sor` files are machine-generated binary measurement archives (EXFO/VIAVI standard). They are uploaded along with a PDF summary report. The expected count formula (splices × 4) ensures every splice point has been measured from both directions plus a bidirectional average (standard telecom practice).

### Domain terms

| Term | Meaning |
|------|---------|
| **OTDR** | Optical Time Domain Reflectometer — laser measurement device for fiber testing |
| **SOR** | Standard OTDR Results file — binary format defined by Telcordia GR-196 standard |
| **Splice count** | Number of fiber splices at this address (from the Splicing module column) |
| **Expected files** | `spliceCount × 4` — the mandatory file count for a complete OTDR measurement |
| **Waiting** | OTDR is ready to start (auto-set by server when APL + Knotenpunkt are Done) |
| **Incomplete** | Files uploaded but count < expected — measurement is partial |
| **Done** | File count ≥ expected — measurement complete |

---

## User Journey (Step by Step)

### 1. Dashboard → Module

`dashboard.html?project=PROJECTNAME` → **OTDR** card → `otdr.html?project=PROJECTNAME`

Auth guard: same pattern as all modules.

### 2. Cluster → Knotenpunkt

Standard ModuleNavigator cluster and knotenpunkt cards.

### 3. Address List (Filtered — Custom Renderer)

`renderOTDRAddressList()` replaces the default address list. Key difference: **only addresses with OTDR status `Waiting`, `Incomplete`, or `Done` are shown**.

Pending addresses (OTDR not yet enabled) are invisible. The empty state message explains:
> "Addresses appear here after both APL status and Knotenpunkt splicing status are set to 'Done' in the Aufmass."

Each visible address row shows:
- Address name (end), cable name
- Status badge: Done (green) / Incomplete (yellow/orange) / Waiting (blue)
- **Expected file count** label: `"N exp."` — e.g. `"8 exp."` for a 2-splice address

### 4. OTDR Upload Form

Clicking an address calls `renderOTDRForm()`. It first shows a spinner, then fetches existing files from storage, then renders `renderOTDRFormHTML()`.

**Form layout:**

#### Address Info Card
- Knotenpunkt / address, cable name, fiber type, status badge
- **Expected files:** `"8 (2 splices × 4)"` or `"—"` if no splice count
- **Target path:** `CLUSTER/OTDR/KNOTENPUNKT/AddressClean/`

#### Existing Files Card (shown if files already exist)
- List of existing files with ext badge (PDF / SOR), name, size
- **Count fraction:** `"3/8 expected"`
- **Admin only:** Mode selector — `🗑 Replace All` / `➕ Add More` (default: Add More)
  - Replace All: existing files deleted before new upload
  - Add More: new files appended to existing
- **Non-admin:** informational label "Adding new files will append to existing"

#### Upload Card
- Accepts: `.pdf` and `.sor` files
- Multi-file (multiple selection allowed)
- Drop zone (click or drag-and-drop)
- **File list:** selected files with ext badge + size + ✕ remove
- **Count display:** updates dynamically — green if will reach/exceed expected, orange if still short, warning if exceeding expected
- **Warning banner:** shown if uploaded count doesn't match expected (but doesn't block upload)
- **Upload button:** disabled until at least 1 file selected

**Count display logic:**
```
totalAfter = (uploadMode === 'replace') ? newCount : existingCount + newCount

if totalAfter === expected → "✓ N files — matches expected count"  (green)
if totalAfter < expected  → "N files — X more needed"              (orange)
if totalAfter > expected  → "N files — X more than expected ⚠"    (orange)
```

### 5. Upload Execution

On clicking "Upload Files":

1. **Replace mode (admin only):** DELETE all existing files first
2. Upload each selected file: `POST /api/modules/upload` (original filename kept, no renaming)
3. Calculate new status:
   ```js
   const totalAfter = (uploadMode === 'replace') ? newCount : existingCount + newCount;
   const newStatus  = (expectedFiles > 0 && totalAfter >= expectedFiles) ? 'Done' : 'Incomplete';
   ```
4. `POST /api/modules/aufmass-update`:
   - `statusColId` → `"Done"` or `"Incomplete"`
   - `typeColId` → `"N splices"` (e.g. `"2 splices"`)
   - `fileColId` → folder path: `"Doku/CLUSTER/OTDR/KNOTENPUNKT/AddressClean"`
5. Shows `"✓ N files uploaded. Status: Done/Incomplete"` or error

---

## Technical Architecture

### Frontend Files

| File | Role |
|------|------|
| `otdr.html` | Page shell |
| `src/js/module-shared.js` | `ModuleNavigator` class |
| `src/js/otdr.js` | All OTDR-specific logic |

### ModuleNavigator Config

```js
const nav = new ModuleNavigator({
    project:          projectName,
    moduleName:       'OTDR',
    moduleKey:        'otdr',
    targetFolder:     'OTDR',
    groupLabel:       'otdr',              // schema group with status/type/file columns
    customUploadForm: true,
    onKnotenpunktSelected: (cluster, knotenpunkt) => {
        // render custom address list
    },
    onAddressSelected: (cluster, knotenpunkt, address) => {
        renderOTDRForm(cluster, knotenpunkt, address);
    },
    containers: {
        content:    document.getElementById('moduleContent'),
        breadcrumb: document.getElementById('moduleBreadcrumb'),
    }
});
```

After `nav.init()`, column IDs are resolved:
- `nav.statusColId` — from `otdr` group, col[0]
- `nav.typeColId` — from `otdr` group, col[1]
- `nav.fileColId` — from `otdr` group, col[2]

Plus: `nav.findColumnId('splicing', 'number of splices')` — to get expected count.

### Backend Endpoints

#### GET /api/modules/navigation
```
GET /api/modules/navigation?project=SUPPN&module=otdr
```

#### GET /api/modules/list-files
```
GET /api/modules/list-files?project=SUPPN&path=SUPPN/OTDR/NVt-14/Zeilerweg-11
Headers: x-user-email, x-user-role
```

**Response:**
```json
{
  "success": true,
  "files": [
    { "name": "Zeilerweg11_01.sor", "size": 65536, "mtime": "2026-04-14T16:20:00.000Z" },
    { "name": "Zeilerweg11_02.sor", "size": 65800, "mtime": "2026-04-14T16:20:05.000Z" },
    { "name": "Zeilerweg11_summary.pdf", "size": 204800, "mtime": "2026-04-14T16:22:00.000Z" }
  ]
}
```

#### DELETE /api/files (Replace mode — admin only)
```
DELETE /api/files?project=SUPPN&path=Doku/SUPPN/OTDR/NVt-14/Zeilerweg-11&file=Zeilerweg11_01.sor
Headers: x-user-email, x-user-role
```

Called once per existing file when `uploadMode === 'replace'`.

#### POST /api/modules/upload (original filename, multiple times)
```
POST /api/modules/upload
Content-Type: multipart/form-data

project    = "SUPPN"
targetPath = "SUPPN/OTDR/NVt-14/Zeilerweg-11"
module     = "otdr"
files[]    = <.pdf or .sor>
(no customName — original filenames preserved)
```

Called once per selected file. Each upload is sequential (await in loop) with progress shown.

#### POST /api/modules/aufmass-update
```json
{
  "project": "SUPPN",
  "rowId": "ROW-0042",
  "updates": {
    "col-8-0": "Done",
    "col-8-1": "2 splices",
    "col-8-2": "Doku/SUPPN/OTDR/NVt-14/Zeilerweg-11"
  }
}
```

Note: `fileColId` stores the **folder path**, not a specific file path. This is because multiple OTDR files are uploaded per address.

### Data Flow Diagram

```
otdr.html → nav.init() → GET /api/modules/navigation
                │
                ▼
Cluster → Knotenpunkt → renderOTDRAddressList()
    (filters: only Waiting / Incomplete / Done visible)
                │
                ▼ user clicks address
renderOTDRForm() → GET /api/modules/list-files (fetch existing)
                │
                ▼ user selects files, clicks Upload
    [admin Replace mode: DELETE existing files]
    loop: POST /api/modules/upload (per file, original name)
                │
                ▼
    POST /api/modules/aufmass-update
        status = Done (if ≥ expected) or Incomplete
        typeColId = "N splices"
        fileColId = "Doku/CLUSTER/OTDR/KNOTENPUNKT/AddressClean"
```

---

## Data Model

### Schema Columns

#### OTDR group (via `nav.statusColId`, `nav.typeColId`, `nav.fileColId`)

Resolved by `_resolveColumnIds()` from group whose label contains `"otdr"`:

| Position | Assigned to | Written value |
|----------|-------------|---------------|
| `cols[0]` | `statusColId` | `"Done"` / `"Incomplete"` / `"Waiting"` |
| `cols[1]` | `typeColId` | `"N splices"` (e.g. `"2 splices"`) |
| `cols[2]` | `fileColId` | Folder path (not individual file) |

#### Splicing group (cross-read)

| Column label | Purpose |
|---|---|
| `findColumnId('splicing', 'number of splices')` | Read-only — determines expected file count |

### Status Behavior

| Status value | Badge | Shown in address list? |
|---|---|---|
| `"Waiting"` | Blue "Waiting" | ✅ Yes |
| `"Incomplete"` | Orange "Incomplete" | ✅ Yes |
| `"Done"` | Green "Done" | ✅ Yes |
| `"Pending"` or `""` | Gray "Pending" | ❌ No (filtered out) |

### File Count Formula

```
expectedFiles = spliceCount × 4
```

Rationale: 1 PDF summary + 3 SOR files per splice point (one from each direction, one combined). This is a German fiber acceptance standard pattern.

If `spliceCount` is 0 or absent:
- `expectedFiles = 0`
- No count warning shown
- Status set to `Done` as soon as any file is uploaded (0 ≥ 0)

### File Naming

OTDR files keep their **original names** from the OTDR device. No renaming happens. Example OTDR device filenames:
```
A001_NVt14_ZW11_FWD_01.sor
A001_NVt14_ZW11_REV_01.sor
A001_NVt14_ZW11_BI_01.sor
A001_NVt14_ZW11_report.pdf
```

### Storage Path

```
STORAGE_ROOT/
└── {PROJECT}/
    └── Doku/
        └── {CLUSTER}/
            └── OTDR/
                └── {KNOTENPUNKT}/
                    └── {AddressClean}/    ← per-address subfolder
                        ├── file.sor
                        ├── file2.sor
                        ├── file3.sor
                        └── report.pdf
```

---

## Error Reporting

No error reporting mechanism in OTDR. Upload errors shown inline in `#otdrUploadStatus`. No aufmass error column is written.

---

## Permissions / ACL

- Project access required
- `otdr` module access required
- Edit permission required for upload and aufmass writes
- **Replace All** mode only available to `superadmin` (role check: `userRole === 'superadmin'`)

Backend:
```js
canAccessModule(email, project, 'otdr')
canEditProject(email, project)
```

---

## Dependencies

- Aufmass data file must exist
- Schema must have `otdr` group (status, type, file columns)
- Schema must have `splicing` group with `number of splices` column (for expected count)
- **APL module** must be completed (APL status → Done) for OTDR status to become `Waiting`
- **Knotenpunkt Splicing** must be completed (Knotenpunkt Status → Done) for OTDR status to become `Waiting`
- Both conditions are checked server-side after each `aufmass-update` — it's an automatic trigger

---

## Code Walkthrough

### `renderOTDRAddressList(clusterObj, kn, addresses)`

Custom address list renderer. Called instead of `nav.renderAddresses()`.

```js
function renderOTDRAddressList(clusterObj, kn, addresses) {
    const otdrStatusColId  = nav.statusColId;
    const spliceCountColId = nav.findColumnId('splicing', 'number of splices');

    // Filter: only show OTDR-ready addresses
    const filtered = (addresses || []).filter(addr => {
        const status = otdrStatusColId && addr.data ? (addr.data[otdrStatusColId] || '') : '';
        return ['Waiting', 'Incomplete', 'Done'].includes(status);
    });

    if (filtered.length === 0) {
        // Show empty state with explanation about the auto-trigger
        el.innerHTML = `<div class="mod-empty">...</div>`;
        return;
    }

    // Render rows with OTDR badges + expected count label
    const rows = filtered.map(addr => {
        const spliceCount   = parseInt(addr.data[spliceCountColId]) || 0;
        const expectedFiles = spliceCount * 4;
        const badge         = getOTDRBadge(status);
        const countLabel    = spliceCount > 0 ? `<span>${expectedFiles} exp.</span>` : '';
        return `<div class="addr-row" data-id="${addr.id}">...${badge}${countLabel}...</div>`;
    });
}
```

### `updateCountDisplay()`

Live count display update. Called whenever files are added/removed or upload mode changes:

```js
function updateCountDisplay() {
    const newCount    = selectedFiles.length;
    const totalAfter  = uploadMode === 'replace'
        ? newCount
        : existingFiles.length + newCount;

    if (newCount === 0) {
        countDisplay.classList.add('hidden');
        uploadBtn.disabled = true;
        return;
    }

    if (expectedFiles > 0) {
        const diff = totalAfter - expectedFiles;
        if (diff === 0) {
            // Perfect match — green
            countDisplay.textContent = `✓ ${totalAfter} files — matches expected count`;
            countDisplay.className = 'count-display count-ok';
        } else if (diff < 0) {
            // Short — orange warning
            countDisplay.textContent = `${totalAfter} files — ${Math.abs(diff)} more needed`;
            countDisplay.className = 'count-display count-warn';
        } else {
            // Over — orange warning
            countDisplay.textContent = `${totalAfter} files — ${diff} more than expected ⚠`;
            countDisplay.className = 'count-display count-warn';
        }
    } else {
        countDisplay.textContent = `${newCount} file${newCount !== 1 ? 's' : ''} selected`;
    }

    uploadBtn.disabled = false;
}
```

### Upload Handler (inside `wireOTDRForm`)

```js
uploadBtn.addEventListener('click', async () => {
    uploadBtn.disabled = true;

    // Step 1: Replace mode — delete existing files
    if (uploadMode === 'replace') {
        for (const f of existingFiles) {
            await fetch(`/api/files?project=...&path=Doku/${targetPath}&file=${f.name}`, {
                method: 'DELETE', headers: { ... }
            });
        }
    }

    // Step 2: Upload each selected file
    let uploadedCount = 0;
    for (const file of selectedFiles) {
        const fd = new FormData();
        fd.append('project', projectName);
        fd.append('targetPath', targetPath);
        fd.append('files', file);
        // NO customName — keep original
        const res = await fetch('/api/modules/upload', { method: 'POST', body: fd, ... });
        if (!res.ok) throw new Error(...);
        uploadedCount++;
        showStatus('success', `Uploading… ${uploadedCount}/${selectedFiles.length}`);
    }

    // Step 3: Determine new status
    const totalAfter = uploadMode === 'replace'
        ? uploadedCount
        : existingFiles.length + uploadedCount;
    const newStatus = (expectedFiles > 0 && totalAfter >= expectedFiles) ? 'Done' : 'Incomplete';

    // Step 4: Update aufmass
    const updates = {
        [otdrStatusColId]: newStatus,
        [otdrTypeColId]:   spliceCount > 0 ? `${spliceCount} splices` : `${totalAfter} files`,
        [otdrFileColId]:   `Doku/${targetPath}`,
    };
    await fetch('/api/modules/aufmass-update', {
        method: 'POST',
        body: JSON.stringify({ project: projectName, rowId: address.id, updates })
    });

    showStatus('success', `✓ ${uploadedCount} file(s) uploaded. Status: ${newStatus}`);
});
```

### `getOTDRBadge(status)`

```js
function getOTDRBadge(status) {
    const s = (status || '').toLowerCase();
    if (s === 'done')       return `<span class="mod-badge mod-badge-done">Done</span>`;
    if (s === 'incomplete') return `<span class="mod-badge mod-badge-incomplete">Incomplete</span>`;
    if (s === 'waiting')    return `<span class="mod-badge mod-badge-waiting">Waiting</span>`;
    return `<span class="mod-badge mod-badge-pending">Pending</span>`;
}
```

`mod-badge-incomplete` and `mod-badge-waiting` are OTDR-specific badge classes (not shared with other modules).

### `isOTDRFile(f)`

```js
function isOTDRFile(f) {
    const name = (f.name || '').toLowerCase();
    return name.endsWith('.pdf') || name.endsWith('.sor');
}
```

Drag-and-drop also uses this filter — non-OTDR files dropped on the zone are silently ignored.

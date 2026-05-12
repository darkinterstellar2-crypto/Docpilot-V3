# Knotenpunkt Vorbereitung / Splicing Module

## Overview

### What it does

**For the field worker:** This is a two-in-one module. At the Knotenpunkt level it handles:
1. **NVT Preparation (Knotenpunkt Vorbereitung):** Photo documentation of the junction cabinet before and during fiber installation — multiple images uploaded together for the entire cabinet
2. **Splicing:** Per-address documentation of fiber splicing work — each cable run terminated at this Knotenpunkt gets its own splice report uploaded

This module skips the address-level navigation step for NVT preparation (all images belong to the cabinet, not individual cables) but still shows per-address rows for the splicing section.

**For the developer:** This is a merged "knotenpunkt-level" module that uses `ModuleNavigator` with `skipAddressStep: true` and `onKnotenpunktSelected` callback to render a custom combined screen. Section 1 handles multi-image NVT upload (original filenames, images only). Section 2 renders an address list inline — clicking an address shows a splice upload form within the same screen. Both sections store files to the same folder: `{CLUSTER}/Knotenpunkt_Vorbereitung/{KNOTENPUNKT}/`.

### Why it exists in the workflow

Fiber splicing at the Knotenpunkt is a critical quality step. The Knotenpunkt cabinet must be photographed as-built before splices are made (NVT prep), and then each cable run's splice documentation proves the correct fibers were joined. After both APL and Knotenpunkt Status are Done, the OTDR auto-trigger fires (server side), enabling the OTDR measurement module.

### Domain terms

| Term | Meaning |
|------|---------|
| **Knotenpunkt Vorbereitung** | Junction point preparation — photographing and documenting the cabinet before/during install |
| **NVT** | Netzverteilertechnik — the physical junction cabinet housing fiber connections |
| **Splicing / Spleißen** | Fusion-splicing of optical fiber — melting two fiber ends together for permanent join |
| **Knotenpunkt Status** | Column tracking whether the NVT/splicing work is Done — triggers OTDR auto-enable |
| **Splice count** | Number of individual fiber splices made (tracked per address row) |

---

## User Journey (Step by Step)

### 1. Dashboard → Module

`dashboard.html?project=PROJECTNAME` → **Knotenpunkt Vorbereitung** card → `knotenpunkt-vorbereitung.html?project=PROJECTNAME`

Auth guard via localStorage. Header shows project name.

### 2. Cluster → Knotenpunkt (skips address level)

User navigates Cluster → Knotenpunkt cards. When a Knotenpunkt is selected, `ModuleNavigator` calls `onKnotenpunktSelected(cluster, knotenpunkt)` instead of showing an address list — this is the `skipAddressStep: true` behavior.

`renderKnotenpunktScreen(cluster, knotenpunkt)` is called immediately.

### 3. Combined Knotenpunkt Screen

A single scrollable screen with two sections:

---

**SECTION 1: NVT Preparation**

Header card: "📦 NVT Vorbereitung — {KNOTENPUNKT}"
- Subtext: target path `CLUSTER/Knotenpunkt_Vorbereitung/KNOTENPUNKT/`
- File count badge: "N files uploaded" (fetched async from storage)

Drop zone: Multi-image upload (JPEG/PNG accepted, multiple files)
- "Browse Images" button and drag-and-drop
- Selected files listed with ✕ per file, truncated filenames
- Limit hint if applicable

"Upload NVT Photos" button — disabled until at least one image selected

Status message area (`#kvUploadStatus`)

---

**SECTION 2: Splicing (per-address)**

Subtitle: "🔗 Splicing — {KNOTENPUNKT}"
- Shows knotenpunkt-level status badge: Done/Pending

**Address rows** for all addresses in this Knotenpunkt:
Each row displays:
- Address name (end or start)
- Cable name
- Splice status badge: Done (green) / Pending (gray)
- Done date badge (from file timestamps, async)
- Clickable → shows splice upload form (inline, within the same page)

**Splice Upload Sub-Form** (appears below the address row on click):
- Address name + cable name header
- Drop zone: PDF or image files (splice report)
- File preview (filename + type badge)
- "Upload Splice" button
- Status message area (`#spliceUploadStatus`)

---

### 4a. NVT Photo Upload

User selects one or more images and clicks "Upload NVT Photos":

1. For each selected file: `POST /api/modules/upload` with:
   - `targetPath: "${cluster}/Knotenpunkt_Vorbereitung/${knotenpunkt}"`
   - No `customName` (original filenames used)
   - Module: `'knotenpunkt'`
2. After all uploads: shows success count `"✓ N photo(s) uploaded"`
3. File count badge updates

Does NOT write to aufmass (NVT prep has no dedicated status column — it's implicit from the presence of files).

### 4b. Splice Upload (per address)

User clicks an address row to expand the splice form, selects a file, and clicks "Upload Splice":

1. Generates filename:
   ```
   {KNOTENPUNKT}_{AddressClean}_Splices_{YYYYMMDD_HHmmss}.{ext}
   ```
   Example: `NVt-14_Zeilerweg-11_Splices_20260414_153045.pdf`

2. `POST /api/modules/upload` with:
   - `targetPath: "${cluster}/Knotenpunkt_Vorbereitung/${knotenpunkt}"`
   - `customName: generatedFilename`

3. `POST /api/modules/aufmass-update`:
   ```json
   {
     "rowId": "ROW-0042",
     "updates": {
       "col-3-5": "Done",
       "col-3-6": "Doku/SUPPN/Knotenpunkt_Vorbereitung/NVt-14/NVt-14_Zeilerweg-11_Splices_20260414_153045.pdf"
     },
     "module": "knotenpunkt"
   }
   ```
   Where `col-3-5` = Knotenpunkt Status, `col-3-6` = Knotenpunkt image location.

4. After save: the address row updates to Done badge. OTDR auto-trigger may fire server-side if APL is also Done.

---

## Technical Architecture

### Frontend Files

| File | Role |
|------|------|
| `knotenpunkt-vorbereitung.html` | Page shell |
| `src/js/module-shared.js` | `ModuleNavigator` class |
| `src/js/knotenpunkt-vorbereitung.js` | All combined-screen logic |

**Script load order:**
```html
<script src="src/js/module-shared.js"></script>
<script src="src/js/knotenpunkt-vorbereitung.js"></script>
```

### ModuleNavigator Config

```js
const nav = new ModuleNavigator({
    project:             projectName,
    moduleKey:           'knotenpunkt',
    targetFolder:        'Knotenpunkt_Vorbereitung',
    groupLabel:          'splicing',          // reads status from 'splicing' group
    skipAddressStep:     true,                // skip address list — go straight to combined screen
    customUploadForm:    true,                // no standard upload form
    onKnotenpunktSelected: (cluster, knotenpunkt) => {
        renderKnotenpunktScreen(cluster, knotenpunkt);
    },
    containers: {
        content:    document.getElementById('moduleContent'),
        breadcrumb: document.getElementById('moduleBreadcrumb'),
    }
});
```

`skipAddressStep: true` means: clicking a Knotenpunkt card calls `onKnotenpunktSelected` directly, bypassing `renderAddresses()`.

### Backend Endpoints

#### GET /api/modules/navigation
```
GET /api/modules/navigation?project=SUPPN&module=knotenpunkt
```
Returns full tree. All address `.data` is included (needed for per-address splice status badges).

#### POST /api/modules/upload (NVT photos — one per file)
```
POST /api/modules/upload
Content-Type: multipart/form-data

project    = "SUPPN"
targetPath = "SUPPN/Knotenpunkt_Vorbereitung/NVt-14"
module     = "knotenpunkt"
files[]    = <image>
(no customName — original filename used)
```

#### POST /api/modules/upload (splice document)
```
POST /api/modules/upload
Content-Type: multipart/form-data

project    = "SUPPN"
targetPath = "SUPPN/Knotenpunkt_Vorbereitung/NVt-14"
customName = "NVt-14_Zeilerweg-11_Splices_20260414_153045.pdf"
module     = "knotenpunkt"
files[]    = <PDF or image>
```

#### POST /api/modules/aufmass-update (splice only)
```json
{
  "project": "SUPPN",
  "rowId": "ROW-0042",
  "updates": {
    "col-3-5": "Done",
    "col-3-6": "Doku/SUPPN/Knotenpunkt_Vorbereitung/NVt-14/NVt-14_Zeilerweg-11_Splices_20260414_153045.pdf"
  },
  "module": "knotenpunkt",
  "note": "Splice upload — NVt-14 / Zeilerweg-11"
}
```

#### GET /api/modules/list-files (for NVT file count badge)
```
GET /api/modules/list-files?project=SUPPN&path=SUPPN/Knotenpunkt_Vorbereitung/NVt-14
Headers: x-user-email, x-user-role
```

Response: `{ success: true, files: [{ name, size }] }`

Used to show the "N files uploaded" badge in the NVT section header.

### Data Flow Diagram

```
knotenpunkt-vorbereitung.html loads
    │
    ▼
nav.init() → GET /api/modules/navigation
    │
    ▼
Cluster → Knotenpunkt selected (skipAddressStep = true)
    │
    ▼
renderKnotenpunktScreen(cluster, knotenpunkt)
    ├─ GET /api/modules/list-files (count badge)
    │
    ├─ Section 1: NVT Photos
    │   └─ select images → POST /api/modules/upload (no customName, per file)
    │
    └─ Section 2: Address rows (inline)
        └─ click address → splice form appears
            ├─ select file
            └─ POST /api/modules/upload (customName = KNOTEN_ADDR_Splices_TS.ext)
               POST /api/modules/aufmass-update (knotenpunkt status + file path)
```

---

## Data Model

### Schema Columns

Module uses the **splicing** group (via `findColumnId('splicing', ...)`).

#### Per-address splice columns

| Column label fragment | Purpose | Written value |
|-----------------------|---------|---------------|
| `'knotenpunkt status'` | Per-address splice done flag | `"Done"` / `""` |
| `'knotenpunkt image location'` | Splice file path | `"Doku/SUPPN/Knotenpunkt_Vorbereitung/NVt-14/NVt-14_Zeilerweg-11_Splices_....pdf"` |

These are `knStatusColId` and `knImageColId` resolved via `findColumnId`.

### Address Status Badges (Splicing Section)

| `knStatusColId` value | Badge |
|-----------------------|-------|
| `"Done"` (case-insensitive) | Green "Done" |
| Anything else | Gray "Pending" |

### NVT Photos

NVT photos are NOT tracked in aufmass — they're storage-only. Status is derived from file existence (count badge).

### File Naming

**NVT photos:** original filename unchanged.

**Splice documents:**
```
{KNOTENPUNKT}_{AddressClean}_Splices_{YYYYMMDD}_{HHmmss}.{ext}
```

`cleanAddress()` same as other modules:
```js
// "Laichingen, Zeilerweg 11" → "Zeilerweg-11"
```

Examples:
```
NVt-14_Zeilerweg-11_Splices_20260414_153045.pdf
NVt-14_Hauptstr-5_Splices_20260414_155210.jpg
```

### Storage Path

Both NVT photos and splice files land in the same folder:
```
STORAGE_ROOT/
└── {PROJECT}/
    └── Doku/
        └── {CLUSTER}/
            └── Knotenpunkt_Vorbereitung/    ← note: underscore
                └── {KNOTENPUNKT}/
                    ├── photo1.jpg            ← NVT photo (original name)
                    ├── photo2.jpg
                    ├── NVt-14_Zeilerweg-11_Splices_20260414_153045.pdf
                    └── NVt-14_Hauptstr-5_Splices_20260414_155210.jpg
```

---

## Error Reporting

No error reporting in this module. Upload failures are shown inline via `showNVTStatus()` / `showSpliceStatus()`. No aufmass error column is written.

---

## Permissions / ACL

- Project access required
- `knotenpunkt` module access required
- Edit permission required for uploads and aufmass writes

Backend checks:
```js
// /navigation
canAccessModule(email, project, 'knotenpunkt')

// /upload
canAccessModule(email, project, 'knotenpunkt') || canAccessModule(email, project, 'files')
canEditProject(email, project)
```

---

## Dependencies

- Aufmass data file must exist
- Schema must have `splicing` group with `knotenpunkt status` and `knotenpunkt image location` columns
- Schema must have `Cluster` + `Knotenpunkt` navigation columns
- APL module is a logical predecessor (work is done at APL first, then brought back to Knotenpunkt for splicing), but there is no technical dependency — Knotenpunkt module runs independently

**OTDR trigger dependency:** When this module sets Knotenpunkt Status → `"Done"`, the server checks if APL status for the same row is also `"Done"`. If both are Done, OTDR status is automatically set to `"Waiting"`. This means OTDR is downstream of both APL and Knotenpunkt.

---

## Code Walkthrough

### renderKnotenpunktScreen(cluster, knotenpunkt)

The core rendering function. Runs when a Knotenpunkt is selected.

```js
function renderKnotenpunktScreen(cluster, knotenpunkt) {
    const el = document.getElementById('moduleContent');
    const targetPath = `${cluster}/Knotenpunkt_Vorbereitung/${knotenpunkt}`;
    const docsPath   = `Doku/${targetPath}`;

    // Resolve column IDs for splicing section
    const knStatusColId = nav.findColumnId('splicing', 'knotenpunkt status');
    const knImageColId  = nav.findColumnId('splicing', 'knotenpunkt image location');

    // Build per-address rows for the splicing section
    const addresses = nav.currentKnoten ? (nav.currentKnoten.addresses || []) : [];
    const addrRows  = buildAddressRows(addresses, knStatusColId, knImageColId);

    el.innerHTML = `
        <!-- NVT section + splice section HTML -->
    `;

    // Async: fetch file count for badge
    fetch(`/api/modules/list-files?project=...&path=${targetPath}`)
        .then(r => r.json())
        .then(data => {
            const count = (data.files || []).length;
            document.getElementById('nvtFileCount').textContent = `${count} file${count !== 1 ? 's' : ''} uploaded`;
        });

    // Wire NVT upload
    wireNVTUpload(targetPath, docsPath);

    // Wire per-address splice forms
    addresses.forEach(addr => {
        wireSpliceForm(addr, cluster, knotenpunkt, knStatusColId, knImageColId);
    });
}
```

### buildAddressRows(addresses, knStatusColId, knImageColId)

Generates HTML string for all address rows in the splicing section. Each row is clickable and shows:
- Address name, cable name
- Status badge from `addr.data[knStatusColId]`
- Done date (loaded async later)

### wireNVTUpload(targetPath, docsPath)

Sets up the multi-file NVT upload:
```js
// Drop zone + browse button → selectedNVTFiles array
// Upload button → iterate selectedNVTFiles:
for (const file of selectedNVTFiles) {
    const fd = new FormData();
    fd.append('project', projectName);
    fd.append('targetPath', targetPath);
    fd.append('module', 'knotenpunkt');
    fd.append('files', file);
    // NO customName — original filename preserved
    await fetch('/api/modules/upload', { method: 'POST', ... });
}
```

Shows count: `"✓ 3 photo(s) uploaded"` on success.

### wireSpliceForm(addr, cluster, knotenpunkt, ...)

When user clicks an address row, injects a splice form below it:
```js
function wireSpliceForm(addr, ...) {
    document.getElementById(`addr-${addr.id}`).addEventListener('click', () => {
        // Toggle form: if already open, close it; otherwise expand
        renderSpliceSubForm(addr, ...);
    });
}
```

Splice sub-form upload handler:
```js
async function handleSpliceUpload(addr, file, ...) {
    const addressClean = cleanAddress(addr.end);
    const now = formatDateTime(); // "YYYYMMDD_HHmmss"
    const ext = file.name.split('.').pop();
    const customName = `${knotenpunkt}_${addressClean}_Splices_${now}.${ext}`;

    // Upload file
    await fetch('/api/modules/upload', { body: fd });

    // Update aufmass
    await fetch('/api/modules/aufmass-update', {
        body: JSON.stringify({
            rowId: addr.id,
            updates: {
                [knStatusColId]: 'Done',
                [knImageColId]:  `Doku/${targetPath}/${customName}`
            }
        })
    });

    // Update local cache + re-render the address row badge to Done
    addr.data[knStatusColId] = 'Done';
    updateAddressRowBadge(addr.id, 'Done');
}
```

### `formatDateTime()`

```js
function formatDateTime() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
// → "20260414_153045"
```

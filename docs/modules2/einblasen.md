# Einblasen (Cable Blowing) Module

## Overview

### What it does

**For the field worker:** Einblasen is the cable blowing step. After conduits are pressure-tested and calibrated, fiber cables are blown into them using compressed air. This module lets the worker schedule an appointment (Termin) for the blowing job, then upload the blowing protocol PDF after completion. Workers can also report problems (errors) and mark them as fixed.

**For the developer:** This is a significantly more complex module than Druckprüfung/Kalibrieren. It uses `AppointmentHelper` from `appointment-shared.js` to add scheduling (date/time/notes), a custom address list renderer (with search, date filter, and status filter), error reporting via a dedicated aufmass column, a `Metrierung` (cable length measurement) extra field, and a file listing that shows existing uploads when status is Done/Error. All module-specific logic lives in `einblasen.js` — `ModuleNavigator` is used but with `customUploadForm: true` and `onAddressSelected` callback overrides.

### Why it exists in the workflow

Einblasen is the physically complex step — the right machine, the right technician, and a specific time window must be coordinated with site access. Scheduling failures (appointment not kept, access denied) and technical failures (cable stuck, machine breakdown) need to be tracked. DocPilot captures both the scheduling intent and the outcome document, plus any problems that occurred.

### Domain terms

| Term | Meaning |
|------|---------|
| **Einblasen** | Cable blowing — using compressed air to blow fiber cable through pre-installed conduits |
| **Termin** | Appointment — stored as `{date, time, notes}` JSON in an aufmass column |
| **Metrierung** | Cable length measurement in meters — the actual length of cable blown in |
| **EB:** | Error prefix for Einblasen errors in the `error-reporting` column |
| **#** | Suffix appended to an EB error entry to mark it as fixed |
| **NVT** | Network distribution cabinet — where the cable segment ends |

---

## User Journey (Step by Step)

### 1. Dashboard → Module

User navigates from `dashboard.html?project=PROJECTNAME` → clicks **Einblasen** card → browser goes to:
```
einblasen.html?project=PROJECTNAME
```

Auth check via `localStorage`. Missing either → redirect. Header shows project name.

### 2. Cluster → Knotenpunkt Navigation

Standard `ModuleNavigator` cluster and knotenpunkt cards, same as Druckprüfung.

### 3. Address List (Custom Renderer)

Einblasen replaces the default address list with `renderAddressesWithTermin()`. This custom renderer:

1. Sorts addresses by appointment date (soonest first) using `AH.sortByTermin()`
2. Renders a **toolbar** above the list:
   - **Search box** (`#addrSearch`) — filters by address text, cable name, or row ID
   - **Date picker** (`#addrDateFilter`) — filters by Done date
   - **Status dropdown** (`#addrStatusFilter`) — All / Done / Pending / Error
3. Each address row shows:
   - Address name (end or start), cable name
   - Status badge: Done (green), Error (red ⚠), Pending (gray)
   - **Appointment badge** (green dot + datetime if future, red dot if past/overdue)
   - **Done date** (from filename timestamp or file mtime if status=Done)

The filters are live — all three update `renderList()` instantly without re-fetching.

### 4. Choice Screen

Clicking an address calls `renderChoiceScreen()`. This shows:

**Address info card:**
- Knotenpunkt / address display name
- Cable name and fiber type
- Status badge (Done / Error / Pending)
- If status is Error: expandable error card showing active EB errors and fixed ones

**Appointment card** (if termin exists):
- Green/red dot + "Upcoming/Overdue" label
- Date + time + notes
- Rendered by `AH.terminInfoHTML(termin)`

**Two-column button grid** (from `AH.choiceButtonsHTML(isDone, termin)`):
- Left: "📅 Mark Appointment" (if no termin) / "✏️ Edit Appointment" (if termin exists) / disabled (if Done)
- Right: "📷 Upload Work" (always visible; label changes to "Re-upload / Edit" if files exist)

**Error buttons row:**
- Red "⚠ Report Error" button (always shown)
- "✓ Clear Error" button (shown only if current status is Error)

**Files section** (if status is Done or Error): injected asynchronously below the cards — shows existing files with download (⬇) and delete (🗑) buttons.

### 5a. Schedule Appointment

User clicks "Mark Appointment" or "Edit Appointment". `AH.renderAppointmentForm()` renders:
- Date picker (default: tomorrow)
- Time picker (default: 09:00)
- Notes textarea (optional)
- "Save Appointment" and "Back" buttons
- If editing: "Remove Appointment" button (red)

On save:
1. **Conflict check:** `AH.checkConflicts()` fetches all `einblasen` appointments for the project on the same date. Any appointment within ±40 minutes of the proposed time (excluding current row) triggers a conflict modal.
2. **Conflict modal** shows conflicting addresses with their times. User can "Force Schedule" or "Cancel".
3. If no conflict (or forced): `POST /api/modules/aufmass-update` with `{terminColId: JSON.stringify({date, time, notes})}`.
4. After save, re-navigates to knotenpunkt to refresh all address data.

### 5b. Upload Work (Metrierung + PDF)

User clicks "Upload Work". `renderUploadWithGenerator()` is called. This screen shows:

**Extra field:**
- **Metrierung (m)** — number input for cable length in meters (required)

**Type select:** options like `'12x10'`, `'4x20'`, `'custom'`

**Drop zone:** PDF only

**Upload button:** disabled until file + type + metrierung all filled

On upload:
1. `handleUpload(file, addr, type, { metrierung: '450' })` fires
2. File gets a **generated filename** (not original name): `{CLUSTER}_{DATETIME}_{KNOTEN}_bis_{AddrClean}.pdf`
   - E.g. `SUPPN_20260414_143022_NVt-14_bis_Zeilerweg-11.pdf`
3. `POST /api/modules/upload` with `customName` set to generated filename
4. `POST /api/modules/aufmass-update` writes:
   - `statusColId` → `"Done"`
   - `typeColId` → type string
   - `fileColId` → file path
   - `metrierung` column → the entered value
   - The metrierung value is also cross-copied to the LWL Specs group via `alsoCopyTo`

### 5c. Report Error

User clicks "⚠ Report Error". `showPrompt()` appears asking for a description.

On submit:
1. Appends `EB:{description};` to the `error-reporting` column
2. Sets `statusColId` → `"Error"`
3. Re-renders choice screen — now shows red Error badge + error detail card

### 5d. Clear Error

User clicks "✓ Clear Error". `showConfirm()` asks for confirmation.

On confirm:
1. Finds the **last unfixed EB entry** in error-reporting (one that doesn't end in `#`)
2. Appends `#` to mark it fixed: `EB:cable stuck;` → `EB:cable stuck;#`

Wait — looking at the actual parsing: each entry is separated by `;`. The format is:
```
EB:description;EB:another error;#
```
Actually the code splits on `;` and appends `#` to the matching entry:
```
EB:cable stuck;    → becomes →    EB:cable stuck#;
```
3. Checks if any unfixed EB entries remain. If none → clears status (sets to `""` = Pending). If some remain → keeps `"Error"`.

### 6. File Delete

In the files section, clicking 🗑 on a file:
1. `showConfirm()` asks "Move this file to the recycle bin?"
2. `DELETE /api/files?...` with file path
3. Row removed from DOM
4. If no files remain: status reset to Pending, EB errors stripped from error-reporting column, choice screen re-rendered

---

## Technical Architecture

### Frontend Files

| File | Role |
|------|------|
| `einblasen.html` | Page shell |
| `src/js/appointment-shared.js` | `AppointmentHelper` — termin forms, conflict detection |
| `src/js/module-shared.js` | `ModuleNavigator` — navigation + upload infrastructure |
| `src/js/einblasen.js` | All einblasen-specific logic (choice screen, error reporting, custom address renderer) |

**Load order:**
```html
<script src="src/js/api.js"></script>
<script src="src/js/modal.js"></script>
<script src="src/js/appointment-shared.js"></script>
<script src="src/js/module-shared.js"></script>
<script src="src/js/einblasen.js"></script>
```

### ModuleNavigator Config (inferred from einblasen.js usage)

```js
const nav = new ModuleNavigator({
    project:          projectName,
    moduleKey:        'einblasen',
    targetFolder:     'Einblasen',
    groupLabel:       'einblasen',
    customUploadForm: true,          // bypass standard upload form
    onAddressSelected: (cluster, knotenpunkt, address) => {
        renderChoiceScreen(cluster, knotenpunkt, address);
    },
    onKnotenpunktSelected: (cluster, knoten) => {
        // fetch file dates + render custom address list
    },
    containers: {
        content:    document.getElementById('moduleContent'),
        breadcrumb: document.getElementById('moduleBreadcrumb'),
    }
});
```

`customUploadForm: true` skips `renderUploadForm()` and `_wireUploadForm()`. Instead, `onAddressSelected` is called when user picks an address, and einblasen.js renders the choice screen.

### Backend Endpoints

#### GET /api/modules/navigation
```
GET /api/modules/navigation?project=SUPPN&module=einblasen
```
Same structure as other modules. Provides full `data` map for each address.

#### GET /api/modules/list-files
```
GET /api/modules/list-files?project=SUPPN&path=SUPPN/Einblasen/NVt-14
Headers: x-user-email, x-user-role
```

**Response:**
```json
{
  "success": true,
  "files": [
    { "name": "SUPPN_20260414_143022_NVt-14_bis_Zeilerweg-11.pdf", "size": 204800, "mtime": "2026-04-14T14:30:22.000Z" }
  ]
}
```

Used by `injectFilesSection()` and by `fetchFileDates()` (to show done-date in address list).

#### POST /api/modules/upload
```
POST /api/modules/upload
Content-Type: multipart/form-data

project    = "SUPPN"
targetPath = "SUPPN/Einblasen/NVt-14"
module     = "einblasen"
customName = "SUPPN_20260414_143022_NVt-14_bis_Zeilerweg-11.pdf"
files[]    = <PDF>
```

#### POST /api/modules/aufmass-update
```json
{
  "project": "SUPPN",
  "rowId": "ROW-0042",
  "updates": {
    "col-7-0": "Done",
    "col-7-1": "12x10",
    "col-7-2": "Doku/SUPPN/Einblasen/NVt-14/SUPPN_20260414_143022_NVt-14_bis_Zeilerweg-11.pdf",
    "col-7-3": "450",
    "col-8-2": "450"
  },
  "module": "einblasen",
  "note": "Einblasen upload — Zeilerweg-11"
}
```

Where `col-7-3` is the metrierung column (within the Einblasen group) and `col-8-2` is the cross-copy target in LWL Specs group.

#### DELETE /api/files
```
DELETE /api/files?project=SUPPN&path=Doku/SUPPN/Einblasen/NVt-14&file=SUPPN_20260414_143022_NVt-14_bis_Zeilerweg-11.pdf
Headers: x-user-email, x-user-role
```

**Response:**
```json
{ "success": true }
```

Moves file to recycle bin (does not permanently delete).

### Data Flow Diagram

```
einblasen.html loads
    │
    ▼
nav.init() → GET /api/modules/navigation
    │
    ▼
renderClusters() → user picks cluster
    │
    ▼
renderKnotenpunkte() → user picks knotenpunkt
    │
    ▼
onKnotenpunktSelected → fetchFileDates() + renderAddressesWithTermin()
    │
    ▼
user picks address → renderChoiceScreen()
    │
    ├─ "Mark Appointment" → AH.renderAppointmentForm()
    │       └─ conflict check → aufmass-update (terminColId)
    │
    ├─ "Upload Work" → renderUploadWithGenerator()
    │       └─ upload → /api/modules/upload (customName)
    │       └─ aufmass-update (status + type + file + metrierung + cross-copy)
    │
    ├─ "Report Error" → showPrompt → aufmass-update (status=Error + EB entry)
    │
    └─ "Clear Error" → showConfirm → aufmass-update (EB entry += #, status recalculated)
```

---

## Data Model

### Schema Columns (Einblasen group)

Group label must contain `"einblasen"` (case-insensitive).

| `findColumnId` call | Expected column label | Resolved ID | Purpose |
|----|----|----|---|
| `findColumnId('einblasen', 'status einblasen')` | "Status Einblasen" | e.g. `col-7-0` | Done/Error/Pending |
| `findColumnId('einblasen', 'einblasen-termin')` | "Einblasen-Termin" | e.g. `col-7-1` | `{date,time,notes}` JSON |
| `findColumnId('einblasen', 'einblasen-date')` | "Einblasen-Date" | e.g. `col-7-2` | Done timestamp for display |
| metrierung column (via extraFields config) | "Metrierung" | e.g. `col-7-3` | Cable length in meters |

### Error-Reporting Column

| `findColumnId` call | Expected label | Resolved ID |
|----|----|----|
| `findColumnId('notes', 'error-reporting')` | "Error-Reporting" | e.g. `col-12-2` |

**Format:** Semicolon-delimited entries. Each entry is either:
- `EB:description;` — active error
- `EB:description#;` — fixed error (the `#` is appended to the entry itself, before `;`)

Example value:
```
EB:cable stuck at 120m;EB:machine failure;#
```

Wait — the actual code appends `#` to the part before `;`:
```js
parts[i] = parts[i] + '#';
// so: "EB:cable stuck" becomes "EB:cable stuck#"
// full log: "EB:cable stuck#;EB:machine failure;"
```

Active errors: entries starting with `EB:` that do NOT end in `#`.
Fixed errors: entries starting with `EB:` that DO end in `#`.

**Status derivation logic:**
```js
// After clear: check if any unfixed EB remain
const hasUnfixed = parts.some(p => p.startsWith('EB:') && !p.endsWith('#'));
updates[sc] = hasUnfixed ? 'Error' : (currentStatus === 'error' ? '' : currentStatus);
// '' = Pending (empty string)
```

### File Naming Convention

Generated filename (not original):
```
{CLUSTER}_{YYYYMMDD}_{HHMMSS}_{KNOTENPUNKT}_bis_{AddressClean}.pdf
```

Address cleaning:
```js
// "Laichingen, Zeilerweg 11" → "Zeilerweg-11"
// (strip prefix before comma, trim, spaces→hyphens, commas removed)
```

Real examples:
```
SUPPN_20260414_143022_NVt-14_bis_Zeilerweg-11.pdf
SUPPN_20260414_151045_NVt-02_bis_Hauptstr-5.pdf
```

### Storage Path

```
STORAGE_ROOT/
└── {PROJECT}/
    └── Doku/
        └── {CLUSTER}/
            └── Einblasen/
                └── {KNOTENPUNKT}/
                    └── {CLUSTER}_{DATETIME}_{KNOTENPUNKT}_bis_{AddressClean}.pdf
```

---

## Error Reporting

### Report Error Flow

1. User clicks "⚠ Report Error"
2. `showPrompt('⚠ Report Error', 'Describe the error...')` shows a modal input
3. On confirm:
   ```js
   const updates = {
       [statusColId]: 'Error',
       [errorColId]: existingLog + 'EB:' + errorText.trim() + ';'
   };
   POST /api/modules/aufmass-update
   ```
4. Screen re-renders with Error badge + error detail card

### Error Detail Card (in choice screen)

Shown when `status === 'Error'`. Parses the error-reporting column:
```js
const parts = errLog.split(';').filter(p => p.startsWith('EB:'));
const activeErrors = parts.filter(p => !p.endsWith('#')).map(p => p.replace(/^EB:/, ''));
const fixedErrors  = parts.filter(p => p.endsWith('#')).map(p => p.replace(/^EB:/, '').replace(/#$/, ''));
```

Displays:
- Red box: "⚠ Active Errors:" — list of active descriptions
- If fixed errors exist: green "✓ Fixed:" section

### Clear Error Flow

1. User clicks "✓ Clear Error"
2. `showConfirm('Clear Error', 'Mark latest Einblasen error as fixed?')`
3. On confirm:
   ```js
   // Find last unfixed EB entry and append #
   for (let i = parts.length - 1; i >= 0; i--) {
       if (parts[i].startsWith('EB:') && !parts[i].endsWith('#')) {
           parts[i] = parts[i] + '#';
           break;
       }
   }
   // Recalculate status
   const hasUnfixed = parts.some(p => p.startsWith('EB:') && !p.endsWith('#'));
   updates[statusColId] = hasUnfixed ? 'Error' : '';
   ```

---

## Permissions / ACL

- Project access required
- `einblasen` module access required for navigation
- Edit permission required for upload, aufmass-update

Same backend enforcement as other modules. `superadmin` bypasses all checks.

---

## Dependencies

- Aufmass data file must exist
- Schema must have `"einblasen"` group with status, termin, metrierung columns
- Schema must have `"notes"` group with `"error-reporting"` column
- Schema must have `"Cluster"` and `"Knotenpunkt"` navigation columns
- The LWL Specs group must exist for the metrierung cross-copy (`alsoCopyTo`) to work (optional — silently skipped if column not found)

---

## Code Walkthrough

### renderChoiceScreen(cluster, knotenpunkt, address)

Main view dispatcher. Always called when user lands on an address.

1. Reads `terminColId`, `statusColId` from `nav.findColumnId()`
2. Parses termin JSON with `AH.parseTermin()`
3. Determines `isDone` / `isError` from status column value
4. Renders HTML: info card + termin card + choice buttons + error buttons
5. If `isDone || isError`: calls `injectFilesSection()` async
6. Wires event listeners for all buttons

### injectFilesSection(containerEl, listPath, docsPath, addrFilter, ...)

1. Injects a spinner placeholder into the DOM immediately
2. Fetches `GET /api/modules/list-files?path=CLUSTER/Einblasen/KNOTEN`
3. Filters returned files by `addrFilter` string (boundary-safe match):
   ```js
   // Match "Zeilerweg-11" in filename, but only if followed by ., _, -, space, or end
   const idx = f.name.indexOf(clean);
   const next = f.name[idx + clean.length];
   return next === '.' || next === '_' || next === '-' || next === ' ';
   ```
4. Renders file rows with download/delete buttons
5. Delete handler: on last file deleted, resets status + strips EB errors + re-renders choice screen

### renderAddressesWithTermin(cluster, kn, addresses)

Custom address list renderer. Key differences from default:

1. **Sorting:** `AH.sortByTermin(filtered, terminColId)` — puts appointments with soonest upcoming termin first, past appointments after, no-termin last
2. **File date extraction:** calls `fetchFileDates()` → parses filenames for `_YYYYMMDD_HHMMSS_` timestamps
3. **Live filters:** search, status, date — all filter `addrData` array and re-render DOM list

### parseDateFromFilename(fname)

```js
function parseDateFromFilename(fname) {
    const m = fname.match(/_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_/);
    if (m) return `${m[3]}.${m[2]}.${m[1]}, ${m[4]}:${m[5]}`;
    return null;
}
// "SUPPN_20260414_143022_NVt-14_bis_Zeilerweg-11.pdf"
// → "14.04.2026, 14:30"
```

### AppointmentHelper.checkConflicts()

```js
// Fetches all appointments for the project
// Filters to same module + same date + within 40 minutes of proposed time
const conflicts = appointments.filter(appt => {
    if (appt.rowId === excludeRowId) return false; // skip self
    if (appt.module !== module) return false;
    if (appt.date !== date) return false;
    const diff = Math.abs(toMinutes(appt.time) - toMinutes(proposed));
    return diff < 40;  // ±40 minute buffer
});
```

If conflicts found: shows modal with list of conflicting addresses and their times. User chooses "Force Schedule" or "Cancel".

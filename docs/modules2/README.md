# DocPilot — Complete Module Technical Reference

**Audience:** Senior developer joining the DocPilot team. You know JavaScript and Node.js. You know nothing about German fiber-optic construction workflows. This document covers both.

**Last Updated:** 2026-04-14  
**Covers:** All 8 dashboard modules + supporting subsystems (GeoCam, Error Reporting, Appointments, Idle Logout)

---

## Table of Contents

1. [Domain Primer — German Fiber-Optic Workflow](#1-domain-primer)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [Shared Infrastructure: ModuleNavigator](#3-shared-infrastructure-modulenavigator)
4. [Module 1: Druckprüfung (Pressure Testing)](#4-module-1-druckprüfung-pressure-testing)
5. [Module 2: Kalibrieren (Calibration)](#5-module-2-kalibrieren-calibration)
6. [Module 3: Einblasen (Cable Blowing)](#6-module-3-einblasen-cable-blowing)
7. [Module 4: APL (Closure Protocol)](#7-module-4-apl-closure-protocol)
8. [Module 5: Knotenpunkt Vorbereitung & Splicing](#8-module-5-knotenpunkt-vorbereitung--splicing)
9. [Module 6: OTDR (Optical Time Domain Reflectometry)](#9-module-6-otdr)
10. [Module 7: Files (File Manager)](#10-module-7-files-file-manager)
11. [Module 8: Appointment Planner](#11-module-8-appointment-planner)
12. [Cross-Cutting: Idle Logout](#12-cross-cutting-idle-logout)
13. [Backend API Reference](#13-backend-api-reference)
14. [ACL & Permissions Model](#14-acl--permissions-model)
15. [Data File Format](#15-data-file-format)

---

## 1. Domain Primer

Before any code makes sense, you need this vocabulary. German telecom fiber construction is organized as a strict hierarchy:

```
Project (e.g. "Laichingen 2025")
  └── Cluster (a geographic area, e.g. "Cluster-A")
        └── Knotenpunkt (a network junction point, abbreviated NVT or KP)
              └── Address (a physical street address, e.g. "Laichingen, Zeilerweg 11")
```

**Key German/Telecom Terms:**

| Term | English | Explanation |
|---|---|---|
| Knotenpunkt | Junction point / node | A network distribution node, often an NVT cabinet on the street. Each one serves multiple households. |
| NVT | Netzverteiler | The physical cabinet/box at the Knotenpunkt. Often used interchangeably with Knotenpunkt in the code. |
| APL | Abschlussprotokoll Linientechnik | Line-technology closure protocol. The final inspection of an APL closure box at a subscriber's address. Requires 4 geo-stamped photos. |
| Einblasen | Blowing | The process of blowing fiber-optic cable through a conduit using compressed air. Requires metrierung tracking. |
| Druckprüfung | Pressure test | Testing the conduit for leaks before cable installation. Produces a PDF result. |
| Kalibrieren | Calibration | Calibrating measurement equipment. Produces a PDF result. |
| Splicing | Spleißen | Joining fiber-optic strands. Creates a splice count that OTDR must measure. |
| OTDR | Optical Time Domain Reflectometer | A device that sends laser pulses down fiber and measures reflections to check for faults. Requires one PDF + three .sor files per splice. |
| Aufmass | Measurement data / field data | The central data file for a project. Every address has a row. Every module reads/writes columns in this file. |
| Metrierung | Cable length measurement | The measured length of blown cable in meters. |
| Eigentümerdaten | Owner data | The name, phone, email of the property owner where work is being done. |
| Termin | Appointment | A scheduled work appointment. Stored as JSON in a dedicated column. |
| EB: | Einblasen Error prefix | A coded error entry in the error-reporting column for Einblasen errors. |
| APL: | APL Error prefix | Same pattern for APL module errors. |

**The Workflow (in order):**

```
Druckprüfung → Kalibrieren → Einblasen → APL → Splicing/Knotenpunkt Vorbereitung → OTDR
```

OTDR is the final quality check and only becomes available once both APL and Splicing are marked Done for an address.

---

## 2. System Architecture Overview

### Tech Stack

- **Backend:** Node.js + Express, routes in `routes/` directory
- **Frontend:** Vanilla JS (no React/Vue), ES5/ES6, class-based for shared components
- **Storage:** Local filesystem under `STORAGE_ROOT`, optionally synced to a NAS
- **Auth:** OTP-based login, session tokens in `localStorage`

### Request Auth Pattern

All authenticated API requests send two headers:

```
x-user-email: user@example.com
x-user-role: superadmin | admin | user
```

These are read from `localStorage` on the frontend and read from `req.headers` on the backend.

### Data Storage Layout

```
STORAGE_ROOT/
  <ProjectName>/
    Doku/
      Aufmass/
        datafile/
          <ProjectName>.txt          ← The single source of truth (Aufmass)
      <Cluster>/
        Druckrufung/<Knotenpunkt>/   ← Pressure test PDFs
        kalibrieren/<Knotenpunkt>/   ← Calibration PDFs
        Einblasen/<Knotenpunkt>/     ← Einblasen files + generated protocols
        APL/<Knotenpunkt>/<AddrClean>/  ← 4 required APL images per address
        Knotenpunkt_Vorbereitung/<Knotenpunkt>/  ← NVT prep + splice images
        OTDR/<Knotenpunkt>/<AddrClean>/  ← .pdf + .sor OTDR files
    .trash/                          ← Recycle bin (30-day TTL)
    .filemeta.json                   ← Who modified which file + when
    row-versions.json                ← Optimistic locking per row
```

### Backend Routes

| Route file | Mounted at | Purpose |
|---|---|---|
| `moduleRoutes.js` | `/api/modules/` | Navigation tree, file upload, Aufmass updates |
| `fileRoutes.js` | `/api/files/` | General file CRUD, trash, shares |
| `geocodeRoutes.js` | `/api/geocode` | Nominatim reverse-geocode proxy (no auth required) |
| `accessRoutes.js` | `/api/access/` | ACL permission checks |
| `settingsRoutes.js` | `/api/settings/` | Generator access check, code verification |

### Dashboard

`dashboard.html` + `src/js/dashboard.js` — the hub that links to all 8 modules. Each module card on the dashboard links to its dedicated HTML page with `?project=<name>` appended to the URL.

---

## 3. Shared Infrastructure: ModuleNavigator

**File:** `src/js/module-shared.js`  
**Class:** `ModuleNavigator`  
**Used by:** Druckprüfung, Kalibrieren, Einblasen, APL, Knotenpunkt Vorbereitung, OTDR (every field module)

This class is the backbone of every field module. It handles the Cluster → Knotenpunkt → Address navigation, file upload form, status display, and Aufmass updates. Understanding this class is prerequisite to understanding any individual module.

### Constructor Config

```js
const nav = new ModuleNavigator({
    project:             'Laichingen-2025',    // from URL ?project=
    moduleName:          'Druckprüfung',       // display name
    moduleKey:           'druckprufung',       // must match access-control.json key
    targetFolder:        'Druckrufung',        // folder inside Doku/<Cluster>/
    groupLabel:          'druckprufung',       // schema group label for column resolution
    typeOptions:         ['12x10', '4x20', 'custom'],
    useOriginalFilename: true,                 // keep original name, don't rename
    filenamePattern:     (addr, type) => `${addr.cableName}_Druckprüfung_${type}.pdf`,  // OR provide this
    containers: {
        content:    document.getElementById('moduleContent'),
        breadcrumb: document.getElementById('breadcrumb'),
    },
    onUploadComplete:    null,           // optional callback after upload
    customUploadForm:    false,          // true = skip default form, call onAddressSelected
    onAddressSelected:   null,           // (cluster, kn, address) => void
    addressFilter:       null,           // (addr) => boolean
    skipAddressStep:     false,          // true = knotenpunkt click goes straight to form
    onKnotenpunktSelected: null,         // used when skipAddressStep: true
    extraFields:         [],             // additional form inputs (see below)
});
```

### `extraFields` Configuration

Used by Einblasen to add Metrierung fields to the standard upload form:

```js
extraFields: [{
    id:          'metrierungTotal',     // HTML element ID
    label:       'Metrierung Total (m)',
    type:        'number',
    placeholder: 'e.g. 3970',
    required:    false,
    colLabel:    'metrierung total',    // Aufmass column to write value into
    colGroup:    'einblasen',           // group label
    alsoCopyTo: [{                      // optionally mirror value to another column
        colGroup: 'lwl specs',
        colLabel: 'total',
    }]
}]
```

### Initialization & Navigation Flow

```
nav.init()
  ↓
GET /api/modules/navigation?project=X&module=druckprufung
  ↓
{ success, schema, clusters }
  ↓
_resolveColumnIds()     → finds statusColId, typeColId, fileColId by groupLabel
renderClusters()        → grid of cluster cards
  ↓ [click cluster]
renderKnotenpunkte()    → grid of knotenpunkt cards
  ↓ [click knotenpunkt]
renderAddresses()       → list of addresses with Done/Pending badges
  ↓ [click address]
renderUploadForm()      → if Pending: upload form | if Done: files view
```

### Schema Resolution: `findColumnId(groupLabel, colLabel)`

This is how modules find the right column in the Aufmass data:

```js
const statusColId = nav.findColumnId('druckprufung', 'status');
// → "col-5-0" (depends on actual schema position)

const fileColId = nav.findColumnId('druckprufung', 'file location');
// → "col-5-2"
```

Column IDs are always in the format `col-{groupIndex}-{colIndex}`. They are **position-based**, not named — the exact IDs vary per project schema. Always use `findColumnId()` rather than hardcoding.

The match is case-insensitive and partial:
```js
// From module-shared.js:
if (g.label.toLowerCase().includes(this.groupLabel.toLowerCase())) {
    this.statusColId = col.id; // found by "status" partial match within group
}
```

### Upload Flow (Standard PDF Modules)

```
User selects file (drag-drop or browse)
  ↓
nav.handleUpload(file, addr, type, extraValues)
  ↓
POST /api/modules/upload
  Body: FormData {
    project: "Laichingen-2025",
    targetPath: "Cluster-A/Druckrufung/NVT-001",
    customName: "KabelNord_Druckprüfung_12x10.pdf",  // or empty for original name
    files: [<file>]
  }
  ↓ Response: { success, files: [{ name, path, size }] }
  ↓
POST /api/modules/aufmass-update
  Body: {
    project: "Laichingen-2025",
    rowId: "ROW-42",
    module: "druckprufung",
    updates: {
      "col-5-0": "Done",
      "col-5-1": "12x10",
      "col-5-2": "Doku/Cluster-A/Druckrufung/NVT-001/KabelNord_Druckprüfung_12x10.pdf"
    }
  }
  ↓ Response: { success, rowId, updated, otdrAutoTriggered, rowVersion }
```

### File Listing View (Done State)

When an address has status "Done", `renderUploadForm()` calls `_renderFilesViewAsync()` instead:

```js
GET /api/modules/list-files?project=X&path=Cluster-A/Druckrufung/NVT-001
→ { success, files: [{ name, size, mtime, isDir }] }
```

Renders a list of file rows. Images get authenticated thumbnails via `data-auth-src` → blob URL conversion. "Edit / Re-upload" button bypasses the Done check and forces the upload form.

### Authenticated Image Loading

```js
// Injects style element once (id="module-shared-styles")
// For all [data-auth-src] elements:
const res = await fetch(src, { headers: { 'x-user-email': ..., 'x-user-role': ... } });
const blob = await res.blob();
img.src = URL.createObjectURL(blob);
```

### Optimistic Locking

The `aufmass-update` endpoint uses row versioning to prevent concurrent edits overwriting each other:

- Server stores per-row version in `<projectRoot>/row-versions.json`
- Client receives `rowVersion` on each update response
- On the next update, client sends the last `rowVersion` it received
- Server rejects with `409 Conflict` if version doesn't match

Not all modules send `rowVersion` currently — only those where concurrent edits are likely.

---

## 4. Module 1: Druckprüfung (Pressure Testing)

**Files:** `druckprufung.html`, `src/js/druckprufung.js`  
**ACL Key:** `druckprufung`  
**Storage Folder:** `Druckrufung` (note: no umlaut in the folder name)  
**Group Label:** `druckprufung`

### Overview

**For the field worker:** Before a fiber conduit gets any cable, it's pressure-tested to confirm there are no leaks. The testing machine produces a printout/PDF. This module is where you upload that PDF.

**For the developer:** The simplest module in the system. It instantiates `ModuleNavigator` with minimal config and does nothing else. All logic is in the shared class.

### User Journey

```
1. Open dashboard.html?project=<name>
2. Click "Druckprüfung" card
3. Lands on druckprufung.html?project=<name>
4. See cluster grid (cards, each showing cluster name + knotenpunkt count)
5. Click a cluster → knotenpunkt grid appears
6. Click a knotenpunkt → address list appears
   - Each row: address name, cable name, fiber type, Done/Pending badge
7. Click an address:
   a. If Pending:
      - Type dropdown: 12x10 | 4x20 | custom
        - Selecting "custom" shows a free-text input below the dropdown
      - PDF drop zone (drag-and-drop or click to browse)
      - "Upload" button (disabled until file selected)
   b. If Done:
      - File list with size + download button per file
      - "Edit / Re-upload" button → forces upload form
8. Drop/select PDF → click Upload
9. Progress indicator during upload
10. On success: view switches to files view showing the uploaded PDF
```

### Technical Architecture

**Frontend:**
```js
// druckprufung.js — entire file:
(function () {
    const project = new URLSearchParams(window.location.search).get('project');
    if (!project) { window.location.href = 'index.html'; return; }

    const nav = new ModuleNavigator({
        project,
        moduleName:          'Druckprüfung',
        moduleKey:           'druckprufung',
        targetFolder:        'Druckrufung',
        groupLabel:          'druckprufung',
        typeOptions:         ['12x10', '4x20', 'custom'],
        useOriginalFilename: true,
        containers: {
            content:    document.getElementById('moduleContent'),
            breadcrumb: document.getElementById('breadcrumb'),
        },
    });

    nav.init();
})();
```

That is literally the entire module JS. Everything else is `ModuleNavigator`.

**Backend endpoints used:**

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/modules/navigation?project=X&module=druckprufung` | GET | Navigation tree + schema |
| `/api/modules/upload` | POST | Upload PDF |
| `/api/modules/aufmass-update` | POST | Write status/type/file to Aufmass |
| `/api/modules/list-files?project=X&path=<Cluster>/Druckrufung/<Knotenpunkt>` | GET | List uploaded files |

### Data Model

**Group label:** `druckprufung`

| Column Label | Column ID Pattern | Value Written |
|---|---|---|
| `status` | `col-{g}-0` | `"Done"` |
| `type` | `col-{g}-1` | `"12x10"` / `"4x20"` / custom string |
| `file location` | `col-{g}-2` | `"Doku/Cluster-A/Druckrufung/NVT-001/filename.pdf"` |

**Exact column IDs** depend on schema position — always resolved via `nav.findColumnId('druckprufung', 'status')`.

### Status Tracking

| Value | Meaning |
|---|---|
| `""` (empty) | Pending — no upload yet |
| `"Done"` | PDF uploaded successfully |

### File Naming & Storage

- Filename: **original name kept** (`useOriginalFilename: true`)
- Storage path: `STORAGE_ROOT/<project>/Doku/<Cluster>/Druckrufung/<Knotenpunkt>/`
- No address subfolder (one PDF per knotenpunkt address, all in the same folder)

### ACL

Backend enforces `canAccessModule(email, project, 'druckprufung')` on both navigation and upload. Superadmin bypasses all checks. No client-side role redirect.

### Dependencies

- `ModuleNavigator` (module-shared.js)
- The Aufmass data file must exist with a `druckprufung` group

### No Error Reporting

Druckprüfung does not use the error reporting system. There is no "Report Error" button.

---

## 5. Module 2: Kalibrieren (Calibration)

**Files:** `kalibrieren.html`, `src/js/kalibrieren.js`  
**ACL Key:** `kalibrieren`  
**Storage Folder:** `kalibrieren` (lowercase)  
**Group Label:** `kalibrieren`

### Overview

**For the field worker:** Before blowing cable, the measurement equipment (e.g. the Einblasgerät) gets calibrated. The calibration result is a PDF. This module stores that PDF.

**For the developer:** Identical to Druckprüfung in structure. Different `moduleName`, `moduleKey`, `targetFolder`, and `groupLabel`. Nothing else differs.

### User Journey

Identical to Druckprüfung. See [Module 1 User Journey](#user-journey) above, substituting "Kalibrieren" for "Druckprüfung".

### Technical Architecture

```js
// kalibrieren.js — entire file:
const nav = new ModuleNavigator({
    project,
    moduleName:          'Kalibrieren',
    moduleKey:           'kalibrieren',
    targetFolder:        'kalibrieren',
    groupLabel:          'kalibrieren',
    typeOptions:         ['12x10', '4x20', 'custom'],
    useOriginalFilename: true,
    containers: {
        content:    document.getElementById('moduleContent'),
        breadcrumb: document.getElementById('breadcrumb'),
    },
});
nav.init();
```

### Data Model

**Group label:** `kalibrieren`

| Column Label | Value Written |
|---|---|
| `status` | `"Done"` |
| `type` | Selected type string |
| `file location` | `"Doku/{Cluster}/kalibrieren/{Knotenpunkt}/{filename}"` |

### Differences from Druckprüfung

| Property | Druckprüfung | Kalibrieren |
|---|---|---|
| `moduleName` | `"Druckprüfung"` | `"Kalibrieren"` |
| `moduleKey` | `"druckprufung"` | `"kalibrieren"` |
| `targetFolder` | `"Druckrufung"` | `"kalibrieren"` |
| `groupLabel` | `"druckprufung"` | `"kalibrieren"` |
| Storage subfolder | `Druckrufung` | `kalibrieren` |

### ACL, Dependencies, File Naming

All identical to Druckprüfung. No error reporting.

---

## 6. Module 3: Einblasen (Cable Blowing)

**Files:** `einblasen.html`, `src/js/einblasen.js`  
**ACL Key:** `einblasen`  
**Storage Folder:** `Einblasen`  
**Group Label:** `einblasen`  
**Extra Columns:** `metrierung total`, `einblasen-date`, `einblasen-termin`

### Overview

**For the field worker:** "Einblasen" (blowing) is the process of pushing fiber-optic cable through pre-installed conduit using a machine that forces compressed air through the tube. The cable gets blown in, and the distance (metrierung) is recorded. This module lets you either upload an existing work PDF, or generate a formal Einblasprotokoll (blowing protocol document) directly in the browser using a code-gated generator.

**For the developer:** The most complex of the "simple" modules. It uses `ModuleNavigator` as a base but overrides the address list, choice screen, and upload form with custom rendering. It also integrates:
- `AppointmentHelper` for termin scheduling
- An iframe-based protocol generator (code-gated)
- An error reporting system (`EB:` prefix in `error-reporting` column)
- Custom address list with search/filter/sort
- File deletion with automatic status reset

### User Journey

```
1. Open einblasen.html?project=<name>
2. ModuleNavigator renders cluster → knotenpunkt navigation
3. Click knotenpunkt → custom address list (NOT the default one)
   - Search box (by address, cable name, row ID)
   - Date filter (by einblasen-date column value)
   - Status filter: All | Done | Pending | Error
   - Each row shows:
     - Address end name + cable name + fiber type
     - Status badge (Done / Pending / ⚠ Error)
     - Green termin badge (if appointment set, upcoming)
     - Red termin badge (if appointment overdue)
     - Done date below status (if Done, shows DD.MM.YYYY, HH:MM)
   - Sort: upcoming termin first, then overdue, then no termin (alphabetical)
4. Click an address → Choice Screen:
   - Header: Knotenpunkt / Address, cable, fiber count
   - Status badge
   - If Error: red box listing active EB: errors and green-labeled fixed ones
   - Termin info card (if set: Upcoming/Overdue with date/time/notes)
   - Two action buttons in a grid:
     [📅 Mark/Edit Appointment]    [📷 Upload Work]
   - Error buttons: [⚠ Report Error]  [✓ Clear Error] (only if Error status)
   - If Done or Error: existing files injected below (with 🗑 delete buttons)

5a. [📅 Mark/Edit Appointment] clicked:
   → AppointmentHelper.renderAppointmentForm() replaces content
   → Date/time/notes form
   → [Save]: conflict check → save → back to choice screen
   → [Remove]: clears termin → back to choice screen

5b. [📷 Upload Work] clicked → Upload + Generator Page:
   Section A: Standard Upload
   - Uses ModuleNavigator.renderUploadFormInto() injected into a section
   - Accepts any file type (original filename kept)
   - Above the drop zone: Date field + Time field (for einblasen-date)
   - Below: Start Meter + End Meter → Metrierung Total (auto-calculated, readonly)

   Section B: Generator (hidden unless user has generator-access)
   - Shown only if GET /api/settings/generator-access → { hasAccess: true }
   - Code gate: user enters a verification code
     → POST /api/settings/verify-code
     → On success: generator form + iframe appear
   - Generator form fields: (see full list below)
   - Action buttons: ⚡ Generate | 📄 Export PDF | ✓ Approve & Send
   
6. Upload or Generate → Aufmass updated → choice screen re-rendered
```

### Generator Form Fields

| Field | Type | Default |
|---|---|---|
| Date | date | today |
| Time | time | current time |
| Start Meter | number | — |
| End Meter | number | — |
| Metrierung Total | number (readonly) | End - Start |
| Fiber Colour | text | — |
| Einbläser (Operator) | text | — |
| Ort (GPS) | text | auto from project-info |
| Bemerkungen | textarea | — |
| Rohr-Hersteller | text | `Hexatronic` |
| Rohrverband | text | `SNRVe 12x10x2.0` |
| Rohr Dim | text | `SNR 10x2.0` |
| Kabel-Hersteller | text | `Faber` |
| Einblasgerät | text | `Fremco MicroFlow LOG` |
| Controller S/N | text | `9328.4720` |
| Kompressor | text | `M17` |
| Gleitmittel | text | `Micro Jetting Lube MJL` |

### Generator PostMessage Protocol

The generator is an iframe. The parent page and iframe communicate via `window.postMessage`.

**Parent → Iframe:**
```js
// Push form data:
iframe.contentWindow.postMessage({
    type: 'einblas-details-update',
    startMeter: 100,
    endMeter: 4070,
    date: '2026-04-13',
    time: '09:00',
    color: 'Blue, Red',
    operator: 'M. Mustermann',
    gps: '48.4921°N, 9.8760°E',
    remarks: '',
    rohrHersteller: 'Hexatronic',
    // ... all other fields
}, '*');

// Commands:
iframe.contentWindow.postMessage({
    type: 'einblas-command',
    action: 'generate'   // or 'export' or 'approve'
}, '*');
```

**Iframe → Parent:**
```js
// After generate:
{ type: 'einblas-generated', logCount: 47, einblaszeit: '01:23:45' }

// Generate failed:
{ type: 'einblas-generate-error', error: 'Cable length mismatch' }

// After approve:
{ type: 'einblas-approved', pdfBlob: '<base64>', startMeter: 100, endMeter: 4070 }
```

**On approval:** Parent receives blob, uploads via `POST /api/modules/upload` with generated filename, then calls `aufmass-update`.

### Technical Architecture

**Frontend files:**
- `einblasen.html` — page shell with CSS
- `src/js/einblasen.js` (~600 lines) — all module logic
- `src/js/module-shared.js` — `ModuleNavigator` base
- `src/js/appointment-shared.js` — `AppointmentHelper`

**Key functions in `einblasen.js`:**

```js
injectFilesSection(containerEl, listPath, docsPath, addrFilter, cluster, kn, addr)
// Fetches file list, renders rows with download + delete buttons.
// addrFilter: the address display name — used to filter files to just this address
// On last file deleted: resets status to '' and strips EB: error entries.

renderChoiceScreen(cluster, knotenpunkt, address)
// Renders the choice screen. Reads: status, termin, EB: errors.
// Wires: appointment button, upload button, report error, clear error.

renderUploadWithGenerator(cluster, knotenpunkt, address)
// Renders the upload page (both sections A and B).
// Calls nav.renderUploadFormInto() for section A.
// Checks generator access, wires iframe postMessage events.

renderCustomAddressList(cluster, kn)
// Renders the custom address list with search/date/status filters.
// Called via onAddressSelected config (customUploadForm: true).
```

**Backend endpoints used:**

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/modules/navigation?project=X&module=einblasen` | GET | Navigation tree |
| `/api/modules/upload` | POST | Upload file |
| `/api/modules/aufmass-update` | POST | Update Aufmass columns |
| `/api/modules/list-files?project=X&path=<Cluster>/Einblasen/<Knotenpunkt>` | GET | Existing files |
| `/api/modules/appointments?project=X` | GET | Conflict check |
| `/api/settings/generator-access` | GET | Check generator permission |
| `/api/settings/verify-code` | POST | Validate generator code |
| `/api/project-info?project=X` | GET | GPS coordinates for form pre-fill |
| `/api/files?project=X&path=Y&file=Z` | DELETE | Delete file (→ trash) |

### Data Model

**Group label:** `einblasen`

| Column Label | Value Written | Notes |
|---|---|---|
| `status einblasen` | `"Done"` \| `"Error"` \| `""` | Empty = Pending |
| `metrierung total` | `"3970"` (string) | End - Start meters |
| `file location` | `"Doku/Cluster-A/Einblasen/NVT-001/filename.pdf"` | |
| `einblasen-date` | `"2026-04-13, 09:00"` | Date + time of work |
| `einblasen-termin` | `'{"date":"2026-04-15","time":"09:00","notes":"..."}' ` | JSON-encoded appointment |

**Cross-group copy:**

| Group | Column | Value |
|---|---|---|
| `lwl specs` | `total` | Same metrierung value (alsoCopyTo) |

**Error reporting column:**

| Group | Column | Format |
|---|---|---|
| `notes` | `error-reporting` | `"EB:error text;EB:another error;EB:fixed error#;"` |

### Error Reporting System

The `error-reporting` column stores all errors for all modules in a single semicolon-delimited string. Each entry is prefixed with a module code:

- `EB:` = Einblasen error (active)
- `EB:some error#` = Einblasen error (fixed — `#` appended to mark resolved)
- `APL:` = APL module error (same pattern)

**Report Error flow:**
```js
// User clicks ⚠ Report Error → showPrompt() for description
const errorText = await showPrompt('⚠ Report Error', 'Describe the error:');

// Build update:
const updates = {
    [statusColId]: 'Error',
    [errorReportingColId]: existingLog + 'EB:' + errorText.trim() + ';'
};

// POST to aufmass-update
```

**Clear Error flow:**
```js
// Find last unfixed EB: entry, append #
const parts = log.split(';').filter(Boolean);
for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].startsWith('EB:') && !parts[i].endsWith('#')) {
        parts[i] = parts[i] + '#';
        break;
    }
}
// Check if any unfixed remain
const hasUnfixed = parts.some(p => p.startsWith('EB:') && !p.endsWith('#'));
updates[statusColId] = hasUnfixed ? 'Error' : '';
```

### File Naming

**Standard upload (any file type, original name kept):**
- Filename = exactly as uploaded, no transformation

**Generator-produced PDF:**
```
{Cluster}_{YYYYMMDD}_{HHMMSS}_{AddrStart-clean}_bis_{AddrEnd-clean}.pdf
```
Where address "cleaning" = spaces → `-`, commas removed.

Example: `Cluster-A_20260413_143022_Hauptstr-5_bis_Bahnhofstr-12.pdf`

### Appointment System Integration

```js
// Column: einblasen-termin in einblasen group
const terminColId = nav.findColumnId('einblasen', 'einblasen-termin');

// When appointment button clicked:
AH.renderAppointmentForm({
    el,
    existingTermin: termin,    // null or parsed JSON object
    knotenpunkt,
    addrDisplay,
    nav,
    projectName,
    userEmail,
    address,
    terminColId,
    moduleKey: 'einblasen',
    onDone: () => renderChoiceScreen(cluster, knotenpunkt, address)
});
```

Conflict detection: ±40 minutes across all Einblasen appointments on the same date.

---

## 7. Module 4: APL (Closure Protocol)

**Files:** `apl.html`, `src/js/apl.js`  
**ACL Key:** `apl`  
**Storage Folder:** `APL/<Knotenpunkt>/<AddrClean>/`  
**Status Group:** `splicing` (APL columns live in the splicing group)

### Overview

**For the field worker:** APL (Abschlussprotokoll Linientechnik) is the final physical step of connecting the fiber to a subscriber's home. An APL closure box is installed and sealed. This module requires 4 mandatory geo-stamped photos to document the work: a metrierung reading, the APL box exterior, the splice interior, and the inside of the APL. It also records when work was done and who owns the property.

**For the developer:** The most feature-rich module. It integrates:
- `AppointmentHelper` for scheduling
- **GeoCam** for geo-stamped photo capture (this is where GeoCam is used)
- Error reporting with `APL:` prefix
- Eigentümerdaten (customer contact data) display with `tel:` and `mailto:` links
- Splice count tracking (reads existing value from Aufmass, lets user confirm or override)
- 4-required-image upload form with optional extras
- File deletion with automatic status reset (also strips APL: error entries)
- Done date/time display on choice screen

### Domain Context: Why APL?

When a fiber technician completes APL work at a subscriber's address, there must be photographic proof for quality assurance and billing. The 4 required photos serve as evidence that:
1. The cable measurement was taken (Metrierung)
2. The APL box is properly installed (APL_Box)
3. The splice has been done (Splices)
4. The inside of the box is properly prepared (Inside_APL)

Photos taken with GeoCam get GPS+address stamps, providing tamper-resistant location evidence. Photos uploaded from device (without GeoCam) get `_U` appended to the filename to mark them as "uploaded" (not geo-stamped).

### User Journey

```
1. apl.html?project=<name>
2. Cluster → Knotenpunkt → Address list (with termin badges + Done/Pending/Error)
3. Click address → Choice Screen:
   - Header: Knotenpunkt / Address, cable info
   - Status badge
   - If Error: red box with active APL: errors (green for fixed ones)
   - Eigentümerdaten card (if names/phones/emails exist in Aufmass):
     - 👤 Owner names (split on "o.", "und", ",")
     - 📞 Phone numbers as clickable tel: links (split on " o. ")
     - ✉️ Email addresses as clickable mailto: links (split on ";", "|", " o. ")
   - Done date/time card (if Done: shows 📅 date · 🕐 time)
   - Termin info card (if appointment set)
   - Two buttons: [📅 Appointment] [📷 Upload Work]
   - Error buttons: [⚠ Report Error] [✓ Clear Error]
   - If Done or Error: file list injected below with 🗑 delete buttons

4. [📷 Upload Work] → APL Upload Form:
   - Date field (default: today)
   - Time field (default: current time)
   - Splice count section (three states):
     a. Value exists in Aufmass: shows number with [✓ Confirm] and [✎ Update]
        - Confirm → spliceCountFinal = existing, spliceWasUpdated = false
        - Update → warning + input → [Save] → spliceCountFinal = new, spliceWasUpdated = true
     b. No value in Aufmass: free input, always spliceWasUpdated = true
   - 4 required image zones (must all be filled before upload allowed):
     📏 Metrierung  📦 APL_Box  🔗 Splices  🔍 Inside_APL
     Each zone has:
       [📷 Take Photo] → GeoCam overlay (geo-stamped)
       [📁 Upload] → file picker (JPG/PNG)
       Drag-and-drop support
       Thumbnail preview after selection
       ✕ clear button
   - Optional extra images section (any count, original filenames)
   - [Upload All] button (disabled until splice count + all 4 images ready)

5. Click [Upload All]:
   - Timestamp generated: YYYYMMDD_HHmmss
   - Each of the 4 images uploaded with filename: 
     {Knotenpunkt}_{AddrClean}_{ImageType}_{timestamp}[_U].{ext}
   - Extra images uploaded with original filenames
   - Aufmass updated with all status columns
   - Choice screen re-rendered (now shows Done + date/time card)
```

### GeoCam Integration

GeoCam (`window.GeoCam`) is included on `apl.html` and used for the 4 required image zones.

**Taking a photo:**
```js
const IMAGE_TYPES = [
    { id: 'Metrierung', label: 'Metrierung Image',  icon: '📏' },
    { id: 'APL_Box',    label: 'APL Box Image',      icon: '📦' },
    { id: 'Splices',    label: 'Splices Image',       icon: '🔗' },
    { id: 'Inside_APL', label: 'Inside APL Image',   icon: '🔍' },
];

// When "📷 Take Photo" clicked for zone i:
const result = await window.GeoCam.capture({ userText: IMAGE_TYPES[i].label });

if (result) {
    // Create synthetic File object from blob
    const timestamp = formatDateTime(); // YYYYMMDD_HHmmss
    const filename = `${IMAGE_TYPES[i].id}_${timestamp}.jpg`;
    const file = new File([result.blob], filename, { type: 'image/jpeg' });
    
    // Store with source marker
    imageFiles[i] = { file, source: 'camera', preview: URL.createObjectURL(result.blob) };
    // source='camera' → no _U suffix in final filename
}
```

**Uploading from device (file picker):**
```js
// source='upload' → _U suffix added to final filename
imageFiles[i] = { file: pickedFile, source: 'upload', preview: previewUrl };
```

**Final filename assembly at upload time:**
```js
function buildFilename(kn, addrClean, imageType, timestamp, source, ext) {
    const u = source === 'upload' ? '_U' : '';
    return `${kn}_${addrClean}_${imageType}_${timestamp}${u}.${ext}`;
}
// Example: NVT-001_Zeilerweg-11_APL_Box_20260413_143022_U.jpg
```

**`AddrClean` computation:**
```js
function cleanAddress(address) {
    let clean = address.trim();
    if (clean.includes(',')) clean = clean.split(',').pop().trim(); // take last part after comma
    return clean.replace(/\s+/g, '-').replace(/,/g, '');
}
// "Laichingen, Zeilerweg 11" → "Zeilerweg-11"
```

### GeoCam Full System Description

GeoCam is a standalone JS module at `src/js/geocam.js` (~1342 lines), exposed as `window.GeoCam`. It is also described here because APL is its only consumer.

**Capture API:**
```js
const result = await window.GeoCam.capture({
    userText: 'Metrierung Image'  // text shown on the photo overlay
});
// Returns null if cancelled
// Returns { blob: Blob, metadata: { timestamp, lat, lng, altitude, address: {...}, userText } }
```

**Internal Capture Flow:**
```
1. Append fullscreen overlay to document.body (z-index: 99999)
2. getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } })
   → Falls back to any camera if rear not available
3. Live video in viewfinder; overlay fields update every second
4. Parallel: navigator.geolocation.getCurrentPosition()
   → Cached 30 min in localStorage['geocam-pos-v1']
5. Reverse geocode: GET /api/geocode?lat=X&lng=Y (Nominatim proxy)
   → Server-side: 60s cache at 4-decimal precision, max 500 entries, 30 req/min/IP rate limit
   → Client-side: debounced 10s cache + distance check (< 0.0005°)
6. User presses ● shutter
7. Canvas = captured video frame
8. Overlay composited on top (text block at configured position)
9. Preview screen → [Use Photo] or [Retake]
10. [Use Photo]: resolve { blob, metadata }
```

**Overlay Composition — 8 Configurable Fields:**

| Field ID | Default | Description |
|---|---|---|
| `datetime` | enabled | Formatted date + time |
| `address1` | enabled | Road name from Nominatim |
| `address2` | enabled | City + postcode |
| `address3` | enabled | Country |
| `coordinates` | enabled | `48.000000°N, 10.000000°E` |
| `altitude` | enabled | `Alt: 623.4m` or `Alt: N/A` |
| `weather` | disabled | Planned, not implemented |
| `usertext` | enabled | Caller-provided text (e.g. "Metrierung Image") |

**Overlay Settings (persisted in `localStorage['geocam-settings-v1']`):**

```js
{
    dateFormat: 'DD.MM.YYYY',        // or MM/DD/YYYY, YYYY-MM-DD, DD/MM/YYYY
    timeFormat: 'HH:mm:ss',          // or HH:mm, hh:mm:ss A
    overlayPosition: 'bottom-left',  // or bottom-right, top-left, top-right
    overlayColor: '#FFFFFF',         // hex color picker
    overlayFontSize: 14,             // 10–24px slider
    overlayFields: [...],            // enabled/order per field
    userText: '',                    // default custom text
    logoDataUrl: null,               // base64 logo image
    enableHash: false,               // SHA-256 hash for tamper evidence
}
```

**Settings Panel — 6 Sections (accessed via ⚙ button):**
1. Date & Time Format — radio buttons for date + time format
2. Overlay Position — radio: Bottom Left / Bottom Right / Top Left / Top Right
3. Overlay Appearance — color picker + font size slider (10–24px)
4. Overlay Fields — toggle + reorder (drag or up/down arrows)
5. Custom Text — free-text input
6. Logo — file upload stored as data URL

**Geocode Proxy (`routes/geocodeRoutes.js`):**
```
GET /api/geocode?lat=48.1234&lng=10.5678
```
- Mounted BEFORE auth middleware (no auth headers needed)
- Calls Nominatim: `https://nominatim.openstreetmap.org/reverse?lat=X&lon=Y&format=json&addressdetails=1&accept-language=de,en`
- Returns raw Nominatim response (includes `address.road`, `address.city`, `address.postcode`, `address.country`)
- Server cache: `Map` keyed by `lat.toFixed(4),lng.toFixed(4)`, TTL 60s, max 500 entries
- Rate limit: 30 requests/minute/IP (sliding window)

### Technical Architecture

**Frontend files:**
- `apl.html` — page shell
- `src/js/apl.js` (~980 lines) — all module logic
- `src/js/geocam.js` (~1342 lines) — GeoCam capture
- `src/js/appointment-shared.js` — appointment helpers
- `src/js/module-shared.js` — `ModuleNavigator` base

**Key functions in `apl.js`:**

```js
cleanAddress(address)
// "Laichingen, Zeilerweg 11" → "Zeilerweg-11"

formatDateTime()
// Returns YYYYMMDD_HHmmss for timestamp in filenames

buildCustomerHTML(address)
// Reads eigentümer group columns: name, phone, email
// Splits on delimiters, wraps phones in <a href="tel:">, emails in <a href="mailto:">
// Returns HTML string or '' if no data

injectFilesSection(containerEl, listPath, docsPath, addrFilter, cluster, kn, addr)
// Same pattern as Einblasen. addrFilter = AddrClean string.
// On last file deleted: resets 'apl status' to '' and strips APL: error entries

renderChoiceScreen(cluster, knotenpunkt, address)
// Main choice screen. Reads: apl status, apl-termin, timing date/time, eigentümer data
// Renders: customer card, done date card, termin card, choice buttons, error buttons

renderAPLUploadForm(cluster, knotenpunkt, address)
// The 4-image upload form
// Manages imageFiles[] state (4 slots + extras)
// Wires: GeoCam capture, file picker, drag-drop, splice confirm/update, upload button
```

**Backend endpoints used:**

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/modules/navigation?project=X&module=apl` | GET | Navigation tree |
| `/api/modules/upload` | POST | Upload each image |
| `/api/modules/aufmass-update` | POST | Write status, splices, date/time, folder |
| `/api/modules/list-files?project=X&path=<Cluster>/APL/<Knotenpunkt>` | GET | Existing files |
| `/api/modules/appointments?project=X` | GET | Conflict check for termin |
| `/api/files?project=X&path=Y&file=Z` | DELETE | Delete file |

### Data Model

**Group label:** `splicing` (APL columns live in the Splicing group)

| Column Label | Value Written |
|---|---|
| `apl status` | `"Done"` \| `"Error"` \| `""` |
| `number of splices` | `"4"` (string) |
| `apl folder location` | `"Doku/Cluster-A/APL/NVT-001/Zeilerweg-11"` |
| `apl-termin` | `'{"date":"2026-04-15","time":"09:00","notes":"..."}'` |

**Group:** `timing`

| Column Label | Value Written |
|---|---|
| `date` | `"2026-04-13"` |
| `time` | `"14:30"` |

**Group:** `eigentümer` (read-only by APL, populated elsewhere)

| Column Label | Read |
|---|---|
| `name` | Owner name(s) |
| `phone` | Phone number(s) |
| `email` | Email address(es) |

**Group:** `notes`

| Column Label | Format |
|---|---|
| `error-reporting` | `"APL:error text;APL:fixed error#;"` |

### OTDR Auto-Trigger

When APL status is set to `"Done"`, the `aufmass-update` handler on the server checks if `knotenpunkt status` is also `"Done"`:

```js
// In moduleRoutes.js, after applying updates:
if (aplStatus === 'Done' && knotenStatus === 'Done' && otdrStatus !== 'Done') {
    targetRow[otdrStatusPos.grpIdx][otdrStatusPos.colIdx] = 'Waiting';
    otdrAutoTriggered = true;
}
```

The response includes `otdrAutoTriggered: true` when this fires. The OTDR module then shows this address as ready.

### Status Tracking

| Status | Trigger | Meaning |
|---|---|---|
| `""` | Initial / all files deleted | Not started |
| `"Done"` | Upload All completed | 4 images uploaded |
| `"Error"` | Report Error clicked | Error state |

### Error Reporting

Same mechanism as Einblasen but with `APL:` prefix:

```
error-reporting column: "APL:box lid broken;APL:fixed#;"
                         ^ active error       ^ fixed error (# suffix)
```

Active errors shown in red box. Fixed errors shown in green below.

### ACL

Backend: `canAccessModule(email, project, 'apl')` on all requests. No client-side redirect.

### Dependencies

- `ModuleNavigator` (module-shared.js)
- `AppointmentHelper` (appointment-shared.js)
- `window.GeoCam` (geocam.js) — must be loaded before apl.js
- OTDR module depends on APL completing first

---

## 8. Module 5: Knotenpunkt Vorbereitung & Splicing

**Files:** `knotenpunkt-vorbereitung.html`, `src/js/knotenpunkt-vorbereitung.js`  
**ACL Key:** `knotenpunkt`  
**Storage Folder:** `Knotenpunkt_Vorbereitung/<Knotenpunkt>/`  
**Group Labels:** `splicing` (for Knotenpunkt Status column)

### Overview

**For the field worker:** Two separate tasks live on this page:

1. **Knotenpunkt Vorbereitung (NVT Prep):** Before any splicing can happen, the NVT cabinet needs to be prepared — unpacked, cleaned, mounted, and made ready. Multiple overview photos are taken of this preparation work. These are shot at the Knotenpunkt level (one NVT, not per subscriber address).

2. **Splicing:** After the cable is blown in and the APL is done, the fiber strands get spliced (fused together) inside the NVT cabinet. A photo of the completed splices is uploaded per subscriber address. When this is marked Done (and APL is also Done), OTDR unlocks for that address.

**For the developer:** A hybrid module. It uses `ModuleNavigator` in two modes:
- `skipAddressStep: true` for NVT Prep (Knotenpunkt level, no address list)
- Standard mode (Cluster → Knotenpunkt → Address) for Splicing

### User Journey

#### Mode A: Knotenpunkt Vorbereitung (NVT Prep)

```
1. Open knotenpunkt-vorbereitung.html?project=<name>
2. Tab/mode selector to choose: [NVT Vorbereitung] | [Splicing]
3. In NVT Prep mode: Cluster → Knotenpunkt (skipAddressStep: true)
   → Clicking a knotenpunkt goes directly to the NVT prep form
4. NVT Prep form:
   - Knotenpunkt name shown as header
   - Multi-image drop zone (JPG/PNG, multiple files at once)
   - Existing files shown below with thumbnails
   - [Upload] button
5. Upload → files saved to Knotenpunkt_Vorbereitung/<Knotenpunkt>/
   - No Aufmass status update (NVT prep doesn't change any status column)
```

#### Mode B: Splicing

```
1. In Splicing mode: Cluster → Knotenpunkt → Address list (with Done/Pending badges)
2. Click address → Splice image upload form
   - Address details header
   - Single image file drop zone (JPG/PNG)
   - Splice count shown (read from Aufmass, display-only)
   - [Upload] button
3. Upload → file saved with naming convention
4. Aufmass updated: knotenpunkt status → Done, knotenpunkt image location → path
5. OTDR auto-trigger fires on server if apl status is also Done
```

### Technical Architecture

**Frontend files:**
- `knotenpunkt-vorbereitung.html`
- `src/js/knotenpunkt-vorbereitung.js`
- `src/js/module-shared.js`

**Two Navigator Instances:**

The page uses two `ModuleNavigator` instances, one per mode:

```js
// NVT Prep navigator
const navKV = new ModuleNavigator({
    project,
    moduleName:          'Knotenpunkt Vorbereitung',
    moduleKey:           'knotenpunkt',
    targetFolder:        'Knotenpunkt_Vorbereitung',
    groupLabel:          '',           // no status column needed
    skipAddressStep:     true,         // skip address list
    onKnotenpunktSelected: (cluster, kn) => renderKVUploadForm(cluster, kn),
    containers: { content, breadcrumb },
});

// Splicing navigator
const navSplicing = new ModuleNavigator({
    project,
    moduleName:          'Splicing',
    moduleKey:           'knotenpunkt',
    targetFolder:        'Knotenpunkt_Vorbereitung',
    groupLabel:          'splicing',
    customUploadForm:    true,         // custom renderer per address
    onAddressSelected:   (cluster, kn, addr) => renderSpliceForm(cluster, kn, addr),
    containers: { content, breadcrumb },
});
```

**Backend endpoints used:**

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/modules/navigation?project=X&module=knotenpunkt` | GET | Navigation tree |
| `/api/modules/upload` | POST | Upload NVT prep or splice images |
| `/api/modules/aufmass-update` | POST | Update knotenpunkt status (Splicing only) |
| `/api/modules/list-files?project=X&path=...` | GET | Existing images |

### Data Model

**For Splicing (per address):**  
Group label: `splicing`

| Column Label | Value Written |
|---|---|
| `knotenpunkt status` | `"Done"` |
| `knotenpunkt image location` | `"Doku/Cluster-A/Knotenpunkt_Vorbereitung/NVT-001/NVT-001_Zeilerweg-11_Splices_20260413_151200.jpg"` |

**For NVT Prep:** No Aufmass update — files only.

### File Naming

**NVT Preparation images:** Original filenames kept (no rename).

**Splice images:**
```
{Knotenpunkt}_{AddrClean}_Splices_{YYYYMMDD_HHmmss}.{ext}
```

Example: `NVT-001_Zeilerweg-11_Splices_20260413_151200.jpg`

`AddrClean` = same computation as APL: last segment after comma, spaces → `-`.

### Storage Path

Both NVT Prep and Splice images go to the SAME folder:
```
STORAGE_ROOT/<project>/Doku/<Cluster>/Knotenpunkt_Vorbereitung/<Knotenpunkt>/
```

Splice images are distinguished from NVT prep images by their `_Splices_` naming convention, NOT by a subfolder.

### Status Tracking (Splicing)

| Status | Meaning |
|---|---|
| `""` | Pending — no splice image uploaded |
| `"Done"` | Splice image uploaded |

**OTDR Auto-Trigger:** When knotenpunkt status is set to `"Done"` and `apl status` is already `"Done"` for the same row → server auto-sets `otdr status` to `"Waiting"`.

### ACL

`canAccessModule(email, project, 'knotenpunkt')` for all operations.

### Dependencies

- `ModuleNavigator` (module-shared.js)
- APL module completion (for OTDR unlock via OTDR auto-trigger)
- No error reporting in this module

---

## 9. Module 6: OTDR

**Files:** `otdr.html`, `src/js/otdr.js`  
**ACL Key:** `otdr`  
**Storage Folder:** `OTDR/<Knotenpunkt>/<AddrClean>/`  
**Group Label:** `otdr`

### Overview

**For the field worker:** OTDR (Optical Time Domain Reflectometry) is the final quality test for fiber installation. The OTDR machine sends laser pulses down the fiber and measures reflections to detect faults, bends, or bad splices. For every splice that was made during Splicing, you get one PDF report and three `.sor` files (binary measurement data). These get uploaded here.

**For the developer:** The only module with a gated entry condition — addresses only appear here after both APL and Splicing are marked Done. The expected file count is `spliceCount × 4` (1 PDF + 3 SOR per splice). If you upload fewer files, status becomes "Incomplete" instead of "Done". Also supports "Replace All" mode for admins.

### Prerequisites & Auto-Trigger

OTDR addresses are **not visible** until the server auto-sets their OTDR status to `"Waiting"`. This happens in the `aufmass-update` handler when both conditions are met:

```js
// In routes/moduleRoutes.js — aufmass-update endpoint:
const aplStatus    = row[aplStatusPos...];    // must be "Done"
const knotenStatus = row[knotenStatusPos...]; // must be "Done"
const otdrStatus   = row[otdrStatusPos...];   // must NOT be "Done"

if (aplStatus === 'Done' && knotenStatus === 'Done' && otdrStatus !== 'Done') {
    row[otdrStatusPos...] = 'Waiting';
    otdrAutoTriggered = true;
}
```

The auto-trigger fires from either the APL module update or the Splicing module update — whichever completes last.

### User Journey

```
1. otdr.html?project=<name>
2. Cluster → Knotenpunkt → OTDR address list
   - Custom renderer: only shows addresses with OTDR status in ["Waiting", "Incomplete", "Done"]
   - Addresses with "" (Pending/not triggered) are hidden
   - If no OTDR-ready addresses: empty state with explanation:
     "Addresses appear here after both APL status and Knotenpunkt splicing status are set to 'Done'"
   - Each row shows: address end name, cable name, OTDR status badge, "N exp." (expected files)
3. Click address → OTDR upload form:
   a. No existing files (fresh upload):
      - Drop zone accepts .pdf and .sor files (multiple)
      - Shows expected count: "Expected: {spliceCount × 4} files (1 PDF + 3 SOR per splice)"
      - [Upload] button (disabled until at least 1 file selected)
   b. Has existing files:
      - File list with type badges (PDF = red, SOR = orange)
      - Two mode buttons: [Add More] | [Replace All] (admin/superadmin only)
      - File count status
      - Drop zone for new files
4. Select .pdf + .sor files → Click Upload:
   - Files saved to OTDR/<Knotenpunkt>/<AddrClean>/
   - File count validated: total uploaded vs. spliceCount × 4
   - If total ≥ expected → status "Done"
   - If total < expected → status "Incomplete" + warning
5. Aufmass updated with status + file location
```

### Address List Filtering

```js
// Only show addresses where OTDR status is one of:
const OTDR_SHOW_STATUSES = ['Waiting', 'Incomplete', 'Done'];

addressFilter: (addr) => {
    const otdrStatus = addr.data[otdrStatusColId] || '';
    return OTDR_SHOW_STATUSES.includes(otdrStatus);
}
```

### File Count Validation

```js
// After upload completes:
const spliceCount = parseInt(addr.spliceCount, 10) || 0;
const expectedCount = spliceCount * 4;
const actualCount = existingFiles.length + newFiles.length;

const status = actualCount >= expectedCount ? 'Done' : 'Incomplete';

if (status === 'Incomplete') {
    showWarning(`Uploaded ${actualCount} of ${expectedCount} expected files (${spliceCount} splices × 4)`);
}
```

### Replace All Mode

Admin/superadmin only. Deletes all existing files before uploading new ones:

```js
// For each existing file:
DELETE /api/files?project=X&path=Doku/Cluster-A/OTDR/NVT-001/Zeilerweg-11&file=measurement.pdf
```

Then uploads fresh set and recalculates status.

### Technical Architecture

**Frontend files:**
- `otdr.html`
- `src/js/otdr.js` (~760 lines)
- `src/js/module-shared.js`

**Backend endpoints used:**

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/modules/navigation?project=X&module=otdr` | GET | Navigation tree |
| `/api/modules/list-files?project=X&path=...` | GET | Existing files |
| `/api/modules/upload` | POST | Upload OTDR files |
| `/api/modules/aufmass-update` | POST | Update status, type, file location |
| `/api/files?project=X&path=Y&file=Z` | DELETE | Delete file (Replace All) |

### Data Model

**Group label:** `otdr`

| Column Label | Value Written |
|---|---|
| `status` | `"Waiting"` (auto) → `"Done"` \| `"Incomplete"` |
| `type` | `"4×4 files"` (describes the expected count) |
| `file location` | `"Doku/Cluster-A/OTDR/NVT-001/Zeilerweg-11"` (folder, not file) |

### Status Tracking

| Status | Trigger | Meaning |
|---|---|---|
| `""` | Initial | Not eligible (APL or Splicing not Done) |
| `"Waiting"` | Server auto-trigger | Both APL + Splicing Done — ready to upload |
| `"Incomplete"` | Upload with < spliceCount×4 files | Files uploaded but count insufficient |
| `"Done"` | Upload with ≥ spliceCount×4 files | All expected files present |

### File Naming & Storage

Files keep **original names** exactly as uploaded. No renaming.

```
STORAGE_ROOT/<project>/Doku/<Cluster>/OTDR/<Knotenpunkt>/<AddrClean>/
```

Example:
```
/storage/Projekt-A/Doku/Cluster-1/OTDR/NVT-001/Zeilerweg-11/
  measurement_001.pdf
  measurement_001_A.sor
  measurement_001_B.sor
  measurement_001_C.sor
```

### ACL

- Navigation + upload: `canAccessModule(email, project, 'otdr')`
- Replace All: additionally requires `canEditProject(email, project)` (admin/superadmin)

### Dependencies

- `ModuleNavigator` (module-shared.js)
- **APL must be Done** for the address
- **Knotenpunkt Splicing must be Done** for the knotenpunkt
- Both conditions required for OTDR auto-trigger

### No Error Reporting

OTDR does not use the error reporting system. No "Report Error" button.

---

## 10. Module 7: Files (File Manager)

**Files:** `files.html` (frontend with inline scripts), `routes/fileRoutes.js` (backend)  
**ACL Key:** `files`

### Overview

**For the field worker:** A general file browser for the project. Not tied to Aufmass rows. Browse folders, upload anything, create folders, rename/move/copy files, delete (to a recycle bin), and share files via a public link.

**For the developer:** The most self-contained module — it has its own route file (`fileRoutes.js`) with no dependency on the Aufmass data format. All operations are on the raw filesystem. Includes NAS synchronization for every write operation.

### User Journey

```
1. files.html?project=<name>
2. Root folder listing (sorted: folders first, then files, both alphabetical)
   - Name, size, last modified, modified-by (from fileMeta)
3. Click folder → navigate in, update breadcrumb
4. Click file → authenticated download
5. Drag files over file list → upload them
6. Toolbar actions:
   - [+ New Folder] → prompt for name → create
   - [↑ Upload] → file picker (up to 50 files)
   - [🗑 Recycle Bin] → show deleted items panel
7. Right-click / three-dot menu on item → context menu:
   - Download
   - Rename → inline edit
   - Copy → folder picker tree dialog → copy to destination
   - Move → folder picker tree dialog → move (atomic rename)
   - Delete → move to .trash/ (30-day TTL)
   - Share → create public link with expiry (1–720 hours)
8. Recycle Bin panel: list items with deleted-by, expiry, [Restore] or [Purge]
```

### Backend Endpoints (Full Reference)

All under `/api/files/`:

#### List Files
```
GET /api/files?project=X&path=Y
Headers: x-user-email, x-user-role

Response: {
  success: true,
  items: [
    { name: "subfolder", isDir: true, size: 0, mtime: "2026-04-13T10:00:00Z", modifiedBy: "user@...", modifiedAt: "..." },
    { name: "document.pdf", isDir: false, size: 1048576, mtime: "...", modifiedBy: "...", modifiedAt: "..." }
  ]
}
```
Hidden items: `.trash`, `.filemeta.json`, `chat`, `chat-media`.

#### Upload
```
POST /api/files/upload?project=X&path=Y
Content-Type: multipart/form-data
Fields: files[] (up to 50 files, 200 MB each)
Requires: canEditProject
```

#### Create Folder
```
POST /api/files/folder?project=X&path=Y
Body: { name: "New Folder Name" }
```

#### Rename
```
POST /api/files/rename?project=X&path=Y
Body: { oldName: "old.pdf", newName: "new.pdf" }
```

#### Delete (→ Trash)
```
DELETE /api/files?project=X&path=Y&file=Z
```
Moves to `<projectRoot>/.trash/` with timestamp-based trash filename.  
Updates `.trash/.manifest.json`.

#### Copy
```
POST /api/files/copy?project=X
Body: {
  source: "relative/path/file.pdf",
  destination: "relative/dest/folder"
}
```
Auto-renames on conflict: `file.pdf` → `file (1).pdf`.

#### Move
```
POST /api/files/move?project=X
Body: { source: "old/path/file.pdf", destination: "new/path" }
```
Atomic rename. Cannot move folder into itself.

#### Folder Tree (for picker dialog)
```
GET /api/files/tree?project=X

Response: {
  success: true,
  tree: {
    name: "Root",
    path: "",
    children: [
      { name: "Doku", path: "Doku", children: [...] }
    ]
  }
}
```
Up to 10 levels deep (directories only).

#### Download File
```
GET /api/files/download?project=X&path=Y&file=Z
```
Streams file. If missing locally: fetches from NAS first (`nasOnDemand`).

#### Download Folder (ZIP)
```
GET /api/files/download-folder?project=X&path=folderPath
```
Streams ZIP archive via `archiver`.

### Recycle Bin

**Manifest:** `<projectRoot>/.trash/.manifest.json`

```json
{
  "items": [{
    "id": "1713000000000",
    "originalName": "document.pdf",
    "originalPath": "Doku/Cluster-A",
    "trashName": "Doku_Cluster-A_document.pdf_1713000000000",
    "deletedBy": "user@example.com",
    "deletedAt": "2026-04-13T12:00:00Z",
    "isDir": false,
    "expiresAt": "2026-05-13T12:00:00Z"
  }]
}
```

- TTL: 30 days
- Cleanup runs: on server startup (all projects) + before every trash listing

**Recycle Bin Endpoints:**
```
GET    /api/files/trash?project=X             → list items
POST   /api/files/trash/restore?project=X     → { id } → restore file
DELETE /api/files/trash/purge?project=X       → { id } → permanently delete
```

Restore re-syncs to NAS. Purge skips NAS (NAS file already deleted at original delete time).

### Share Links

**Create share:**
```
POST /api/files/share?project=X
Body: { filePath: "relative/path/file.pdf", expiresIn: 168 }
```
- Generates 12-character URL-safe token
- Expiry: 1–720 hours (default 168 = 7 days)
- Response: `{ success, shareId, shareUrl: "/share/{shareId}", shareType, expiresAt }`

**Access share (no auth needed):**
```
GET /share/{shareId}              → File: download | Folder: HTML browser page
GET /share/{shareId}/browse?path=subfolder    → Browse inside shared folder
GET /share/{shareId}/download?file=name.pdf   → Download from shared folder
```

**Data stored in:** `src/DataFiles/shares.json`

**List shares for a file:**
```
GET /api/files/shares?project=X&filePath=Y
```

**Revoke share:**
```
DELETE /api/files/share?project=X
Body: { shareId }
```

### File Metadata (`fileMeta`)

Tracks `modifiedBy` (email) and `modifiedAt` (ISO timestamp) per file path.  
Stored in: `<projectRoot>/.filemeta.json`

Updated on: upload, folder create, rename, move (destination), copy (destination).

### NAS Sync

Every write operation triggers NAS sync:

| Operation | NAS Action |
|---|---|
| Upload | `syncFile(relPath)` — fire-and-forget push |
| Delete | `queueOperation({ type: 'delete', remotePath, isDir })` |
| Rename/Move | `queueOperation({ type: 'rename'|'move', ... })` |
| Copy | `syncFile()` for destination |
| Download | `ensureLocalFile(absPath, relPath)` — fetch from NAS if missing |
| Listing | Merges NAS items via `listNASDirectory()` |

### Path Traversal Protection

All paths go through `safePath(projectName, subPath)`:
```js
const resolved = path.resolve(target);
const resolvedRoot = path.resolve(projectRoot);
if (!resolved.startsWith(resolvedRoot + path.sep)) {
    return null; // → 400 response
}
```

System files protected from deletion: `.filemeta.json`, `.trash`.

### ACL

| Operation | Required |
|---|---|
| List, Download | `canAccessProject` + `canAccessModule('files')` |
| Upload, Create folder, Rename | Above + `canEditProject` |
| Copy, Move, Delete | `canEditProject` |
| Share create/revoke | `canEditProject` |
| Trash restore/purge | `canEditProject` |

Superadmin bypasses all.

---

## 11. Module 8: Appointment Planner

**Files:** `planner.html`, `src/js/planner.js`  
**ACL Key:** `planner`

### Overview

**For the field worker:** A day-view calendar showing all scheduled appointments across all modules (Einblasen, APL, etc.) for the project. See what's scheduled for any day, navigate between days, and jump directly to the module for any appointment.

**For the developer:** A read-only aggregation view. It fetches all termin column values from the Aufmass via a single API call and renders them on a pixel-precise timeline. No writes — only reads.

### User Journey

```
1. planner.html?project=<name>
2. ACL check: GET /api/access/my-permissions?project=X → must have planner: true
3. Loads all appointments: GET /api/modules/appointments?project=X
4. Initial view: today's appointments on day timeline
5. Week bar: Mon–Sun row centered on current week
   - Each day: abbrev + date number + dot if has appointments
   - Current day highlighted
6. Day timeline: 06:00–22:00 at 80px/hour
   - Color-coded chips per appointment (module-specific colors)
   - Red "now" line on today's view
7. Navigation:
   - Click week bar day → jump to that day
   - [← Prev Day] / [Next Day →] → adjacent day
   - [Today] → today
   - Date label click → date picker
   - Module filter dropdown → filter visible chips
8. Click appointment chip → detail side panel:
   - Module badge (color-coded)
   - Date + time
   - Address (start/end), Knotenpunkt, Cluster
   - Notes (if any)
   - "Go to [Module]" link → {module}.html?project=X
   - Close: click X, press Escape, click outside
9. Empty day: illustration + "No appointments scheduled"
```

### Timeline Layout Constants

```js
const HOUR_START  = 6;           // 06:00
const HOUR_END    = 22;          // 22:00
const HOURS       = 16;          // HOUR_END - HOUR_START
const PX_PER_HOUR = 80;          // 80px per hour
const PX_PER_MIN  = 80 / 60;     // ≈ 1.333 px/min
const BUFFER_MINS = 40;          // conflict zone ±40 minutes
```

**Chip positioning:**
```js
const minutesFromStart = (hourInt * 60 + minInt) - (HOUR_START * 60);
const topPx = minutesFromStart * PX_PER_MIN;
// chip is absolutely positioned at top: topPx, min-height: 60px
```

### Data Loading

```
GET /api/modules/appointments?project=X
Headers: x-user-email, x-user-role

Response: {
  success: true,
  appointments: [
    {
      rowId: "ROW-42",
      module: "einblasen",
      date: "2026-04-14",
      time: "09:00",
      notes: "Morning shift",
      cluster: "Cluster-A",
      knotenpunkt: "NVT-001",
      addressStart: "Hauptstraße 1",
      addressEnd: "Bahnhofstraße 5",
      terminColId: "col-3-2"
    }
  ]
}
```

**Backend logic** (`routes/moduleRoutes.js` — `/api/modules/appointments`):
1. Parse the entire Aufmass data file
2. For every column whose label contains "termin" (case-insensitive)
3. Parse the JSON value (the stored appointment object)
4. Map the group label to a module name via:
   ```js
   "einblasen" group → module: "einblasen"
   "splicing" / "apl" group → module: "apl"
   "druckprüfung" group → module: "druckprufung"
   "kalibrieren" group → module: "kalibrieren"
   "otdr" group → module: "otdr"
   ```
5. Return all found appointments as a flat array

### Module Color Map

```js
const MODULE_COLORS = {
    einblasen:    { bg: '#EFF6FF', border: '#3B82F6', text: '#1D4ED8', dot: '#3B82F6' },
    apl:          { bg: '#ECFDF5', border: '#10B981', text: '#065F46', dot: '#10B981' },
    druckprufung: { bg: '#FFFBEB', border: '#F59E0B', text: '#92400E', dot: '#F59E0B' },
    kalibrieren:  { bg: '#F5F3FF', border: '#8B5CF6', text: '#4C1D95', dot: '#8B5CF6' },
    otdr:         { bg: '#FEF2F2', border: '#EF4444', text: '#991B1B', dot: '#EF4444' },
};
// Unknown module: { bg: '#F9FAFB', border: '#9CA3AF', text: '#374151', dot: '#9CA3AF' }
```

### Conflict Detection

```js
// Two appointments conflict if:
// - Same date
// - Same module
// - |time difference| < BUFFER_MINS (40 minutes)

function detectConflicts(appointments) {
    const byDateModule = {};
    appointments.forEach(a => {
        const key = `${a.date}::${a.module}`;
        if (!byDateModule[key]) byDateModule[key] = [];
        byDateModule[key].push(a);
    });
    
    const conflicts = new Set();
    for (const group of Object.values(byDateModule)) {
        for (let i = 0; i < group.length; i++) {
            for (let j = i + 1; j < group.length; j++) {
                const diff = Math.abs(toMinutes(group[i].time) - toMinutes(group[j].time));
                if (diff < BUFFER_MINS) {
                    conflicts.add(group[i].rowId);
                    conflicts.add(group[j].rowId);
                }
            }
        }
    }
    return conflicts;
}
```

Conflicting appointments get a `"⚠ Overlap"` indicator on their chip. Does NOT prevent scheduling.

### "Go to Module" URL Mapping

```js
const MODULE_URLS = {
    einblasen:    'einblasen.html',
    apl:          'apl.html',
    druckprufung: 'druckprufung.html',
    kalibrieren:  'kalibrieren.html',
    otdr:         'otdr.html',
};
// Link: `${MODULE_URLS[mod]}?project=${encodeURIComponent(projectName)}`
```

### ACL

```
GET /api/access/my-permissions?project=X
→ { permissions: { planner: true/false, ... } }
```

Non-superadmin users must have `planner: true`. Superadmin bypasses. Backend at `/api/modules/appointments` only requires project access.

### Appointment System — AppointmentHelper (appointment-shared.js)

This helper is used by APL and Einblasen to create/edit/delete appointments. The Planner reads the results. Here is the full API of `window.AppointmentHelper`:

**`parseTermin(val)`**
```js
// val is the raw string from the Aufmass termin column
const termin = AH.parseTermin('{"date":"2026-04-15","time":"09:00","notes":"test"}');
// → { date: "2026-04-15", time: "09:00", notes: "test" }
// Returns null for empty/invalid JSON
```

**`formatTermin(termin)`**
```js
AH.formatTermin({ date: '2026-04-15', time: '09:00' }); // → "15.04.2026, 09:00"
AH.formatTermin({ date: '2026-04-15' });                 // → "15.04.2026"
```

**`isTerminPassed(termin)`**
```js
AH.isTerminPassed({ date: '2026-04-14', time: '09:00' }); // → true (if past)
```

**`terminBadgeHTML(termin)`** → compact inline badge for address list rows  
**`terminInfoHTML(termin)`** → larger card for choice screens  
**`choiceButtonsHTML(isDone, termin)`** → two-column grid (appointment + upload buttons)

**`renderAppointmentForm(opts)`** — full form UI:
```js
AH.renderAppointmentForm({
    el:             document.getElementById('moduleContent'),
    existingTermin: { date: '2026-04-15', time: '09:00', notes: '' },
    knotenpunkt:    'NVT-001',
    addrDisplay:    'Zeilerweg 11',
    nav:            navInstance,
    projectName:    'Laichingen-2025',
    userEmail:      'tech@example.com',
    address:        addressObject,
    terminColId:    'col-3-2',
    moduleKey:      'einblasen',
    onDone:         () => renderChoiceScreen(cluster, kn, addr),
});
```

Form fields: Date (required, default tomorrow), Time (required, default 09:00), Notes (optional).  
Buttons: [Save Appointment], [Back], [Remove Appointment] (editing only).

**`checkConflicts(projectName, module, date, time, excludeRowId)`** → `Promise<{ hasConflict, conflicts }>`  
Fetches all appointments, filters to same module+date, checks ±40 minute window.

**`_showConflictModal(conflicts)`** → `Promise<boolean>`  
Shows DOM modal with list of conflicting appointments. Returns `true` (force) or `false` (cancel).

**`sortByTermin(addresses, terminColId)`**  
Sorts address array: upcoming termins first (earliest first), then overdue (oldest first), then no termin (alphabetical).

**Save flow:**
```
1. User fills date/time/notes
2. [Save Appointment] clicked
3. checkConflicts(project, module, date, time, currentRowId)
4. If conflict: _showConflictModal() → user chooses Force or Cancel
5. POST /api/modules/aufmass-update { updates: { [terminColId]: JSON.stringify({date,time,notes}) } }
6. onDone() → navigate back
```

**Termin columns per module:**

| Module | Group | Column Label |
|---|---|---|
| Einblasen | `einblasen` | `einblasen-termin` |
| APL | `splicing` | `apl-termin` |

---

## 12. Cross-Cutting: Idle Logout

**File:** `src/js/idle-logout.js`  
**Included on:** All **15** authenticated pages (after `api.js`): admin, apl, aufmass, dashboard, druckprufung, einblasen, files, index, kalibrieren, knotenpunkt-vorbereitung, new-project, otdr, planner, profile, superlog

### Overview

An IIFE (Immediately Invoked Function Expression) that silently monitors user activity. When inactive too long, shows a countdown banner and then logs out. Uses `localStorage` for cross-tab coordination.

### Configuration Constants

```js
const IDLE_MS_USER       = 2 * 60 * 60 * 1000;   // 2 hours (regular users)
const IDLE_MS_SUPERADMIN = 30 * 60 * 1000;        // 30 minutes (superadmin)
const CHECK_INTERVAL_MS  = 30 * 1000;             // check every 30 seconds
const WARN_BEFORE_MS     = 2 * 60 * 1000;         // warning 2 minutes before logout
const LS_KEY             = '_docpilot_lastActive'; // localStorage key
```

### Activity Detection

Listens on `document` (passive, capture phase):
```js
const events = ['click', 'keydown', 'scroll', 'mousemove', 'touchstart', 'touchmove'];
```

**Throttled:** Only updates `localStorage` once per 10 seconds for high-frequency events to avoid thrash.

**Fetch interception:**
```js
const _prevFetch = window.fetch;
window.fetch = function(...args) {
    throttledTouch();
    return _prevFetch.apply(this, args);
};
```
Every API call resets the idle timer.

### Cross-Tab Sync

```js
// All tabs share the same localStorage key
localStorage.setItem('_docpilot_lastActive', String(Date.now()));

// Other tabs detect activity via storage event:
window.addEventListener('storage', (e) => {
    if (e.key === '_docpilot_lastActive' && e.newValue) {
        if (warned) hideWarning(); // dismiss warning if another tab was active
    }
});
```

### Warning Banner

Fixed-position red gradient banner sliding in from top:
```
⚠️ You will be logged out due to inactivity in 1m 47s  [Stay Logged In]
```

- Appears when ≤ 2 minutes remaining
- Countdown updates every 5 seconds (switches from 30s to 5s interval when warning shows)
- "Stay Logged In" button: bypasses throttle, immediately touches activity
- Banner hidden when user becomes active

### Logout Sequence

```js
function doIdleLogout() {
    if (loggingOut) return;   // guard against double-fire
    loggingOut = true;
    clearInterval(intervalId);
    clearInterval(warnIntervalId);
    localStorage.removeItem(LS_KEY);
    
    if (typeof window.doLogout === 'function') {
        window.doLogout();    // shared logout: clears tokens, calls API
    } else {
        // Fallback:
        localStorage.removeItem('userRole');
        localStorage.removeItem('userEmail');
        localStorage.removeItem('userName');
        localStorage.removeItem('authToken');
        alert('You have been logged out due to inactivity.');
        window.location.href = 'login.html';
    }
}
```

### Early Return Conditions

Script does nothing (returns immediately) if:
- `localStorage.getItem('userEmail')` is null/empty  
- `localStorage.getItem('userRole')` is null/empty  

This prevents running on `login.html` or `register.html`.

### Visibility Change

```js
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkIdle();
});
```

When a tab becomes visible after being hidden, it immediately checks whether idle timeout was exceeded while hidden.

---

## 13. Backend API Reference

### Module Routes (`/api/modules/`)

#### `GET /api/modules/navigation`
**Query:** `project=X&module=druckprufung`  
**Auth headers:** `x-user-email`, `x-user-role`

Returns the cluster → knotenpunkt → address tree built from the Aufmass data file, plus the schema (all group/column labels with their IDs).

**Response:**
```json
{
  "success": true,
  "schema": [
    {
      "id": "grp-0",
      "label": "Address",
      "cols": [
        { "id": "col-0-0", "label": "ID" },
        { "id": "col-0-1", "label": "address start" }
      ]
    }
  ],
  "clusters": [
    {
      "name": "Cluster-A",
      "knotenpunkte": [
        {
          "name": "NVT-001",
          "addresses": [
            {
              "id": "ROW-1",
              "start": "Hauptstraße 1",
              "end": "Zeilerweg 11",
              "cableName": "KabelNord",
              "fiberType": "12x10",
              "spliceCount": "4",
              "data": {
                "col-0-0": "ROW-1",
                "col-0-1": "Hauptstraße 1",
                "col-5-0": "Done"
              }
            }
          ]
        }
      ]
    }
  ]
}
```

**Column positions found (hardcoded label search):**
- `cluster` → cluster name
- `knotenpunkt` or `nvt` → NVT/knotenpunkt name
- `address start` → start address
- `address end` → end address
- `cable name` → cable name
- `fiber type` or `fiber count` → fiber type
- `splices` or `splice count` → splice count

#### `POST /api/modules/upload`
**Body:** `multipart/form-data`

| Field | Type | Description |
|---|---|---|
| `project` | string | Project name |
| `targetPath` | string | Relative path under `Doku/` (e.g. `Cluster-A/Druckrufung/NVT-001`) |
| `customName` | string | (optional) Rename single file to this name |
| `module` | string | ACL module key for this upload |
| `files[]` | file(s) | Up to 50 files, 200 MB each |

**Response:**
```json
{
  "success": true,
  "files": [
    { "name": "document.pdf", "path": "Doku/Cluster-A/Druckrufung/NVT-001/document.pdf", "size": 1048576 }
  ]
}
```

After response: NAS sync fires for each saved file (fire-and-forget).

#### `POST /api/modules/aufmass-update`
**Body (JSON):**
```json
{
  "project": "Laichingen-2025",
  "rowId": "ROW-42",
  "module": "druckprufung",
  "updates": {
    "col-5-0": "Done",
    "col-5-1": "12x10",
    "col-5-2": "Doku/Cluster-A/Druckrufung/NVT-001/test.pdf"
  },
  "rowVersion": 3,
  "note": "Optional human-readable note for audit log"
}
```

**Response:**
```json
{
  "success": true,
  "rowId": "ROW-42",
  "updated": ["col-5-0", "col-5-1", "col-5-2"],
  "otdrAutoTriggered": false,
  "rowVersion": 4
}
```

**Conflict (optimistic lock):**
```json
{ "success": false, "conflict": true, "message": "This row was modified by another user.", "serverVersion": 5, "clientVersion": 3 }
```
→ HTTP 409

After write: NAS sync fires. Background tasks: `saveVersionedCopy()` (for data versioning + Excel export).

#### `GET /api/modules/aufmass-row`
**Query:** `project=X&rowId=ROW-42&module=druckprufung`  
**Response:** `{ success, row: { _id, "col-0-0": "ROW-1", ... }, schema }`

#### `GET /api/modules/list-files`
**Query:** `project=X&path=Cluster-A/Druckrufung/NVT-001`  
**Response:** `{ success, files: [{ name, size, mtime, isDir }] }`

Merges local + NAS files. Path is relative to `STORAGE_ROOT/<project>/Doku/`.

#### `GET /api/modules/appointments`
**Query:** `project=X`  
**Response:** `{ success, appointments: [...] }` — see Planner section for full shape.

Scans entire Aufmass. Finds all columns with "termin" in label. Parses JSON. Returns one entry per set appointment.

### Geocode Route (`/api/geocode`)

```
GET /api/geocode?lat=48.1234&lng=10.5678
```

No auth required. Proxies Nominatim. Rate limit: 30/min/IP. Server cache: 60s at 4-decimal precision (≈50m). Returns raw Nominatim JSON.

---

## 14. ACL & Permissions Model

### Storage

Permissions stored in `src/DataFiles/access-control.json`:
```json
{
  "users": {
    "user@example.com": {
      "projects": {
        "Laichingen-2025": {
          "access": true,
          "canEdit": true,
          "modules": ["druckprufung", "einblasen", "kalibrieren", "apl", "knotenpunkt", "otdr", "files", "planner"]
        }
      }
    }
  }
}
```

### ACL Functions (`controllers/accessControl.js`)

```js
canAccessProject(email, project)     // → boolean: user has any access to project
canAccessModule(email, project, key) // → boolean: user has module key in their modules list
canEditProject(email, project)       // → boolean: user has canEdit: true
```

Superadmin (`role === 'superadmin'`) bypasses all three checks unconditionally.

### How Modules Check ACL

**Backend:** Every route handler checks:
1. Parse `x-user-role` from headers — if `superadmin`, skip all checks
2. `canAccessProject(email, project)` — 403 if denied
3. `canAccessModule(email, project, aclModule)` — 403 if denied
4. For write operations: `canEditProject(email, project)` — 403 if denied

**Frontend:** Modules read `localStorage.getItem('userRole')` and redirect to `login.html` if missing. No client-side module ACL check — that's server-side only.

**Module ACL Keys:**

| Module | Key |
|---|---|
| Druckprüfung | `druckprufung` |
| Kalibrieren | `kalibrieren` |
| Einblasen | `einblasen` |
| APL | `apl` |
| Knotenpunkt Vorbereitung + Splicing | `knotenpunkt` |
| OTDR | `otdr` |
| Files | `files` |
| Planner | `planner` |

---

## 15. Data File Format

The Aufmass data file is at:
```
STORAGE_ROOT/<project>/Doku/Aufmass/datafile/<project>.txt
```

It's a JSON file despite the `.txt` extension:

```json
[
  ["Address", "Splicing", "Einblasen", "Druckprufung", "Kalibrieren", "OTDR", "LWL Specs", "Timing", "Notes", "Eigentümer"],
  [
    [
      ["ID", "cluster", "knotenpunkt", "address start", "address end", "cable name", "fiber type"],
      ["apl status", "knotenpunkt status", "number of splices", "apl folder location", "knotenpunkt image location", "apl-termin"],
      ["status einblasen", "metrierung total", "file location", "einblasen-date", "einblasen-termin"],
      ["status", "type", "file location"],
      ["status", "type", "file location"],
      ["status", "type", "file location"],
      ["total"],
      ["date", "time"],
      ["error-reporting"],
      ["name", "phone", "email"]
    ],
    ["ROW-1", "Cluster-A", "NVT-001", "Hauptstr. 1", "Zeilerweg 11", "KabelNord", "12x10",
             "Done", "Done", "4", "Doku/Cluster-A/APL/NVT-001/Zeilerweg-11", "...", "...",
             "Done", "3970", "Doku/.../file.pdf", "2026-04-13, 09:00", "...",
             "Done", "12x10", "Doku/.../file.pdf",
             "Done", "12x10", "Doku/.../file.pdf",
             "Waiting", "", "",
             "3970",
             "2026-04-13", "09:00",
             "",
             "Max Mustermann", "0731 123456", "max@example.com"
    ],
    ["ROW-2", ...]
  ]
]
```

**Format details:**
- `[0]` = `E1`: array of group labels (strings)
- `[1]` = `E2`: array where:
  - `E2[0]` = subcolumn definition array: one sub-array of column labels per group
  - `E2[1..n]` = data rows, each a flat array parallel to the schema

**Column ID resolution:**
- Group `i` = `E1[i]` (label) and `E2[0][i]` (column labels)
- Column at group `i`, position `j` → ID: `col-{i}-{j}`
- A cell value for row `r` at column `col-{i}-{j}` = `E2[r+1][i][j]`

Wait — the actual row structure in the code is:
```js
// From navigation handler:
const cluster = row[clusterPos.grpIdx]?.[clusterPos.colIdx];
// row is a flat array of sub-arrays (one per group)
// row[groupIndex][colIndex] gives the value
```

So each data row is an **array of arrays**:
```js
row = [
    ["ROW-1", "Cluster-A", "NVT-001", "Hauptstr. 1", "Zeilerweg 11", "KabelNord", "12x10"], // group 0: Address
    ["Done", "Done", "4", "Doku/...", "Doku/...", "..."], // group 1: Splicing
    ["Done", "3970", "Doku/...", "2026-04-13, 09:00", "..."], // group 2: Einblasen
    // ...
]
```

**Optimistic locking:** Row versions stored in `<projectRoot>/row-versions.json`:
```json
{ "ROW-1": 5, "ROW-2": 2 }
```

**Data versioning:** After every `aufmass-update`, `saveVersionedCopy()` runs in the background to create a versioned snapshot and export an Excel file.

---

## Appendix: Module Dependency Graph

```
Druckprüfung  ──────────────────────────────────────┐
Kalibrieren   ──────────────────────────────────────│
Einblasen     ──────────────────────────────────────│
                                                    │ (field work prerequisites,
                                                    │  not technically enforced in code)
APL ─────────────────────────────────┐              │
    (sets apl status = Done)         │              │
                                     ↓              │
Knotenpunkt Vorbereitung / Splicing  │              │
    (sets knotenpunkt status = Done) │              │
                                     ↓              │
                           OTDR auto-trigger ───────┘
                           (status: "" → "Waiting")
                                     ↓
                                   OTDR upload
                                   (status: "Waiting" → "Done" | "Incomplete")

AppointmentHelper ←── Einblasen (einblasen-termin column)
AppointmentHelper ←── APL (apl-termin column)
AppointmentHelper data ───→ Planner (reads all termin columns)

GeoCam ←── APL (4 required images)

idle-logout.js ←── Every authenticated page
```

---

## Appendix: Common Patterns Used Across Modules

### Address Clean Function

Used in APL, OTDR, Knotenpunkt Vorbereitung, Einblasen generator for filename/folder generation:

```js
function cleanAddress(address) {
    let clean = (address || '').trim();
    if (clean.includes(',')) clean = clean.split(',').pop().trim();
    return clean.replace(/\s+/g, '-').replace(/,/g, '');
}
// "Laichingen, Zeilerweg 11" → "Zeilerweg-11"
// "Zeilerweg 11" → "Zeilerweg-11"
```

### Timestamp Format

Used in APL image filenames, Einblasen generator:
```js
function formatDateTime() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
// → "20260413_143022"
```

### Error Reporting Column Format

```
"EB:cable stuck;EB:machine failed#;APL:box not sealed;"
  ^active EB    ^fixed EB (# marks resolved)  ^active APL error
```

Parsing:
```js
const entries = log.split(';').filter(Boolean);
const activeErrors = entries.filter(e => e.startsWith('EB:') && !e.endsWith('#'));
const fixedErrors  = entries.filter(e => e.startsWith('EB:') && e.endsWith('#'));
```

### Module Key → HTML Page Map

```js
const MODULE_PAGES = {
    druckprufung: 'druckprufung.html',
    kalibrieren:  'kalibrieren.html',
    einblasen:    'einblasen.html',
    apl:          'apl.html',
    knotenpunkt:  'knotenpunkt-vorbereitung.html',
    otdr:         'otdr.html',
    files:        'files.html',
    planner:      'planner.html',
};
```

### Standard Auth Headers

```js
// Used by every authenticated fetch:
{
    'x-user-email': localStorage.getItem('userEmail') || '',
    'x-user-role':  localStorage.getItem('userRole')  || '',
}
```

### `showConfirm` / `showAlert` / `showPrompt`

These appear throughout modules. They are custom async modal helpers (not `window.confirm/alert/prompt`) that return promises:

```js
// Returns true/false (user confirmed or cancelled)
const ok = await showConfirm('Title', 'Are you sure?');

// Returns the entered string or null if cancelled
const text = await showPrompt('Title', 'Enter description:');

// Shows dismissable alert
await showAlert('Something went wrong');
```

Implemented using DOM modal elements (`#modal-overlay`, `#modal-box`) that must be present in the HTML page.

---

*End of DocPilot Module Technical Reference — v2026-04-14*

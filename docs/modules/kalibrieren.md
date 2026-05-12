# Kalibrieren Module

**File:** `src/js/kalibrieren.js`  
**Page:** `kalibrieren.html`  
**ACL Key:** `kalibrieren`  
**Purpose:** Cable calibration documentation — upload one PDF per address and track status in Aufmass.

---

## Overview

Functionally identical to Druckprüfung. Uses `ModuleNavigator` directly with minimal config differences (module name, folder name, group label). Standard three-level navigation + PDF upload + Aufmass update.

---

## User Flow

```
Dashboard → kalibrieren.html?project=X
    ↓
Cluster grid → Knotenpunkt grid → Address list (Done/Pending badges)
    ↓
Address selected:
    • Pending: type dropdown + PDF drop zone
    • Done: existing files list + "Edit / Re-upload"
    ↓
Upload PDF → Aufmass updated
```

---

## UI Components

Same as Druckprüfung:
- Cluster grid, Knotenpunkt grid, Address list
- Upload form: type select (`12x10`, `4x20`, `custom`), PDF drop zone
- Files view when Done

---

## Backend Endpoints Used

| Endpoint | Purpose |
|---|---|
| `GET /api/modules/navigation?project=X&module=kalibrieren` | Load navigation tree |
| `POST /api/modules/upload` | Upload PDF |
| `POST /api/modules/aufmass-update` | Update status, type, file location |
| `GET /api/modules/list-files?project=X&path=...` | List files (files view) |

---

## Data Model — Aufmass Columns Updated

Group label: `kalibrieren`

| Column Label | Value Written |
|---|---|
| `status` | `"Done"` |
| `type` | Selected type string |
| `file location` | `"Doku/{Cluster}/kalibrieren/{Knotenpunkt}/{filename}"` |

---

## File Upload

- **One PDF per address**
- **Filename**: original filename kept (`useOriginalFilename: true`)
- **Max size**: 200 MB

### Storage Path

```
STORAGE_ROOT/<project>/Doku/<Cluster>/kalibrieren/<Knotenpunkt>/
```

Note: folder is lowercase `kalibrieren` (matching `targetFolder: 'kalibrieren'`).

---

## Status Tracking

| Status | Meaning |
|---|---|
| `""` | Pending |
| `"Done"` | PDF uploaded |

---

## ACL / Permissions

Backend checks `canAccessModule(email, project, 'kalibrieren')`.

---

## Dependencies

- `ModuleNavigator` (module-shared.js)

---

## Key Code Files

- `src/js/kalibrieren.js` — ~45 lines (boots ModuleNavigator)
- `src/js/module-shared.js` — all logic

---

## Differences from Druckprüfung

| | Druckprüfung | Kalibrieren |
|---|---|---|
| `moduleName` | `"Druckprüfung"` | `"Kalibrieren"` |
| `moduleKey` | `"druckprufung"` | `"kalibrieren"` |
| `targetFolder` | `"Druckrufung"` | `"kalibrieren"` |
| `groupLabel` | `"druckprufung"` | `"kalibrieren"` |
| Page | `druckprufung.html` | `kalibrieren.html` |

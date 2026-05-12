# Druckprüfung Module

**File:** `src/js/druckprufung.js`  
**Page:** `druckprufung.html`  
**ACL Key:** `druckprufung`  
**Purpose:** Pressure testing documentation — upload one PDF per address and track status in Aufmass.

---

## Overview

The simplest module in DocPilot. It uses `ModuleNavigator` directly with no customization — standard three-level navigation (Cluster → Knotenpunkt → Address), standard PDF upload form, and automatic Aufmass update on completion.

---

## User Flow

```
Dashboard → druckprufung.html?project=X
    ↓
Cluster grid → Knotenpunkt grid → Address list (Done/Pending badges)
    ↓
Address selected:
    • Pending: shows type dropdown + PDF drop zone
    • Done: shows existing files list + "Edit / Re-upload" button
    ↓
Upload PDF → Aufmass updated → returns to address list
```

---

## UI Components

- **Cluster grid**: cards showing cluster name + knotenpunkt count
- **Knotenpunkt grid**: cards showing knotenpunkt name + address count
- **Address list**: rows with address name, cable name, fiber type, Done/Pending badge
- **Upload form**:
  - Type select: `12x10`, `4x20`, `custom` (custom → free-text input appears)
  - PDF drop zone (drag-and-drop or browse)
  - Upload button (disabled until file selected)
  - Status message after upload
- **Files view** (when Done):
  - List of uploaded files with size and download button
  - "Edit / Re-upload" button

---

## Backend Endpoints Used

| Endpoint | Purpose |
|---|---|
| `GET /api/modules/navigation?project=X&module=druckprufung` | Load navigation tree |
| `POST /api/modules/upload` | Upload PDF |
| `POST /api/modules/aufmass-update` | Update status, type, file location |
| `GET /api/modules/list-files?project=X&path=...` | List existing files (files view) |

---

## Data Model — Aufmass Columns Updated

Group label: `druckprufung`

| Column Label | Value Written |
|---|---|
| `status` | `"Done"` |
| `type` | Selected type string (e.g. `"12x10"`) |
| `file location` | `"Doku/{Cluster}/Druckprufung/{Knotenpunkt}/{filename}"` |

---

## File Upload

- **One PDF per address** (single file upload)
- **Filename**: original filename kept (`useOriginalFilename: true`)
- **Max size**: 200 MB

### Storage Path

```
STORAGE_ROOT/<project>/Doku/<Cluster>/Druckrufung/<Knotenpunkt>/
```

Note: folder is `Druckrufung` (German umlaut dropped), matching `targetFolder: 'Druckrufung'` in the config.

---

## Status Tracking

| Status | Meaning |
|---|---|
| `""` | Pending — no PDF uploaded |
| `"Done"` | PDF uploaded successfully |

---

## ACL / Permissions

- Backend checks `canAccessModule(email, project, 'druckprufung')` on every request
- No role-based redirect on client side

---

## Dependencies

- `ModuleNavigator` (module-shared.js) — all navigation and upload logic

---

## Key Code Files

- `src/js/druckprufung.js` — ~45 lines, just boots ModuleNavigator
- `src/js/module-shared.js` — all actual logic

---

## Notes

This module is intentionally minimal. The `ModuleNavigator` handles everything. If new behavior is needed (e.g., date tracking, appointments), the config can be extended with `extraFields` or `customUploadForm` without touching the shared class.

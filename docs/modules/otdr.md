# OTDR Module

**File:** `src/js/otdr.js`  
**Page:** `otdr.html`  
**ACL Key:** `otdr`  
**Purpose:** OTDR (Optical Time Domain Reflectometer) measurement upload — multi-file (.pdf + .sor), with expected file count validation and prerequisite-gated unlock.

---

## Overview

OTDR is the final step in the per-address workflow. It only becomes available after:
1. **APL status = Done** for that address
2. **Knotenpunkt splicing status = Done** for that Knotenpunkt

When both conditions are met, the server automatically sets the OTDR status column to `"Waiting"`. The address then appears in the OTDR module.

Per address, the expected number of files is:
```
spliceCount × 4  (1 PDF + 3 SOR per splice)
```

If the uploaded count matches → status `"Done"`. If fewer → `"Incomplete"`.

---

## Prerequisites

The OTDR status auto-trigger happens server-side during `POST /api/modules/aufmass-update`:
- When APL status is set to `"Done"` and the Knotenpunkt splicing status is already `"Done"` → OTDR column set to `"Waiting"`
- (And vice versa: when Knotenpunkt status is set to `"Done"` and APL is already `"Done"` → OTDR set to `"Waiting"`)

This is indicated by `otdrAutoTriggered: true` in the update response.

---

## User Flow

```
Dashboard → otdr.html?project=X
    ↓
Cluster grid → Knotenpunkt grid → OTDR address list
    (only shows Waiting / Incomplete / Done addresses)
    ↓
Address selected → OTDR upload form
    ├── If has existing files → "Add More" or "Replace All" mode
    └── If no existing files → fresh upload
    ↓
User selects PDF + SOR files → Upload
    ↓
Aufmass updated (status = Done or Incomplete)
```

---

## OTDR Address List

Custom renderer — only shows addresses where OTDR status is in `["Waiting", "Incomplete", "Done"]`. Addresses with `""` (Pending) are hidden.

Each row shows:
- Address end name, cable name
- OTDR status badge (Waiting / Incomplete / Done / Pending)
- Expected file count: `N exp.` (based on `spliceCount × 4`)

If no OTDR-ready addresses in the Knotenpunkt, shows an empty state with explanation:
> "Addresses appear here after both APL status and Knotenpunkt splicing status are set to 'Done' in the Aufmass."

---

## Upload Form

Fetches existing files on load (`GET /api/modules/list-files`).

### When no existing files
Fresh upload — drop zone accepts `.pdf` and `.sor` files (multiple). Original filenames kept.

### When existing files present
Two modes offered:
- **Add More** — uploads additional files alongside existing ones
- **Replace All** _(admin/superadmin only)_ — deletes existing files, then uploads new set

Shows existing files with type badges (PDF = red, SOR = orange) and sizes.

### File Count Validation
After upload:
- Count uploaded files
- Compare to `spliceCount × 4`
- If count ≥ expected → status `"Done"`
- If count < expected → status `"Incomplete"` with warning: "Uploaded N of M expected files"

### Upload Button
Disabled until at least one file is selected.

---

## File Naming

Files keep their **original names** exactly as uploaded. No renaming.

---

## Storage Path

```
STORAGE_ROOT/<project>/Doku/<Cluster>/OTDR/<Knotenpunkt>/<AddrClean>/
```

`AddrClean` = last segment of address after comma, spaces → `-`, commas removed.  
Example: `"Laichingen, Zeilerweg 11"` → `"Zeilerweg-11"`

---

## Backend Endpoints Used

| Endpoint | Purpose |
|---|---|
| `GET /api/modules/navigation?project=X&module=otdr` | Load navigation tree |
| `GET /api/modules/list-files?project=X&path=...` | Fetch existing files |
| `POST /api/modules/upload` | Upload OTDR files |
| `POST /api/modules/aufmass-update` | Update OTDR status, file location |
| `DELETE /api/files?project=X&path=Y&file=Z` | Delete existing files (Replace All) |

---

## Data Model — Aufmass Columns Updated

Group label: `otdr`

| Column Label | Value Written |
|---|---|
| `status` | `"Waiting"` (auto) → `"Done"` or `"Incomplete"` (after upload) |
| `type` | `"spliceCount×4"` file count description |
| `file location` | `"Doku/{Cluster}/OTDR/{Knotenpunkt}/{AddrClean}"` |

---

## Status Tracking

| Status | Trigger | Meaning |
|---|---|---|
| `""` | Initial | Not yet eligible |
| `"Waiting"` | Auto (server) | Prerequisites met, ready for OTDR |
| `"Incomplete"` | Upload with < expected files | Files uploaded but count doesn't match |
| `"Done"` | Upload with ≥ expected files | Complete |

---

## ACL / Permissions

- Backend checks `canAccessModule(email, project, 'otdr')` on navigation load and upload
- "Replace All" mode additionally requires admin/superadmin role (checked client-side, enforced server-side via `canEditProject`)

---

## Dependencies

- `ModuleNavigator` (module-shared.js) — navigation base
- APL module must have completed (Knotenpunkt APL status = Done)
- Knotenpunkt Vorbereitung (splicing) must have completed (Knotenpunkt Status = Done)

---

## Key Code Files

- `src/js/otdr.js` — full module (~760 lines)
- `src/js/module-shared.js` — navigation base
- `routes/moduleRoutes.js` — OTDR auto-trigger logic in `aufmass-update` handler

# Knotenpunkt Vorbereitung Module

**File:** `src/js/knotenpunkt-vorbereitung.js`  
**Page:** `knotenpunkt-vorbereitung.html`  
**ACL Key:** `knotenpunkt`  
**Purpose:** Two merged workflows in one page: (1) NVT preparation photos for the whole Knotenpunkt, (2) per-address splice image upload. Completing the splicing section unlocks OTDR for those addresses.

---

## Overview

This module handles the physical preparation of Knotenpunkte (distribution nodes):

1. **NVT/Knotenpunkt Preparation** — multiple overview photos of the NVT preparation work, uploaded at the Knotenpunkt level (no address selection needed).
2. **Splicing** — per-address splice photos, tracked in `knotenpunkt status` column. When this is set to Done, combined with APL Done, the OTDR module unlocks for that address.

Both sections live on the same page. The user picks which to do from a tab/mode selector.

---

## User Flow

### Knotenpunkt Vorbereitung (NVT Prep)
```
Cluster → Knotenpunkt (skipAddressStep: true)
    ↓
KV form (no address list):
    - Multi-image drop zone
    - Upload → saves to NVT prep folder
    - Aufmass: (no status column update for KV — files only)
```

### Splicing
```
Cluster → Knotenpunkt → Address list
    ↓
Address selected:
    - Upload splice image
    - Aufmass: knotenpunkt status → Done, knotenpunkt image location → path
```

---

## UI Components

- **Mode tabs**: Switch between "Knotenpunkt Vorbereitung" and "Splicing" modes
- **KV section** (when NVT prep mode):
  - Knotenpunkt name header
  - Multi-image drop zone (JPG/PNG, multiple files at once)
  - Existing files list with thumbnails
  - Upload button
- **Splicing section** (when splicing mode):
  - Address list with Done/Pending badges
  - Per-address form with single image upload
  - Splice count display (from Aufmass)

---

## File Naming

### NVT Preparation images
Original filenames kept (no rename).

### Splice images
```
{Knotenpunkt}_{AddrClean}_Splices_{YYYYMMDD_HHmmss}.{ext}
```

Example:
```
NVT-001_Zeilerweg-11_Splices_20260413_151200.jpg
```

`AddrClean`: last segment after comma, spaces → `-`, commas removed.

---

## Storage Paths

### NVT Preparation
```
STORAGE_ROOT/<project>/Doku/<Cluster>/Knotenpunkt_Vorbereitung/<Knotenpunkt>/
```

### Splicing images
```
STORAGE_ROOT/<project>/Doku/<Cluster>/Knotenpunkt_Vorbereitung/<Knotenpunkt>/
```
(same folder, distinguished by naming convention: `_Splices_` in filename)

Note per spec: "No address subfolder — saves in Knotenpunkt_Vorbereitung/[Knotenpunkt]/"

---

## Backend Endpoints Used

| Endpoint | Purpose |
|---|---|
| `GET /api/modules/navigation?project=X&module=knotenpunkt` | Load navigation tree |
| `POST /api/modules/upload` | Upload NVT prep or splice images |
| `POST /api/modules/aufmass-update` | Update `knotenpunkt status` + `knotenpunkt image location` |
| `GET /api/modules/list-files?project=X&path=...` | List existing images |

---

## Data Model — Aufmass Columns Updated

For **splicing** (per address), group label `splicing`:

| Column Label | Value Written |
|---|---|
| `knotenpunkt status` | `"Done"` |
| `knotenpunkt image location` | `"Doku/{Cluster}/Knotenpunkt_Vorbereitung/{Knotenpunkt}/{filename}"` |

For **NVT preparation** (per knotenpunkt):
- No status column update — files are stored, but no Aufmass field is set for KV images per se.

---

## Status Tracking

Splicing column `knotenpunkt status`:

| Status | Meaning |
|---|---|
| `""` | Pending |
| `"Done"` | Splice image uploaded |

**OTDR trigger:** When `knotenpunkt status = Done` AND `apl status = Done` for the same address → server sets OTDR status to `"Waiting"`.

---

## ACL / Permissions

- Module key `knotenpunkt` checked on navigation and upload
- No client-side role redirect

---

## Dependencies

- `ModuleNavigator` (module-shared.js) — navigation base
- APL module completion triggers OTDR in combination with this module's splicing status

---

## Key Code Files

- `src/js/knotenpunkt-vorbereitung.js` — full module
- `src/js/module-shared.js` — navigation base

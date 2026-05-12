# APL Module

**File:** `src/js/apl.js`  
**Page:** `apl.html`  
**ACL Key:** `apl`  
**Purpose:** APL (Abschlussprotokoll / closure protocol) — records 4 required geo-stamped photos, splice count, and appointment per address. Gateway to OTDR (once APL is Done + Knotenpunkt splicing is Done, OTDR unlocks).

---

## Overview

The APL module captures 4 mandatory images of the APL closure work:
1. **Metrierung** — measurement reading
2. **APL_Box** — the APL box exterior
3. **Splices** — splices overview
4. **Inside_APL** — interior of the APL

Each image can be taken with the GeoCam overlay (GPS + address stamp) or uploaded from the device. Files from the device get a `_U` suffix in their name. A splice count must be confirmed or entered before upload.

---

## User Flow

```
Dashboard → apl.html?project=X
    ↓
ModuleNavigator: Cluster grid → Knotenpunkt grid → Address list
    ↓
Choice screen per address:
    ├── [📅 Mark/Edit Appointment]
    └── [📷 Upload Work] → APL upload form
            ↓
    Upload form:
        1. Date + Time
        2. Splice count (confirm from Aufmass or enter/update)
        3. 4 required image zones (GeoCam or file picker each)
        4. Optional extra images
        5. [Upload All]
```

---

## Choice Screen

Displays:
- Address header (Knotenpunkt / Address, cable, fiber count)
- Status badge (Done / Pending / Error)
- Error details (APL: entries, active vs fixed)
- **Eigentümerdaten card** (customer contact info from Aufmass):
  - Names: multiple owners split on "o.", "und", ","
  - Phones: clickable `tel:` links, split on " o. "
  - Emails: clickable `mailto:` links, split on ";", "|", " o. "
- Done date/time card (if Done and date/time saved)
- Appointment info card
- Two action buttons: appointment + upload
- [⚠ Report Error] / [✓ Clear Error] buttons

If Done or Error, existing files injected below (with per-file delete buttons).

---

## Upload Form

### Date & Time
Default to current date/time. Saved to `timing / date` and `timing / time` columns.

### Splice Count
Three states:
1. **Existing in Aufmass**: shows value with [✓ Confirm] and [✎ Update] buttons
   - Confirm → `spliceCountFinal` = Aufmass value, `spliceWasUpdated = false`
   - Update → shows warning + input → Save → `spliceCountFinal` = new value, `spliceWasUpdated = true`
2. **No existing value**: manual input required, always `spliceWasUpdated = true`
3. Upload button disabled until splice count is confirmed/entered AND all 4 images selected

### 4 Required Image Zones

```js
IMAGE_TYPES = [
    { id: 'Metrierung', label: 'Metrierung Image',  icon: '📏' },
    { id: 'APL_Box',    label: 'APL Box Image',      icon: '📦' },
    { id: 'Splices',    label: 'Splices Image',       icon: '🔗' },
    { id: 'Inside_APL', label: 'Inside APL Image',   icon: '🔍' },
]
```

Each zone has:
- **📷 Take Photo** → opens `window.GeoCam.capture({ userText: imageLabel })` fullscreen overlay
- **📁 Upload** → file picker (JPG/PNG)
- Drag-and-drop support (counted as upload source)
- Preview thumbnail after selection
- ✕ clear button

Source tracking:
- `'camera'` = taken with GeoCam → no `_U` suffix
- `'upload'` = file picker / drag-drop → `_U` suffix in filename

### Extra Images
Optional additional images (JPG/PNG), any count. Appended to the upload batch with original filenames.

---

## File Naming Convention

### Required 4 images
```
{Knotenpunkt}_{AddrClean}_{ImageType}_{YYYYMMDD_HHmmss}[_U].{ext}
```

- `AddrClean`: last part of address after comma, spaces → `-`, commas removed
  - e.g. `"Laichingen, Zeilerweg 11"` → `"Zeilerweg-11"`
- `_U` suffix added if source = `'upload'` (device file, not geo-stamped)
- `YYYYMMDD_HHmmss` = timestamp when Upload All is clicked

Examples:
```
NVT-001_Zeilerweg-11_Metrierung_20260413_143022.jpg       (GeoCam)
NVT-001_Zeilerweg-11_APL_Box_20260413_143022_U.jpg         (from device)
NVT-001_Zeilerweg-11_Splices_20260413_143022.jpg
NVT-001_Zeilerweg-11_Inside_APL_20260413_143022.jpg
```

### Extra images
Kept with original filename as uploaded.

---

## Storage Path

```
STORAGE_ROOT/<project>/Doku/<Cluster>/APL/<Knotenpunkt>/<AddrClean>/
```

Example:
```
/storage/Projekt-A/Doku/Cluster-1/APL/NVT-001/Zeilerweg-11/
```

---

## Backend Endpoints Used

| Endpoint | Purpose |
|---|---|
| `GET /api/modules/navigation?project=X&module=apl` | Load clusters/addresses |
| `POST /api/modules/upload` | Upload each image file |
| `POST /api/modules/aufmass-update` | Update status, splices, date/time, folder location |
| `GET /api/modules/list-files?project=X&path=...` | List existing images |
| `GET /api/modules/appointments?project=X` | Conflict check |
| `DELETE /api/files?project=X&path=Y&file=Z` | Delete file (move to trash) |

---

## Data Model — Aufmass Columns Updated

After successful upload, these columns are written:

| Group | Column Label | Value Written |
|---|---|---|
| `splicing` | `apl status` | `"Done"` |
| `splicing` | `number of splices` | `"N"` (from confirmed/entered count) |
| `splicing` | `apl folder location` | `"Doku/{Cluster}/APL/{Knotenpunkt}/{AddrClean}"` |
| `timing` | `date` | `"YYYY-MM-DD"` (from form) |
| `timing` | `time` | `"HH:MM"` (from form) |
| `splicing` | `apl-termin` | JSON: `{"date":"...","time":"...","notes":"..."}` |
| `notes` | `error-reporting` | `"APL:errorText;"` entries (errors) |

If splice count was updated (changed from Aufmass value), it's also logged with `note: 'Splice count updated from N to M'`.

---

## Status Tracking

| Status | Meaning |
|---|---|
| `""` | Pending — no work done |
| `"Done"` | All 4 images uploaded, splice count confirmed |
| `"Error"` | Error reported by technician |

Status resets to `""` when all files deleted (also clears APL: error entries).

**OTDR trigger:** Server auto-sets OTDR status → `"Waiting"` when both `apl status = Done` AND `knotenpunkt status = Done` (via `otdrAutoTriggered` logic in `aufmass-update`).

---

## Error Reporting

Uses `APL:` prefix in the `error-reporting` column:
- **Report Error** → appends `APL:{text};` → status = `Error`
- **Clear Error** → appends `#` to last unfixed `APL:` entry
- All `APL:` errors fixed → status clears

---

## Appointments (Termin)

- Column label: `apl-termin` (in `splicing` group)
- Module key: `'apl'`
- Conflict detection: ±40 minutes, same date, same `apl` module
- When appointment is scheduled and status is Done, appointment button is disabled

---

## ACL / Permissions

- Module key `apl` checked on backend for every navigation/upload call
- No client-side role redirect

---

## Dependencies

- `ModuleNavigator` (module-shared.js) — navigation base
- `AppointmentHelper` (appointment-shared.js) — termin form + conflict check
- `window.GeoCam` (geocam.js) — camera overlay for photo capture
- `ModuleNavigator._downloadFile` — file downloads

---

## Key Code Files

- `src/js/apl.js` — full module (~980 lines)
- `src/js/geocam.js` — GeoCam capture overlay
- `src/js/appointment-shared.js` — appointment helpers
- `src/js/module-shared.js` — navigation base

---

## Recent Changes (2026-04-13 to 2026-04-14)

- **Eigentümerdaten card**: customer name/phone/email rendered with tel:/mailto: links
- **Error reporting**: APL: error system, report/clear/fix flow
- **File delete in choice screen**: delete buttons injected with auto-status-reset
- **Done date/time display**: date and time shown in a separate card on choice screen when Done

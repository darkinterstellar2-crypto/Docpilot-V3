# Einblasen Module

**File:** `src/js/einblasen.js`  
**Page:** `einblasen.html`  
**ACL Key:** `einblasen`  
**Purpose:** Cable blowing (Einblasen) documentation — appointment scheduling, manual PDF upload, and an optional Einblasprotokoll PDF generator.

---

## Overview

The Einblasen module lets field technicians document cable blowing work. For each address they can:
1. Schedule/view an appointment (Termin)
2. Upload work evidence (any file, keeps original name)
3. **Or** generate a formal Einblasprotokoll PDF using an embedded generator (code-gated)

After upload, the Aufmass is updated with status, metrierung total, file location, and the work date.

---

## User Flow

```
Dashboard → einblasen.html?project=X
    ↓
ModuleNavigator: Cluster grid → Knotenpunkt grid → Address list
    ↓
Choice screen per address:
    ├── [📅 Mark/Edit Appointment] → appointment form
    └── [📷 Upload Work] → upload + generator page
            ↓
    Upload page has two sections:
        A. Standard upload area (any file, original filename)
        B. Einblasprotokoll generator (hidden unless user has generator access)
```

### Address List

The address list is custom (not the default `ModuleNavigator.renderAddresses`). It includes:
- Search box (by address, cable name, row ID)
- Date filter (by `einblasen-date` column)
- Status filter (All / Done / Pending / Error)
- Termin badge (upcoming green, overdue red) per address
- Done date displayed in green below the badge

Addresses sorted by termin (upcoming first, then overdue, then no termin).

---

## Choice Screen

Shown after selecting an address. Displays:
- Knotenpunkt / Address header
- Cable name + fiber count
- Status badge (Done / Pending / Error)
- Error detail block (if status = Error): lists active EB: entries and fixed entries
- Termin info card (if appointment set)
- Two action buttons: [📅 Appointment] + [📷 Upload Work]
- [⚠ Report Error] button (always visible)
- [✓ Clear Error] button (only when status = Error)

If Done or Error, existing files are injected below the card (with delete buttons).

---

## Upload + Generator Page

### Standard Upload Section

Uses `ModuleNavigator.renderUploadFormInto()` with the status temporarily cleared to force the upload form (not the files view). Accepts any file type, keeps original filename.

When uploaded via standard upload:
- File saved to `{Cluster}/Einblasen/{Knotenpunkt}/`
- Aufmass updated:
  - `status einblasen` → `Done`
  - `einblasen-date` → date from form field (`YYYY-MM-DD, HH:MM`)
  - `metrierung total` → calculated from Start/End meters
  - `lwl specs / total` → same metrierung value (cross-group copy)
  - `file location` → `Doku/{Cluster}/Einblasen/{Knotenpunkt}/{filename}`

### Generator Section

Hidden unless user's account has generator access (`GET /api/settings/generator-access` returns `hasAccess: true`).

**Code verification:** User enters a code → `POST /api/settings/verify-code`. On success, shows the details form + iframe.

**Generator form fields:**
| Field | Description |
|---|---|
| Date / Time | Work date and time |
| Start Meter | Cable start position (m) |
| End Meter | Cable end position (m) |
| Metrierung Total | Auto-calculated (End - Start), shown readonly |
| Fiber Colour | e.g. "Blue, Red" |
| **Advanced** | |
| Einbläser (Operator) | Technician name |
| Ort (GPS) | Coordinates (auto-populated from project-info if available) |
| Bemerkungen | Optional remarks |
| Rohr-Hersteller | Default: Hexatronic |
| Rohrverband | Default: SNRVe 12x10x2.0 |
| Rohr Dim | Default: SNR 10x2.0 |
| Kabel-Hersteller | Default: Faber |
| Einblasgerät | Default: Fremco MicroFlow LOG |
| Controller S/N | Default: 9328.4720 |
| Kompressor | Default: M17 |
| Gleitmittel | Default: Micro Jetting Lube MJL |

**Action buttons:**
- ⚡ **Generate** — sends `postMessage({ type: 'einblas-command', action: 'generate' })` to iframe + pushes all form values
- 📄 **Export PDF** — sends `action: 'export'` to iframe (enabled after generation)
- ✓ **Approve & Send** — sends `action: 'approve'` to iframe; receives approved PDF blob back

**PostMessage protocol (parent → iframe):**
```js
// Push form values:
{ type: 'einblas-details-update', startMeter, endMeter, date, time, color, operator, gps, ... }

// Commands:
{ type: 'einblas-command', action: 'generate' | 'export' | 'approve' }
```

**PostMessage protocol (iframe → parent):**
```js
{ type: 'einblas-generated', logCount: N, einblaszeit: '...' }  // generation OK → enables buttons
{ type: 'einblas-generate-error', error: '...' }                 // generation failed
{ type: 'einblas-approved', pdfBlob: base64, startMeter, endMeter }  // approved PDF ready
```

**On approval:** Parent receives the blob, uploads it via `POST /api/modules/upload` with the generated filename, then updates Aufmass columns.

---

## File Naming

### Standard upload (original filename kept)
Files uploaded manually keep their original name exactly as uploaded.

### Generator-produced PDF
```
{Cluster}_{YYYYMMDD}_{HHMMSS}_{AddrStart}_bis_{AddrEnd}.pdf
```
Example: `Cluster-A_20260413_143022_Hauptstr-5_bis_Bahnhofstr-12.pdf`

Address segments: spaces → `-`, commas → removed.

---

## Storage Path

```
STORAGE_ROOT/<project>/Doku/<Cluster>/Einblasen/<Knotenpunkt>/
```

---

## Backend Endpoints Used

| Endpoint | Purpose |
|---|---|
| `GET /api/modules/navigation?project=X&module=einblasen` | Load clusters/addresses |
| `POST /api/modules/upload` | Upload file to Einblasen folder |
| `POST /api/modules/aufmass-update` | Update status, date, metrierung, file location |
| `GET /api/modules/list-files?project=X&path=...` | List existing files |
| `GET /api/modules/appointments?project=X` | Check for scheduling conflicts |
| `GET /api/settings/generator-access` | Check if user can see generator |
| `POST /api/settings/verify-code` | Validate generator code |
| `GET /api/project-info?project=X` | Fetch GPS coordinates for form pre-fill |

---

## Data Model — Aufmass Columns Updated

All in group label `einblasen`:

| Column Label | Column ID Pattern | Value Written |
|---|---|---|
| `status einblasen` | `col-{g}-{c}` | `"Done"` or `"Error"` |
| `metrierung total` | `col-{g}-{c}` | `"<meters>"` (string, e.g. `"3970"`) |
| `file location` | `col-{g}-{c}` | `"Doku/{Cluster}/Einblasen/{Knotenpunkt}/{filename}"` |
| `einblasen-date` | `col-{g}-{c}` | `"YYYY-MM-DD, HH:MM"` |
| `einblasen-termin` | `col-{g}-{c}` | JSON: `{"date":"YYYY-MM-DD","time":"HH:MM","notes":"..."}` |

Also in group `lwl specs`:
- `total` → same metrierung value (cross-copy from extraFields `alsoCopyTo`)

Also in group `notes`:
- `error-reporting` → `"EB:errorText;"` entries appended (active), `"EB:errorText#;"` for fixed

---

## Status Tracking

| Status | Meaning |
|---|---|
| `""` (empty) | Pending — no work done yet |
| `"Done"` | Upload complete, metrierung recorded |
| `"Error"` | Error reported by technician |

Status resets to `""` when all files are deleted from the folder (with auto-clear of `EB:` entries).

---

## Error Reporting

The Einblasen module uses `EB:` prefixed entries in the shared `error-reporting` column:

- **Report Error:** prompts for text → appends `EB:{text};` → sets status `Error`
- **Clear Error:** finds last unfixed `EB:` entry → appends `#` to mark fixed
  - If all EB errors are fixed → clears Error status
- Fixed entries shown in green in the choice screen

---

## Appointments (Termin)

Uses `AppointmentHelper` from `appointment-shared.js`.
- Column: `einblasen-termin` (in `einblasen` group)
- Conflict check: ±40 minutes across all `einblasen` appointments on same date
- Module key passed to conflict check: `'einblasen'`

---

## ACL / Permissions

- Backend checks `canAccessModule(email, project, 'einblasen')` on navigation load and upload
- No client-side role redirect — access is fully server-enforced
- Generator section additionally requires `generator-access` flag per user account

---

## Dependencies

- `ModuleNavigator` (module-shared.js) — navigation + upload base
- `AppointmentHelper` (appointment-shared.js) — appointment form + conflict check
- `ModuleNavigator._downloadFile` — file download via authenticated fetch

---

## Key Code Files

- `src/js/einblasen.js` — full module logic (~600 lines)
- `src/js/module-shared.js` — ModuleNavigator base class
- `src/js/appointment-shared.js` — appointment helpers

---

## Recent Changes (2026-04-13 to 2026-04-14)

- **Generator section** fully built: code gate, iframe integration, postMessage protocol, approve & upload
- **Date tracking**: `einblasen-date` populated from form date/time on both manual upload and generator approval
- **Metrierung auto-calc**: calculated from Start/End meter fields, written to both `metrierung total` and `lwl specs / total`
- **Error reporting**: `EB:` system added — report, display, clear/fix flow
- **Address list**: search, date filter, and status filter added; done date shown in address rows
- **File delete in choice screen**: delete buttons on injected file list; auto-reset to Pending when last file deleted

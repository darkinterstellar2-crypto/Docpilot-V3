# DocPilot Modules — Overview

This directory contains module-by-module documentation for the DocPilot field-data management system.

---

## What Is DocPilot?

DocPilot is a Node.js/Express web application for managing telecom field work documentation. Field technicians navigate to their assigned project, then drill down **Project → Cluster → Knotenpunkt → Address** to upload measurement results, photos, and PDFs. Status flags in the Aufmass (measurement data file) track what's done.

---

## Module List

| Module | HTML Page | ACL Key | Purpose |
|---|---|---|---|
| [Druckprüfung](druckprufung.md) | `druckprufung.html` | `druckprufung` | Pressure test PDF upload |
| [Einblasen](einblasen.md) | `einblasen.html` | `einblasen` | Cable blowing — PDF upload + protocol generator |
| [Kalibrieren](kalibrieren.md) | `kalibrieren.html` | `kalibrieren` | Calibration PDF upload |
| [APL](apl.md) | `apl.html` | `apl` | 4-photo upload + appointment scheduling for APL closure |
| [Knotenpunkt Vorbereitung + Splicing](knotenpunkt-vorbereitung.md) | `knotenpunkt-vorbereitung.html` | `knotenpunkt` | NVT prep images + per-address splice photos |
| [OTDR](otdr.md) | `otdr.html` | `otdr` | Multi-file OTDR upload (.pdf + .sor), unlocks after APL + Splicing |
| [Planner](planner.md) | `planner.html` | `planner` | Day-view appointment planner across all modules |
| [Files](files.md) | `files.html` | `files` | General file manager — CRUD, trash, shares, NAS sync |
| [GeoCam](geocam.md) | _(overlay, no page)_ | — | In-browser camera with GPS/address overlay |
| [Appointments](appointments.md) | _(shared logic)_ | — | Shared appointment scheduling system |
| [Idle Logout](idle-logout.md) | _(included on all pages)_ | — | Inactivity auto-logout |

---

## Shared Infrastructure

### Navigation Pattern

All field-work modules (Druckprüfung, Einblasen, Kalibrieren, APL, OTDR) share the same three-level navigation driven by `ModuleNavigator` (see [module-shared.md](module-shared.md)):

```
Clusters grid
  └── Knotenpunkte grid
        └── Address list (with status badges)
              └── Upload form / custom module form
```

### Aufmass Data File

Each project has a single `.txt` data file at:
```
STORAGE_ROOT/<project>/Doku/Aufmass/datafile/<project>.txt
```

Format: `[E1, [[subHeaders], ...rows]]`  
- `E1` = array of group labels (e.g. `["Splicing", "Einblasen", "LWL Specs", ...]`)
- `E2[0]` = array of per-group sub-column arrays
- `E2[1..n]` = data rows

Column IDs are computed as `col-{groupIndex}-{colIndex}` and resolved at runtime via `findColumnId(groupLabel, colLabel)`.

### Key Column Groups (referenced across modules)

| Group Label | Key Columns |
|---|---|
| `splicing` | `apl status`, `knotenpunkt status`, `number of splices`, `apl folder location`, `knotenpunkt image location` |
| `einblasen` | `status einblasen`, `metrierung total`, `file location`, `einblasen-date`, `einblasen-termin` |
| `druckprufung` | `status`, `type`, `file location` |
| `kalibrieren` | `status`, `type`, `file location` |
| `otdr` | `status`, `type`, `file location` |
| `timing` | `date`, `time` |
| `eigentümer` | `name`, `phone`, `email` |
| `notes` | `error-reporting` |
| `lwl specs` | `total` |

### File Storage

Module files land in:
```
STORAGE_ROOT/<project>/Doku/<Cluster>/<ModuleFolder>/<Knotenpunkt>/[<AddrClean>/]
```

The `Doku/` prefix is applied by the upload route. Module-specific paths:

| Module | Folder |
|---|---|
| Druckprüfung | `<Cluster>/Druckprufung/<Knotenpunkt>/` |
| Einblasen | `<Cluster>/Einblasen/<Knotenpunkt>/` |
| Kalibrieren | `<Cluster>/kalibrieren/<Knotenpunkt>/` |
| APL | `<Cluster>/APL/<Knotenpunkt>/<AddrClean>/` |
| Knotenpunkt Vorbereitung | `<Cluster>/Knotenpunkt_Vorbereitung/<Knotenpunkt>/` |
| OTDR | `<Cluster>/OTDR/<Knotenpunkt>/<AddrClean>/` |

### Backend API (module endpoints)

All mounted under `/api/modules/`:

| Endpoint | Method | Purpose |
|---|---|---|
| `/navigation` | GET | Returns cluster → knotenpunkt → address tree + schema |
| `/upload` | POST | Uploads files to `Doku/<targetPath>/` |
| `/aufmass-update` | POST | Updates columns in the data file |
| `/aufmass-row` | GET | Fetches a single row's data |
| `/list-files` | GET | Lists files in a `Doku/<path>` directory |
| `/appointments` | GET | Returns all termin appointments across all rows |
| `/backfill-einblasen-dates` | POST | Superadmin: backfill Einblasen date columns from filenames |

### NAS Sync

Every file upload fires a background `syncFile(relPath)` to push to the NAS. File listings merge local + NAS results. On-demand NAS fetch runs before downloads if file is missing locally.

### ACL

Each module has a key (e.g. `einblasen`) that must be present in `access-control.json` for the user to access it. The backend checks:
1. `canAccessProject(email, project)` — project-level access
2. `canAccessModule(email, project, moduleKey)` — module-level access
3. `canEditProject(email, project)` — write operations

Superadmin bypasses all checks.

---

## Module Dependencies

```
GeoCam (geocam.js)
    └── APL (apl.js) — uses GeoCam.capture() for 4 images

AppointmentHelper (appointment-shared.js)
    └── APL — apl-termin column
    └── Einblasen — einblasen-termin column
    └── (any future module with a -termin column)

OTDR (otdr.js)
    └── APL must be Done
    └── Knotenpunkt splicing must be Done
    (server auto-sets OTDR status → "Waiting" when both prerequisites complete)

Planner (planner.js)
    └── Reads all termin columns via /api/modules/appointments

idle-logout.js
    └── Included on all 15 authenticated pages (14 + superlog.html)
force-logout.js
    └── Included on 14 authenticated pages (excludes superlog.html)
```

---

## Recent Changes (2026-04-13 to 2026-04-14)

- **Einblasen generator**: Full Einblasprotokoll generator with code-gated iframe, live data push via `postMessage`, approve & auto-upload flow
- **Einblasen date tracking**: `einblasen-date` column now auto-populated from form or filename; address list shows done date
- **Error reporting system**: `EB:`, `APL:` prefixed entries in error-reporting column; clear/fix flow with `#` suffix
- **APL Eigentümerdaten**: Customer name/phone/email rendered with clickable `tel:` and `mailto:` links
- **Planner page**: New `planner.html` with day timeline, conflict detection, module filter, week bar navigation
- **File delete from module views**: Delete buttons in injected file sections (APL, Einblasen) with auto-status-reset when last file deleted
- **Address list enhancements** (Einblasen): search, date filter, status filter with live re-render

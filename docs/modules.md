# Work Modules

DocPilot tracks fiber optic construction through specialized work modules. Each module represents a phase of the installation process. All modules share the same navigation pattern (cluster → Knotenpunkt → address) and use a common `ModuleNavigator` class (`src/js/module-shared.js`).

## Shared Module Architecture

### Navigation Tree

Every module page loads a navigation tree via `GET /api/modules/navigation?project=X&module=Y`. The tree is built from the Aufmass data file:

```
Cluster (e.g., "SUPPN")
  └── Knotenpunkt (e.g., "NVT-001")
       └── Address (e.g., "Zeilerweg 11" → "Am Mühlbach 2")
```

Each address shows:
- Address range (start → end)
- Current status badge (Pending / Done / Waiting / Incomplete)
- Cable name, fiber type, splice count (where applicable)

### ModuleNavigator Class

**File:** `src/js/module-shared.js` (1016 lines)

The `ModuleNavigator` class provides:
- Three-level navigation (cluster → Knotenpunkt → address list)
- Status badge rendering with colors
- File upload with custom naming and GeoCam integration
- Aufmass row updates via `POST /api/modules/aufmass-update`
- Existing file listing via `GET /api/modules/list-files`
- Optimistic locking (sends `rowVersion` with updates)
- Appointment/termin scheduling UI
- Extra form fields (configurable per module via `extraFields`)

### Module Folder Structure

Each module stores uploaded files in the project's `storage/` directory:

```
storage/<Project>/Doku/<Cluster>/<ModuleFolder>/<Knotenpunkt>/<files>
```

Module folder names:
| Module | Folder Name |
|--------|------------|
| Einblasen | `Einblasen/BB` and `Einblasen/HA` |
| Druckprüfung | `Druckprufung` |
| Kalibrieren | `kalibrieren` |
| APL/Splicing | `APL` |
| OTDR | `OTDR` |
| Knotenpunkt-Vorbereitung | `Knotenpunkt_Vorbereitung` |

## Individual Modules

### 1. Aufmass (Measurement Table)

**Page:** `aufmass.html` | **JS:** `src/js/table.js` (1340 lines)

The master data table. All other modules read from and write to this table. Features:
- Dynamic column groups with sub-headers
- Edit mode toggle (view vs. edit)
- Cell-level editing with change tracking
- Row add/delete
- Search/filter
- Excel export
- Optimistic locking (row versions)
- OTDR auto-trigger (when APL Status + Knotenpunkt Status = "Done", OTDR Status auto-sets to "Waiting")
- Cell-level diff logging (every change is logged with old → new values)

### 2. Einblasen (Fiber Blowing)

**Page:** `einblasen.html` | **JS:** `src/js/einblasen.js` (898 lines)

Tracks fiber cable blowing operations. Key features:
- Two sub-types: BB (Backbone) and HA (House Connection)
- Status tracking per address
- File upload with GeoCam integration
- Extra fields: "Metrierung total" (total metering), with `alsoCopyTo` for cross-group column updates
- Einblasen date backfilling from filenames (`POST /api/modules/backfill-einblasen-dates`)
- Status column: `Einblasen Status`
- Target path: `<Cluster>/Einblasen/<type>/<Knotenpunkt>/`

### 3. Druckprüfung (Pressure Testing)

**Page:** `druckprufung.html` | **JS:** `src/js/druckprufung.js` (42 lines)

Minimal module JS — delegates everything to `ModuleNavigator`:

```javascript
document.addEventListener('DOMContentLoaded', () => {
    new ModuleNavigator({
        moduleKey: 'druckprufung',
        statusLabel: 'Druckprüfung Status',
        typeLabel: 'Druckprüfung Type',
        folderLabel: 'Druckprüfung File Location',
        targetFolder: 'Druckprufung',
    });
});
```

### 4. Kalibrieren (Calibration)

**Page:** `kalibrieren.html` | **JS:** `src/js/kalibrieren.js` (41 lines)

Same pattern as Druckprüfung — thin wrapper around `ModuleNavigator`.

### 5. APL / Splicing

**Page:** `apl.html` | **JS:** `src/js/apl.js` (1153 lines)

The most complex module. Tracks splice point installations. Features:
- Custom address-level detail view with splice counts
- Multi-file upload with folder-level organization
- Status: `APL Status`
- Splice count tracking
- Folder location references

### 6. OTDR Testing

**Page:** `otdr.html` | **JS:** `src/js/otdr.js` (762 lines)

Optical Time-Domain Reflectometer test results. Features:
- Auto-triggered when APL + Knotenpunkt statuses are both "Done"
- Status transitions: Waiting → Incomplete → Done
- "Replace All" option to clear and re-upload test files (superadmin only via `DELETE /api/modules/clear-files`)
- File upload for test result documents

### 7. Knotenpunkt-Vorbereitung (Junction Prep)

**Page:** `knotenpunkt-vorbereitung.html` | **JS:** `src/js/knotenpunkt-vorbereitung.js` (714 lines)

Tracks preparation of network junction points. Features:
- Checklist-style status for each Knotenpunkt
- Photo/document upload for site readiness
- Status: `Knotenpunkt Status`
- Target folder: `Knotenpunkt_Vorbereitung`

## Status Values

All module status columns use these standard values:

| Status | Badge Color | Description |
|--------|------------|-------------|
| *(empty)* | Gray | Not started |
| `Pending` | Yellow | Scheduled / waiting |
| `Waiting` | Blue | Waiting for dependency (e.g., OTDR waiting for APL) |
| `Incomplete` | Orange | Started but not finished |
| `Done` | Green | Completed |

## OTDR Auto-Trigger

When saving Aufmass data, the system checks every row:

```
IF apl_status === "Done" AND knotenpunkt_status === "Done"
   AND otdr_status NOT IN ("Done", "Waiting", "Incomplete")
THEN set otdr_status = "Waiting"
```

This logic runs in both `dataRoutes.js` (full table save) and `moduleRoutes.js` (single-row update).

## GeoCam Integration

**File:** `src/js/geocam.js` (1641 lines)

GeoCam provides camera + GPS overlay for field documentation. When uploading through a module:
1. Opens camera with GPS coordinates overlay
2. Captures photo with embedded location data
3. Reverse-geocodes location via `/api/geocode`
4. Auto-names file with address + timestamp
5. Uploads to the correct module folder

## Appointment System

**File:** `src/js/appointment-shared.js` (422 lines)

Each module can schedule appointments (Termine) per address. Appointments are stored as JSON in "Termin" columns in the Aufmass data:

```json
{
  "date": "2026-06-15",
  "time": "09:00",
  "notes": "Crew B, bring spare cables"
}
```

The planner page and calendar aggregate all appointments across modules via `GET /api/modules/appointments/all`.

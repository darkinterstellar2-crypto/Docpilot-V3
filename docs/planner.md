# Planner & Calendar

**Page:** `planner.html` | **JS:** `src/js/planner.js` (480 lines)

## Overview

The planner aggregates all appointments (Termine) across all modules and projects into a calendar-style view.

## Data Source

Appointments are stored as JSON strings in "Termin" columns within the Aufmass data file. Each module can have its own termin column (e.g., "Einblasen Termin", "Druckprüfung Termin").

Appointment format:
```json
{
  "date": "2026-06-15",
  "time": "09:00",
  "notes": "Crew B, bring extra cables"
}
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/modules/appointments?project=X` | All appointments for one project |
| GET | `/api/modules/appointments/all` | All appointments across ALL accessible projects |

Response format:
```json
{
  "success": true,
  "appointments": [
    {
      "rowId": "ROW-7",
      "project": "MyProject",
      "module": "einblasen",
      "date": "2026-06-15",
      "time": "09:00",
      "notes": "Crew B",
      "cluster": "SUPPN",
      "knotenpunkt": "NVT-001",
      "addressStart": "Zeilerweg 11",
      "addressEnd": "Am Mühlbach 2",
      "terminColId": "col-5-3"
    }
  ]
}
```

## Module Mapping

The appointment API maps Aufmass group names to module keys:
- `einblasen` ← groups containing "einblasen"
- `apl` ← groups containing "splicing" or "apl"
- `druckprufung` ← groups containing "druckpr"
- `kalibrieren` ← groups containing "kalibrieren"
- `otdr` ← groups containing "otdr"

## Setting Appointments

Appointments are set through the module pages (not the planner). Each module's address view includes "Mark Appointment" / "Edit Appointment" buttons (via `appointment-shared.js`).

Setting an appointment:
1. User picks date, time, and optional notes
2. JSON is written to the termin column via `POST /api/modules/aufmass-update`
3. Appointment appears on the planner page

## calendar.html

> **Note:** `calendar.html` exists in the codebase but is a **design placeholder only** — it has no JavaScript logic. The functional calendar is `planner.html`.

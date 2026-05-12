# Appointment System

**File:** `src/js/appointment-shared.js`  
**Purpose:** Shared appointment (Termin) helpers used by any module that supports scheduling. Provides form rendering, conflict detection, modal UI, and address sorting.

---

## Overview

`window.AppointmentHelper` is a global singleton object included on every module page that supports appointment scheduling (currently: Einblasen, APL). It provides all appointment-related UI logic so each module doesn't need to re-implement it.

Appointments are stored as JSON in a dedicated Termin column per module in the Aufmass data file.

---

## Data Format

Appointments are stored as JSON strings in the Aufmass Termin column:

```json
{
  "date": "2026-04-15",
  "time": "09:00",
  "notes": "Morning shift, notify owner"
}
```

- `date`: `YYYY-MM-DD` format
- `time`: `HH:MM` format (24h)
- `notes`: optional free text

---

## API Methods

### `parseTermin(val)`
Parses a raw column value (JSON string) into a termin object. Returns `null` if empty or invalid JSON.

```js
const termin = AH.parseTermin(address.data[terminColId]);
// → { date, time, notes } or null
```

### `formatTermin(termin)`
Formats a termin object for display.

```js
AH.formatTermin({ date: '2026-04-15', time: '09:00' });
// → "15.04.2026, 09:00"
AH.formatTermin({ date: '2026-04-15' });
// → "15.04.2026"
```

### `isTerminPassed(termin)`
Returns `true` if the appointment datetime is in the past.

```js
AH.isTerminPassed(termin); // → true/false
```

### `terminBadgeHTML(termin)`
Returns HTML for a compact inline badge (used in address list rows):
- Green dot + green text = upcoming
- Red dot + red text = overdue

```html
<!-- Example output -->
<div class="flex items-center gap-1.5 mt-1">
  <div class="w-2 h-2 rounded-full bg-green-500"></div>
  <span class="text-xs text-green-600">15.04.2026, 09:00</span>
</div>
```

### `terminInfoHTML(termin)`
Returns HTML for a larger appointment info card (used on the choice screen):
- "Upcoming Appointment" or "Overdue" label
- Full date + time
- Notes (if any)

### `choiceButtonsHTML(isDone, termin)`
Returns HTML for the two-column choice grid shown on the choice screen:
- If Done: appointment button shown as disabled (greyed out)
- If no termin: `[📅 Mark Appointment]` button
- If termin set: `[✏️ Edit Appointment]` button
- Always: `[📷 Upload Work]` button

### `renderAppointmentForm(opts)`
Full appointment form renderer. Replaces the current content element.

```js
AH.renderAppointmentForm({
    el:             HTMLElement,     // content container
    existingTermin: object|null,     // current appointment data
    knotenpunkt:    string,
    addrDisplay:    string,
    nav:            ModuleNavigator,
    projectName:    string,
    userEmail:      string,
    address:        object,          // address row object
    terminColId:    string,          // column ID, e.g. "col-3-2"
    moduleKey:      string,          // e.g. "einblasen"
    onDone:         function,        // called on save/cancel → navigate back
});
```

Form fields:
- Date (required, defaults to tomorrow or existing date)
- Time (required, defaults to 09:00 or existing time)
- Notes (optional textarea)

Buttons:
- **Save Appointment** → conflict check → save → `onDone()`
- **Back** → `onDone()` immediately
- **Remove Appointment** (only if editing) → clears column → `onDone()`

### `checkConflicts(projectName, module, date, time, excludeRowId)`
Async. Checks for scheduling conflicts within ±40 minutes.

```js
const { hasConflict, conflicts } = await AH.checkConflicts(
    'Projekt-A', 'einblasen', '2026-04-15', '09:00', 'ROW-42'
);
```

1. Fetches all appointments: `GET /api/modules/appointments?project=X`
2. Filters to same `module` and same `date`
3. Excludes the current row (`excludeRowId`)
4. Checks if `|proposed_minutes - existing_minutes| < 40`

Returns:
```js
{
    hasConflict: boolean,
    conflicts: [{ rowId, module, date, time, notes, cluster, knotenpunkt, addressStart, addressEnd }]
}
```

### `_showConflictModal(conflicts)` → `Promise<boolean>`
Shows a conflict warning modal. Returns `true` (force schedule) or `false` (cancel).

Modal displays:
- List of conflicting appointments (time, address, context)
- [Cancel] — returns `false`
- [Force Schedule ⚠] — returns `true`

Fallback: if `modal-overlay` / `modal-box` DOM elements not found, uses `window.confirm()`.

### `sortByTermin(addresses, terminColId)`
Sorts an address array by appointment datetime:
1. Appointments (upcoming first, oldest first within group)
2. Addresses without appointments (alphabetical)

```js
const sorted = AH.sortByTermin(addresses, terminColId);
```

---

## Save Flow

```
User fills date + time + notes
    ↓
[Save Appointment] clicked
    ↓
checkConflicts(project, module, date, time, currentRowId)
    ↓ (if conflict)
_showConflictModal(conflicts)
    ├── [Cancel] → stay on form
    └── [Force Schedule ⚠] → continue
    ↓ (no conflict or forced)
POST /api/modules/aufmass-update
    { project, rowId, updates: { [terminColId]: JSON.stringify({date, time, notes}) }, module }
    ↓
onDone() → navigate back to address list
```

---

## Remove Flow

```
[Remove Appointment] clicked
    ↓
POST /api/modules/aufmass-update
    { project, rowId, updates: { [terminColId]: "" }, module }
    ↓
onDone()
```

---

## Termin Columns per Module

Each module has its own termin column (different column ID):

| Module | Group | Column Label |
|---|---|---|
| Einblasen | `einblasen` | `einblasen-termin` |
| APL | `splicing` | `apl-termin` |

The `/api/modules/appointments` endpoint finds all columns with "termin" in their label automatically.

---

## Backend Endpoint: `/api/modules/appointments`

```
GET /api/modules/appointments?project=X
Headers: x-user-email, x-user-role
```

Scans the entire Aufmass, finds every column containing "termin" in its label, and returns all set appointments.

Group-to-module mapping:
```js
"einblasen" group → module: "einblasen"
"splicing" / "apl" group → module: "apl"
"druckprüfung" group → module: "druckprufung"
"kalibrieren" group → module: "kalibrieren"
"otdr" group → module: "otdr"
```

ACL: project access required (no per-module check), superadmin bypasses.

---

## I18N Support

Button labels use `I18N.t(key)` if `window.I18N` is defined:
- `mod.appointment` — "Mark Appointment"
- `mod.editAppointment` — "Edit Appointment"
- `mod.scheduleDesc` — schedule description text
- `mod.uploadWork` — "Upload Work"
- `mod.uploadDesc` — upload description text
- `mod.workDone` — shown on disabled appointment button when Done

Falls back to key string if I18N not loaded.

---

## Key Code Files

- `src/js/appointment-shared.js` — full helper (~300 lines)
- `routes/moduleRoutes.js` — `/api/modules/appointments` endpoint

---

## Recent Changes (2026-04-13 to 2026-04-14)

- Conflict modal built with real DOM modal (not alert/confirm)
- `sortByTermin` added for Einblasen address list sorting
- `terminBadgeHTML` used in Einblasen address list rows

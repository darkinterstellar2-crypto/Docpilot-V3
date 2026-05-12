# Appointment Planner Module

## Overview

### What it does

**For the field worker / manager:** The Planner is a read-only calendar view of all scheduled appointments across all modules (Einblasen, APL, Druckprüfung, Kalibrieren, OTDR). It shows the day as a vertical timeline from 06:00 to 22:00, with each appointment as a colored block. Workers can browse days, filter by module type, and click any appointment to see full details with a deep-link to the relevant module. No appointments are created here — the Planner only displays appointments that were scheduled within their respective modules.

**For the developer:** Planner is a standalone, read-only visualization page. It uses `appointment-shared.js`'s `AppointmentHelper` concept on the backend (fetching all termin columns across the project via `GET /api/modules/appointments`) and a fully custom timeline renderer in `planner.js`. Key rendering features: 80px-per-hour resolution, ±40-minute buffer zones drawn as transparent overlaps, visual staggering of overlapping appointments (column subdivision), per-module color coding, a week strip navigation bar, day picker, and module filter dropdown.

### Why it exists in the workflow

Field work scheduling is complex — multiple technicians work different cable segments on the same day, and the ±40-minute conflict window in individual modules prevents double-booking. The Planner gives managers a bird's-eye view of what's scheduled when, lets them spot overloaded days, and provides a direct link back to any module to edit appointments.

### Domain terms

| Term | Meaning |
|------|---------|
| **Termin** | Appointment — a `{date, time, notes}` JSON object stored in an aufmass column |
| **BUFFER_MINS = 40** | The ±40 minute window used both for conflict detection (in modules) and for drawing buffer zones (in Planner) |
| **PX_PER_HOUR = 80** | Pixels per hour on the timeline grid |
| **Timeline** | Vertical day view from 06:00–22:00 |
| **Week bar** | 7-button Mon–Sun strip showing appointment count badges per day |
| **Overlap staggering** | When 2+ appointments are within 40 minutes, they are split into equal-width columns side by side |

---

## User Journey (Step by Step)

### 1. Dashboard → Planner

`dashboard.html?project=PROJECTNAME` → **Planner** card → `planner.html?project=PROJECTNAME`

Auth guard: `localStorage.getItem('userRole')` + URL project param.

### 2. ACL Check (Planner-specific permission)

Unlike other modules that use `canAccessModule()` via the navigation endpoint, Planner makes its own ACL check at load time:

```
GET /api/access/my-permissions?project=SUPPN
Headers: x-user-email, x-user-role
```

**Response:**
```json
{
  "success": true,
  "permissions": {
    "einblasen": true,
    "apl": true,
    "planner": true,
    "files": false
  }
}
```

If `permissions.planner !== true` (and not superadmin): shows error "Access denied: you do not have Planner access for this project." and stops.

### 3. Initial Load

On successful ACL check:
1. Date picker set to today (`YYYY-MM-DD` local time — NOT UTC)
2. `loadAppointments()` called

### 4. Loading Appointments

```
GET /api/modules/appointments?project=SUPPN
Headers: x-user-email, x-user-role
```

Returns a flat array of all appointments across ALL modules (all termin columns in the aufmass file). Stored in `allAppts`.

`populateModuleFilter()` extracts unique module values and populates the dropdown.

### 5. Week Bar

Renders a 7-button strip (Mon → Sun of the current week):
- Each button shows: day abbreviation (Mon/Tue/…), day number
- Appointment count badge (number, or none if 0)
- Active day highlighted in current accent color
- Clicking any day navigates to it

### 6. Day View

`renderDay()` renders the vertical timeline for `currentDate`.

**Empty state:** If no appointments on the selected day (matching filter), shows an empty state message with the date.

**Timeline grid (when appointments exist):**
- 06:00–22:00 (16 hours × 80px = 1280px total height)
- Hour lines drawn as horizontal guides with time labels (left column)
- Scrolls automatically to first appointment (or to 08:00 if no appointments)

**For each appointment:**

1. **Buffer zone** (drawn first, behind blocks): a semi-transparent colored strip centered on the appointment time, extending ±40 minutes. Visualizes the conflict window.

2. **Appointment block**: a colored rectangle at the correct Y position:
   - Height = 40px fixed (represents the ~40-minute slot visually)
   - Top = `(appointmentMinutesFromStart) × PX_PER_MIN`
   - Left = 48px (time label column) + optional offset for overlapping appointments
   - Color scheme per module (see Module Colors below)
   - Contains: time (bold), module badge, address line, knotenpunkt/cluster (if available)

**Overlap staggering:**
```js
// Appointments are grouped: if startMin of B - startMin of A < 40, they're in the same group
// Within a group, each gets a column slot:
// width = (availableWidth) / totalCols
// left  = 48px + availableWidth * colIndex / totalCols
```

Clicking a block opens the detail panel.

### 7. Detail Panel

A modal slide-in panel (overlay + card):

**Contents:**
- Module color dot + module name (e.g. "APL")
- Date & Time (formatted as "14.04.2026, 09:00")
- Address (start → end, or just start/end)
- Knotenpunkt + Cluster (if available)
- Notes (if any)
- **"Edit in {Module}"** link → deep-links to `einblasen.html?project=SUPPN` etc.

Closed by: clicking ✕ button, clicking outside the card, pressing Escape.

### 8. Day Navigation

- **◀ Prev / Next ▶** buttons: `changeDay(±1)` adds/subtracts 1 day
- **"Today"** button: jumps to today
- **Date picker** (calendar input): jump to any date
- **Week bar** buttons: click any day in the current week

All navigation updates `currentDate`, re-renders week bar, re-renders day view.

### 9. Module Filter

Dropdown populated from unique module values in `allAppts`. Options: "All Modules" + one per module present.

Changing filter calls `renderDay()` which re-filters `allAppts` by both date AND module.

---

## Technical Architecture

### Frontend Files

| File | Role |
|------|------|
| `planner.html` | Page shell — timeline container, week bar, toolbar, detail panel |
| `src/js/planner.js` | All planner logic |

No `module-shared.js` — planner has no navigation pattern.

### Constants (in planner.js)

```js
const HOUR_START    = 6;    // 06:00
const HOUR_END      = 22;   // 22:00
const HOURS         = 16;   // 22 - 6
const PX_PER_HOUR   = 80;
const PX_PER_MIN    = PX_PER_HOUR / 60;  // = 1.333...
const BUFFER_MINS   = 40;
```

Total timeline height: `16 × 80 = 1280px`

### Module Color Scheme

```js
const MODULE_COLORS = {
    einblasen:    { bg: '#EFF6FF', border: '#3B82F6', text: '#1D4ED8', dot: '#3B82F6' }, // blue
    apl:          { bg: '#ECFDF5', border: '#10B981', text: '#065F46', dot: '#10B981' }, // green
    druckprufung: { bg: '#FFFBEB', border: '#F59E0B', text: '#92400E', dot: '#F59E0B' }, // amber
    kalibrieren:  { bg: '#F5F3FF', border: '#8B5CF6', text: '#4C1D95', dot: '#8B5CF6' }, // purple
    otdr:         { bg: '#FEF2F2', border: '#EF4444', text: '#991B1B', dot: '#EF4444' }, // red
};
const DEFAULT_COLOR = { bg: '#F9FAFB', border: '#9CA3AF', text: '#374151', dot: '#9CA3AF' }; // gray
```

### Backend Endpoint

#### GET /api/modules/appointments
```
GET /api/modules/appointments?project=SUPPN
Headers: x-user-email, x-user-role
```

**What the server does:**
1. Parses the project's aufmass `.txt` data file
2. Finds all columns across all schema groups whose label contains `"termin"` (case-insensitive)
3. For each row × each termin column: if the cell value is valid JSON with a `date` field, creates an appointment entry
4. Maps schema group name → module key (e.g. "Einblasen" → `"einblasen"`)
5. Returns flat array

**Response:**
```json
{
  "success": true,
  "appointments": [
    {
      "rowId": "ROW-0042",
      "module": "einblasen",
      "date": "2026-04-15",
      "time": "09:00",
      "notes": "Gate code: 4821",
      "cluster": "SUPPN",
      "knotenpunkt": "NVt-14",
      "addressStart": "SUPPN, Hauptstr 5",
      "addressEnd": "SUPPN, Zeilerweg 11",
      "terminColId": "col-7-1"
    },
    {
      "rowId": "ROW-0043",
      "module": "apl",
      "date": "2026-04-15",
      "time": "10:30",
      "notes": "",
      "cluster": "SUPPN",
      "knotenpunkt": "NVt-14",
      "addressStart": "SUPPN, Hauptstr 5",
      "addressEnd": "SUPPN, Zeilerweg 15",
      "terminColId": "col-3-2"
    }
  ]
}
```

Group-to-module mapping (in `moduleRoutes.js`):
```js
function groupToModule(groupName) {
    const n = (groupName || '').toLowerCase();
    if (n.includes('einblasen')) return 'einblasen';
    if (n.includes('splicing') || n.includes('apl')) return 'apl';
    if (n.includes('druckpr')) return 'druckprufung';
    if (n.includes('kalibrieren')) return 'kalibrieren';
    if (n.includes('otdr')) return 'otdr';
    return n.replace(/\s+/g, '-');  // fallback: slugified group name
}
```

#### GET /api/access/my-permissions
```
GET /api/access/my-permissions?project=SUPPN
Headers: x-user-email, x-user-role
```

Returns `{ success: true, permissions: { moduleName: true/false, ... } }`.

Planner specifically checks `permissions.planner === true`.

### Data Flow Diagram

```
planner.html loads
    │
    ├─ GET /api/access/my-permissions → check planner=true
    │
    ▼
loadAppointments()
    └─ GET /api/modules/appointments → allAppts[]
        │
        ▼
populateModuleFilter() → populate <select>
renderWeekBar() → 7 day buttons with count badges
renderDay() →
    filter allAppts by currentDate + filterModule
    │
    ├─ renderBufferZones()  (behind — transparent colored strips, ±40min)
    └─ renderBlocks()       (colored appointment rectangles at correct Y pos)
        └─ addEventListener('click') → openDetail(appt)

User clicks block → openDetail(appt):
    │
    └─ renders detail panel with deep-link to module page
```

---

## Appointment System (AppointmentHelper)

The Planner reads data that was created by `AppointmentHelper` in individual modules. This section documents how that system works end-to-end.

### Appointment Creation (in modules — e.g. Einblasen, APL)

When a user clicks "Mark Appointment" in a module:

1. `AH.renderAppointmentForm(config)` renders date/time/notes inputs
2. On save: conflict check runs
3. If no conflict (or forced): `POST /api/modules/aufmass-update` writes:
   ```json
   { "updates": { "col-7-1": "{\"date\":\"2026-04-15\",\"time\":\"09:00\",\"notes\":\"\"}" } }
   ```
4. The termin column stores a JSON string in the aufmass cell

### Conflict Detection (`AppointmentHelper.checkConflicts`)

Called when saving a new/edited appointment:

```js
async checkConflicts(projectName, module, date, time, excludeRowId) {
    // 1. Fetch all appointments for the project (same endpoint as Planner uses)
    const res = await fetch(`/api/modules/appointments?project=${projectName}`);
    const data = await res.json();

    const proposed = this._toMinutes(time);  // e.g. "09:00" → 540

    // 2. Filter to: same module, same date, within 40 minutes
    const conflicts = (data.appointments || []).filter(appt => {
        if (appt.rowId === excludeRowId) return false;  // skip self (for edits)
        if (appt.module !== module) return false;       // different module = no conflict
        if (appt.date !== date) return false;           // different day = no conflict
        if (!appt.time) return false;
        const diff = Math.abs(this._toMinutes(appt.time) - proposed);
        return diff < 40;  // within 40-minute window
    });

    return { hasConflict: conflicts.length > 0, conflicts };
}

_toMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
    // "09:00" → 540, "09:39" → 579, diff = 39 → < 40 → conflict!
}
```

Note: conflicts are **per-module**. An Einblasen appointment at 09:00 does NOT conflict with an APL appointment at 09:15. Only same-module, same-date, within-40-minutes appointments conflict.

### Conflict Modal

```js
_showConflictModal(conflicts) {
    return new Promise(resolve => {
        // Build HTML list of conflicting appointments:
        // "09:15 — Zeilerweg 11 (NVt-14, SUPPN)"
        const html = conflicts.map(c => `
            <li>${c.time} — ${c.addressStart || c.addressEnd}
                ${c.knotenpunkt ? `(${c.knotenpunkt}${c.cluster ? `, ${c.cluster}` : ''})` : ''}
            </li>
        `).join('');

        // Rendered as a modal with two buttons:
        // [Cancel] → resolve(false)
        // [Force Schedule] → resolve(true)
    });
}
```

The force option logs the override — the appointment is saved normally without any special flag.

### Appointment Display in Modules (AH helper methods)

#### `AH.parseTermin(rawValue)`
```js
// rawValue: '{"date":"2026-04-15","time":"09:00","notes":"Gate code: 4821"}'
// Returns: { date, time, notes } or null if invalid/empty
parseTermin(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}
```

#### `AH.terminInfoHTML(termin)`
Renders the appointment info card shown in module choice screens:
```js
// Returns HTML string:
// - green dot + "Upcoming Appointment" (or red + "Overdue") label
// - "15 April 2026, 09:00"
// - notes (if any)
terminInfoHTML(termin) {
    const today = todayStr();
    const isPast = termin.date < today || (termin.date === today && termin.time < currentTimeHHMM());
    const dotColor = isPast ? '#EF4444' : '#10B981';
    const label = isPast ? 'Overdue Appointment' : 'Upcoming Appointment';
    // ...
}
```

#### `AH.choiceButtonsHTML(isDone, termin)`
Returns the 2-column button HTML for the choice screen:
- Left button: "📅 Mark Appointment" (no termin) / "✏️ Edit Appointment" (has termin) / disabled (if Done)
- Right button: "📷 Upload Work"

#### `AH.sortByTermin(addresses, terminColId)`
Sorts address array by appointment date+time:
```js
// Upcoming first (soonest first), overdue next, no-termin last
sortByTermin(addresses, terminColId) {
    return addresses.sort((a, b) => {
        const ta = parseTermin(a.data?.[terminColId]);
        const tb = parseTermin(b.data?.[terminColId]);
        if (!ta && !tb) return 0;
        if (!ta) return 1;   // no termin → to end
        if (!tb) return -1;
        const dtA = `${ta.date}T${ta.time || '00:00'}`;
        const dtB = `${tb.date}T${tb.time || '00:00'}`;
        return dtA.localeCompare(dtB);
    });
}
```

---

## Code Walkthrough

### `renderDay()`

The core visualization function:

```js
function renderDay() {
    const filtered = allAppts.filter(a =>
        a.date === currentDate && (!filterModule || a.module === filterModule)
    );

    // Sort by time for overlap detection
    const sorted = [...filtered].sort((a, b) =>
        (a.time || '00:00').localeCompare(b.time || '00:00')
    );

    // Overlap grouping: group appointments within 40 minutes of each other
    const groups = [];
    sorted.forEach((appt, idx) => {
        const [h, m] = appt.time.split(':').map(Number);
        const startMin = h * 60 + m - HOUR_START * 60;
        let placed = false;
        for (const group of groups) {
            const last = group[group.length - 1];
            if (startMin - last.startMin < 40) {
                group.push({ idx, startMin });
                placed = true;
                break;
            }
        }
        if (!placed) groups.push([{ idx, startMin }]);
    });

    // Map idx → { col, totalCols }
    const overlapInfo = new Map();
    groups.forEach(group => {
        group.forEach((item, col) => {
            overlapInfo.set(item.idx, { col, totalCols: group.length });
        });
    });

    // Draw buffer zones (transparent colored strips)
    sorted.forEach(appt => {
        if (!appt.time) return;
        const startMin = toGridMin(appt.time);
        const bufTop    = Math.max(0, startMin - BUFFER_MINS) * PX_PER_MIN;
        const bufBottom = Math.min(HOURS * 60, startMin + BUFFER_MINS) * PX_PER_MIN;
        // Renders a <div class="appt-buffer"> with 10% opacity background
    });

    // Draw appointment blocks
    sorted.forEach((appt, idx) => {
        const startMin = toGridMin(appt.time);
        const topPx    = startMin * PX_PER_MIN;
        const heightPx = 40 * PX_PER_MIN;         // fixed 40-min block height
        const { col, totalCols } = overlapInfo.get(idx) || { col: 0, totalCols: 1 };

        const colWidth = totalCols > 1 ? `calc((100% - 52px) / ${totalCols})` : 'calc(100% - 52px)';
        const colLeft  = totalCols > 1 ? `calc(48px + (100% - 52px) * ${col} / ${totalCols})` : '48px';

        // <div class="appt-block" style="top:Xpx; width:W; left:L"> with module colors
    });
}
```

### `weekDays(dateStr)`

Returns array of 7 date strings (Mon–Sun) containing the given date:
```js
function weekDays(dateStr) {
    const d = new Date(dateStr + 'T12:00:00'); // noon to avoid DST edge cases
    const dayOfWeek = (d.getDay() + 6) % 7;    // 0=Mon, 6=Sun
    const monday = new Date(d);
    monday.setDate(d.getDate() - dayOfWeek);
    return Array.from({ length: 7 }, (_, i) => {
        const day = new Date(monday);
        day.setDate(monday.getDate() + i);
        return `${day.getFullYear()}-${pad(day.getMonth()+1)}-${pad(day.getDate())}`;
    });
}
```

### `todayStr()`

```js
function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
```

Note: uses LOCAL time, not UTC. This is intentional — avoids showing "wrong day" if the user is in a non-UTC timezone.

### `modulePageUrl(mod, projectName)`

Maps module key to its HTML page for deep-link generation:
```js
const map = {
    einblasen:    'einblasen.html',
    apl:          'apl.html',
    druckprufung: 'druckprufung.html',
    kalibrieren:  'kalibrieren.html',
    otdr:         'otdr.html',
};
return `${map[mod]}?project=${encodeURIComponent(projectName)}`;
```

---

## Error States

| Condition | What's shown |
|-----------|-------------|
| No project in URL | Error: "No project specified. Please open from the dashboard." |
| No planner permission | Error: "Access denied: you do not have Planner access for this project." |
| API fetch fails | Error: "Could not load appointments: {message}" |
| No appointments on selected day | Empty state illustration + date label |
| No appointments with active filter | Empty state |

Loading state: spinner shown while `loadAppointments()` runs.

---

## Permissions / ACL

- **Auth:** `userRole` in localStorage (any non-empty role)
- **Project:** user must have project access
- **Module-specific:** `permissions.planner === true` (from `/api/access/my-permissions`)
- **Superadmin:** bypasses permission check, always has access

No write operations — Planner is read-only. No edit permission needed.

---

## Dependencies

- At least one module (Einblasen, APL, etc.) must have termin columns in the aufmass schema for any appointments to appear
- `/api/access/my-permissions` endpoint must return `planner` permission key
- `/api/modules/appointments` endpoint scans ALL termin columns across ALL groups — adding a new module with termin columns is automatically picked up

# Planner Module

**File:** `src/js/planner.js`  
**Page:** `planner.html`  
**ACL Key:** `planner`  
**Purpose:** Day-view appointment planner showing all module appointments (Termine) for a project on a visual timeline.

---

## Overview

The Planner is a read-only appointment dashboard. It loads all scheduled appointments from all modules (Einblasen, APL, Druckprüfung, Kalibrieren, OTDR) and displays them on a day-view timeline. Users can navigate between days, filter by module, and click appointments to see details with a link back to the source module.

---

## User Flow

```
Dashboard → planner.html?project=X
    ↓
ACL check (planner permission or superadmin)
    ↓
Load all appointments via /api/modules/appointments
    ↓
Week bar (Mon–Sun) + day timeline rendered for today
    ↓
User actions:
    ├── [← Prev Day] / [Next Day →] — navigate days
    ├── [Today] — jump to today
    ├── Date picker — jump to any date
    ├── Module filter dropdown — filter by module
    └── Click appointment chip — open detail panel
```

---

## UI Components

### Header
- Project name label
- Module filter dropdown (auto-populated from loaded appointments)
- Navigation: ← Prev Day, date label ("Monday, 14 April 2026"), Next Day →, Today button
- Date picker (hidden, triggered by label)

### Week Bar
A row of 7 day buttons (Mon–Sun centered on current week). Each shows:
- Day abbrev (Mo, Di, Mi, ...)
- Date number
- Dot indicator if that day has appointments
- Highlighted for the currently selected day

### Day Timeline
- Hours from **06:00 to 22:00** (16 hours total)
- **80 px per hour** (1.33 px per minute)
- Time labels on the left for each hour
- **Now indicator**: red horizontal line at current time (only on today's view)

### Appointment Chips
Each appointment rendered as an absolutely-positioned chip on the timeline:
- Positioned at `(time - 06:00) × PX_PER_MIN` pixels from top
- Height: 60px minimum
- Color-coded by module:
  - Einblasen: blue (`#3B82F6`)
  - APL: green (`#10B981`)
  - Druckprüfung: amber (`#F59E0B`)
  - Kalibrieren: purple (`#8B5CF6`)
  - OTDR: red (`#EF4444`)
- Content: module label, time, address/knotenpunkt, cluster

### Conflict Indicator
Appointments within ±40 minutes of each other on the same day get a `"⚠ Overlap"` warning indicator. The **BUFFER_MINS** constant is 40.

### Detail Panel
Slide-in side panel (or modal on mobile) shown when appointment chip clicked:
- Module badge (color-coded)
- Date + time
- Address (start/end), Knotenpunkt, Cluster
- Notes (if any)
- **"Go to [Module]"** link — opens `{module}.html?project=X`
- Close button, Escape key, click-outside

### Empty State
If no appointments on the selected day: centered illustration + "No appointments scheduled" message.

---

## Data Loading

```
GET /api/modules/appointments?project=X
```

Returns flat array of all appointments:
```json
{
  "success": true,
  "appointments": [
    {
      "rowId": "ROW-42",
      "module": "einblasen",
      "date": "2026-04-14",
      "time": "09:00",
      "notes": "Morning shift",
      "cluster": "Cluster-A",
      "knotenpunkt": "NVT-001",
      "addressStart": "Hauptstraße 1",
      "addressEnd": "Bahnhofstraße 5",
      "terminColId": "col-3-2"
    }
  ]
}
```

The backend scans all rows in the Aufmass, finds every column whose label contains "termin", parses the JSON value, and returns one appointment object per found termin.

---

## Module Filter

- Auto-populated from unique `module` values in loaded appointments
- Options: "All Modules" + one per module found
- Filters the rendered chips without re-fetching from API

---

## Conflict Detection

```js
const BUFFER_MINS = 40;
```

Two appointments conflict if they are:
- Same date
- Same module
- Within 40 minutes of each other

Displayed as a warning chip overlay. Does not prevent scheduling — only visualizes the conflict.

---

## Module Color Map

```js
const MODULE_COLORS = {
    einblasen:    { bg: '#EFF6FF', border: '#3B82F6', text: '#1D4ED8' },
    apl:          { bg: '#ECFDF5', border: '#10B981', text: '#065F46' },
    druckprufung: { bg: '#FFFBEB', border: '#F59E0B', text: '#92400E' },
    kalibrieren:  { bg: '#F5F3FF', border: '#8B5CF6', text: '#4C1D95' },
    otdr:         { bg: '#FEF2F2', border: '#EF4444', text: '#991B1B' },
};
```

Unknown modules get a gray default.

---

## Module URL Mapping

"Go to Module" links:
```js
einblasen    → einblasen.html?project=X
apl          → apl.html?project=X
druckprufung → druckprufung.html?project=X
kalibrieren  → kalibrieren.html?project=X
otdr         → otdr.html?project=X
```

---

## ACL / Permissions

- Non-superadmin users checked via `GET /api/access/my-permissions?project=X`
- Must have `permissions.planner === true`
- Superadmin bypasses check
- Backend `/api/modules/appointments` only requires project access (not module-specific)

---

## Constants

```js
const HOUR_START    = 6;    // 06:00
const HOUR_END      = 22;   // 22:00
const HOURS         = 16;
const PX_PER_HOUR   = 80;
const PX_PER_MIN    = 80 / 60;  // ≈ 1.333 px/min
const BUFFER_MINS   = 40;
```

---

## Key Code Files

- `src/js/planner.js` — full page logic (~476 lines)
- `routes/moduleRoutes.js` — `/api/modules/appointments` endpoint
- `planner.html` — page shell + CSS

---

## Recent Changes (2026-04-14)

- **New module** — added in `v20260414a`
- Day timeline with color-coded chips per module
- Week bar with dot indicators
- Conflict detection (±40 min buffer visualization)
- Module filter dropdown
- Detail panel with direct link to source module

# 2026-04-14 — Appointment Planner + Inactivity Auto-Logout

## Appointment Planner

### Backend
- **`GET /api/modules/appointments?project=X`** — scans all Termin columns across all groups in the Aufmass data file
- Returns flat array: `{ rowId, module, date, time, notes, cluster, knotenpunkt, addressStart, addressEnd, terminColId }`
- Group→module mapping: Einblasen→einblasen, Splicing/APL→apl, Druckprüfung→druckprufung, etc.
- ACL: requires project access (not module-gated — conflict check needs cross-module data)

### Conflict Detection (`appointment-shared.js`)
- `checkConflicts(projectName, module, date, time, excludeRowId)` — fetches all appointments, filters same module + same date
- Flags anything within **±40 minutes** as a conflict (same module only, different teams work different modules)
- Glassmorphism warning modal listing each conflicting appointment (time, address, knotenpunkt)
- Two buttons: **Cancel** (stay on form) / **Force Schedule ⚠** (red, saves anyway)
- Falls back to `confirm()` if modal.js not loaded
- All user data in modal escaped against XSS

### Planner Page (`planner.html` + `src/js/planner.js`)
- Vertical day timeline: 06:00–22:00, 80px/hour
- Color-coded by module: Einblasen (blue), APL (green), Druckprüfung (orange), Kalibrieren (purple), OTDR (red)
- 40-min buffer zones as light translucent shading (7% opacity)
- Overlapping appointments get side-by-side columns (stagger algorithm)
- Date navigation: ‹ › arrows, "Today" button, date picker
- Week bar: Mon–Sun with appointment count badges, click to jump
- Module filter dropdown
- Click appointment → detail panel with full info + "Edit in [Module]" link
- Escape key closes detail panel
- ACL: fail-closed (`permissions.planner !== true`)
- All dates use local timezone (not UTC) — safe at midnight in UTC+ timezones
- Responsive, mobile-friendly

### Dashboard Integration
- Compact 42px calendar icon next to "Modules" heading (top-right)
- Green badge showing today's appointment count
- Click → opens planner page
- ACL-controlled via `data-module="planner"`

### ACL
- `planner` added to `ALL_MODULES` in `accessRoutes.js`
- Admin panel (`admin.html`) shows Planner toggle per project
- Default: inherits from project access (no breaking change for existing users)

---

## Inactivity Auto-Logout (`idle-logout.js`)

### Behavior
- **Regular users:** 2 hours of inactivity → auto-logout
- **Superadmin:** 30 minutes of inactivity → auto-logout
- **Activity resets the timer:** click, keydown, scroll, mousemove, touchstart, touchmove, any fetch call
- Activity throttled to 1 localStorage write per 10 seconds (performance)
- Cross-tab: `localStorage` timestamp shared, `storage` event syncs across tabs

### Warning Banner
- Shows **2 minutes before logout** — red gradient banner, fixed top
- Live countdown updating every 5 seconds
- **"Stay Logged In"** button directly resets timer (bypasses throttle)
- Banner auto-hides on any activity

### Implementation Details
- Uses `localStorage('_docpilot_lastActive')` timestamp
- Check interval: 30s normal, 5s during warning phase
- `loggingOut` guard prevents double-fire from dual intervals
- `warnIntervalId` properly cleared on warning dismiss (no interval leak)
- `visibilitychange` event: checks immediately when tab becomes visible (laptop wake)
- Uses `doLogout()` when available (clean session closure), falls back to manual clear
- Added to all 15 authenticated pages (login/register excluded)

---

## QA Fixes Applied (3 passes)

### Security
- **XSS: conflict modal** — addr, time, cluster now escaped
- **XSS: planner blocks** — modLabel, time, formatDate escaped
- **XSS: appointment form** — date/time input `value` attributes escaped
- **ACL fail-closed** — planner permission check uses `!== true` not `=== false`

### Bugs
- **Timezone:** `todayStr()`/`changeDay()`/`weekDays()` used `toISOString()` (UTC) — fixed to local dates with `T12:00:00` noon anchor for DST safety
- **Overlap stagger:** appointments at same time now render side-by-side (was stacked/invisible)
- **Buffer zone:** visualization was too wide (±40 + 40 duration) — fixed to match actual ±40 min conflict window
- **TDZ bug:** `warnIntervalId` used before declaration — moved to top of state section
- **Interval leak:** `hideWarning()` didn't clear fast countdown interval
- **Race condition:** dual 30s+5s intervals could double-fire `doIdleLogout` — added `loggingOut` guard
- **Missing scripts:** planner.html was missing `logout.js` + `header-avatar.js`
- **Duplicate display:none:** calendar widget had two `display:none` in inline style
- **Admin panel:** planner toggle was missing from `ALL_MODULES` in admin.html

### UX
- Planner block readability: larger text, bolder fonts, proper text-overflow
- Buffer zone opacity reduced (12% → 7%)
- Calendar widget: compact icon instead of text block
- Detail panel: Escape key closes it
- Countdown: Math.floor (was ceil), zero-padded seconds, 5s updates during warning

---

## Files Changed

### New Files
- `planner.html` — Planner page
- `src/js/planner.js` — Planner page logic
- `src/js/idle-logout.js` — Inactivity auto-logout

### Modified Files
- `routes/moduleRoutes.js` — appointments endpoint
- `routes/accessRoutes.js` — planner in ALL_MODULES
- `controllers/accessControl.js` — planner in module names comment
- `src/js/appointment-shared.js` — conflict check + modal + XSS fixes
- `dashboard.html` — calendar widget, idle-logout script
- `admin.html` — planner toggle in ACL panel, idle-logout script
- All 15 authenticated HTML pages — idle-logout.js script tag

## Commits
- `aa9861c` → `e375165` (10 commits)

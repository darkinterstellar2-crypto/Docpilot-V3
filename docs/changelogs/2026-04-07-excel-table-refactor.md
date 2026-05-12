# Changelog — 2026-04-07: Excel-like Table Refactor + Multiple Fixes

## Summary
Major refactor of the Aufmass table into an Excel-like spreadsheet experience, plus chat notifications, permission fixes, UI fixes, and data corrections.

---

## 1. Excel-like Aufmass Table Refactor

### Inline Cell Editing (replaces old Edit Mode)
- **Old:** Click "Edit" button → ALL rows become editable at once (280 rows = browser freeze)
- **New:** Click any cell → only that cell becomes editable. No edit mode toggle needed.
- **Dropdowns:** Cluster, Knotenpunkt, Fiber Type, Status columns show `<select>` on click
- **Contenteditable:** All other columns become text-editable on click
- **Keyboard navigation:** Enter commits, Tab moves to next cell, Escape reverts
- **Dirty tracking:** Modified cells highlighted yellow, floating "Unsaved Changes" bar appears with Save/Discard

### Row Numbers
- Fixed first column showing 1, 2, 3... (auto-updates on add/delete)
- Light gray background, monospace font
- Click row number → selects entire row

### Column Letters
- New header row above group headers: A, B, C... Z, AA, AB...
- Click column letter → selects entire column

### Column Selection + Action Bar
- Click column letter → floating action bar: Rename, Add Column, Delete, Sort A→Z, Sort Z→A
- Rename uses custom glassmorphism modal prompt
- Delete uses custom modal confirm

### Row Selection + Action Bar
- Click row number → floating action bar: Insert Above, Insert Below, Duplicate, Delete
- Delete uses custom modal confirm

### Toolbar Buttons
- **+ Row** and **+ Column** buttons always visible in toolbar
- No longer hidden behind edit mode

### Custom Modal System (`modal.js`)
- Replaces all native `prompt()`, `confirm()`, `alert()` dialogs
- Glassmorphism styled (backdrop blur, translucent white, rounded, shadow)
- Functions: `showAlert()`, `showConfirm()`, `showPrompt()`
- Keyboard support: Enter to confirm, Escape to cancel
- Auto-focus on input/button

### Files Changed
- `aufmass.html` — removed Edit button, added modal.js script, new CSS classes
- `src/js/table.js` — full rewrite (896 → 1260+ lines)
- `src/js/modal.js` — new file

---

## 2. Permission Fix: canEdit Enforcement

### Problem
After removing the Edit button, users without "can edit" permission could still click cells and edit data.

### Fix
- `table.js` fetches `/api/access/permissions` on page load
- Sets `canEdit` flag based on user's role and project-specific permissions
- `canEdit = false` → clicking cells does nothing, +Row/+Column hidden, action bars disabled
- Admin/superadmin always get `canEdit = true`
- Backend save endpoint still enforces permissions as defense-in-depth

---

## 3. Fiber Type in Einblasen Module

### Change
- Added Fiber Type display to all module pages (Einblasen, APL, OTDR, etc.)
- **Address list view:** shows fiber type next to cable name (e.g. "KAB-001 · 96")
- **Upload form detail card:** shows "Fiber Type: 96" as a row

### Technical
- `fiberType` was already in the address object from `moduleRoutes.js` backend
- Only needed frontend display in `module-shared.js`

---

## 4. Address Display Fix

### Change
- Module address list now shows **Address End** (house address) instead of Address Start (knotenpunkt)
- Changed `addr.start || addr.end` → `addr.end || addr.start` in `module-shared.js`

### Context
- Address Start = Knotenpunkt name (e.g. "NVt 27")
- Address End = actual house address (e.g. "Grabengasse 3")
- When navigating modules, the house address is what workers need to see

---

## 5. Rauhenebrach Data Fix

### Change
- Updated all 280 rows in Gemeinde Rauhenebrach project via API
- **Address Start** ← Knotenpunkt value (was: house address)
- **Address End** ← house address (was: empty)

### Method
- Fetched data via `GET /api/data`, modified with Python script, saved via `POST /api/data`
- Server auto-created versioned backup before overwrite

---

## 6. Chat Notifications

### Features Added
- **Browser push notifications** — system notification when new message arrives and chat is closed or tab unfocused
- **Notification sound** — subtle 800Hz sine beep via Web Audio API (no external file)
- **Tab title badge** — shows `(3) ProjectName — DocPilot` with unread count
- **Permission request** — asks user to allow notifications on first visit
- **Click to open** — clicking notification opens chat and focuses window

### Technical
- Notifications only fire for messages from other users (not your own)
- `Notification.requestPermission()` on page load
- Title badge resets when chat panel is opened
- Sound uses Web Audio API oscillator (0.3s, 800Hz, volume 0.15)

---

## 7. Mobile Layout Fix

### Change
- "+ New Project" button on `index.html` no longer overlaps "Projects" title on mobile
- Changed `flex-row` → `flex-col sm:flex-row` with `gap-3`
- Button stacks below title on mobile, stays inline on desktop

---

## Commits
1. `feat: Excel-like aufmass table refactor` — inline editing, row numbers, column letters, selection, modals
2. `fix: add permanent +Row and +Column buttons to toolbar`
3. `feat: show fiber type in module upload form and address list`
4. `fix: show Address End in module address list instead of Address Start`
5. `fix: New Project button mobile layout`
6. `fix: enforce canEdit permission`
7. `feat: chat notifications — browser push, sound, title badge`

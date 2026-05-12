# 2026-04-09 — Major Update

## New Features

### User Profile Page
- New `/profile.html` with avatar upload, name/username edit, password change
- Profile picture shown in header across all pages (replaces generic person icon)
- Username uniqueness: case-insensitive, real-time validation on keystroke
- Fields locked by default — Edit button to unlock, Cancel to revert

### NAS Sync (Live)
- Tailscale tunnel connecting VPS (`100.98.104.30`) ↔ NAS (`100.116.37.97`)
- WebDAV sync via dedicated `docpilot` user on NAS
- Remote base: `/Docpilot-Data`, sync interval: 300s
- 110 files synced on first run
- `.db` files excluded (SQLite), regular files + media sync normally

### Appointment System (APL, Einblasen, OTDR)
- Choice screen after address selection: "Mark Appointment" / "Upload Work"
- Appointment: date + time + notes, saved as JSON in termin columns
- Address list: green (upcoming) / red (overdue) badges, sorted by appointment time
- Edit/Delete existing appointments
- Appointment disabled when work status is "Done"
- Shared implementation via `appointment-shared.js`
- Required columns: `apl-termin` (Splicing), `einblasen-termin` (Einblasen), `otdr-termin` (OTDR)

### EN/DE Language Toggle
- `i18n.js` with translation dictionary (EN ↔ DE)
- Toggle button in header on every page
- Persists via localStorage
- Covers: hub, dashboard modules, profile, login, appointments
- Data files, column names, and file names remain untouched

### Registration Workflow
- **Email notification:** Superadmins receive email when new user completes OTP verification
- **Reject button:** Pending users can now be rejected — removes from `users.json` + sends rejection email
- **Removed stale `otp: null`** field from saved user records

## Bug Fixes

### Files Page Not Loading
- **Root cause:** `api.js` (global auth header interceptor) loaded after main script
- First `loadFiles()` call had no auth headers → ACL rejected → empty page
- Clicking "Root" in breadcrumb worked because `api.js` loaded by then
- **Fix:** `api.js` now loads before main script in `files.html`

### Folder Location Links in Aufmass
- Clicking "📂 Open" links triggered cell editor instead of navigation
- **Fix:** Table click handler now skips `<a>` tags

## New Files
- `profile.html` — user profile page
- `routes/profileRoutes.js` — profile API (GET/PUT profile, password, avatar)
- `src/js/header-avatar.js` — dynamic avatar in header
- `src/js/appointment-shared.js` — reusable appointment helpers
- `src/js/i18n.js` — internationalization (EN/DE)

## Environment Changes
- `.env` additions: `NAS_SYNC_ENABLED`, `NAS_WEBDAV_URL`, `NAS_USERNAME`, `NAS_PASSWORD`, `NAS_SYNC_INTERVAL`, `NAS_REMOTE_BASE`
- Tailscale installed on VPS (`tailscale up`)
- Tailscale Docker container on NAS with persistent state volume

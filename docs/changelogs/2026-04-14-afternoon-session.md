# 2026-04-14 Afternoon Session

## Commits

### `a800227` — GeoCam mobile scroll + blue theme
- Fixed settings panel scroll on mobile (removed overflow:hidden trap)
- Yellow → blue color scheme throughout settings (#3B82F6)
- Default overlay text → white

### `26625ad` — GeoCam location fixes
- GPS permission denied → red badge feedback
- HTTPS requirement detection
- "Locating…" no longer stuck on rural addresses

### `bf50c38` — GeoCam permission gate
- Permission check screen before camera opens
- Camera + GPS checked in parallel
- Auto-proceed when both granted
- "Continue without GPS" fallback

### `135b78a` — Einblasen error display fix
- Root cause: module ignored Error-Reporting column (col-12-2)
- Now reads active EB: entries and shows error badge + banner

## 2026-04-19 — Bugfixes & Planner Deep-Linking

### Bug Fixes
- **moduleRoutes.js — Versioned file fallback**: `getFilePath()` now falls back to the latest versioned `ProjectName_YYYYMMDD_HHMMSS.txt` file when the base `ProjectName.txt` is missing. This prevents APL and all dashboard modules from breaking if the base file gets cleaned up by NAS sync. Previously only `dataRoutes.js` had this fallback; now both routes are consistent.
- **nasSync.js — Hardened 48h cleanup**: Three safety layers added:
  1. Base `ProjectName.txt` files (without timestamp suffix) are permanently protected — never deleted by cleanup
  2. Before deleting ANY file, a live `exists()` check verifies the file is actually on the NAS right now (not just trusting the manifest's `confirmed` flag)
  3. If the NAS check fails (network error, 403, timeout), deletion is skipped entirely with a warning log
- **Root cause**: The base Aufmass data file was deleted by the 48h cleanup, breaking all modules that depend on it for navigation (APL, Einblasen, Druckprüfung, etc.). The Aufmass table itself still worked because it had a versioned fallback.

### New Feature
- **Planner deep-linking**: "Edit in [Module]" button in the appointment planner now deep-links directly to the specific address within the module page. URL params `cluster`, `knotenpunkt`, and `address` are appended. `ModuleNavigator.init()` in `module-shared.js` auto-navigates to the matching address on page load. Works for all modules (APL, Einblasen, Druckprüfung, Kalibrieren, OTDR). Graceful fallback — stops at the deepest matching level if a param doesn't match.

### Files Changed
- `routes/moduleRoutes.js`
- `controllers/nasSync.js`
- `src/js/planner.js`
- `src/js/module-shared.js`

### Commit
`f2e0b27` on `main`

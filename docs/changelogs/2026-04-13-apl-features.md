# 2026-04-13 — APL Module Features + Glassmorphism Modals

## Commit: `83c72b1`

### APL Module — Feature Parity with Einblasen
- Error status support: red badge, Report Error button (solid red), Clear Error button
- Files filtered per address (was showing all Knotenpunkt files)
- Delete button per file (recycle bin, not permanent)
- Auto-reset to Pending when last file deleted
- Custom file row rendering (replaced ModuleNavigator's default)

### Browser Dialogs Replaced (Einblasen + APL)
- All `confirm()` replaced with `showConfirm()` glassmorphism modal
- All `alert()` replaced with `showAlert()` glassmorphism modal
- `modal.js` added to both `einblasen.html` and `apl.html`

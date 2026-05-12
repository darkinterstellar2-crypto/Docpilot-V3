# 2026-04-13 — Einblasen UX Fixes + Optimistic Locking

## Summary
Post-midnight session fixing Einblasen module UX issues reported by field workers, plus implementing optimistic locking to prevent concurrent edit overwrites in the Aufmass table.

---

## Einblasen UX Fixes

### Error Status
- **"Error" status** added to Einblasen (e.g., cable stuck during blowing)
- Red badge `⚠ Error` in address list, choice screen, and Aufmass table
- **"⚠ Report Error"** button (solid red) on choice screen — visible for ALL statuses
- **"✓ Clear Error"** button appears when status is Error — resets to Pending
- Error addresses remain workable (upload + generator not blocked)

### File Listing
- **Filtered per address** — only shows files matching the current address name (not all Knotenpunkt files)
- **Delete button 🗑** on each file — moves to recycle bin (not permanent delete)
- Uses correct `DELETE /api/files` endpoint (was incorrectly calling `POST /api/files/delete`)
- **Auto-reset to Pending** when last file is deleted

### Upload Page (Edit/Re-upload)
- Fixed: was showing ModuleNavigator's default file list (24 unfiltered files)
- Now shows clean upload form directly (type dropdown + drag-drop)
- Temporarily clears Done status before rendering to bypass `_renderFilesViewAsync`

### Cache Busting
- All JS `<script>` tags have `?v=20260413x` version params
- `Cache-Control: no-cache, must-revalidate` header for .js and .css files
- Field workers on phones no longer see stale cached JS

---

## Optimistic Locking (Concurrent Edit Protection)

### Problem
Two users editing the Aufmass table simultaneously — last save silently overwrites the other's work.

### Solution
Row-level optimistic locking with version numbers.

### Implementation

**Server (`row-versions.json` per project):**
- Each row has a version number (starts at 0)
- `GET /api/data` returns `_version` per row
- `POST /api/data` (bulk save) checks versions for all changed rows
- `POST /api/modules/aufmass-update` (cell update) accepts `rowVersion` param
- Version mismatch → `409 Conflict` response with message
- Successful save → version auto-increments

**Client (`table.js`):**
- Stores `_version` per row from server response
- Sends `_version` with save data
- Handles 409 → alert: "Modified by another user. Please refresh."
- Updates local versions after successful save

### Files Modified
- `routes/moduleRoutes.js` — row version helpers + version check in aufmass-update
- `routes/dataRoutes.js` — version check in bulk save + return versions
- `src/js/table.js` — send/receive versions, handle 409

---

## Commits
| Hash | Description |
|------|-------------|
| `8eba8a9` | Cache-busting for JS files + no-cache headers |
| `c167103` | Report Error on choice screen, Clear Error button |
| `24493fc` | Multer upload error handler (JSON instead of HTML) |
| `4a39552` | Upload page shows drag-drop form directly |
| `b24970b` | Delete uses correct API (recycle bin) |
| `b8f9e94` | Auto-reset status when last file deleted |
| `d5cba43` | Optimistic locking for aufmass |

## Deploy
```bash
cd /opt/docpilot && git pull && docker compose build --no-cache && docker compose up -d
```

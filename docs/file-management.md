# File Management

DocPilot includes a full file management system with browsing, upload, download, trash/restore, copy/move, share links, and optional WebDAV NAS sync.

## File Browser

**Page:** `files.html` | **API:** `routes/fileRoutes.js`

The file browser operates within a project's `storage/<ProjectName>/` directory. Features:
- Directory listing with file size, modification date, and "modified by" metadata
- Upload (multi-file, up to 200 MB per file, max 50 files at once)
- Create folders
- Rename files/folders
- Copy and move (with auto-rename on conflict, e.g., "report (1).pdf")
- Delete (soft-delete to trash)
- Download individual files or entire folders as ZIP
- Share link generation

### Path Traversal Protection

All file operations use the `safePath()` function:

```javascript
function safePath(projectName, subPath) {
    const root = getProjectRoot(projectName);
    const resolved = path.resolve(root, subPath || '');
    if (!resolved.startsWith(path.resolve(root) + path.sep) && resolved !== path.resolve(root)) {
        return null; // traversal attempt blocked
    }
    return resolved;
}
```

This prevents `../` attacks that could access files outside the project directory.

### Hidden Items

The file browser hides system items: `.trash`, `.filemeta.json`, `chat`, `chat-media`.

### File Metadata

Every file operation (upload, create, rename, move) updates `.filemeta.json` with the actor's email and timestamp. This is displayed as "Modified by" in the file browser.

## Trash System

Files are soft-deleted to a `.trash` directory within each project.

### Soft Delete

When a file is deleted (`DELETE /api/files`):
1. File is moved to `storage/<Project>/.trash/<originalName>_<timestamp>`
2. An entry is added to `.trash/.manifest.json` with:
   - Original name and path (for restore)
   - Who deleted it
   - 30-day expiration timestamp
3. On NAS: file is immediately deleted from NAS (NAS is not a recycle bin)

### Restore

`POST /api/files/trash/restore` moves the file back to its original location and removes the manifest entry.

### Permanent Delete

`DELETE /api/files/trash/purge` permanently removes the file from `.trash`.

### Auto-Cleanup

Expired trash items (>30 days) are automatically removed:
- On server startup: cleanup runs for all projects
- No periodic cleanup timer (only runs on startup)

## Share Links

DocPilot can generate temporary, token-based public share links for files and folders.

### Creating a Share

`POST /api/files/share?project=X` with `{ filePath, expiresIn? }`:
- Generates a cryptographically secure 12-character token (9 random bytes, base64url)
- Default expiry: 7 days (168 hours)
- Max expiry: 30 days (720 hours)
- Supports both files and folders

### Accessing a Share

`GET /share/:shareId` (no authentication required):
- **File share:** Serves a direct file download
- **Folder share:** Renders a self-contained HTML page with folder browsing and per-file download links
  - The folder browser is a single-page app embedded in the response HTML
  - Supports nested navigation within the shared folder
  - No authentication needed — the share token IS the authentication

### Share Management

- `GET /api/files/shares?project=X&filePath=Y` — List active shares for a file
- `DELETE /api/files/share?project=X` with `{ shareId }` — Revoke a share link
- Expired shares return `410 Gone`; non-existent shares return `404`
- Access count is tracked per share

### Storage

Share data is stored in `src/DataFiles/shares.json`. Expired entries are lazily cleaned on access.

## Copy & Move

### Copy (`POST /api/files/copy?project=X`)

- Deep recursive copy for directories
- Auto-renames on conflict: `report.pdf` → `report (1).pdf` → `report (2).pdf`
- Updates `.filemeta.json` for every copied file
- Fire-and-forget NAS sync for file copies; directories picked up by next full sync cycle

### Move (`POST /api/files/move?project=X`)

- Uses `fs.rename` (atomic on same filesystem)
- Prevents moving a folder into itself
- Auto-renames on conflict
- Updates `.filemeta.json` (renames all entries under old path)
- NAS sync: queues a move operation for WebDAV

## Folder Tree

`GET /api/files/tree?project=X` returns a recursive directory tree (up to 10 levels deep) for the folder picker UI used in copy/move operations. Excludes `.trash`, `chat`, and hidden directories. At root level, NAS-only directories are merged.

## WebDAV NAS Sync

**File:** `controllers/nasSync.js` (~600 lines)

Optional background sync engine that replicates project files to a WebDAV-compatible NAS (e.g., UGREEN NAS).

### Configuration

```env
NAS_SYNC_ENABLED=true
NAS_WEBDAV_URL=http://100.x.x.x:5005
NAS_USERNAME=user
NAS_PASSWORD=pass
NAS_SYNC_INTERVAL=300000        # 5 minutes
NAS_REMOTE_BASE=/Supreme
```

### Sync Behavior

1. **Full sync** runs periodically (default: every 5 minutes):
   - Walks all files in `STORAGE_ROOT`
   - Compares modification times to `.sync-manifest.json`
   - Uploads changed/new files to NAS
   - Processes queued operations (delete, rename, move, copy)

2. **Immediate sync** (`syncFile()`) fires after file uploads/saves (fire-and-forget)

3. **Operation queue** (`queueOperation()`) handles NAS-side renames, moves, deletes, and copies:
   - Persisted to `.sync-operations.json` (survives restarts)
   - Retried up to 10 times on failure

4. **48-hour cleanup** (`cleanup48h()`) — removes local copies of files that have been synced to NAS for >48 hours:
   - Verifies file exists on NAS before deleting locally
   - Never deletes the base `<ProjectName>.txt` data file
   - Never deletes the latest versioned `.txt` file per project
   - Runs every 6 hours

5. **On-demand fetch** (`nasOnDemand.js`) — transparently downloads files from NAS when they're requested but have been cleaned locally

### Skipped Files

- `node_modules`, `.git`
- `.db`, `.db-wal`, `.db-shm` (SQLite files — active binary, would corrupt)
- `.sync-manifest.json`

### Status API

`GET /api/admin/sync-status` returns current sync state:
```json
{
  "enabled": true,
  "connected": true,
  "lastSync": "2026-06-01T14:30:00.000Z",
  "lastCleanup": "2026-06-01T12:00:00.000Z",
  "pendingFiles": 2,
  "totalTracked": 1547,
  "errors": []
}
```

Manual trigger: `POST /api/admin/sync-trigger`

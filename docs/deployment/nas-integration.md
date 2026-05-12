# NAS Integration

> Architecture and operation of the VPS ↔ NAS sync system.

---

## NAS Hardware

| Field | Value |
|---|---|
| Model | UGREEN DXP4800 Plus |
| Connection | LAN (local) or via Tailscale (planned) |
| WebDAV port | 5005 (default UGREEN WebDAV) |
| Remote base path | `/Supreme` (configurable via `NAS_REMOTE_BASE`) |

---

## Architecture: Hot Cache + Cold Storage

```
┌─────────────────────┐              ┌─────────────────────┐
│   VPS (Hostinger)   │              │   NAS (UGREEN)       │
│   187.124.164.237   │              │   DXP4800 Plus        │
│                     │              │                     │
│  ┌───────────────┐  │   WebDAV     │  ┌───────────────┐  │
│  │  docpilot   │◄─┼─────────────►│  │  /Supreme/    │  │
│  │  Node.js      │  │              │  │  cold storage │  │
│  └───────────────┘  │              │  └───────────────┘  │
│         │           │              │                     │
│  ┌──────▼────────┐  │              └─────────────────────┘
│  │ geggos-storage│  │   Role:
│  │ Docker volume │  │   ● Permanent archive
│  │ (hot cache)   │  │   ● Survives VPS crashes
│  └───────────────┘  │   ● Full mirror of storage/
│                     │
│  Role:              │
│  ● App runs here    │
│  ● Serves files     │
│  ● 48h hot cache    │
└─────────────────────┘
```

**VPS = hot cache:** Stores recently accessed and recently written files. After 48 hours, confirmed-synced files are deleted from VPS to free disk space.

**NAS = permanent cold storage:** Holds a complete mirror of everything ever written. Files are never deleted from NAS (unless explicitly queued via `queueOperation('delete')`).

---

## WebDAV Sync Engine (`controllers/nasSync.js`)

### Enabling
```ini
NAS_SYNC_ENABLED=true
NAS_WEBDAV_URL=http://100.x.x.x:5005    # NAS WebDAV URL
NAS_USERNAME=webdav_user
NAS_PASSWORD=webdav_password
NAS_SYNC_INTERVAL=300000                 # 5 minutes in ms
NAS_REMOTE_BASE=/Supreme                 # Root path on NAS
```

Set `NAS_SYNC_ENABLED=false` (or omit it) to disable sync entirely. All sync functions become no-ops — the app works normally with local storage only.

### Startup
`startSync()` is called from `server.js` on startup:
1. Creates WebDAV client with credentials
2. Tests connectivity via `client.exists(REMOTE_BASE)`
3. Ensures `REMOTE_BASE` directory exists on NAS
4. Triggers initial `fullSync()` (fire-and-forget via `setImmediate`)
5. Sets up periodic sync interval (`SYNC_INTERVAL`)
6. Sets up periodic 48h cleanup interval (every 6 hours)

If NAS is unreachable at startup: app starts normally, logs a warning, retries on next sync cycle.

---

## Sync Flow: Write → NAS

```
User saves data / uploads file
     │
     ▼
File written to local storage/
     │
     ├─► HTTP response returned to user (fast)
     │
     └─► syncFile(relPath)  [fire-and-forget via setImmediate]
              │
              ▼
         uploadFile(relPath)
              │
              ├─ Read file from local disk
              ├─ ensureRemoteDirs() on NAS (MKCOL if needed)
              ├─ client.putFileContents() via WebDAV
              └─ Update sync manifest (confirmed=true, syncedAt=now)
```

**Fire-and-forget:** `syncFile()` never blocks the HTTP response. If the upload fails, it's retried on the next `fullSync()` cycle (5 minutes).

---

## Full Sync Cycle (`fullSync()`)

Runs every 5 minutes (configurable) and on startup.

```
1. Re-check connectivity if previously lost
2. Read sync manifest (.sync-manifest.json)
3. Walk all of STORAGE_ROOT/ recursively
   - Skip: .sync-manifest.json, node_modules, .git
   - Skip extensions: .db, .db-wal, .db-shm (SQLite files)
4. For each file:
   - Compare localMtime to manifest entry
   - If changed or unconfirmed: add to toSync list
5. Upload each changed file via WebDAV (putFileContents)
6. Update manifest entries (confirmed=true, syncedAt=now)
7. Process operation queue (delete/rename/move/copy ops)
8. Write updated manifest to disk
```

---

## 48-Hour Cleanup (`cleanup48h()`)

Runs every 6 hours.

```
1. Read sync manifest
2. Find latest versioned .txt file per project (protect it from cleanup)
3. For each file entry in manifest:
   - Skip: not confirmed synced
   - Skip: already cleaned (cleanedAt set)
   - Skip: synced < 48h ago
   - Skip: protected JSON files in src/DataFiles/
   - Skip: latest versioned .txt per project
   - Skip: .sync-manifest.json itself
   - Verify file still exists on NAS (if not: mark unconfirmed, skip)
   - Delete local copy: fs.unlink(localPath)
   - Set manifest entry.cleanedAt = now
4. Write updated manifest
```

**After cleanup:** The file is gone from VPS disk but remains on NAS. The manifest entry still exists with `cleanedAt` set.

---

## On-Demand Fetch (`nasOnDemand.js`)

When a route needs a file that doesn't exist locally:

```javascript
// In any route that reads a file:
const { ensureLocalFile } = require('./controllers/nasOnDemand');

const resolvedPath = await ensureLocalFile(localPath, relativePath);
// Now safe to read localPath — it exists locally
```

**Flow:**
```
1. Check fs.access(localPath) → if exists, return immediately
2. If NAS sync is disabled → throw "File not found"
3. Compute relative path from STORAGE_ROOT
4. fetchFromNAS(relativePath, localPath):
   a. client.getFileContents(remotePath)
   b. fs.mkdir(dirname(localPath), recursive)
   c. fs.writeFile(localPath, buffer)
   d. Update manifest: confirmed=true, cleanedAt cleared
5. Verify local file now exists
6. Return localPath
```

**Transparent to callers:** Routes that use `ensureLocalFile()` work identically whether the file is local or on NAS. The extra fetch latency is the only observable difference.

**Currently used in:**
- `dataRoutes.js` → `getFilePathForRead()` (reading aufmass data)
- `fileRoutes.js` → `GET /api/files/download` (downloading files)
- `fileRoutes.js` → `GET /share/:id` (file share download)
- `fileRoutes.js` → `GET /share/:id/download` (folder share file download)

---

## Unified Directory Listing (VPS ∪ NAS)

> Added 2026-04-12

When a user browses the Files module, the listing shows the **union** of files on VPS and NAS — without downloading any file content.

### How It Works

```
User opens a folder in Files module
     │
     ▼
GET /api/files?project=X&path=Y
     │
     ├─► 1. Read local VPS directory → add entries to Map
     │
     ├─► 2. listNASDirectory(relDir) → 1 WebDAV PROPFIND (metadata only)
     │      └─ Returns [{name, isDir, size, mtime}] from NAS
     │
     ├─► 3. Merge NAS entries into Map (skip duplicates — local wins)
     │      └─ Create local stub dirs for NAS-only folders (so navigation works)
     │
     └─► 4. Return unified list to client
```

**Key design decisions:**
- **No files downloaded during browsing** — only lightweight PROPFIND metadata calls
- **Local entries take priority** — if a file exists on both, local metadata shown
- **NAS-only folders get stub dirs** — empty local dirs created so `readdir` works on next navigate
- **Individual files fetched on-demand** — `ensureLocalFile()` in download routes
- **Graceful degradation** — if NAS is unreachable, listing shows local files only (no error)

### `listNASDirectory(relDir)` — nasSync.js

```javascript
// Returns array of {name, isDir, size, mtime} or null on error
async function listNASDirectory(relDir) {
    const contents = await _client.getDirectoryContents(remotePath, { deep: false });
    return contents.map(item => ({
        name: path.basename(item.filename),
        isDir: item.type === 'directory',
        size: item.size || null,
        mtime: item.lastmod ? new Date(item.lastmod) : null,
    }));
}
```

### Routes Using Unified Listing
- `GET /api/files` — main Files module browser
- `GET /share/:id/browse` — shared folder browser (public)

---

## Operation Queue

Some operations (rename, delete, move, copy) must be replicated on NAS as structured operations (not just file uploads). The operation queue handles this.

**Location:** `STORAGE_ROOT/.sync-operations.json` (persisted to disk)

**Queue operations:**

```javascript
// Delete a file from NAS
queueOperation({
  type: 'delete',
  remotePath: 'ProjectA/Doku/ClusterA/file.pdf',
  isDir: false
});

// Rename/move a file or folder on NAS
queueOperation({
  type: 'rename',
  oldRemotePath: 'ProjectA/Doku/ClusterA',
  newRemotePath: 'ProjectA/Doku/ClusterB',
  isDir: true
});

// Copy a file on NAS
queueOperation({
  type: 'copy',
  sourcePath: 'ProjectA/Doku/ClusterA/file.pdf',
  destPath: 'ProjectA/Doku/ClusterB/file.pdf'
});
```

**Processing:** At the end of every `fullSync()`, the queue is processed via WebDAV operations. Failed ops are retried up to 10 times, then discarded with error log.

**Persistence:** The queue is written to `.sync-operations.json` after every mutation. On server restart, the queue is loaded from disk — no operations are lost across restarts.

---

## Environment Variables for NAS

| Variable | Required | Default | Description |
|---|---|---|---|
| `NAS_SYNC_ENABLED` | No | `false` | Enable WebDAV sync. Must be `true` to activate. |
| `NAS_WEBDAV_URL` | If enabled | — | Full WebDAV URL (e.g. `http://100.x.x.x:5005`) |
| `NAS_USERNAME` | If enabled | — | WebDAV username |
| `NAS_PASSWORD` | If enabled | — | WebDAV password |
| `NAS_SYNC_INTERVAL` | No | `300000` | Sync interval in ms (default: 5 minutes) |
| `NAS_REMOTE_BASE` | No | `/Supreme` | Root folder on NAS WebDAV |

---

## Tailscale (Planned — Not Yet Implemented)

The VPS cannot access the NAS directly over the internet (NAS is behind a home/office NAT). The planned solution is **Tailscale** — a WireGuard-based VPN mesh.

**Current status:** WebDAV URL uses a direct LAN IP or temporary setup. Tailscale is the intended permanent solution.

**Planned setup:**
1. Install Tailscale on NAS (UGREEN supports Tailscale via Docker or native app)
2. Install Tailscale on VPS
3. Join both to the same Tailnet
4. NAS gets a stable Tailscale IP (e.g., `100.x.x.x`)
5. Set `NAS_WEBDAV_URL=http://100.x.x.x:5005`

This creates a private encrypted tunnel between VPS and NAS without exposing the WebDAV port to the public internet.

---

## Admin Sync Monitor

The admin panel has a **sync status dashboard** that shows:
- `enabled` — whether sync is configured
- `connected` — whether NAS is currently reachable
- `lastSync` — ISO timestamp of last successful full sync
- `lastCleanup` — ISO timestamp of last 48h cleanup
- `pendingFiles` — number of files not yet confirmed synced
- `totalTracked` — total files in sync manifest
- `errors` — last 50 NAS errors

**Accessed via:** `GET /api/admin/sync-status`  
**Manual trigger:** `POST /api/admin/sync-trigger` — fires a full sync immediately (fire-and-forget)

---

## What Is NOT Synced to NAS

| Item | Reason |
|---|---|
| `*.db`, `*.db-wal`, `*.db-shm` | Active SQLite files — binary snapshots would be corrupt |
| `.sync-manifest.json` | Skip list is hardcoded |
| `node_modules` | Skip list is hardcoded |
| `.git` | Skip list is hardcoded |
| `src/DataFiles/*.json` | Protected from 48h cleanup (but ARE uploaded to NAS) |

---

## Error Handling & Resilience

- **Connection failure:** Sync skips the cycle and retries next time. App continues serving files normally from local storage.
- **Upload failure:** File marked `confirmed: false` in manifest. Retried every full sync cycle.
- **Operation queue failure:** Failed ops incremented `retryCount`. After 10 failures, op is discarded and logged as error.
- **On-demand fetch failure:** `ensureLocalFile()` throws — route returns 404 to client.
- **Superlogger integration:** All NAS errors are logged to `superLogger` with type `sync` and level `error`.
- **Error log:** Rolling list of last 50 NAS errors kept in memory (`_errors` array in `nasSync.js`), included in `getSyncStatus()` response.

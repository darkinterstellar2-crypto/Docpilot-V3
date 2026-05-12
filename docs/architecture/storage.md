# Storage Architecture

> Everything about how and where docpilot stores data.

---

## STORAGE_ROOT: The Concept

All project data lives in a single root directory called `STORAGE_ROOT`.

- **Default:** `<project-root>/storage/` (relative to `server.js`)
- **Override:** Set `STORAGE_ROOT` environment variable to any absolute path
- **Docker:** Mounted as a named volume `geggos-storage` → `/data/storage`
  - Set `STORAGE_ROOT=/data/storage` in `.env`
- **Ensures on startup:** `ensureStorageRoot()` in `storageConfig.js` calls `fs.mkdir(STORAGE_ROOT, { recursive: true })` so the root always exists before anything else runs.

```
STORAGE_ROOT=./storage            # local dev
STORAGE_ROOT=/data/storage        # Docker / VPS production
```

All path-building functions in `controllers/storageConfig.js` resolve relative to `STORAGE_ROOT`. **Never hardcode project paths in route files** — always import from `storageConfig.js`.

---

## Path Helper Functions (`storageConfig.js`)

| Function | Returns |
|---|---|
| `getProjectRoot(name)` | `STORAGE_ROOT/<name>/` |
| `getDatafileDir(name)` | `STORAGE_ROOT/<name>/Doku/Aufmass/datafile/` |
| `getXlsxDir(name)` | `STORAGE_ROOT/<name>/Doku/Aufmass/xlsx/` |
| `getChatDir(name)` | `STORAGE_ROOT/<name>/chat/` |
| `getChatMediaDir(name)` | `STORAGE_ROOT/<name>/chat/media/` |
| `ensureDir(path)` | Creates directory recursively, returns path |
| `ensureStorageRoot()` | Creates STORAGE_ROOT on startup |

---

## Project Folder Structure

Every project gets the following structure under `STORAGE_ROOT/<ProjectName>/`:

```
<ProjectName>/
│
├── Doku/                                  ← All documentation files
│   ├── Aufmass/                           ← Measurement data
│   │   ├── datafile/                      ← ← CRITICAL: data lives here
│   │   │   ├── ProjectName.txt            ← Master data file (JSON)
│   │   │   ├── ProjectName_20250315_141022.txt   ← Versioned copy
│   │   │   ├── ProjectName_20250316_093045.txt   ← Another version
│   │   │   └── ...
│   │   └── xlsx/                          ← Excel exports
│   │       ├── ProjectName_20250315_141022.xlsx
│   │       └── ...
│   │
│   └── <ClusterName>/                     ← Auto-created per cluster from aufmass data
│       ├── APL/                           ← APL documents
│       │   └── <KnotenpunktName>/         ← Sub-folder per knotenpunkt
│       ├── Druckprufung/                  ← Pressure test docs
│       │   └── <KnotenpunktName>/
│       ├── Einblasen/                     ← Cable blowing docs
│       │   ├── BB/
│       │   │   └── <KnotenpunktName>/
│       │   └── HA/
│       │       └── <KnotenpunktName>/
│       ├── kalibrieren/                   ← Calibration docs
│       │   └── <KnotenpunktName>/
│       ├── Knotenpunkt_Vorbereitung/      ← Junction prep docs
│       │   └── <KnotenpunktName>/
│       ├── OTDR/                          ← OTDR test docs
│       │   └── <KnotenpunktName>/
│       ├── POP_details/                   ← POP documentation (cluster-level)
│       └── SCT_details/                   ← SCT documentation (cluster-level)
│
├── Pläne/                                 ← Plan/layout files
│   └── <ClusterName>/                     ← One folder per cluster
│
├── chat/                                  ← Project chat system
│   ├── chat.db                            ← SQLite database (WAL mode)
│   ├── .migrated                          ← Flag: legacy migration done
│   └── media/                             ← Chat media attachments
│       └── <timestamp>_<safename>.ext     ← Timestamped filenames
│
├── row-versions.json                      ← Optimistic locking version tracker for concurrent row edits
├── .filemeta.json                         ← File modification tracking
└── .trash/                                ← Soft-deleted items
    ├── .manifest.json                     ← Trash index with expiry dates
    └── <originalname>_<timestamp>         ← Deleted files/dirs (30-day hold)
```

### Auto-creation Rules
- `Doku/`, `Pläne/` → Created by `createProjectStructure()` on project creation
- `Doku/Aufmass/datafile/` and `Doku/Aufmass/xlsx/` → Created on project creation
- `Doku/<ClusterName>/` and all sub-folders → Auto-created by `folderSync.js` when a cluster appears in the aufmass data
- `Doku/<ClusterName>/<Module>/<KnotenpunktName>/` → Auto-created by `syncKnotenpunktFolders()` when a knotenpunkt appears in the data
- `chat/`, `chat/media/` → Lazily created by `chatDb.js` on first message
- `.trash/` → Created on first delete operation

---

## Data File Format (.txt with [E1, [E2]])

Despite the `.txt` extension, these files contain **JSON**. They must be valid JSON at all times.

### Top-level structure

```json
[E1, E2]
```

- `E1` — Array of main group/column header strings
- `E2` — `E2[0]` = sub-headers (array of arrays of strings), `E2[1..N]` = data rows

### Complete annotated example

```json
[
  ["Identification", "Location", "Cable", "APL"],
  [
    [
      ["Unique Project ID", "Metadata"],
      ["Address Start", "Address End"],
      ["Cable Name", "Fiber Type"],
      ["APL Status", "APL Date"]
    ],
    [
      ["ROW-001", ""],
      ["Zeilerweg 11", "Zeilerweg 15"],
      ["KAB-001", "G.652D"],
      ["Done", "2025-03-15"]
    ],
    [
      ["ROW-002", ""],
      ["Hauptstr. 4", "Hauptstr. 8"],
      ["KAB-002", "G.657A2"],
      ["Pending", ""]
    ]
  ]
]
```

### Addressing cells
- `rawData[0]` → E1 (main group headers)
- `rawData[1][0]` → E2_0 (sub-headers, array of arrays)
- `rawData[1][0][groupIdx][colIdx]` → subcolumn name
- `rawData[1][rowIdx+1]` → data row (rowIdx is 0-based in data)
- `rawData[1][rowIdx+1][groupIdx][colIdx]` → cell value
- `col-i-j` → API identifier for group `i`, column `j`
- `rawData[1][rowIdx+1][0][0]` → **Unique row ID** (primary key)

> **Note:** Current production uses `[E1, E2]` as documented above. A future `[E1, E2, E3]` format with additional column metadata (format codes, widths) is being explored in the DocPilot-Futures repo and is **not** used in production.

### Special columns (by label, case-insensitive)
| Label | Purpose |
|---|---|
| `Unique Project ID` | Row primary key (always group 0, col 0) |
| `Cluster` | Drives folder structure auto-sync |
| `Knotenpunkt` or `NVT` | Drives sub-folder creation per cluster |
| `APL Status` | Triggers OTDR auto-set when 'Done' |
| `Knotenpunkt Status` | Triggers OTDR auto-set when 'Done' |
| `OTDR Status` | Auto-set to 'Waiting' when APL+Knoten are Done |
| `Address Start` | Used in module navigation tree |
| `Address End` | Used in module navigation tree |
| `Cable Name` | Used in module navigation tree |
| `Fiber Type` | Used in module navigation tree |

---

## Versioning System

Every time the aufmass data is saved (via `POST /api/data` or `POST /api/modules/aufmass-update`), a **versioned copy** is created automatically.

**Implemented in:** `controllers/dataVersioning.js` — `saveVersionedCopy()`

### Versioned .txt copy
- Location: same directory as main file (`Doku/Aufmass/datafile/`)
- Filename: `<ProjectName>_YYYYMMDD_HHMMSS.txt`
- Format: same JSON structure as main file
- Example: `SupremeBau_20250315_141022.txt`

### Excel (.xlsx) export
- Location: `Doku/Aufmass/xlsx/`
- Filename: `<ProjectName>_YYYYMMDD_HHMMSS.xlsx`
- Sheet name: `Aufmass`
- Row 1: main headers (merged across sub-columns)
- Row 2: sub-headers
- Row 3+: data rows (all values as strings)
- Main header cells are **merged** across their sub-column span

### Timestamp format
```
YYYYMMDD_HHMMSS
20260404_213045  ← April 4 2026 at 21:30:45
```

### Reading: latest version wins
When reading data, `getFilePathForRead()` in `dataRoutes.js`:
1. Scans `datafile/` directory for versioned files matching `ProjectName_\d{8}_\d{6}.txt`
2. Sorts newest-first (string comparison works because YYYYMMDD_HHMMSS is lexicographically sortable)
3. Returns the newest versioned file if any exist
4. Falls back to `ProjectName.txt` (base file) if no versioned copies

### NAS cleanup protection
The **latest** versioned `.txt` per project is never deleted from VPS during 48h cleanup (even if synced > 48h ago). See `nasSync.js` → `cleanup48h()`.

---

## File Metadata (.filemeta.json)

Every project has a `.filemeta.json` at the project root that tracks who last modified each file.

**Location:** `STORAGE_ROOT/<ProjectName>/.filemeta.json`

**Format:**
```json
{
  "Doku/Aufmass/datafile/ProjectName.txt": {
    "modifiedBy": "admin@company.de",
    "modifiedAt": "2026-04-04T21:30:45.123Z"
  },
  "Doku/ClusterA/APL/NVT-001/photo.jpg": {
    "modifiedBy": "worker@company.de",
    "modifiedAt": "2026-04-03T10:15:00.000Z"
  }
}
```

**Keys:** Relative path from project root, forward slashes  
**Set by:** `setFileMeta(projectName, relativePath, userEmail)` in `fileMeta.js`  
**Rename tracking:** `renameFileMeta()` updates all matching keys (including children for folder renames)  
**Shown in:** File manager listing (modifiedBy + modifiedAt columns)

System-created entries use `"Automated-System"` as the `modifiedBy` value.

---

## Trash System (.trash/)

Deleting a file or folder does **not** immediately remove it. Instead it's moved to `.trash/` with a 30-day expiry.

**Location:** `STORAGE_ROOT/<ProjectName>/.trash/`

### Trash manifest (.manifest.json)
```json
{
  "items": [
    {
      "id": "1712345678901",
      "originalName": "report.pdf",
      "originalPath": "Doku/ClusterA/APL/NVT-001",
      "trashName": "Doku_ClusterA_APL_NVT-001_report.pdf_1712345678901",
      "deletedBy": "admin@company.de",
      "deletedAt": "2026-04-04T21:00:00.000Z",
      "isDir": false,
      "expiresAt": "2026-05-04T21:00:00.000Z"
    }
  ]
}
```

### Trash lifecycle
1. **Delete:** `DELETE /api/files?project=X&path=...&file=Z`
   - Moves to `.trash/<flatPath>_<timestamp>`
   - Adds entry to `.manifest.json` with `expiresAt = now + 30 days`
   - Queues NAS `delete` operation (file removed from NAS immediately)
2. **List:** `GET /api/files/trash?project=X` — returns manifest items (runs auto-cleanup first)
3. **Restore:** `POST /api/files/trash/restore?project=X` — moves back to original location
4. **Purge:** `DELETE /api/files/trash/purge?project=X` — permanently deletes from trash
5. **Auto-expire:** `cleanExpiredTrash()` runs on startup for all projects, and before each trash listing

### Who can use trash
- **List trash:** any user (read-only)
- **Restore / Purge:** admin, administrator, superadmin (user role blocked)

---

## Chat Storage (Per-Project SQLite DB)

Each project has a completely isolated SQLite database for its chat.

**Location:** `STORAGE_ROOT/<ProjectName>/chat/chat.db`  
**Engine:** `better-sqlite3` with WAL journal mode  
**Documentation:** See [chat.md](./chat.md) for complete details.

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS messages (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email        TEXT NOT NULL,
    user_name         TEXT NOT NULL,
    message           TEXT NOT NULL DEFAULT '',
    media_url         TEXT DEFAULT NULL,
    media_type        TEXT DEFAULT NULL,     -- 'image' | 'video' | 'file'
    original_filename TEXT DEFAULT NULL,
    created_at        DATETIME DEFAULT (datetime('now')),
    edited_at         DATETIME DEFAULT NULL,
    deleted           INTEGER DEFAULT 0      -- soft delete flag
);

CREATE INDEX IF NOT EXISTS idx_messages_id ON messages(id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
```

Chat media files live at: `STORAGE_ROOT/<ProjectName>/chat/media/<timestamp>_<safename>.ext`

### ⚠ SQLite files are NEVER synced to NAS
`nasSync.js` skips `.db`, `.db-wal`, `.db-shm` files entirely. They are active binary files that would be corrupted by a WebDAV snapshot. They also must never be cleaned from VPS.

---

## App-Level Data Files (src/DataFiles/)

> ⚠️ **Case-sensitivity warning (Linux):** There are two completely separate directories with similar names:
> - `src/DataFiles/` (PascalCase) — application-level config files (users.json, shares.json, settings.json, etc.)
> - `datafile/` (lowercase) — lives inside each project's `Doku/Aufmass/` folder, contains the versioned `.txt` data files
>
> On Linux/Docker these are distinct paths. Do not confuse them — they serve entirely different purposes.

These are NOT project data — they are the application's own config/state files.

**Location inside Docker:** `/app/src/DataFiles/` (mounted as named volume `docpilotdata`)

| File | Purpose | Format | Max size |
|---|---|---|---|
| `users.json` | User accounts | JSON array | Unbounded |
| `projects.json` | Project registry | JSON array | Unbounded |
| `logs.json` | Audit log | JSON array (newest first) | 1,000 entries |
| `schema.json` | Reserved (not used yet) | JSON array | — |
| `super-log.json` | System event log | JSON array | 5,000 entries (rolling) |
| `access-control.json` | ACL rules | JSON object | Unbounded |
| `sessions-log.json` | Login/logout history | JSON array | 10,000 entries |
| `shares.json` | Active share links | JSON object | Unbounded |
| `terminated-sessions.json` | Force-terminated user sessions (cleared on re-login) | JSON object | Runtime |
| `project-info.json` | Per-project metadata: description, custom fields, members array | JSON object | Unbounded |
| `settings.json` | App settings: generatorCode, generatorUrl, generatorApiUrl, generatorAllowedUsers[] | JSON object | Unbounded |
| `.jwt-secret` | Auto-generated JWT signing secret (gitignored) | Plain text | 128 hex chars |

All files are created with empty defaults (`[]` or `{}`) on first startup if they don't exist (`ensureDataFiles()` in `server.js`).

---

## NAS Sync System

See [nas-integration.md](../deployment/nas-integration.md) for full details.

**Overview:**
- Background sync runs every 5 minutes (configurable via `NAS_SYNC_INTERVAL`)
- On every write operation: `syncFile(relPath)` pushes the file to NAS immediately (fire-and-forget)
- After 48 hours of confirmed sync: local files are deleted to save VPS disk space
- On read: `ensureLocalFile()` transparently fetches from NAS if file is missing locally
- Operation queue (`queueOperation()`): rename/move/delete/copy operations are replicated on NAS

### Sync Manifest (.sync-manifest.json)
**Location:** `STORAGE_ROOT/.sync-manifest.json`

```json
{
  "files": {
    "ProjectA/Doku/Aufmass/datafile/ProjectA.txt": {
      "localMtime": "2026-04-04T21:30:45.000Z",
      "syncedAt": "2026-04-04T21:30:47.123Z",
      "confirmed": true,
      "size": 45231
    },
    "ProjectA/Doku/ClusterA/APL/NVT-001/photo.jpg": {
      "localMtime": "2026-04-03T10:15:00.000Z",
      "syncedAt": "2026-04-03T10:15:05.000Z",
      "confirmed": true,
      "cleanedAt": "2026-04-05T10:00:00.000Z",
      "size": 2398402
    }
  },
  "lastFullSync": "2026-04-04T21:35:00.000Z",
  "lastCleanup": "2026-04-04T18:00:00.000Z"
}
```

**Fields:**
- `localMtime` — last-modified timestamp of local file (used to detect changes)
- `syncedAt` — when the file was last successfully pushed to NAS
- `confirmed` — `true` = NAS has the current version
- `size` — file size in bytes
- `cleanedAt` — when the local copy was deleted (file now only on NAS)

### Operation Queue (.sync-operations.json)
**Location:** `STORAGE_ROOT/.sync-operations.json`

Persisted to disk so pending operations survive server restarts.

```json
[
  {
    "type": "rename",
    "oldRemotePath": "ProjectA/Doku/ClusterA",
    "newRemotePath": "ProjectA/Doku/ClusterB",
    "isDir": true,
    "timestamp": "2026-04-04T21:00:00.000Z",
    "retryCount": 0
  },
  {
    "type": "delete",
    "remotePath": "ProjectA/Doku/ClusterA/APL/NVT-001/old.pdf",
    "isDir": false,
    "timestamp": "2026-04-04T21:01:00.000Z",
    "retryCount": 0
  }
]
```

**Operation types:**
| Type | Description | Fields |
|---|---|---|
| `delete` | Remove file/dir from NAS | `remotePath`, `isDir` |
| `rename` | Rename/rename in place on NAS | `oldRemotePath`, `newRemotePath`, `isDir` |
| `move` | Move to different location on NAS | `oldRemotePath`, `newRemotePath`, `isDir` |
| `copy` | Copy file/dir on NAS | `sourcePath`, `destPath` |

Operations are processed at the end of every `fullSync()` cycle. Failed operations are retried up to 10 times, then discarded with an error log.

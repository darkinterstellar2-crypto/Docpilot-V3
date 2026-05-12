# Files Module

**File:** `routes/fileRoutes.js` (backend), `files.html` + inline scripts (frontend)  
**Page:** `files.html`  
**ACL Key:** `files`  
**Purpose:** General-purpose file manager for a project. Browse, upload, create folders, rename, move, copy, delete (→ trash), restore, share, and download files. Synced with NAS.

---

## Overview

The Files module is the project-level file browser. Unlike the task modules (Einblasen, APL, etc.), it's not tied to Aufmass rows. It gives full filesystem access within the project's storage root, with:
- Folder navigation (breadcrumb)
- Drag-and-drop upload (up to 50 files, 200 MB each)
- Folder creation
- Rename / move / copy operations
- Soft delete → 30-day recycle bin
- Public share links (file or folder, 1–720 hours)
- NAS sync (transparent to user)
- Folder ZIP download

---

## User Flow

```
Dashboard → files.html?project=X
    ↓
Root folder listing
    ↓
Navigate into folders (click), use breadcrumb to go back
    ↓
Actions on files/folders:
    ├── Click file → download
    ├── Drag files into window → upload
    ├── [+ New Folder] button → create folder
    ├── Right-click / action menu → rename, move, copy, delete, share
    └── Toolbar → recycle bin view
```

---

## UI Components

- **Breadcrumb**: clickable path from project root
- **File list**: sorted (folders first, then files, both alphabetical)
  - Name, size, last modified, modified-by (from fileMeta)
  - Folder icon, file type icon
- **Drag-and-drop zone**: the whole file list area accepts drops
- **Action toolbar**: New Folder, Upload, Recycle Bin
- **Context menu** (right-click or three-dot menu):
  - Download
  - Rename
  - Copy → folder picker tree
  - Move → folder picker tree
  - Delete (→ trash)
  - Share → creates share link with expiry selector
- **Folder picker tree**: built from `GET /api/files/tree`, up to 10 levels deep
- **Recycle Bin panel**: lists deleted items (name, deleted by, expires at), restore or purge

---

## Backend Endpoints

All mounted under `/api/files/`:

### File Listing
```
GET /api/files?project=X&path=Y
```
Returns unified listing: local ∪ NAS (NAS items merged if NAS is enabled). Hidden: `.trash`, `.filemeta.json`, `chat`, `chat-media`.  
Response: `{ success, items: [{name, isDir, size, mtime, modifiedBy, modifiedAt}] }`

### Upload
```
POST /api/files/upload?project=X&path=Y
Content-Type: multipart/form-data, field: files[] (up to 50 files)
```
Requires `canEditProject`. Saves to `STORAGE_ROOT/<project>/<path>/`, then syncs to NAS.

### Create Folder
```
POST /api/files/folder?project=X&path=Y
Body: { name }
```

### Rename
```
POST /api/files/rename?project=X&path=Y
Body: { oldName, newName }
```
Also renames in fileMeta. Queues NAS rename operation.

### Delete (→ Trash)
```
DELETE /api/files?project=X&path=Y&file=Z
```
Moves file to `<projectRoot>/.trash/` with timestamp-based trash name. Updates `.trash/.manifest.json`. Queues NAS delete.

### Copy
```
POST /api/files/copy?project=X
Body: { source: "relative/path/file.pdf", destination: "relative/dest/folder" }
```
Deep copies file/folder. Auto-renames if conflict (`file (1).pdf`). Syncs copy to NAS.

### Move
```
POST /api/files/move?project=X
Body: { source, destination }
```
Renames (atomic). Cannot move folder into itself. Auto-renames on conflict. Queues NAS move.

### Folder Tree (for picker)
```
GET /api/files/tree?project=X
```
Returns recursive directory tree up to 10 levels deep (dirs only). Merges NAS top-level dirs.  
Response: `{ success, tree: { name: 'Root', path: '', children: [...] } }`

### Download File
```
GET /api/files/download?project=X&path=Y&file=Z
```
Authenticated download. Fetches from NAS on-demand if not locally available.

### Download Folder (ZIP)
```
GET /api/files/download-folder?project=X&path=folderPath
```
Streams a ZIP archive of the folder using `archiver`.

---

## Recycle Bin

### Manifest file
```
<projectRoot>/.trash/.manifest.json
{
  "items": [{
    "id": "timestamp",
    "originalName": "file.pdf",
    "originalPath": "some/subfolder",
    "trashName": "some_subfolder_file.pdf_1713000000000",
    "deletedBy": "user@example.com",
    "deletedAt": "2026-04-13T12:00:00Z",
    "isDir": false,
    "expiresAt": "2026-05-13T12:00:00Z"
  }]
}
```

Items auto-expire after **30 days**. Cleanup runs:
- On server startup (for all projects)
- Before every trash listing request

### Endpoints

```
GET    /api/files/trash?project=X              → list items
POST   /api/files/trash/restore?project=X      → restore item { id }
DELETE /api/files/trash/purge?project=X        → permanently delete { id }
```

Restore re-uploads to NAS (fire-and-forget). Purge skips NAS (NAS already deleted on initial delete).

---

## Share Links

### Create Share
```
POST /api/files/share?project=X
Body: { filePath: "relative/path/file.pdf", expiresIn: 168 }
```
Generates a 12-char URL-safe token. Expiry: 1–720 hours (default 168 = 7 days).  
Response: `{ success, shareId, shareUrl: "/share/{shareId}", shareType, expiresAt }`

### Share URL
```
GET /share/{shareId}
```
No auth required (share token is the auth). For files: streams download. For folders: serves a self-contained HTML folder browser.

### Folder share browsing
```
GET /share/{shareId}/browse?path=subfolder
GET /share/{shareId}/download?file=subfolder/name.pdf
```

### List Shares for a file
```
GET /api/files/shares?project=X&filePath=Y
```

### Revoke Share
```
DELETE /api/files/share?project=X
Body: { shareId }
```

Share data persists in:
```
src/DataFiles/shares.json
```

---

## File Metadata (`fileMeta`)

Tracks `modifiedBy` (user email) and `modifiedAt` (timestamp) per file path. Stored in:
```
<projectRoot>/.filemeta.json
```

Updated on: upload, folder create, rename, move (destination), copy (destination).

---

## NAS Sync

- **Upload**: `syncFile(relPath)` fires after every file write (fire-and-forget)
- **Delete**: `queueOperation({ type: 'delete', remotePath, isDir })` — NAS doesn't have a trash
- **Rename/Move**: `queueOperation({ type: 'rename'|'move', ... })`
- **Copy**: `syncFile()` for the copy destination
- **Download**: `ensureLocalFile(absPath, relPath)` fetches from NAS if missing locally
- **Listing**: merges NAS items (via `listNASDirectory`) into local listing

---

## ACL / Permissions

| Operation | Required Permission |
|---|---|
| List files | `canAccessProject` + `canAccessModule('files')` |
| Download | Same as list |
| Upload | Above + `canEditProject` |
| Create folder | Above + `canEditProject` |
| Rename | Above + `canEditProject` |
| Copy / Move | `canEditProject` |
| Delete | `canEditProject` |
| Share create/revoke | `canEditProject` |
| Trash restore/purge | `canEditProject` |

Superadmin bypasses all checks.

---

## Path Traversal Protection

All paths go through `safePath(projectName, subPath)` which resolves and checks:
```js
resolved.startsWith(resolvedRoot + path.sep)
```
Returns `null` on traversal attempt → 400 response.

System files protected from deletion: `.filemeta.json`, `.trash`.

---

## Key Code Files

- `routes/fileRoutes.js` — all endpoints (~850 lines)
- `files.html` — frontend UI + inline scripts
- `controllers/nasSync.js` — NAS sync logic
- `controllers/nasOnDemand.js` — on-demand fetch
- `controllers/fileMeta.js` — metadata read/write
- `controllers/storageConfig.js` — `STORAGE_ROOT`, `getProjectRoot()`

---

## Recent Changes (2026-04-13 to 2026-04-14)

- **Folder ZIP download**: `GET /api/files/download-folder` using archiver
- **Folder share browsing**: self-contained HTML page served at `/share/{id}`, with `/browse` and `/download` sub-routes
- **NAS on-demand fetch**: files missing locally are transparently fetched from NAS before download
- **Path traversal sep-suffix fix**: hardened against prefix-match attacks (e.g. `/storage/Foo` vs `/storage/FooBar`)

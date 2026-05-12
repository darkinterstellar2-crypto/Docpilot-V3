# File Manager Module

## Overview

### What it does

**For the field worker:** The File Manager is a full file browser for the project's document storage. Users can browse folders, download files, view images, and (if they have edit access) upload files, create folders, rename files/folders, and delete items (moved to a recycle bin, not permanently deleted immediately). It's essentially a Finder/Explorer-style interface scoped to one project's `Doku/` folder.

**For the developer:** This is a standalone module — no `ModuleNavigator`, no schema involvement. It talks directly to `fileRoutes.js` endpoints. It supports: directory listing with breadcrumb navigation, multi-file upload (drag-and-drop to anywhere on the page or via "New" dropdown), folder creation, rename, trash/restore/purge, and a search/filter bar. There's also a trash panel (recycle bin with 30-day expiry) accessible via a dedicated button. Admin users get "Replace All" and rename capabilities that are hidden from read-only users.

### Why it exists in the workflow

Module uploads (Einblasen, APL, OTDR etc.) put files in the right place automatically. But sometimes:
- Someone needs to upload an ad-hoc supporting document
- A manager needs to browse what's been uploaded
- A file got uploaded to the wrong folder and needs to be moved
- Someone needs to download files for offline review or handover

The File Manager covers all these cases.

### Domain terms

| Term | Meaning |
|------|---------|
| **Doku/** | The documentation root folder inside each project's storage directory |
| **Trash / Recycle Bin** | Files moved here on "delete" — recoverable for 30 days before permanent deletion |
| **Manifest** | `.trash/.manifest.json` — JSON file tracking all trash items with expiry dates |
| **NAS** | Network Attached Storage — DocPilot syncs uploads to a NAS device; file manager triggers sync |

---

## User Journey (Step by Step)

### 1. Dashboard → File Manager

`dashboard.html?project=PROJECTNAME` → **Files** card → `files.html?project=PROJECTNAME`

Auth guard: checks `localStorage.getItem('userRole')` inline (before DOMContentLoaded).

Header shows:
- Back button → dashboard
- File folder icon + project name
- **"New" dropdown button** (admin/editor only — hidden for read-only users via `#newBtnWrap` `display:none`)
- User profile icon

### 2. Directory Listing

Page loads and calls:
```
GET /api/files/list?project=SUPPN&path=Doku
```

Renders a grid/list view of the Doku root:
- Folder cards: amber folder icon, folder name, entry count
- File rows: file type icon (PDF = red, SOR = purple, image = green, etc.), filename, size, last modified date
- For images: thumbnail preview on hover (or inline)

**Toolbar:**
- **Search box** — filters the current directory listing by name (client-side, instant)
- **View toggle** — Grid / List
- **Sort options** — Name, Date, Size

### 3. Navigate to Subfolder

Clicking a folder card calls `loadDirectory(newPath)`. Breadcrumb updates.

Path structure follows the module storage layout:
```
Doku/
├── CLUSTER/
│   ├── Einblasen/
│   │   └── NVt-14/
│   ├── Druckprufung/
│   ├── kalibrieren/
│   ├── APL/
│   │   └── NVt-14/
│   │       └── Zeilerweg-11/
│   ├── Knotenpunkt_Vorbereitung/
│   │   └── NVt-14/
│   └── OTDR/
│       └── NVt-14/
│           └── Zeilerweg-11/
└── Aufmass/
    └── datafile/
```

### 4. Upload Files

**Admin/editor only.** Two entry points:
1. "New" dropdown → "Upload Files" → multi-file picker opens (`#fileInputMulti`)
2. "New" dropdown → "Upload Folder" → directory picker opens (`#folderInputDir`, `webkitdirectory`)
3. **Drag anywhere on the page** → `#dragOverlay` appears ("Drop files to upload") → release → upload to current directory

Upload handler:
- Shows progress bar per file
- `POST /api/files/upload?project=SUPPN&path=Doku/CLUSTER/Einblasen/NVt-14` (multipart)
- After each upload: row appears in the listing
- After all done: success toast

### 5. Create Folder

"New" dropdown → "New Folder" → `createFolder()` called:
1. `showPrompt('New Folder', 'Enter folder name:')` modal
2. On confirm: `POST /api/files/folder?project=SUPPN&path=Doku/CLUSTER` with `{ name: 'NewFolderName' }`
3. New folder card appears in listing

### 6. Rename File/Folder

Right-click context menu or inline "Rename" button (admin only):
1. Inline edit mode: filename becomes a text input
2. On blur/Enter: `POST /api/files/rename?project=SUPPN` with `{ oldPath, newName }`
3. UI updates the name

### 7. Delete (Move to Trash)

"Delete" button or keyboard Delete on selected item (admin/editor):
1. `showConfirm('Move to Trash', 'Move to recycle bin?')`
2. `DELETE /api/files?project=SUPPN&path=Doku/CLUSTER&file=filename.pdf`
3. Item moves to `.trash/` (server side) and disappears from listing
4. Toast: "Moved to trash"

### 8. Trash Panel

Clicking the trash icon opens the recycle bin panel:
```
GET /api/files/trash?project=SUPPN
```

Shows list of trashed items with:
- Name, original path, deletion date, expiry date
- **Restore** button → `POST /api/files/trash/restore?project=SUPPN` with `{ id }`
- **Delete Forever** button (admin) → `DELETE /api/files/trash/purge?project=SUPPN` with `{ id }`

### 9. Download

Clicking a file name / download button:
```
GET /api/files/download?project=SUPPN&path=Doku/CLUSTER/Einblasen/NVt-14/filename.pdf
```

Browser triggers native file download.

---

## Technical Architecture

### Frontend Files

| File | Role |
|------|------|
| `files.html` | Page shell — header with New button, drag overlay, hidden file inputs |
| `src/js/files.js` | All file manager logic (implied — not explicitly read, but the module is complete) |

### Backend Routes (`fileRoutes.js`)

#### GET /api/files/list
```
GET /api/files/list?project=SUPPN&path=Doku
Headers: x-user-email, x-user-role
```

**Response:**
```json
{
  "success": true,
  "entries": [
    {
      "name": "SUPPN",
      "type": "directory",
      "count": 4,
      "mtime": "2026-04-14T12:00:00.000Z"
    },
    {
      "name": "report.pdf",
      "type": "file",
      "size": 204800,
      "mtime": "2026-04-14T14:30:00.000Z",
      "mime": "application/pdf"
    }
  ]
}
```

Entries from NAS are fetched on-demand if not cached locally (`ensureLocalFile()`).

#### POST /api/files/upload
```
POST /api/files/upload?project=SUPPN&path=Doku/SUPPN/Einblasen/NVt-14
Content-Type: multipart/form-data
Headers: x-user-email, x-user-role

[multipart files]
```

- Uses Multer with `diskStorage`
- `destination`: resolved via `safePath(project, path)` — path traversal blocked
- `filename`: `path.basename(originalname).replace(/[/\\]/g, '_')` — sanitized
- 200MB per-file limit
- Fires `syncFile()` after each successful write (NAS sync)

**Response:**
```json
{
  "success": true,
  "files": [
    { "name": "report.pdf", "path": "Doku/SUPPN/Einblasen/NVt-14/report.pdf", "size": 204800 }
  ]
}
```

#### POST /api/files/folder
```
POST /api/files/folder?project=SUPPN&path=Doku/SUPPN
Body: { "name": "NewFolder" }
```

Creates directory. Response: `{ success: true }`.

#### POST /api/files/rename
```
POST /api/files/rename?project=SUPPN
Body: {
  "oldPath": "Doku/SUPPN/Einblasen/NVt-14/oldname.pdf",
  "newName": "newname.pdf"
}
```

Uses `fsAsync.rename()`. Also calls `renameFileMeta()` to update any stored metadata. Response: `{ success: true }`.

#### DELETE /api/files (move to trash)
```
DELETE /api/files?project=SUPPN&path=Doku/SUPPN/Einblasen/NVt-14&file=report.pdf
Headers: x-user-email, x-user-role
```

**What happens server-side:**
1. Resolves full path via `safePath()`
2. Generates a UUID for the trash item
3. Copies to `.trash/{uuid}_{original_name}` (timestamp-safe naming)
4. Updates `.trash/.manifest.json` with: `{ id, originalName, originalPath, trashName, deletedAt, expiresAt, isDir }`
5. Removes the original
6. Queues NAS delete operation

**Response:**
```json
{ "success": true, "id": "uuid-of-trash-item" }
```

#### GET /api/files/trash
```
GET /api/files/trash?project=SUPPN
```

Also runs `cleanExpiredTrash()` before returning (auto-purges items older than 30 days).

**Response:**
```json
{
  "success": true,
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "originalName": "report.pdf",
      "originalPath": "Doku/SUPPN/Einblasen/NVt-14",
      "deletedAt": "2026-04-10T09:00:00.000Z",
      "expiresAt": "2026-05-10T09:00:00.000Z",
      "isDir": false
    }
  ]
}
```

#### POST /api/files/trash/restore
```
POST /api/files/trash/restore?project=SUPPN
Body: { "id": "550e8400-e29b-41d4-a716-446655440000" }
```

Moves file from `.trash/` back to `originalPath/originalName`. Creates parent dirs if needed. Fires NAS sync for restored file. Response: `{ success: true }`.

#### DELETE /api/files/trash/purge
```
DELETE /api/files/trash/purge?project=SUPPN
Body: { "id": "..." }
```

Permanently deletes from `.trash/`. Removes manifest entry. Response: `{ success: true }`.

#### GET /api/files/download
```
GET /api/files/download?project=SUPPN&path=Doku/SUPPN/Einblasen/NVt-14/report.pdf
Headers: x-user-email, x-user-role
```

Streams the file as a download (appropriate `Content-Disposition: attachment` header). Calls `ensureLocalFile()` first — if the file is on NAS but not local cache, it's fetched from NAS before streaming.

### Data Flow Diagram

```
files.html loads
    │
    ▼
GET /api/files/list?path=Doku — renders entry grid
    │
    ▼ user navigates into subfolder
GET /api/files/list?path=Doku/CLUSTER/Einblasen/NVt-14
    │
    ├─ Upload: POST /api/files/upload → writes to disk, fires NAS sync
    ├─ New Folder: POST /api/files/folder
    ├─ Rename: POST /api/files/rename
    ├─ Delete: DELETE /api/files → moves to .trash/, updates manifest
    └─ Download: GET /api/files/download → ensureLocalFile + stream
    
Trash panel:
    └─ GET /api/files/trash
       ├─ POST /api/files/trash/restore → moves back from trash
       └─ DELETE /api/files/trash/purge → permanent delete
```

---

## Data Model

### Storage Structure

```
STORAGE_ROOT/
└── {PROJECT}/               ← getProjectRoot(project)
    ├── Doku/                ← browseable root (module files live here)
    └── .trash/              ← hidden trash directory
        ├── .manifest.json   ← trash manifest
        └── {uuid}_{name}    ← trashed files/folders
```

### Trash Manifest Format

```json
{
  "items": [
    {
      "id": "uuid",
      "originalName": "report.pdf",
      "originalPath": "Doku/SUPPN/Einblasen/NVt-14",
      "trashName": "uuid_report.pdf",
      "deletedAt": "2026-04-10T09:00:00.000Z",
      "expiresAt": "2026-05-10T09:00:00.000Z",
      "isDir": false
    }
  ]
}
```

Items expire after 30 days. Expiry check runs on every `GET /api/files/trash` call and on server startup.

### File Meta

`fileMeta` module stores additional per-file metadata (e.g. display name overrides, custom tags). Not required for basic operation. Uses `getFileMeta()`, `setFileMeta()`, `renameFileMeta()`.

---

## Path Security

The `safePath()` function is the primary defense against path traversal:

```js
function safePath(projectName, subPath) {
    const root = getProjectRoot(projectName);
    const resolved = path.resolve(root, subPath || '');
    const resolvedRoot = path.resolve(root);
    // Prevent prefix-match attacks: "/storage/Foo" must not match "/storage/FooBar"
    if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
        return null; // traversal attempt — caller returns 400
    }
    return resolved;
}
```

Called on every file operation. Returns `null` on traversal attempt → all routes return `400 Invalid path`.

---

## Permissions / ACL

### ACL Enforcement Function (`canEditFiles`)

```js
async function canEditFiles(req, project) {
    const email = req.headers['x-user-email'] || '';
    const role  = (req.headers['x-user-role'] || '').toLowerCase();
    if (role === 'superadmin') return true;
    const projectOk = await canAccessProject(email, project);
    const editOk    = await canEditProject(email, project);
    return projectOk && editOk;
}
```

Used for: upload, folder creation, rename, delete, trash restore, purge.

**Read operations** (list, download) only require `canAccessProject()`.

### Frontend Role Check

`#newBtnWrap` is hidden (`display:none`) by default. After loading, the frontend checks user role and shows it for admin/editor users. Read-only users see no New/Upload/Delete controls.

---

## Dependencies

- Project root directory must exist under `STORAGE_ROOT`
- No dependency on aufmass data file — this module is purely storage-based
- NAS sync is optional — operates fine without it (fire-and-forget)

---

## Code Walkthrough

### `cleanExpiredTrash(projectName)`

```js
async function cleanExpiredTrash(projectName) {
    const manifest = await readManifest(projectName);
    const now = new Date();
    const remaining = [];
    for (const item of manifest.items) {
        if (new Date(item.expiresAt) <= now) {
            // Permanently delete
            const trashPath = path.join(getTrashDir(projectName), item.trashName);
            const stat = await fsAsync.stat(trashPath);
            if (stat.isDirectory()) {
                await fsAsync.rm(trashPath, { recursive: true, force: true });
            } else {
                await fsAsync.unlink(trashPath);
            }
        } else {
            remaining.push(item);
        }
    }
    manifest.items = remaining;
    await writeManifest(projectName, manifest);
}
```

Runs on startup (for all projects) and on every `GET /api/files/trash` request.

### Multer Upload Config

```js
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const { project, path: subPath } = req.query;
            const dest = safePath(project, subPath || '');
            if (!dest) return cb(new Error('Invalid path'), null);
            fs.mkdirSync(dest, { recursive: true });   // auto-create dir
            cb(null, dest);
        },
        filename: (req, file, cb) => {
            const safe = path.basename(file.originalname).replace(/[/\\]/g, '_');
            cb(null, safe || 'unnamed');
        }
    }),
    limits: { fileSize: 200 * 1024 * 1024 }  // 200MB
});
```

Path traversal is blocked at `destination` level — if `safePath` returns null, Multer errors out before writing anything.

### NAS Integration

After file writes:
```js
syncFile(relPath);               // fire-and-forget: push to NAS
queueOperation('delete', path);  // queue NAS delete on trash
```

Before file reads:
```js
await ensureLocalFile(project, relPath);  // pull from NAS if not local
```

NAS sync is conditional: `if (nasIsEnabled())` check before each operation.

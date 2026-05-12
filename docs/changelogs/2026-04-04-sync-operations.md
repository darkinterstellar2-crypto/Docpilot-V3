# Changelog: Sync Engine — File Operations (2026-04-04)

## Summary

Extended the NAS sync engine (`controllers/nasSync.js`) to replicate file operations — delete, rename, move, and copy — to the NAS via WebDAV. Previously the sync engine was additive-only (upload new/changed files). Now any structural change made through the file manager is queued and replicated on the NAS.

---

## Changes

### `controllers/nasSync.js`

#### New: Operation Queue

- Added `_operationQueue` — in-memory array of pending file operations.
- Added `OPERATIONS_PATH` — persisted queue at `storage/.sync-operations.json`.
- Queue survives server restarts: `loadOperationQueue()` reads the file on first access, `saveOperationQueue()` writes after every mutation.

#### New: `queueOperation(op)` (exported)

Fire-and-forget function that enqueues a file operation for NAS replication.  
Is a **no-op** when `NAS_SYNC_ENABLED=false`.

Supported operation shapes:
```js
{ type: 'delete', remotePath: 'Project/sub/file.pdf', isDir: false }
{ type: 'rename', oldRemotePath: '...', newRemotePath: '...', isDir: false }
{ type: 'move',   oldRemotePath: '...', newRemotePath: '...', isDir: false }
{ type: 'copy',   sourcePath: '...',   destPath: '...' }
```

All paths are relative to `REMOTE_BASE` (i.e. relative to `STORAGE_ROOT`).

#### New: `processOperationQueue(manifest)`

Called at the end of every `fullSync()` cycle (including the no-file-changes path).

**WebDAV operations used:**
| Op type | WebDAV call | Fallback on 404 |
|---|---|---|
| `delete` | `client.deleteFile(path)` | Skip — already gone |
| `rename` / `move` | `client.moveFile(from, to)` | Skip — source already gone |
| `copy` | `client.copyFile(from, to)` | Upload from local copy |

**Manifest updates:**
- `delete`: removes affected entries from the manifest (directory deletes remove all entries with that prefix).
- `rename` / `move`: renames all manifest keys matching old path to new path.
- `copy`: no manifest update needed (the uploaded copy will be picked up by the next fullSync file walk).

**Retry behaviour:**
- Failed operations stay in the queue with `retryCount` incremented.
- After **10 failures**, the operation is logged and discarded.

#### Modified: `fullSync()`

`processOperationQueue(manifest)` is now called in both code paths of `fullSync()`:
1. Early-return path (no files changed) — so queued ops are still processed.
2. Main path — after uploading changed files, before writing the manifest.

---

### `routes/fileRoutes.js`

Added `queueOperation` to the NAS sync import.

Hooked NAS sync into each file operation:

| Route | NAS action |
|---|---|
| `DELETE /api/files` (trash) | `queueOperation({ type: 'delete', ... })` — NAS deletes immediately; VPS keeps in trash 30 days |
| `POST /api/files/trash/restore` | `syncFile(relPath)` — re-uploads the restored file (files only; dirs picked up by next fullSync) |
| `POST /api/files/rename` | `queueOperation({ type: 'rename', ... })` |
| `POST /api/files/move` | `queueOperation({ type: 'move', ... })` |
| `POST /api/files/copy` | `syncFile(relPath)` — uploads the new copy directly (files only; dirs picked up by next fullSync) |
| `DELETE /api/files/trash/purge` | No NAS action — NAS already deleted on original trash move |

All hooks are **fire-and-forget** and never block request handlers.

---

## Design Decisions

- **NAS is not a recycle bin.** When a file is moved to VPS trash, it is deleted from NAS immediately. Cold storage doesn't need the 30-day recovery window.
- **Purge from trash = no-op.** NAS already deleted the file when it was trashed.
- **Copy → direct upload.** Using `syncFile()` instead of WebDAV COPY is simpler and more reliable since we always have the local copy available.
- **Directory operations.** WebDAV DELETE/MOVE on a directory handles the entire tree recursively. A trailing slash is added to directory paths as required by WebDAV spec.
- **Retry with ceiling.** Max 10 retries per operation before permanent discard. This prevents stale ops from blocking the queue indefinitely.

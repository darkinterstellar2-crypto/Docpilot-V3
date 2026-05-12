# 2026-04-12 — Files Module: Bulk Copy/Move, Cut+Paste, NAS-Aware Folder Tree

## Summary

Added bulk file operations and clipboard-based cut+paste to the Files module, with NAS-aware folder tree for the picker.

---

## 1. Bulk Copy/Move (`e1fd96c`)

### Feature
Multi-select files/folders in the Files module, then batch copy or move them to a different folder via the folder picker.

### How It Works
- **Batch action bar:** When multiple items are selected, "Copy to…" and "Move to…" buttons appear alongside the existing "Move to Recycle Bin"
- **Folder picker:** Opens in batch mode — title shows item count, e.g. "Move 3 items to…"
- **Execution:** Loops through all selected items sequentially, calling `/api/files/copy` or `/api/files/move` for each
- **Error handling:** Partial failures shown (e.g. "Some items failed: file.pdf: Name conflict")
- **Success toast:** "✓ Moved 3 items successfully"

### Files Changed
- `files.html` — `batchCopyMove()` function, batch bar buttons, `_fpBatchItems` state

---

## 2. Cut + Paste (`e1fd96c`)

### Feature
Clipboard-based cut operation in context menu — cut a file/folder, navigate to destination, paste.

### How It Works
- **Context menu:** New "Cut" option (scissors icon) for files and folders
- **Clipboard state:** `_clipboard = { name, path, isDir, mode: 'move' }`
- **Paste pill:** Amber banner appears in breadcrumb bar: `✂️ filename [Paste here] [✕]`
- **Paste visibility:** Only shown when current folder differs from source folder (can't paste in same location)
- **Paste action:** Calls `/api/files/move` with source path → current path
- **Cancel:** ✕ button clears clipboard
- **Toast:** "✂ Cut: filename — navigate to destination and click Paste here"

### Files Changed
- `files.html` — `cutItem()`, `pasteClipboard()`, `clearClipboard()`, `updateClipboardUI()`, clipboard pill HTML, scissors icon

---

## 3. NAS-Aware Folder Tree (`e1fd96c`, `7758aba`)

### Problem
Folder picker tree only showed local VPS directories. Files synced to NAS and cleaned from VPS meant top-level folders were missing from the tree.

### Solution
- `buildDirTree()` in `fileRoutes.js` merges NAS directories at **root level only** (depth 0)
- Single PROPFIND call for root → adds NAS-only dirs as local stubs
- Deeper levels rely on stubs created during normal browsing — no additional NAS calls
- Result: instant tree loading (was N recursive PROPFIND calls in initial approach)

### Files Changed
- `routes/fileRoutes.js` — `buildDirTree()` refactored with `dirNames` Set + root-level NAS merge

---

## 4. Folder Picker Disabled Logic Fix (`7758aba`)

### Problem
Moving a folder disabled the entire parent directory in the folder picker, preventing moves into sibling folders.

**Example:** Moving `Fürnbach` inside `Doku/` — `Doku` itself was disabled, so you couldn't navigate into it to pick another target.

### Fix
- Only disable the item being moved + its descendants (not the parent/current folder)
- Batch mode: each selected item individually disabled
- Moving `Fürnbach`: `Doku` stays selectable, `Fürnbach` node is disabled

### Files Changed
- `files.html` — `renderTreeNode()` disabled logic
- `routes/fileRoutes.js` — NAS merge only at depth 0

---

## Commits
| Hash | Description |
|------|-------------|
| `e1fd96c` | feat: files module — bulk copy/move, cut+paste, NAS-aware folder tree |
| `7758aba` | fix: folder picker allows moving into sibling folders + remove tree lag |

## Deploy
```bash
cd /opt/docpilot && git pull && docker compose up -d --build
```

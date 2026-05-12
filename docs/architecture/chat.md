# Chat System Architecture

> Per-project team chat with SQLite storage, media uploads, and long-polling.

---

## Overview

Each project has a completely isolated chat system:
- **Separate SQLite database** per project (no shared DB)
- **Per-project media folder** for attachments
- **Connection pool** with LRU eviction (max 20 open DBs)
- **Long-polling** for new messages (3-second interval on client)
- **Soft delete** — messages are flagged deleted, not removed
- **Media support** for images, videos, PDFs, and Office documents

---

## Database Location

```
STORAGE_ROOT/<ProjectName>/chat/chat.db
STORAGE_ROOT/<ProjectName>/chat/media/
STORAGE_ROOT/<ProjectName>/chat/.migrated    ← migration flag
```

**Managed by:** `controllers/chatDb.js`  
**Created:** Lazily on first message for a project (directories created with `fs.mkdirSync`)

---

## SQLite Schema

```sql
CREATE TABLE IF NOT EXISTS messages (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email        TEXT NOT NULL,
    user_name         TEXT NOT NULL,
    message           TEXT NOT NULL DEFAULT '',
    media_url         TEXT DEFAULT NULL,
    media_type        TEXT DEFAULT NULL,
    original_filename TEXT DEFAULT NULL,
    created_at        DATETIME DEFAULT (datetime('now')),
    edited_at         DATETIME DEFAULT NULL,
    deleted           INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_messages_id ON messages(id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
```

### Column descriptions

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER | Auto-increment primary key; used for polling (`after_id`) |
| `user_email` | TEXT | Sender's email (from `x-user-email` header) |
| `user_name` | TEXT | Sender's display name |
| `message` | TEXT | Message body (can be empty if media-only) |
| `media_url` | TEXT | URL path to media file (`/api/chat/:project/media/:filename`) |
| `media_type` | TEXT | `'image'` \| `'video'` \| `'file'` (based on extension) |
| `original_filename` | TEXT | The original filename before safe renaming |
| `created_at` | DATETIME | UTC timestamp of creation |
| `edited_at` | DATETIME | UTC timestamp of last edit (null if never edited) |
| `deleted` | INTEGER | `0` = visible, `1` = soft-deleted (hidden in all queries) |

**SQLite WAL mode** is enabled on every DB: `PRAGMA journal_mode = WAL`  
This improves concurrent read performance (reads don't block writes).

---

## Connection Pool

**Implemented in:** `controllers/chatDb.js`

### Design
- **Lazy loading:** DBs are only opened when first accessed for a project
- **LRU eviction:** When pool reaches `MAX_OPEN_DBS` (20), the least recently used DB is closed
- **Reuse:** Subsequent requests for the same project reuse the existing connection + prepared statements
- **Prepared statements:** All queries are pre-compiled on open for performance

### Pool structure
```javascript
// Internal pool Map: projectName → { db, stmts, lastUsed }
const pool = new Map();       // max MAX_OPEN_DBS entries
const MAX_OPEN_DBS = 20;
```

### How `getEntry(projectName)` works
```
1. If pool.has(projectName):
   → Update lastUsed timestamp → return entry
2. Else:
   → evictLRUIfNeeded() (closes LRU if pool.size >= 20)
   → openProjectDb(projectName):
       → mkdirSync chat/ and media/
       → new Database(dbPath)
       → PRAGMA journal_mode = WAL
       → CREATE TABLE IF NOT EXISTS...
       → One-time migration from legacy DB if needed
       → prepareStatements(db)
   → Add to pool → return entry
```

### Graceful shutdown
On `SIGTERM`/`SIGINT`, `closeAll()` is called from `server.js`:
```javascript
const { closeAll: closeChatDbs } = require('./controllers/chatDb');
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);
```
This calls `db.close()` for every open connection in the pool.

---

## Prepared Statements

All queries use prepared statements to prevent SQL injection and improve performance.

| Statement | Query |
|---|---|
| `insert` | INSERT INTO messages — all fields |
| `getMessages` | SELECT WHERE deleted=0 ORDER BY id ASC LIMIT ? OFFSET ? |
| `getNewMessages` | SELECT WHERE deleted=0 AND id > ? ORDER BY id ASC |
| `countMessages` | SELECT COUNT(*) WHERE deleted=0 |
| `editMessage` | UPDATE SET message=?, edited_at=NOW() WHERE id=? AND user_email=? AND deleted=0 |
| `deleteMessage` | UPDATE SET deleted=1 WHERE id=? AND user_email=? |
| `adminDeleteMessage` | UPDATE SET deleted=1 WHERE id=? (no user_email check) |

---

## Media Uploads

### Storage
```
STORAGE_ROOT/<ProjectName>/chat/media/<timestamp>_<safename>.<ext>
```
Example: `1712345678901_photo_001.jpg`

The `safename` is the original filename with all non-alphanumeric characters replaced by `_`.

### Allowed file types (by extension)
```
Images:    .jpg, .jpeg, .png, .gif, .webp
Videos:    .mp4, .mov, .avi, .webm
Documents: .pdf, .doc, .docx, .xls, .xlsx
```

### Size limit
**50 MB per file** (enforced by Multer)

### Media type detection
```javascript
const ext = path.extname(file.originalname).toLowerCase();
if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) mediaType = 'image';
else if (['.mp4', '.mov', '.avi', '.webm'].includes(ext))      mediaType = 'video';
else                                                            mediaType = 'file';
```

### Media URL format
```
/api/chat/<encodedProjectName>/media/<filename>
```
Example: `/api/chat/ProjectA/media/1712345678901_photo.jpg`

### Media serving
`GET /api/chat/:project/media/:filename` — serves the file with `res.sendFile()`.
Path traversal protection: filename is rejected if it contains `..` or `/`.

### ⚠ Chat media is NOT synced to NAS
Chat media files live in `chat/media/`. The NAS sync skips `.db` files, but does NOT skip media files. However, since media folders are not tracked in the NAS cleanup's 48h logic by project structure, they will be synced but not cleaned from VPS. (Future improvement: configure explicit exclusion or separate backup strategy for chat media.)

---

## API Endpoints

All chat routes are mounted at `/api/chat/:project`.

### GET /api/chat/:project — Fetch messages

**Two modes:**

**Paginated (initial load):**
```
GET /api/chat/ProjectA?limit=50&offset=0
Response: {
  success: true,
  messages: [...],
  total: 247,
  limit: 50,
  offset: 0
}
```

**Polling (incremental):**
```
GET /api/chat/ProjectA?after=184
Response: {
  success: true,
  messages: [...],   // only messages with id > 184
  mode: "poll"
}
```

### POST /api/chat/:project — Send message

```
POST /api/chat/ProjectA
Content-Type: multipart/form-data

Fields:
  message: "Hello team!"          (optional if media present)
  media: <file>                   (optional)

Headers: x-user-email, x-user-role, x-user-name

Response: { success: true, message: { id, user_email, user_name, message, media_url, ... } }
```

### PUT /api/chat/:project/:id — Edit message

```
PUT /api/chat/ProjectA/42
Body: { message: "Updated text" }
Headers: x-user-email

Response: { success: true/false }
Note: Only succeeds if user_email matches the message's author
```

### DELETE /api/chat/:project/:id — Delete message

```
DELETE /api/chat/ProjectA/42
Headers: x-user-email, x-user-role

Response: { success: true/false }

Rules:
- Regular users: can only delete their own messages (user_email check)
- admin/administrator/superadmin: can delete any message
```

### GET /api/chat/:project/media/:filename — Serve media file

```
GET /api/chat/ProjectA/media/1712345678901_photo.jpg
Response: Binary file content (sendFile)
```

---

## Polling Mechanism

The frontend polls for new messages every **3 seconds** using the `after` query parameter.

```
Client flow:
1. Load: GET /api/chat/ProjectA?limit=50 → get initial messages
2. Track lastId = messages[messages.length - 1].id
3. Every 3 seconds: GET /api/chat/ProjectA?after=<lastId>
4. If new messages returned: append to UI, update lastId
5. No new messages: do nothing (no flickering)
```

This is **short-polling** (not WebSocket, not SSE). Simple and reliable for the use case.

---

## ACL Enforcement

Chat is subject to the full ACL stack:
1. `canAccessProject(email, project)` — must be able to see the project
2. `canAccessModule(email, project, 'chat')` — chat module must be enabled

`user` role IS allowed to access chat (included in `USER_ROLE_ALLOWED_MODULES`).

---

## Migration from Legacy Single DB

The original version used a single `chat.db` at `src/DataFiles/chat.db` with a `project` column.

On first access to a project's per-project DB, a one-time migration runs:

```
1. Check if .migrated flag file exists in chat/ → if yes, skip
2. If legacy DB exists at src/DataFiles/chat.db:
   a. Open legacy DB read-only
   b. SELECT rows WHERE project = <projectName>
   c. INSERT all rows into new per-project DB
   d. Write .migrated flag file
3. If no legacy DB: write .migrated flag (mark as already done)
```

This migration is **idempotent** — the `.migrated` flag prevents it from running twice.

Legacy data is kept in the old `chat.db` (not deleted) for safety.

---

## Admin Controls

Chat messages can be deleted by admins:
- `isAdmin` check in DELETE handler: `['admin', 'administrator', 'superadmin'].includes(userRole)`
- Admin delete uses `adminDeleteMessage` statement (no user_email check)

Regular users can only delete their own messages (user_email must match).

There is no admin endpoint to list all messages across projects — each project's chat is accessed through its own endpoint.

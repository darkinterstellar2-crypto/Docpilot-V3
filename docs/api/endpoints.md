# API Endpoints Reference

> Complete list of every API endpoint. All endpoints are prefixed with `/api` unless noted otherwise.
> Last updated: 2026-04-11

**Authentication:** Most endpoints require a JWT token:
```
Authorization: Bearer <token>
```
Legacy header-based auth (`x-user-email`, `x-user-role`) is still accepted during migration but will be removed.

---

## Auth Routes (`/api`)

### POST /api/register
Register a new user account.

| | |
|---|---|
| Auth | None required |
| Body | `{ name, username, email, password }` |
| Role | Always `user` (no role selection — everyone registers as user) |
| Password | 8+ chars, strength indicator shown (no special char requirement) |

Password is hashed with **bcrypt (12 rounds)** before storage.
Registration goes into an in-memory pending map (15 min expiry), not directly to users.json.

**Response:**
```json
{ "success": true, "message": "Verification code sent to email." }
```
**Errors:** `400` (validation), `500` (server error)

---

### POST /api/verify-otp
Verify email via OTP code.

| | |
|---|---|
| Auth | None required |
| Body | `{ email, otp }` |

**Response:**
```json
{ "success": true, "message": "Email verified! Waiting for admin approval." }
```
**Errors:** `404` (user not found), `400` (invalid OTP)

---

### POST /api/login
Log in with email/username and password.

| | |
|---|---|
| Auth | None required |
| Body | `{ identifier, password }` — identifier is email OR username |
| Rate limit | 5 attempts per IP+identifier → 15 min lockout (HTTP 429) |

Password verification supports both bcrypt hashes and legacy plain text (auto-migrates to bcrypt on match).

**Regular user response:**
```json
{ "success": true, "role": "user", "name": "Max Mustermann", "email": "max@company.de", "token": "eyJ..." }
```

**Superadmin response (2FA required):**
```json
{ "success": true, "requires2FA": true, "email": "admin@company.de", "message": "Verification code sent to your email." }
```
A 6-digit OTP is sent via email. Client must follow up with `/api/verify-2fa`.

**Errors:** `401` (wrong credentials), `403` (not verified or not approved), `429` (rate limited)

---

### POST /api/verify-2fa
Complete superadmin login with 2FA code.

| | |
|---|---|
| Auth | None required (code proves identity) |
| Body | `{ email, otp }` |

**Response:**
```json
{ "success": true, "role": "superadmin", "name": "Rishi", "email": "rishi@geggos.app", "token": "eyJ..." }
```
**Errors:** `400` (invalid/expired code, no pending verification)

---

### POST /api/refresh
Silently extend an active session. Called automatically by `api.js` when the token is within 30 minutes of expiry.

| | |
|---|---|
| Auth | Bearer token required |
| Body | None |

**Response (refreshed):**
```json
{ "success": true, "refreshed": true, "token": "eyJ..." }
```

**Response (not needed yet):**
```json
{ "success": true, "refreshed": false, "message": "Token still valid, no refresh needed." }
```

**Response (expired):** `401 + { tokenExpired: true }`

---

### POST /api/logout
Log a logout event.

| | |
|---|---|
| Auth | None (just records the event) |
| Body | `{ email }` |

**Response:** `{ "success": true }`

---

## Projects Routes (`/api/projects`)

### GET /api/projects
List all projects (filtered by ACL for non-superadmin).

| | |
|---|---|
| Auth | Headers required |
| Min role | any |

**Response:**
```json
{ "success": true, "projects": [{ "id": "...", "name": "ProjectA", "locations": ["ClusterA"], "status": "Active", "progress": 0, "createdAt": "..." }] }
```

---

### POST /api/projects/create
Create a new project with full folder structure.

| | |
|---|---|
| Auth | Headers required |
| Permission | superadmin OR `canDashboard('createProject')` authority permission |
| Body | `{ projectName, locations: ["ClusterA"], schema: [{title, cols:[]}], structure: [{name, children:[]}] }` |

`schema` — array of column groups. Each group: `{ title: "GroupName", cols: ["Col1", "Col2"] }`  
`structure` — optional custom folder structure. If omitted, uses default module folders.

**Response:** `{ "success": true }`

---

### POST /api/projects/status
Update project status.

| | |
|---|---|
| Auth | Headers required |
| Permission | superadmin OR `canDashboard('changeStatus')` authority permission |
| Body | `{ projectName, newStatus }` |

**Response:** `{ "success": true }`

---

### POST /api/projects/reorder
Move a project left or right in the project list.

| | |
|---|---|
| Auth | Headers required |
| Body | `{ projectName, direction: "left" | "right" }` |

**Response:** `{ "success": true }`

---

### POST /api/projects/remove
Delete a project from DB and disk.

| | |
|---|---|
| Auth | Headers required |
| Permission | superadmin OR `deleteProject` authority permission |
| Body | `{ projectName }` |

**Response:** `{ "success": true }`  
⚠ This permanently deletes the entire project folder. No trash recovery.

---

### GET /api/projects/zip/:projectName
Download the entire project as a ZIP archive.

| | |
|---|---|
| Auth | Headers required |
| Response | Binary ZIP stream (`Content-Disposition: attachment`) |

---

### GET /api/projects/:projectName/clusters
List all clusters for a project (merged from data file + projects.json + filesystem).

**Response:**
```json
{ "success": true, "clusters": ["ClusterA", "ClusterB"] }
```

---

### POST /api/projects/:projectName/clusters
Add a new cluster to a project (creates folder structure).

| | |
|---|---|
| Body | `{ name: "ClusterName" }` |

**Response:**
```json
{ "success": true, "cluster": "ClusterName", "clusters": ["ClusterA", "ClusterB"] }
```

---

### GET /api/projects/:projectName/knotenpunkte?cluster=X
List all Knotenpunkte for a cluster.

**Response:**
```json
{ "success": true, "knotenpunkte": ["NVT-001", "NVT-002"] }
```

---

### POST /api/projects/:projectName/knotenpunkte
Add a new Knotenpunkt to a cluster (creates sub-folders).

| | |
|---|---|
| Body | `{ cluster: "ClusterA", name: "NVT-003" }` |

**Response:** `{ "success": true, "knotenpunkt": "NVT-003" }`

---

## Aufmass Data Routes (`/api/data`)

### GET /api/data?project=ProjectName
Read the aufmass data for a project.

| | |
|---|---|
| Auth | Headers required |
| Min role | any (ACL filtered) |
| ACL check | canAccessProject + canAccessModule('aufmass') |

**Response:**
```json
{
  "success": true,
  "schema": [
    { "id": "grp-0", "title": "Identification", "cols": [{ "id": "col-0-0", "label": "Unique Project ID" }] }
  ],
  "data": [
    { "_id": "ROW-001", "col-0-0": "ROW-001", "col-1-0": "Zeilerweg 11" }
  ]
}
```
Side effect: triggers background folder sync (fire-and-forget).

---

### POST /api/data?project=ProjectName
Save/overwrite the entire aufmass dataset.

| | |
|---|---|
| Auth | Headers required |
| Permission | JWT + canEdit (user role without canEdit is blocked) |
| ACL check | canAccessProject + canAccessModule('aufmass') |
| Body | `{ schema: [...], data: [...] }` — same format as GET response |

**Response:**
```json
{ "success": true, "otdrTriggered": 0 }
```
Side effects (fire-and-forget):
- Push to NAS via `syncFile()`
- Create versioned `.txt` copy + Excel export
- Auto-sync cluster/knotenpunkt folders

`otdrTriggered` — number of rows where OTDR was auto-set to "Waiting".

---

## File Routes (`/api/files`)

### GET /api/files?project=X&path=Y
List files and folders in a directory.

| | |
|---|---|
| Auth | Headers required |
| Min role | any (ACL filtered) |
| ACL check | canAccessProject + canAccessModule('files') |

`path` — relative path within project root (e.g., `Doku/ClusterA/APL`)

**Response:**
```json
{
  "success": true,
  "items": [
    {
      "name": "photo.jpg",
      "isDir": false,
      "size": 245000,
      "mtime": "2026-04-04T10:00:00.000Z",
      "modifiedBy": "admin@company.de",
      "modifiedAt": "2026-04-04T10:00:00.000Z"
    }
  ]
}
```
Hidden from listing: `.trash`, `.filemeta.json`, `chat`, `chat-media`

---

### POST /api/files/upload?project=X&path=Y
Upload one or more files (up to 50) to a directory.

| | |
|---|---|
| Auth | Headers required |
| Permission | JWT + canEdit |
| ACL check | canAccessProject + canAccessModule('files') |
| Body | multipart/form-data, field name: `files` |
| Max file size | 200 MB per file |

**Response:**
```json
{ "success": true, "count": 2, "filenames": ["photo.jpg", "report.pdf"] }
```
Side effect: `syncFile()` for each uploaded file (fire-and-forget).

---

### POST /api/files/folder?project=X&path=Y
Create a new folder.

| | |
|---|---|
| Auth | Headers required |
| Permission | JWT + canEdit |
| Body | `{ name: "NewFolder" }` |

**Response:** `{ "success": true }`

---

### POST /api/files/rename?project=X&path=Y
Rename a file or folder.

| | |
|---|---|
| Auth | Headers required |
| Permission | JWT + canEdit |
| Body | `{ oldName: "old.pdf", newName: "new.pdf" }` |

**Response:** `{ "success": true }`  
Side effect: queues NAS `rename` operation.

---

### DELETE /api/files?project=X&path=Y&file=Z
Soft-delete a file or folder (move to `.trash/`).

| | |
|---|---|
| Auth | Headers required |
| Permission | JWT + canEdit |

**Response:** `{ "success": true }`  
Side effect: queues NAS `delete` operation.

---

### POST /api/files/copy?project=X
Copy a file or folder to a destination.

| | |
|---|---|
| Auth | Headers required |
| Permission | JWT + canEdit |
| Body | `{ source: "Doku/ClusterA/file.pdf", destination: "Doku/ClusterB" }` |

Auto-renames destination if name conflicts (e.g., `file (1).pdf`).

**Response:**
```json
{ "success": true, "destination": "Doku/ClusterB/file.pdf" }
```

---

### POST /api/files/move?project=X
Move a file or folder to a destination.

| | |
|---|---|
| Auth | Headers required |
| Permission | JWT + canEdit |
| Body | `{ source: "Doku/ClusterA/file.pdf", destination: "Doku/ClusterB" }` |

**Response:**
```json
{ "success": true, "destination": "Doku/ClusterB/file.pdf" }
```
Side effect: queues NAS `move` operation.

---

### GET /api/files/tree?project=X
Return folder tree (for copy/move picker UI).

| | |
|---|---|
| Max depth | 10 levels |

**Response:**
```json
{
  "success": true,
  "tree": {
    "name": "Root",
    "path": "",
    "children": [{ "name": "Doku", "path": "Doku", "children": [...] }]
  }
}
```
Excludes: `.trash`, `chat`, hidden directories.

---

### GET /api/files/download?project=X&path=Y&file=Z
Download a file.

| | |
|---|---|
| Auth | Headers required |
| Min role | any |
| Response | Binary file download |

If file was cleaned from VPS (48h cleanup): transparently fetches from NAS first.

---

### GET /api/files/trash?project=X
List items in the project's recycle bin.

**Response:**
```json
{
  "success": true,
  "items": [
    {
      "id": "1712345678901",
      "originalName": "report.pdf",
      "originalPath": "Doku/ClusterA/APL/NVT-001",
      "trashName": "...",
      "deletedBy": "admin@company.de",
      "deletedAt": "...",
      "isDir": false,
      "expiresAt": "..."
    }
  ]
}
```
Runs `cleanExpiredTrash()` first (auto-purge items > 30 days old).

---

### POST /api/files/trash/restore?project=X
Restore an item from trash to its original location.

| | |
|---|---|
| Auth | Headers required |
| Permission | JWT + canEdit |
| Body | `{ id: "1712345678901" }` |

**Response:** `{ "success": true }`

---

### DELETE /api/files/trash/purge?project=X
Permanently delete an item from trash.

| | |
|---|---|
| Auth | Headers required |
| Permission | JWT + canEdit |
| Body | `{ id: "1712345678901" }` |

**Response:** `{ "success": true }`

---

### POST /api/files/share?project=X
Create a public share link for a file.

| | |
|---|---|
| Auth | Headers required |
| Permission | JWT + canEdit |
| Body | `{ filePath: "Doku/ClusterA/file.pdf", expiresIn: 168 }` |

`expiresIn` — hours until link expires (1–720, default 168 = 7 days)

**Response:**
```json
{
  "success": true,
  "shareId": "abc123xyz",
  "shareUrl": "/share/abc123xyz",
  "expiresAt": "2026-04-11T21:00:00.000Z"
}
```

---

### GET /api/files/shares?project=X&filePath=Y
List active share links for a file.

**Response:**
```json
{
  "success": true,
  "shares": [{ "shareId": "abc123", "createdBy": "...", "expiresAt": "...", "accessCount": 5 }]
}
```

---

### DELETE /api/files/share?project=X
Revoke a share link.

| | |
|---|---|
| Permission | JWT + canEdit |
| Body | `{ shareId: "abc123" }` |

**Response:** `{ "success": true }`

---

## Shares (Public Route)

> **Auth pattern note:** All regular file downloads (`GET /api/files/download`) require a valid JWT token and use the `fetch + blob` pattern on the client side — the token is sent in the `Authorization: Bearer` header. Share links are an **intentional exception**: they are publicly accessible without any JWT, authenticated via an expiring share token embedded in the URL. This is by design — shares are meant to be sendable to external parties who have no account.

### GET /share/:shareId
**Public — no auth headers required.** Download a shared file.

| Status | Meaning |
|---|---|
| 200 | File download begins |
| 404 | Share doesn't exist or was revoked |
| 410 | Share link has expired |

Mounted directly in `server.js` before any auth middleware.

---

### GET /share/:shareId/browse
**Public — no auth headers required.** Browse a shared folder (directory listing).

| Status | Meaning |
|---|---|
| 200 | Directory listing returned |
| 404 | Share doesn't exist or was revoked |
| 410 | Share link has expired |

---

### GET /share/:shareId/download
**Public — no auth headers required.** Direct file download from a share.

| Status | Meaning |
|---|---|
| 200 | File download begins |
| 404 | Share doesn't exist or was revoked |
| 410 | Share link has expired |

---

## Profile Routes (`/api/profile`)

### GET /api/profile
Get the current user's profile.

| | |
|---|---|
| Auth | Bearer token required |
| Min role | any |

**Response:**
```json
{
  "success": true,
  "profile": {
    "name": "Max Mustermann",
    "username": "max",
    "email": "max@company.de",
    "role": "user",
    "avatar": "/api/profile/avatar/abc123.jpg",
    "createdAt": "2026-01-15T10:00:00.000Z"
  }
}
```

---

### PUT /api/profile
Update own name and/or username.

| | |
|---|---|
| Auth | Bearer token required |
| Body | `{ name?, username? }` |

Username must be unique (case-insensitive). Returns `400` if username is taken.

**Response:**
```json
{ "success": true, "message": "Profile updated", "name": "Max", "username": "max2" }
```

---

### PUT /api/profile/password
Change own password.

| | |
|---|---|
| Auth | Bearer token required |
| Body | `{ currentPassword, newPassword }` |

`newPassword` must be at least 8 characters. Hashed with bcrypt (12 rounds) before storage.

**Response:** `{ "success": true, "message": "Password changed successfully" }`  
**Errors:** `400` (validation), `403` (wrong current password)

---

### POST /api/profile/avatar
Upload a profile picture.

| | |
|---|---|
| Auth | Bearer token required |
| Content-Type | multipart/form-data |
| Body | field `avatar` (single image file) |
| Max size | 2 MB |
| Allowed formats | JPG, PNG, WebP |

Old avatar is automatically deleted on upload. Stored as `<userId>.<ext>` in `src/DataFiles/avatars/`.

**Response:**
```json
{ "success": true, "avatar": "/api/profile/avatar/abc123.jpg" }
```

---

### DELETE /api/profile/avatar
Remove the current user's profile picture.

| | |
|---|---|
| Auth | Bearer token required |

**Response:** `{ "success": true, "message": "Avatar removed" }`

---

### GET /api/profile/avatar/:filename
Serve a profile picture image file.

| | |
|---|---|
| Auth | None (files are served directly) |
| Response | Binary image file (`sendFile`) |

**Errors:** `400` (path traversal attempt), `404` (not found)

---

### GET /api/profile/check-username?username=X
Real-time username uniqueness check (used by profile form).

| | |
|---|---|
| Auth | Bearer token required (to exclude current user from conflict check) |
| Query | `username` — the username to check |

**Response:**
```json
{ "success": true, "available": true, "message": "Available" }
```
```json
{ "success": true, "available": false, "message": "Username already taken" }
```

---

## Project Info Routes (`/api/project-info`)

### GET /api/project-info/:project
Get project metadata (description, custom fields).

| | |
|---|---|
| Auth | Bearer token required |
| ACL check | canAccessProject (superadmin bypasses) |

**Response:**
```json
{
  "success": true,
  "info": {
    "description": "Fiber rollout for Gemeinde Rauhenebrach.",
    "fields": [
      { "label": "Contract Number", "value": "VTG-2026-042" }
    ]
  }
}
```

---

### PUT /api/project-info/:project
Update project metadata.

| | |
|---|---|
| Auth | Bearer token required |
| ACL check | canAccessProject + `editProjectInfo` authority permission (superadmin bypasses) |
| Body | `{ description?, fields?: [{ label, value }] }` |

Preserves the `members` array (managed separately by ACL sync).

**Response:**
```json
{ "success": true, "info": { "description": "...", "fields": [...] } }
```

---

### GET /api/project-info/:project/members
List all users with access to a project.

| | |
|---|---|
| Auth | Bearer token required |
| ACL check | canAccessProject (superadmin bypasses) |

Returns superadmins (always shown) + ACL-granted users + stored members array. Falls back to ACL lookup for backward compatibility.

**Response:**
```json
{
  "success": true,
  "members": [
    { "email": "admin@company.de", "name": "Admin", "avatar": null, "role": "superadmin" },
    { "email": "max@company.de", "name": "Max", "avatar": "/api/profile/avatar/abc.jpg", "role": "user" }
  ]
}
```

---

## Settings Routes (`/api/settings`)

### GET /api/settings
Get all app settings.

| | |
|---|---|
| Auth | Bearer token required |
| Min role | superadmin only |

**Response:**
```json
{
  "success": true,
  "settings": {
    "generatorCode": "SECRET123",
    "generatorUrl": "https://generators.geggos.ai",
    "generatorApiUrl": "https://generators.geggos.ai/api",
    "generatorAllowedUsers": ["max@company.de"]
  }
}
```

---

### PUT /api/settings
Update app settings.

| | |
|---|---|
| Auth | Bearer token required |
| Min role | superadmin only |
| Body | `{ generatorCode?, generatorUrl?, generatorApiUrl?, generatorAllowedUsers? }` |

Partial updates are merged with existing settings. `generatorAllowedUsers` is always kept as an array.

**Response:** `{ "success": true, "message": "Settings updated" }`

---

### GET /api/settings/generator-access
Check if the current user has generator access.

| | |
|---|---|
| Auth | Bearer token required |
| Min role | any authenticated user |

Superadmins always have access. Other users must be in `generatorAllowedUsers`.

**Response:**
```json
{
  "success": true,
  "hasAccess": true,
  "generatorUrl": "https://generators.geggos.ai",
  "generatorApiUrl": "https://generators.geggos.ai/api"
}
```

---

### POST /api/settings/verify-code
Verify a generator access code (backward compatibility endpoint).

| | |
|---|---|
| Auth | Bearer token required |
| Body | `{ code }` |

**Response (valid):**
```json
{ "success": true, "generatorUrl": "https://generators.geggos.ai", "generatorApiUrl": "..." }
```
**Response (invalid):** `403 + { "success": false, "message": "Invalid code" }`

---

## Module Routes (`/api/modules`)

### GET /api/modules/navigation?project=X&module=apl
Get the cluster → knotenpunkt → address tree for module navigation.

| | |
|---|---|
| Auth | Headers required |
| Permission | JWT + ACL (user role is hard-blocked for modules in `USER_ROLE_BLOCKED_MODULES`) |
| ACL check | canAccessProject + canAccessModule(module param) |

**Response:**
```json
{
  "success": true,
  "schema": [...],
  "clusters": [
    {
      "name": "ClusterA",
      "knotenpunkte": [
        {
          "name": "NVT-001",
          "addresses": [
            {
              "id": "ROW-001",
              "start": "Zeilerweg 11",
              "end": "Zeilerweg 15",
              "cableName": "KAB-001",
              "fiberType": "G.652D",
              "spliceCount": "12",
              "data": { "col-0-0": "ROW-001", ... }
            }
          ]
        }
      ]
    }
  ]
}
```

---

### POST /api/modules/upload
Upload files to a module-specific folder within a project.

| | |
|---|---|
| Auth | Headers required |
| Permission | JWT + canEdit |
| Body | multipart/form-data: fields `project`, `targetPath`, `customName` (optional), files[] |

`targetPath` — relative path from project's `Doku/` folder  
`customName` — rename single uploaded file (ignored for batch uploads)

**Response:**
```json
{ "success": true, "files": [{ "name": "report.pdf", "path": "Doku/ClusterA/APL/NVT-001/report.pdf", "size": 245000 }] }
```

---

### POST /api/modules/aufmass-update
Update specific cells in the aufmass data file (without rewriting the whole table).

| | |
|---|---|
| Auth | Headers required |
| Permission | JWT + canEdit |
| ACL check | canAccessProject + canAccessModule(body.module) |
| Body | `{ project, rowId, updates: { "col-8-0": "Done", ... }, module: "apl" }` |

**Response:**
```json
{ "success": true, "rowId": "ROW-001", "updated": ["col-8-0"], "otdrAutoTriggered": false }
```
Side effects: NAS sync + versioned copy (fire-and-forget).

---

### GET /api/modules/aufmass-row?project=X&rowId=ROW-001
Get a single row's data.

| | |
|---|---|
| Auth | Headers required |
| ACL check | canAccessProject + canAccessModule(module query param) |

**Response:**
```json
{
  "success": true,
  "row": { "_id": "ROW-001", "col-0-0": "ROW-001", ... },
  "schema": [...]
}
```

---

### GET /api/modules/list-files?project=X&path=ClusterA/OTDR/NVT-001
List files in a module folder.

| | |
|---|---|
| Auth | Headers required |
| ACL check | canAccessProject + canAccessModule('files') |

**Response:**
```json
{ "success": true, "files": [{ "name": "trace.sor", "size": 12345 }], "count": 1 }
```

---

### DELETE /api/modules/clear-files?project=X&path=ClusterA/OTDR/NVT-001
Delete all files in a directory (OTDR "Replace All" option).

| | |
|---|---|
| Auth | Headers required |
| Min role | superadmin |

**Response:** `{ "success": true, "deleted": 3 }`

---

## Chat Routes (`/api/chat`)

### GET /api/chat/:project
Fetch messages (paginated or polling).

| Mode | Query params | Description |
|---|---|---|
| Paginated | `?limit=50&offset=0` | Full load, oldest-first |
| Polling | `?after=<lastId>` | Only messages with id > lastId |

| | |
|---|---|
| ACL check | canAccessProject + canAccessModule('chat') |

**Paginated response:**
```json
{ "success": true, "messages": [...], "total": 247, "limit": 50, "offset": 0 }
```

**Poll response:**
```json
{ "success": true, "messages": [...], "mode": "poll" }
```

**Message object:**
```json
{
  "id": 42,
  "user_email": "max@company.de",
  "user_name": "Max",
  "message": "Hello!",
  "media_url": null,
  "media_type": null,
  "original_filename": null,
  "created_at": "2026-04-04T21:00:00.000Z",
  "edited_at": null
}
```

---

### POST /api/chat/:project
Send a message (text, media, or both).

| | |
|---|---|
| Auth | Headers required + body fields |
| Content-Type | multipart/form-data |
| Body fields | `message` (text), `media` (file, optional) |
| Max media size | 50 MB |

**Response:**
```json
{ "success": true, "message": { ...message object... } }
```

---

### PUT /api/chat/:project/:id
Edit a message (own messages only).

| | |
|---|---|
| Body | `{ message: "Updated text" }` |

**Response:** `{ "success": true/false }`

---

### DELETE /api/chat/:project/:id
Delete a message.

- Regular users: can only delete own messages
- Superadmin: can delete any message

**Response:** `{ "success": true/false }`

---

### GET /api/chat/:project/media/:filename
Serve a chat media file.

| | |
|---|---|
| Auth | None (files are served directly) |
| Response | Binary file (`sendFile`) |

---

## Admin Routes (`/api/admin`)

### GET /api/admin/users
List all users (excluding superadmins from non-superadmin view).

**Response:**
```json
{
  "success": true,
  "users": [
    { "name": "Max", "email": "...", "username": "...", "role": "user", "status": "approved", "isVerified": true, "isApproved": true, "createdAt": "..." }
  ]
}
```
Note: passwords are never returned.

---

### POST /api/admin/approve
Approve or revoke a user account.

| | |
|---|---|
| Body | `{ email, status: "approved" | "revoked" }` |

Sends welcome email on first approval.

**Response:** `{ "success": true, "message": "User status updated." }`

---

### POST /api/admin/user/update
Update a user's username and/or password.

| | |
|---|---|
| Auth | Headers required |
| Body | `{ email, username?, password? }` |
| Constraint | Only superadmin can edit superadmin accounts |

**Response:** `{ "success": true, "message": "User updated successfully." }`

---

### GET /api/admin/logs
Get all audit log entries.

**Response:**
```json
{ "success": true, "logs": [{ "id": "...", "timestamp": "...", "user": "...", "action": "...", "details": "..." }] }
```

---

### GET /api/admin/logs/search?query=FILENAME
Search audit logs by action or details.

**Response:** `{ "success": true, "logs": [...] }`

---

### GET /api/admin/sync-status
Get NAS sync state.

| | |
|---|---|
| Min role | any authenticated user |

**Response:**
```json
{
  "success": true,
  "enabled": true,
  "connected": true,
  "lastSync": "2026-04-04T21:35:00.000Z",
  "lastCleanup": "2026-04-04T18:00:00.000Z",
  "pendingFiles": 0,
  "totalTracked": 1247,
  "errors": []
}
```

---

### POST /api/admin/sync-trigger
Trigger a manual full NAS sync (fire-and-forget).

**Response:** `{ "success": true, "message": "Sync triggered" }`

---

### GET /api/admin/user-sessions/:email
Get session history for a user.

| | |
|---|---|
| Query | `?limit=50` |

**Response:**
```json
{
  "success": true,
  "sessions": [{ "email": "...", "action": "login", "timestamp": "...", "device": "Chrome on Windows", "ip": "..." }],
  "lastLogin": { ...session entry... },
  "devices": ["Chrome on Windows", "Firefox on Android"]
}
```

---

### GET /api/admin/user-stats/:email
Get aggregated user statistics.

**Response:**
```json
{
  "success": true,
  "stats": {
    "totalLogins": 47,
    "totalLogouts": 45,
    "lastLogin": "2026-04-04T08:00:00.000Z",
    "lastLogout": "2026-04-04T17:00:00.000Z",
    "lastDevice": "Chrome on Windows",
    "devices": ["Chrome on Windows"],
    "createdAt": "2026-01-15T10:00:00.000Z"
  }
}
```

---

## Access Control Routes — Admin (`/api/admin/access-control`) [SUPERADMIN ONLY]

### GET /api/admin/access-control
Get the entire ACL object.

---

### GET /api/admin/access-control/:email
Get ACL rules for a specific user.

**Response:** `{ "success": true, "access": { projects: {...}, defaultProjectAccess: true } }`  
Returns `null` if no rules exist (= full access).

---

### POST /api/admin/access-control/:email
Set ACL rules for a user.

**Body:**
```json
{
  "defaultProjectAccess": false,
  "projects": {
    "ProjectA": {
      "access": true,
      "modules": {
        "aufmass": true,
        "files": true,
        "chat": true,
        "apl": false
      }
    }
  }
}
```

---

### DELETE /api/admin/access-control/:email
Remove all ACL restrictions for a user (restores full access).

---

## Access Routes (`/api/access`)

### GET /api/access/my-permissions?project=X
Get the current user's module permissions for a project.

| | |
|---|---|
| Auth | Headers required |
| Min role | any |

**Response:**
```json
{
  "success": true,
  "permissions": {
    "aufmass": true,
    "files": true,
    "druckprufung": false,
    "kalibrieren": false,
    "einblasen": false,
    "apl": false,
    "splicing": false,
    "knotenpunkt": false,
    "otdr": false,
    "chat": true
  }
}
```

---

## Super Logs Routes (`/api/admin`) [SUPERADMIN ONLY]

### GET /api/admin/super-logs
Query system event logs.

| Query param | Type | Description |
|---|---|---|
| `after_id` | number | Only entries with id > after_id |
| `types` | string | Comma-separated: `request,auth,file,sync,chat,error,system` |
| `level` | string | `debug`, `info`, `warn`, `error` |
| `limit` | number | Default 100, max 500 |
| `search` | string | Substring match in message or meta |

**Response:**
```json
{
  "success": true,
  "logs": [{ "id": 1234, "timestamp": "...", "type": "auth", "level": "info", "message": "Login: ...", "meta": {...} }],
  "total": 5000
}
```

---

### GET /api/admin/super-logs/stats
Log statistics for the last 24 hours.

**Response:**
```json
{
  "success": true,
  "total": 847,
  "byType": { "request": 800, "auth": 30, "file": 17 },
  "byLevel": { "info": 820, "warn": 25, "error": 2 },
  "since": "2026-04-03T21:00:00.000Z"
}
```

---

## Session Termination Routes (`/api/admin`) [SUPERADMIN ONLY]

### POST /api/admin/terminate-session
Force-terminate all sessions for a user across all devices.

| | |
|---|---|
| Auth | Bearer token required |
| Min role | superadmin |
| Body | `{ email }` |

**Response:**
```json
{ "success": true, "message": "All sessions for max@company.de have been terminated." }
```

- Can terminate ANY user including other superadmins and yourself
- Self-termination needed for compromised account scenarios
- Adds email to `terminated-sessions.json`
- All subsequent API calls from that user return 401 + `{ forceLogout: true }`
- Termination cleared automatically on next successful login

---

## Module-Specific Updates

### POST /api/modules/aufmass-update (updated)
Now accepts an optional `note` field for logging context.

| | |
|---|---|
| Body | `{ project, rowId, updates: {...}, module: "apl", note: "Splice count CONFIRMED: 6" }` |

The `note` field is appended to the audit log as `📝 Note: ...`. Used by APL splice confirm/update flow.

# API Reference

All API endpoints are mounted under `/api/` (except public share links at `/share/`). Authentication is via JWT Bearer token in the `Authorization` header unless noted otherwise.

## Auth Routes (`/api/`)

**File:** `routes/authRoutes.js`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/register` | No | Register a new user. Body: `{ name, username, email, password }` |
| POST | `/api/verify-otp` | No | Verify email OTP. Body: `{ email, otp }` |
| POST | `/api/login` | No | Login. Body: `{ identifier, password }`. `identifier` = email or username |
| POST | `/api/verify-2fa` | No | 2FA verification. Body: `{ email, otp }` |
| POST | `/api/auth/refresh` | Yes | Refresh JWT token. Returns new token if within 30 min of expiry |
| POST | `/api/auth/logout` | Yes | Logout. Body: `{ email }` |

## Data Routes (`/api/data`)

**File:** `routes/dataRoutes.js`

| Method | Path | Auth | ACL | Description |
|--------|------|------|-----|-------------|
| GET | `/api/data?project=X` | Yes | aufmass + project | Read Aufmass data. Returns `{ schema, data }` |
| POST | `/api/data?project=X` | Yes | aufmass + project + canEdit | Save Aufmass data. Body: `{ schema, data }`. Supports optimistic locking |

## Project Routes (`/api/projects`)

**File:** `routes/projectRoutes.js`

| Method | Path | Auth | ACL | Description |
|--------|------|------|-----|-------------|
| GET | `/api/projects` | Yes | Filtered by ACL | List all accessible projects |
| POST | `/api/projects/create` | Yes | createProject | Create project. Body: `{ projectName, locations, schema, structure?, description?, fields? }` |
| POST | `/api/projects/status` | Yes | changeStatus | Update project status. Body: `{ projectName, newStatus }` |
| POST | `/api/projects/reorder` | Yes | reorderProjects | Reorder project. Body: `{ projectName, direction: 'left'|'right' }` |
| POST | `/api/projects/remove` | Yes | deleteProject | Delete project. Body: `{ projectName }` |
| GET | `/api/projects/zip/:projectName` | Yes | downloadZip + project | Download project as ZIP |
| GET | `/api/projects/:name/clusters` | Yes | project | List clusters |
| POST | `/api/projects/:name/clusters` | Yes | project | Add cluster. Body: `{ name }` |
| GET | `/api/projects/:name/knotenpunkte?cluster=X` | Yes | project | List Knotenpunkte for cluster |
| POST | `/api/projects/:name/knotenpunkte` | Yes | project | Add Knotenpunkt. Body: `{ cluster, name }` |

## Admin Routes (`/api/admin`)

**File:** `routes/adminRoutes.js`

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | `/api/admin/users` | Yes | Any | List users (superadmins hidden from non-superadmins) |
| POST | `/api/admin/approve` | Yes | Any | Approve/revoke user. Body: `{ email, status: 'approved'|'revoked' }` |
| POST | `/api/admin/reject` | Yes | Any | Reject + delete user. Body: `{ email }` |
| GET | `/api/admin/logs` | Yes | Any | Get action logs |
| GET | `/api/admin/logs/search?query=X` | Yes | Any | Search logs |
| GET | `/api/admin/sync-status` | Yes | Any | NAS sync status |
| POST | `/api/admin/sync-trigger` | Yes | Any | Manually trigger NAS sync |
| GET | `/api/admin/user-sessions/:email` | Yes | Any | User login/logout history |
| GET | `/api/admin/user-stats/:email` | Yes | Any | User statistics |
| POST | `/api/admin/user/update` | Yes | Superadmin | Update username/password. Body: `{ email, username?, password? }` |
| POST | `/api/admin/terminate-session` | Yes | Superadmin | Force-terminate user sessions. Body: `{ email }` |
| GET | `/api/admin/access-control` | Yes | Superadmin | Get all ACL rules |
| GET | `/api/admin/access-control/:email` | Yes | Superadmin | Get user's ACL |
| POST | `/api/admin/access-control/:email` | Yes | Superadmin | Set user's ACL |
| DELETE | `/api/admin/access-control/:email` | Yes | Superadmin | Remove ACL restrictions |
| GET | `/api/admin/super-logs` | Yes | Superadmin | Query super logs. Params: `after_id, types, level, limit, search` |
| GET | `/api/admin/super-logs/stats` | Yes | Superadmin | Log statistics (last 24h) |

## File Routes (`/api/files`)

**File:** `routes/fileRoutes.js`

| Method | Path | Auth | ACL | Description |
|--------|------|------|-----|-------------|
| GET | `/api/files?project=X&path=Y` | Yes | files + project | List directory contents |
| POST | `/api/files/upload?project=X&path=Y` | Yes | files + canEdit | Upload files (multi-file, max 200MB each) |
| POST | `/api/files/folder?project=X&path=Y` | Yes | canEdit | Create folder. Body: `{ name }` |
| POST | `/api/files/rename?project=X&path=Y` | Yes | canEdit | Rename. Body: `{ oldName, newName }` |
| DELETE | `/api/files?project=X&path=Y&file=Z` | Yes | canEdit | Soft-delete (move to trash) |
| POST | `/api/files/copy?project=X` | Yes | canEdit | Copy file/folder. Body: `{ source, destination }` |
| POST | `/api/files/move?project=X` | Yes | canEdit | Move file/folder. Body: `{ source, destination }` |
| GET | `/api/files/tree?project=X` | Yes | project | Get folder tree (for picker UI) |
| GET | `/api/files/download?project=X&path=Y&file=Z` | Yes | files + project | Download a file |
| GET | `/api/files/download-folder?project=X&path=Y` | Yes | project | Download folder as ZIP |
| GET | `/api/files/trash?project=X` | Yes | project | List trash items |
| POST | `/api/files/trash/restore?project=X` | Yes | canEdit | Restore from trash. Body: `{ id }` |
| DELETE | `/api/files/trash/purge?project=X` | Yes | canEdit | Permanently delete trash item. Body: `{ id }` |
| POST | `/api/files/share?project=X` | Yes | canEdit | Create share link. Body: `{ filePath, expiresIn? }` |
| GET | `/api/files/shares?project=X&filePath=Y` | Yes | canEdit | List active shares |
| DELETE | `/api/files/share?project=X` | Yes | canEdit | Revoke share. Body: `{ shareId }` |

### Public Share Routes (No Auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/share/:shareId` | Access shared file/folder (serves download or folder browser) |
| GET | `/share/:shareId/browse?path=X` | Browse shared folder contents |
| GET | `/share/:shareId/download?file=X` | Download file from shared folder |

## Module Routes (`/api/modules`)

**File:** `routes/moduleRoutes.js`

| Method | Path | Auth | ACL | Description |
|--------|------|------|-----|-------------|
| GET | `/api/modules/navigation?project=X&module=Y` | Yes | module + project | Get cluster→knotenpunkt→address navigation tree |
| POST | `/api/modules/upload` | Yes | module + canEdit | Upload file to module folder. Body (multipart): `project, targetPath, files[], customName?` |
| POST | `/api/modules/aufmass-update` | Yes | module + canEdit | Update single row. Body: `{ project, rowId, updates, rowVersion?, note? }` |
| GET | `/api/modules/aufmass-row?project=X&rowId=Y` | Yes | module + project | Get single row data |
| GET | `/api/modules/list-files?project=X&path=Y` | Yes | module + project | List files in module directory |
| GET | `/api/modules/appointments?project=X` | Yes | project | Get all appointments for a project |
| GET | `/api/modules/appointments/all` | Yes | Filtered by ACL | Get appointments from ALL accessible projects |
| GET | `/api/modules/done-dates?project=X&path=Y` | Yes | project | Get file modification dates for done-date display |
| DELETE | `/api/modules/clear-files?project=X&path=Y` | Yes | Superadmin | Delete all files in a directory |
| POST | `/api/modules/backfill-einblasen-dates?project=X` | Yes | Superadmin | Backfill dates from filenames |

## Chat Routes (`/api/chat`)

**File:** `routes/chatRoutes.js`

| Method | Path | Auth | ACL | Description |
|--------|------|------|-----|-------------|
| GET | `/api/chat/:project` | Yes | chat + project | Fetch messages. Params: `limit, offset` or `after` (polling) |
| POST | `/api/chat/:project` | Yes | chat + project | Send message. Body (multipart): `message, media?` |
| PUT | `/api/chat/:project/:id` | Yes | Own messages | Edit message. Body: `{ message }` |
| DELETE | `/api/chat/:project/:id` | Yes | Own or superadmin | Soft-delete message |
| GET | `/api/chat/:project/media/:filename` | Yes | — | Serve media file |

## Access Routes (`/api/access`)

**File:** `routes/accessRoutes.js`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/access/my-permissions?project=X` | Yes | Get module-level permissions for a project |
| GET | `/api/access/permissions` | Yes | Get full effective permissions (dashboard + projects) |

## Profile Routes (`/api/profile`)

**File:** `routes/profileRoutes.js`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/profile` | Yes | Get current user's profile |
| PUT | `/api/profile` | Yes | Update name/username. Body: `{ name?, username? }` |
| PUT | `/api/profile/password` | Yes | Change password. Body: `{ currentPassword, newPassword }` |
| POST | `/api/profile/avatar` | Yes | Upload avatar (max 2MB, JPG/PNG/WebP) |
| DELETE | `/api/profile/avatar` | Yes | Remove avatar |
| GET | `/api/profile/avatar/:filename` | Yes | Serve avatar image |
| PUT | `/api/profile/2fa` | Yes | Toggle 2FA. Body: `{ enabled: boolean }` |
| GET | `/api/profile/check-username?username=X` | Yes | Check username availability |

## Settings Routes (`/api/settings`)

**File:** `routes/settingsRoutes.js`

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | `/api/settings` | Yes | Superadmin | Get all settings |
| PUT | `/api/settings` | Yes | Superadmin | Update settings |
| GET | `/api/settings/generator-access` | Yes | Any | Check generator access for current user |
| POST | `/api/settings/verify-code` | Yes | Any | Verify generator code (legacy) |

## Project Info Routes (`/api/project-info`)

**File:** `routes/projectInfoRoutes.js`

| Method | Path | Auth | ACL | Description |
|--------|------|------|-----|-------------|
| GET | `/api/project-info/:project` | Yes | project | Get project description + fields |
| PUT | `/api/project-info/:project` | Yes | editProjectInfo | Update project info. Body: `{ description, fields[] }` |
| GET | `/api/project-info/:project/members` | Yes | project | List project members |

## Geocode Routes (`/api/geocode`)

**File:** `routes/geocodeRoutes.js` — **No auth required** (public proxy)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/geocode?lat=X&lng=Y` | No | Reverse geocode via Nominatim (cached, rate-limited: 30/min/IP) |

## Team Routes (`/api/teams`)

**File:** `routes/teamRoutes.js`

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | `/api/teams` | Yes | Any | List all teams |
| GET | `/api/teams/available-users` | Yes | Any | List users for member selection |
| GET | `/api/teams/:id` | Yes | Any | Get single team |
| POST | `/api/teams` | Yes | Superadmin | Create team. Body: `{ name, description?, members? }` |
| PUT | `/api/teams/:id` | Yes | Superadmin | Update team. Body: `{ name?, description? }` |
| DELETE | `/api/teams/:id` | Yes | Superadmin | Delete team |
| POST | `/api/teams/:id/members` | Yes | Superadmin | Add member. Body: `{ userId, role? }` |
| DELETE | `/api/teams/:id/members/:userId` | Yes | Superadmin | Remove member |
| POST | `/api/teams/:id/picture` | Yes | Superadmin | Upload team picture |

## AI Routes (`/api/ai`)

**File:** `routes/aiRoutes.js` — All routes require JWT authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/ai/chat` | Yes | Chat with DoBo. Body: `{ message, chatHistory[], context, model? }` |
| POST | `/api/ai/proactive` | Yes | Get proactive suggestion. Body: `{ context }` |
| GET | `/api/ai/memory?project=X&userId=Y` | Yes | Read DoBo memory (own only, or superadmin) |
| GET | `/api/ai/memory/status?project=X` | Yes | Check if DoBo has memory |
| DELETE | `/api/ai/memory?project=X&userId=Y` | Yes | Clear DoBo memory |
| POST | `/api/ai/context` | Yes | Save context snapshot. Body: `{ project, context }` |
| POST | `/api/ai/upload?project=X` | Yes | Upload file for AI (max 10MB, 5/day) |
| POST | `/api/ai/edit-request` | Yes | Forward edit request to admin (5/hour limit) |
| POST | `/api/ai/edit-requests/acknowledge` | Yes (Superadmin) | Mark edit requests as read |

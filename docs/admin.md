# Admin Panel

**Page:** `admin.html` | **API:** `routes/adminRoutes.js`

The admin panel is accessible only to superadmins (sidebar link hidden for regular users).

## User Management

### User List

`GET /api/admin/users` — Returns all users with:
- Name, email, username, role, avatar, status (approved/pending), verification status, creation date
- Superadmin users are only visible to other superadmins

### Approve / Revoke

`POST /api/admin/approve` with `{ email, status: 'approved'|'revoked' }`:
- On approval: `isApproved` set to `true`, zero-access ACL auto-created, welcome email sent
- On revoke: `isApproved` set to `false` — user cannot log in

### Reject (Delete)

`POST /api/admin/reject` with `{ email }`:
- Permanently removes user from `users.json`
- Sends rejection email
- Cannot reject superadmins

### Update User

`POST /api/admin/user/update` (superadmin only) with `{ email, username?, password? }`:
- Can change username (checked for uniqueness)
- Can reset password (hashed with bcrypt)
- Only superadmins can edit other superadmin accounts

### Session Termination

`POST /api/admin/terminate-session` (superadmin only) with `{ email }`:
- Force-terminates all sessions for a user
- User is immediately rejected on their next API call
- Cleared on their next successful login

## Session History

`GET /api/admin/user-sessions/:email` — Returns:
- Login/logout history with timestamps, IP, device info
- Last login details
- List of unique devices used

`GET /api/admin/user-stats/:email` — Returns:
- Total login/logout counts
- Last login/logout timestamps
- Device list
- Account creation date

## Action Logs

`GET /api/admin/logs` — Returns the last 1000 action log entries (newest first).

`GET /api/admin/logs/search?query=X` — Full-text search across log details and actions.

## Super Logs (Superadmin Only)

The super log is a comprehensive system event log. See [Logging](./logging.md).

`GET /api/admin/super-logs` — Query with filters:
- `after_id`: Only entries after this ID (for polling)
- `types`: Comma-separated type filter (request, auth, file, sync, chat, error, system)
- `level`: Level filter (debug, info, warn, error)
- `limit`: Max results (default 100, max 500)
- `search`: Substring search in message and meta

`GET /api/admin/super-logs/stats` — 24-hour statistics by type and level.

## Access Control Management

See [Access Control](./access-control.md) for full details.

- `GET /api/admin/access-control` — All ACL rules
- `GET /api/admin/access-control/:email` — User's ACL
- `POST /api/admin/access-control/:email` — Set ACL
- `DELETE /api/admin/access-control/:email` — Remove restrictions

## NAS Sync Status

- `GET /api/admin/sync-status` — Current sync state
- `POST /api/admin/sync-trigger` — Manually trigger full sync

## Settings

**Page:** `settings.html` | **API:** `routes/settingsRoutes.js`

Currently manages generator (Einblasprotokoll PDF generator) access:
- Generator URL and API URL
- Generator access code (legacy)
- Allowed users list (email-based)

`GET /api/settings/generator-access` — Any user can check if they have generator access (superadmins always have access).

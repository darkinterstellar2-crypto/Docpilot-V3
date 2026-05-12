# Architecture Overview — docpilot

> **Rebuild reference:** This document is the definitive architectural overview. Together with the other docs in this folder, it must be sufficient to understand and recreate the full system from scratch.

---

## Tech Stack

| Layer | Technology | Version / Notes |
|---|---|---|
| Runtime | Node.js | v22 (LTS, via `node:22-alpine` Docker image) |
| Web framework | Express | ^5.2.1 |
| Database (chat) | SQLite via `better-sqlite3` | ^12.8.0 — per-project chat DBs |
| Email | Nodemailer | ^8.0.3 — SMTP via Kasserver |
| File archive | Archiver | ^7.0.1 — project ZIP export |
| Excel export | xlsx (SheetJS) | ^0.18.5 |
| WebDAV (NAS) | webdav | ^5.9.0 |
| File upload | Multer | ^1.4.5-lts.1 |
| Env loading | dotenv | ^17.4.0 |
| Password hashing | bcryptjs | ^2.4.3 — pure JS, no native compilation |
| JWT sessions | jsonwebtoken | ^9.0.2 — token creation + verification |
| Frontend | Vanilla JS + Tailwind CSS (CDN) | No build step — plain HTML/JS |
| Reverse proxy | Traefik | Running on VPS host (not inside DocPilot container) |
| Container | Docker + docker-compose | Node.js app + volumes |

---

## Complete File / Folder Structure

```
docpilot/
│
├── server.js                         ← Entry point. Loads .env, initialises storage,
│                                       runs migration, starts NAS sync, mounts all routes.
│                                       Has graceful shutdown (SIGTERM/SIGINT).
│
├── package.json                      ← NPM manifest. name: "datamanagement", v1.0.0.
├── package-lock.json                 ← Lockfile. Committed to git.
│
├── .env                              ← Secrets (GITIGNORED). See environment.md.
├── .env.example                      ← Template for .env — safe to commit.
├── .gitignore                        ← Ignores: node_modules, .env, *.db, storage/, logs, etc.
├── .dockerignore                     ← Ignores: node_modules, .env, .git, storage/, *.db, docs/
│
├── Dockerfile                        ← node:22-alpine, npm ci --production,
│                                       creates /data/storage and src/DataFiles, EXPOSE 3000.
├── docker-compose.yml                ← Defines docpilot service, two named volumes,
│                                       Traefik labels, healthcheck.
├── Caddyfile                         ← Legacy Caddy config (NOT used in production —
│                                       Traefik is used instead). Kept for reference.
│
├── RULES.md                          ← Developer rules and conventions for this project.
├── DASHBOARD_SPEC.md                 ← Product spec / feature list for the dashboard.
│
├── controllers/                      ← Business logic, shared helpers
│   ├── storageConfig.js              ← Single source of truth for ALL file paths.
│   │                                   Exports: STORAGE_ROOT, getProjectRoot(),
│   │                                   getDatafileDir(), getXlsxDir(), getChatDir(),
│   │                                   getChatMediaDir(), ensureDir(), ensureStorageRoot()
│   ├── chatDb.js                     ← Per-project SQLite chat connection pool (LRU, max 20).
│   │                                   Exports: sendMessage, getMessages, getNewMessages,
│   │                                   getMessageCount, editMessage, deleteMessage, closeAll
│   ├── nasSync.js                    ← NAS WebDAV background sync engine.
│   │                                   Exports: startSync, fullSync, syncFile, queueOperation,
│   │                                   fetchFromNAS, cleanup48h, getSyncStatus, triggerSync, isEnabled
│   ├── nasOnDemand.js                ← Transparent on-demand file fetch from NAS when
│   │                                   a file has been cleaned. Exports: ensureLocalFile
│   ├── dataVersioning.js             ← Creates timestamped .txt copy + Excel .xlsx
│   │                                   export on every aufmass save. Exports: saveVersionedCopy
│   ├── fileMeta.js                   ← .filemeta.json read/write/rename tracking.
│   │                                   Exports: getFileMeta, setFileMeta, renameFileMeta,
│   │                                   getProjectRoot (re-exported from storageConfig)
│   ├── folderSync.js                 ← Auto-create cluster/knotenpunkt folder structures.
│   │                                   Exports: syncClusterFolders, syncKnotenpunktFolders,
│   │                                   getExistingClusters, getExistingKnotenpunkte,
│   │                                   getClustersFromDataFile, getKnotenpunkteFromDataFile,
│   │                                   performFolderSync
│   ├── projectCreator.js             ← Creates full project directory structure + initialises
│   │                                   data file + adds to projects.json. Exports: createProjectStructure
│   ├── trashHelper.js                ← Shared soft-delete helper (moves to .trash/ with
│   │                                   30-day expiry). Exports: moveToTrash
│   ├── logger.js                     ← Simple audit log (logs.json, max 1000 entries).
│   │                                   Exports: getLogs, logAction
│   ├── sessionLogger.js              ← Login/logout tracking to sessions-log.json.
│   │                                   Exports: logSession, getSessionHistory, getAllSessions,
│   │                                   getLastLogin, getLastLogout, getActiveDevices,
│   │                                   clearTermination, isTerminated
│   ├── superLogger.js                ← High-level system event ring buffer (5000 entries in memory,
│   │                                   flushed to super-log.json every 30s or 100 entries).
│   │                                   Also provides requestLogger Express middleware.
│   │                                   Exports: superLog, getSuperLogs, getLogStats,
│   │                                   requestLogger, shutdownFlush
│   ├── accessControl.js             ← ACL engine: per-user, per-project, per-module.
│   │                                   Storage: access-control.json.
│   │                                   Exports: getUserAccess, setUserAccess, removeUserAccess,
│   │                                   getAllAccessRules, canAccessProject, canAccessModule,
│   │                                   getAccessibleProjects, canEditProject,
│   │                                   getEffectivePermissions, getProjectMembers, canDashboard
│   ├── passwordHelper.js            ← bcrypt password hashing with auto-migration from
│   │                                   legacy plain text. 12 salt rounds.
│   │                                   Exports: hashPassword, verifyPassword
│   ├── tokenHelper.js               ← JWT session tokens. Auto-generates secret on first boot.
│   │                                   2h superadmin / 8h user expiry. Silent refresh support.
│   │                                   Exports: createToken, verifyToken, checkRefreshEligible,
│   │                                   authMiddleware
│   └── rateLimiter.js               ← In-memory login rate limiter.
│                                       5 attempts → 15 min lockout per IP+identifier.
│                                       Exports: checkAttempt, recordFailure, clearAttempts
│
├── routes/                           ← Express route handlers
│   ├── authRoutes.js                 ← POST /api/register, /api/verify-otp,
│   │                                   /api/login, /api/verify-2fa,
│   │                                   /api/refresh, /api/logout
│   ├── dataRoutes.js                 ← GET/POST /api/data — aufmass table read/write,
│   │                                   cell diff logging, folder sync, NAS push
│   ├── fileRoutes.js                 ← /api/files — list, upload, download, rename,
│   │                                   delete (soft), copy, move, folder create, share links,
│   │                                   trash management. Also exports serveShare (public).
│   ├── moduleRoutes.js               ← /api/modules — navigation tree, file upload to
│   │                                   module folders, aufmass-update (cell-level update),
│   │                                   aufmass-row (read single row), list-files, clear-files
│   ├── projectRoutes.js              ← /api/projects — list, create, status, reorder,
│   │                                   remove, ZIP download, cluster/knotenpunkt CRUD
│   ├── chatRoutes.js                 ← /api/chat/:project — get/send/edit/delete messages,
│   │                                   media upload + serving
│   ├── adminRoutes.js                ← /api/admin — user management, approve, logs, sync status,
│   │                                   session history, user stats, user update,
│   │                                   access control CRUD, super-logs (superadmin only)
│   ├── accessRoutes.js              ← GET /api/access/my-permissions — per-user module perms
│   ├── profileRoutes.js              ← /api/profile — self-service profile management.
│   │                                   GET/PUT /api/profile (name, username),
│   │                                   PUT /api/profile/password,
│   │                                   POST/DELETE /api/profile/avatar,
│   │                                   GET /api/profile/avatar/:filename,
│   │                                   GET /api/profile/check-username
│   ├── projectInfoRoutes.js          ← /api/project-info — per-project metadata.
│   │                                   GET /api/project-info/:project,
│   │                                   PUT /api/project-info/:project,
│   │                                   GET /api/project-info/:project/members
│   └── settingsRoutes.js             ← /api/settings — app-level settings (superadmin).
│                                       GET/PUT /api/settings,
│                                       GET /api/settings/generator-access,
│                                       POST /api/settings/verify-code
│
├── src/
│   ├── DataFiles/                    ← App-level config/data (NOT project data — that's storage/)
│   │                                   ⚠️ CASE SENSITIVE: "DataFiles" (PascalCase) ≠ "datafile" (lowercase).
│   │                                   datafile/ lives inside each project folder under Doku/Aufmass/.
│   │   ├── users.json                ← User accounts (email, password, role, isVerified, isApproved, OTP)
│   │   ├── projects.json             ← Project registry (name, locations, status, progress)
│   │   ├── logs.json                 ← Audit log (max 1000 entries)
│   │   ├── schema.json               ← (Reserved — not actively used as of now)
│   │   ├── super-log.json            ← System event log (flushed from ring buffer)
│   │   ├── access-control.json       ← ACL rules per user
│   │   ├── sessions-log.json         ← Login/logout events (max 10,000)
│   │   ├── shares.json               ← Active share links (created by admins)
│   │   ├── terminated-sessions.json  ← Force-terminated user emails (runtime)
│   │   ├── project-info.json         ← Per-project metadata: description, custom fields, members array
│   │   ├── settings.json             ← App settings: generatorCode, generatorUrl, generatorApiUrl, generatorAllowedUsers[]
│   │   ├── .jwt-secret               ← Auto-generated JWT signing secret (gitignored)
│   │   └── avatars/                  ← Profile picture storage. Files named <userId>.jpg/png/webp
│   ├── css/
│   │   └── styles.css                ← Global styles (glassmorphism, Tailwind overrides)
│   └── js/
│       ├── api.js                    ← Global fetch interceptor: attaches JWT Bearer token,
│       │                               auto-refreshes when within 30 min of expiry
│       ├── force-logout.js           ← Global fetch interceptor: detects 401 force-logout
│       │                               and token expiry, clears localStorage, redirects to login
│       ├── auth.js                   ← Login/register/OTP/2FA page logic
│       ├── dashboard.js              ← Project list (index.html)
│       ├── new-project.js            ← Project creation wizard
│       ├── table.js                  ← Aufmass data table (aufmass.html)
│       ├── module-shared.js          ← ModuleNavigator class — shared navigation
│       │                               for druckprufung, apl, einblasen, etc.
│       ├── apl.js                    ← APL module frontend
│       ├── druckprufung.js           ← Druckprüfung module frontend
│       ├── einblasen.js              ← Einblasen module frontend
│       ├── kalibrieren.js            ← Kalibrieren module frontend
│       ├── knotenpunkt-vorbereitung.js ← Knotenpunkt Vorbereitung + NVT & Splicing module frontend (merged)
│       ├── otdr.js                   ← OTDR module frontend
│       ├── appointment-shared.js     ← Shared module logic for appointment-related pages
│       ├── header-avatar.js          ← Renders user avatar in page header
│       ├── i18n.js                   ← Internationalization / translation support
│       ├── logout.js                 ← Logout flow logic
│       └── modal.js                  ← Modal/dialog UI component
│
├── storage/                          ← STORAGE_ROOT — all project data
│   └── <ProjectName>/                ← One folder per project (see storage.md)
│
├── (docs live externally)            ← Documentation is maintained separately from the codebase
│                                       Location: ../documentations/DocPilot/ (outside docpilot/)
│                                       Sections: architecture/, api/, deployment/, changelogs/
│
└── *.html                            ← Frontend pages (no build step — plain HTML)
    ├── login.html                    ← Public login page
    ├── register.html                 ← Public registration + OTP page
    ├── index.html                    ← Project list (dashboard home)
    ├── dashboard.html                ← Single project overview
    ├── aufmass.html                  ← Aufmass data table
    ├── files.html                    ← File manager
    ├── admin.html                    ← Admin control panel
    ├── new-project.html              ← Project creation wizard
    ├── superlog.html                 ← System logs viewer (superadmin only)
    ├── apl.html                      ← APL module
    ├── druckprufung.html             ← Druckprüfung module
    ├── einblasen.html                ← Einblasen module
    ├── kalibrieren.html              ← Kalibrieren module
    ├── knotenpunkt-vorbereitung.html ← Knotenpunkt Vorbereitung module
    ├── otdr.html                     ← OTDR module
    ├── profile.html                  ← User profile page — self-service name/username/avatar/password

```

---

## Data Flow: User Request → Response

### 1. Reading Aufmass Data

```
Browser → GET /api/data?project=ProjectName
  Headers: x-user-email, x-user-role
  │
  ├─ ACL check: canAccessProject() + canAccessModule('aufmass')
  │
  ├─ getFilePath(projectName)
  │   ├─ look for latest versioned file: ProjectName_YYYYMMDD_HHMMSS.txt
  │   └─ fallback to ProjectName.txt
  │
  ├─ ensureLocalFile() — fetches from NAS if file was cleaned
  │
  ├─ parse JSON: [E1, [E2_0, ...dataRows]]
  │
  ├─ flatten into { schema, data } response format
  │
  └─ (async) background folder sync triggered via setImmediate()

Response: { success: true, schema: [...], data: [...] }
```

### 2. Saving Aufmass Data

```
Browser → POST /api/data?project=ProjectName
  Body: { schema: [...], data: [...] }
  │
  ├─ ACL check
  ├─ Read old data for cell-level diff
  ├─ OTDR auto-trigger logic (APL Done + Knoten Done → OTDR Waiting)
  ├─ Rebuild E2 from flat schema + data
  ├─ Write ProjectName.txt (main file)
  ├─ Log to logs.json
  │
  └─ (async, fire-and-forget):
      ├─ syncFile() → push to NAS
      ├─ saveVersionedCopy() → timestamped .txt + .xlsx
      └─ performFolderSync() → create missing cluster/knotenpunkt folders

Response: { success: true, otdrTriggered: N }
```

### 3. File Upload

```
Browser → POST /api/files/upload?project=X&path=Doku/ClusterA/APL
  Body: multipart/form-data (files[])
  │
  ├─ requireNonUserRole middleware (user role rejected)
  ├─ Multer saves to disk at destination path
  ├─ ACL check
  ├─ setFileMeta() for each file (who/when)
  ├─ Log to logs.json + superLogger
  │
  └─ (async) syncFile() for each file → push to NAS

Response: { success: true, count: N, filenames: [...] }
```

---

## Authentication Flow

```
REGISTRATION:
  POST /api/register { name, username, email, password }
  → Validate (role always 'user', no selection)
  → Validate password (8+ chars, strength indicator)
  → Hash password with bcrypt (12 rounds)
  → Store in pending map (in-memory, 15 min expiry)
  → Generate 6-digit OTP → send via email
  
  POST /api/verify-otp { email, otp }
  → Match OTP → move from pending → users.json
  → Set isVerified: true, isApproved: false
  → Account now pending admin approval

LOGIN (regular user):
  POST /api/login { identifier, password }
  → Rate limit check (5 attempts → 15 min lockout)
  → Find user by email OR username
  → Verify password (bcrypt OR legacy plain text with auto-migration)
  → Check isVerified + isApproved
  → Clear rate limiter + termination flag
  → Issue JWT token (8h expiry)
  → Return { role, name, email, token }

LOGIN (superadmin — 2FA):
  → Same steps as above through password verification
  → Generate 6-digit OTP → email to superadmin (with IP + device info)
  → Return { requires2FA: true, email }
  → Client shows 2FA input
  
  POST /api/verify-2fa { email, otp }
  → Verify OTP (5 min expiry)
  → Issue JWT token (2h expiry)
  → Return { role, name, email, token }

TOKEN REFRESH (automatic):
  → api.js checks token expiry before each request
  → If within 30 min of expiry → POST /api/refresh
  → Server issues fresh token → client swaps seamlessly
  → Active users never experience session expiry

  Client stores in localStorage: authToken, role, name, email
  api.js sends Authorization: Bearer <token> on all /api/ requests.
  Legacy x-user-email/x-user-role headers also sent (backward compat).

ADMIN APPROVAL:
  Superadmin sees pending users in /admin panel
  → POST /api/admin/approve { email, status: 'approved' }
  → Set isApproved: true → send welcome email

LOGOUT:
  POST /api/logout { email }
  → Log to sessions-log.json
  → Client clears localStorage (authToken, role, email, name)

SESSION TERMINATION:
  Superadmin → POST /api/admin/terminate-session { email }
  → All API calls from that user return 401 + forceLogout
  → Client interceptor catches it → clear + redirect
  → Cleared automatically on next login
```

---

## Role System

Only two roles exist (simplified 2026-04-05):

| Role | Description | Exact Permissions |
|---|---|---|
| `superadmin` | God-mode. Cannot be created via registration. Requires 2FA on every login. | Everything. ACL never applies. Sees all users (including other superadmins). Access to super-logs. Can terminate sessions. Can edit superadmin accounts. |
| `user` | Default for all registrations. Zero access by default — all access granted via ACL. | Can view/edit per ACL. `fullAccess` toggle or per-project/module grants. `canEdit` enables file operations. |

### Role Enforcement Points
- `authMiddleware` validates JWT token, sets `req.user` on all `/api/` routes
- Route handlers check `req.user.role` (or legacy `x-user-role` header during migration)
- `requireNonUserRole` middleware rejects `user` role on write routes (unless `canEdit`)
- `USER_ROLE_BLOCKED_MODULES` set blocks `user` role from module routes
- ACL engine: role restrictions always win over ACL grants
- Admin pages: client-side redirect (defence-in-depth; backend also enforces)

---

## Data Format: The [E1, [E2]] Structure

Every project has exactly one master data file at:
`storage/<ProjectName>/Doku/Aufmass/datafile/<ProjectName>.txt`

This is a JSON file with the following structure:

```json
[
  E1,    // Main header labels (array of strings)
  E2     // E2[0] = sub-headers, E2[1..N] = data rows
]
```

### Detailed breakdown

```
E1 = ["Identification", "Location", "Cable", "APL", "OTDR", ...]
       Group 0           Group 1     Group 2   Group 3  Group 4

E2 = [
  E2_0,   // Sub-headers: array of arrays, one per group
  row1,   // First data row
  row2,   // Second data row
  ...
]

E2_0 = [
  ["Unique Project ID", "Metadata"],        // Group 0 columns
  ["Address Start", "Address End"],          // Group 1 columns
  ["Cable Name", "Fiber Type", "Splices"],  // Group 2 columns
  ["APL Status", "APL Date"],              // Group 3 columns
  ["OTDR Status", "OTDR Date"],            // Group 4 columns
  ...
]

row1 = [
  ["ROW-001", "some-meta"],                // Group 0 values
  ["Zeilerweg 11", "Zeilerweg 15"],        // Group 1 values
  ["KAB-001", "G.652D", "12"],             // Group 2 values
  ["Done", "2025-03-15"],                  // Group 3 values
  ["Waiting", ""],                         // Group 4 values
  ...
]
```

### Key design rules
- `row[0][0]` is always the **Unique Project ID** — the row's primary key
- Group 0 ("Identification") is always prepended automatically — never shown in UI
- "Cluster" column drives folder structure auto-sync
- "Knotenpunkt"/"NVT" column drives sub-folder creation
- The file is read/written atomically (entire file rewritten on each save)
- Versioned copies are created on every save: `ProjectName_YYYYMMDD_HHMMSS.txt`

### On the wire (API response)
The API flattens this into `{ schema, data }` for the frontend:

```json
{
  "schema": [
    { "id": "grp-0", "title": "Identification", "cols": [
      { "id": "col-0-0", "label": "Unique Project ID" },
      { "id": "col-0-1", "label": "Metadata" }
    ]},
    ...
  ],
  "data": [
    { "_id": "ROW-001", "col-0-0": "ROW-001", "col-1-0": "Zeilerweg 11", ... },
    ...
  ]
}
```

---

## Storage Structure (STORAGE_ROOT Layout)

See [storage.md](./storage.md) for the complete deep-dive.

```
storage/                              ← STORAGE_ROOT (mounted Docker volume)
└── <ProjectName>/
    ├── Doku/
    │   ├── Aufmass/
    │   │   ├── datafile/             ← .txt data files + versioned copies
    │   │   └── xlsx/                 ← Excel exports
    │   └── <ClusterName>/            ← auto-created per cluster
    │       ├── APL/<KnotenpunktName>/
    │       ├── Druckprufung/<Knotenpunkt>/
    │       ├── Einblasen/BB/<Knotenpunkt>/
    │       ├── Einblasen/HA/<Knotenpunkt>/
    │       ├── kalibrieren/<Knotenpunkt>/
    │       ├── Knotenpunkt_Vorbereitung/<Knotenpunkt>/
    │       ├── OTDR/<Knotenpunkt>/
    │       ├── POP_details/
    │       └── SCT_details/
    ├── Pläne/
    │   └── <ClusterName>/
    ├── chat/
    │   ├── chat.db                   ← SQLite DB for this project's chat
    │   ├── .migrated                 ← flag file: migration from legacy DB done
    │   └── media/                    ← chat media attachments
    ├── row-versions.json             ← Optimistic locking version tracker for concurrent row edits
    ├── .filemeta.json                ← { "relPath": { modifiedBy, modifiedAt } }
    └── .trash/
        ├── .manifest.json            ← trash items with 30-day expiry
        └── <trashed_files_and_dirs>
```

---

## Module List

All modules display data from the single master `.txt` data file. Navigation is cluster → knotenpunkt → address.

| Module | HTML Page | Description |
|---|---|---|
| Aufmass | `aufmass.html` | Main data table. Full CRUD on all columns. |
| Files | `files.html` | File manager. Upload, rename, delete, copy, move, share links. |
| APL | `apl.html` | APL (Abschlusspunkt Linientechnik) documentation. Upload/view files per knotenpunkt. |
| Druckprüfung | `druckprufung.html` | Pressure test documentation. |
| Einblasen | `einblasen.html` | Cable blowing documentation. BB/HA sub-categories. |
| Kalibrieren | `kalibrieren.html` | Calibration documentation. |
| Knotenpunkt Vorbereitung | `knotenpunkt-vorbereitung.html` | Junction point preparation docs. |
| OTDR | `otdr.html` | Optical Time-Domain Reflectometer test docs. Auto-triggered when APL+Knoten are Done. |
| NVT & Splicing | `knotenpunkt-vorbereitung.html` | NVT preparation images and fiber splice records per address. |
| Chat | (embedded per project) | Per-project team chat. SQLite, media uploads, polling every 3s. |
| Dashboard | `dashboard.html` | Project overview — links to all modules for a given project. |

---

## Cross-Reference

- Storage paths → [storage.md](./storage.md)
- Auth + ACL details → [auth.md](./auth.md)
- Chat system → [chat.md](./chat.md)
- All API endpoints → [../api/endpoints.md](../api/endpoints.md)
- Deployment → [../deployment/hosting.md](../deployment/hosting.md)
- NAS integration → [../deployment/nas-integration.md](../deployment/nas-integration.md)
- Environment variables → [../deployment/environment.md](../deployment/environment.md)

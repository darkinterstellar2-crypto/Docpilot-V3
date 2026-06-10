# Architecture

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Runtime** | Node.js (v22 in Docker) | CommonJS modules (`"type": "commonjs"` in package.json) |
| **Server** | Express 5.2 | HTTP framework |
| **Frontend** | Vanilla JavaScript + HTML | No React/Vue/Angular — each page is a standalone HTML file |
| **CSS** | Tailwind CSS (CDN) | Loaded from CDN in each HTML page; supplemented by `src/css/styles.css` |
| **Data Storage** | JSON files + SQLite | JSON for users/projects/settings/ACL; SQLite for per-project chat |
| **Authentication** | JWT (jsonwebtoken) | Bearer tokens in Authorization header |
| **Password Hashing** | bcryptjs | 12 salt rounds; auto-migrates plain text on first login |
| **File Upload** | Multer | Up to 200 MB per file (50 MB for chat media) |
| **Email** | Nodemailer | SMTP for OTP, approval notifications, 2FA |
| **NAS Sync** | WebDAV (webdav npm) | Optional background sync to NAS/UGREEN |
| **Excel Export** | xlsx (SheetJS) | Auto-generated on every Aufmass save |
| **ZIP** | Archiver | Project backup downloads |
| **AI** | Gemini API + Anthropic API | Optional DoBo assistant with dual-model toggle |
| **Reverse Proxy** | Caddy / Traefik | TLS termination; Traefik labels in docker-compose.yml |

## Folder Structure

```
TheApp/
├── server.js                  # Entry point — Express setup, startup, route mounting
├── package.json               # Dependencies and scripts
├── .env.example               # Environment variable template
├── Dockerfile                 # Docker build (node:22-alpine)
├── docker-compose.yml         # Docker Compose with Traefik labels
├── Caddyfile                  # Caddy reverse proxy config
│
├── controllers/               # Backend business logic
│   ├── accessControl.js       # ACL engine — per-user, per-project, per-module permissions
│   ├── aiController.js        # AI orchestration (chat, proactive suggestions)
│   ├── aiCostTracker.js       # AI usage cost tracking (daily caps)
│   ├── aiDataProvider.js      # Live project data reader for DoBo (read-only)
│   ├── aiKnowledge.js         # Static app knowledge base for DoBo
│   ├── aiMailer.js            # Edit request forwarding (DoBo → admin email)
│   ├── aiMemory.js            # Per-user, per-project DoBo memory (file-based)
│   ├── aiProvider.js          # Swappable AI model abstraction (Gemini, Anthropic)
│   ├── aiRateLimiter.js       # Per-user AI request rate limiting
│   ├── aiSecurity.js          # Input sanitization, output filtering, abuse detection
│   ├── chatDb.js              # Per-project SQLite chat DB with connection pool
│   ├── dataVersioning.js      # Versioned .txt copies + Excel export on save
│   ├── fileMeta.js            # Per-file metadata tracking (.filemeta.json)
│   ├── folderSync.js          # Cluster/Knotenpunkt folder structure sync
│   ├── logger.js              # Action log (logs.json, last 1000 entries)
│   ├── nasOnDemand.js         # On-demand file fetch from NAS
│   ├── nasSync.js             # Background WebDAV NAS sync engine
│   ├── passwordHelper.js      # bcrypt hash + plain text migration
│   ├── projectCreator.js      # Project folder structure generator
│   ├── rateLimiter.js         # Login rate limiter (5 attempts / 15 min)
│   ├── sessionLogger.js       # Login/logout event logger with device parsing
│   ├── storageConfig.js       # STORAGE_ROOT path helpers (single source of truth)
│   ├── superLogger.js         # Ring-buffer system event logger (5000 entries)
│   ├── tokenHelper.js         # JWT creation, verification, refresh
│   └── trashHelper.js         # Soft-delete to .trash with 30-day expiry
│
├── routes/                    # Express route handlers
│   ├── authRoutes.js          # /api/register, /api/login, /api/verify-otp, /api/logout, etc.
│   ├── dataRoutes.js          # /api/data — Aufmass data read/write
│   ├── projectRoutes.js       # /api/projects — CRUD, status, reorder, ZIP, clusters
│   ├── adminRoutes.js         # /api/admin — user mgmt, ACL, super logs, NAS status
│   ├── fileRoutes.js          # /api/files — file browser, upload, trash, share links
│   ├── moduleRoutes.js        # /api/modules — navigation tree, per-row updates, file ops
│   ├── chatRoutes.js          # /api/chat — per-project chat (SQLite)
│   ├── accessRoutes.js        # /api/access — user's own permissions query
│   ├── profileRoutes.js       # /api/profile — profile, avatar, password, 2FA
│   ├── settingsRoutes.js      # /api/settings — generator access config
│   ├── projectInfoRoutes.js   # /api/project-info — project descriptions, members
│   ├── geocodeRoutes.js       # /api/geocode — Nominatim reverse geocoding proxy
│   ├── aiRoutes.js            # /api/ai — DoBo chat, memory, context, uploads
│   └── teamRoutes.js          # /api/teams — team CRUD, members, pictures
│
├── src/
│   ├── js/                    # Frontend JavaScript (loaded via <script> tags)
│   │   ├── api.js             # Global fetch interceptor (JWT injection, auto-refresh)
│   │   ├── auth.js            # Login/register form handling
│   │   ├── dashboard.js       # Hub/dashboard — project cards, permission-based UI
│   │   ├── table.js           # Aufmass table renderer (1340 lines)
│   │   ├── module-shared.js   # ModuleNavigator class (shared by all modules)
│   │   ├── einblasen.js       # Einblasen module page logic
│   │   ├── apl.js             # APL/Splicing module page logic
│   │   ├── otdr.js            # OTDR module page logic
│   │   ├── druckprufung.js    # Druckprüfung module page logic
│   │   ├── kalibrieren.js     # Kalibrieren module page logic
│   │   ├── knotenpunkt-vorbereitung.js  # Knotenpunkt-Vorbereitung module
│   │   ├── geocam.js          # GeoCam overlay (1641 lines — camera + GPS)
│   │   ├── planner.js         # Planner/calendar page logic
│   │   ├── new-project.js     # New project wizard
│   │   ├── modal.js           # Reusable modal system
│   │   ├── i18n.js            # English/German translation system
│   │   ├── sidebar-toggle.js  # Collapsible sidebar
│   │   ├── idle-logout.js     # Inactivity auto-logout
│   │   ├── force-logout.js    # Force-logout on 401 responses
│   │   ├── header-avatar.js   # User avatar in header
│   │   ├── logout.js          # Logout button handler
│   │   ├── ai-widget.js       # DoBo floating widget
│   │   ├── ai-chat.js         # DoBo chat UI
│   │   ├── ai-context.js      # DoBo context manager
│   │   ├── ai-face.js         # DoBo animated face
│   │   ├── ai-thoughts.js     # DoBo thought bubble animations
│   │   ├── dobo-loader.js     # DoBo iframe loader
│   │   └── appointment-shared.js  # Shared appointment/termin logic
│   │
│   ├── css/
│   │   ├── styles.css         # Main stylesheet
│   │   └── ai-widget.css      # DoBo widget styles
│   │
│   ├── img/                   # Static images
│   │
│   └── DataFiles/             # Persistent data (JSON + JWT secret)
│       ├── users.json         # User accounts
│       ├── projects.json      # Project list
│       ├── access-control.json # ACL rules
│       ├── logs.json          # Action logs
│       ├── super-log.json     # System event ring buffer
│       ├── schema.json        # Default Aufmass column schema
│       ├── settings.json      # App settings (generator access)
│       ├── project-info.json  # Project descriptions + members
│       ├── data.json          # (legacy)
│       ├── .jwt-secret        # Auto-generated JWT signing key
│       ├── sessions-log.json  # Login/logout event history
│       ├── terminated-sessions.json  # Force-terminated user sessions
│       └── shares.json        # Active share links
│
├── storage/                   # Project file storage (STORAGE_ROOT)
│   └── <ProjectName>/
│       ├── Doku/
│       │   ├── Aufmass/
│       │   │   ├── datafile/  # .txt data files + versioned copies
│       │   │   └── xlsx/      # Auto-generated Excel exports
│       │   └── <ClusterName>/
│       │       ├── APL/
│       │       ├── Druckprufung/
│       │       ├── Einblasen/BB/
│       │       ├── Einblasen/HA/
│       │       ├── kalibrieren/
│       │       ├── Knotenpunkt_Vorbereitung/
│       │       ├── OTDR/
│       │       ├── POP_details/
│       │       └── SCT_details/
│       ├── Pläne/
│       ├── chat/
│       │   ├── chat.db        # SQLite database for this project's chat
│       │   └── media/         # Chat media files
│       ├── .trash/            # Soft-deleted files (30-day expiry)
│       ├── .filemeta.json     # File modification metadata
│       └── row-versions.json  # Optimistic locking versions
│
├── designs/                   # UI design reference (HTML mockups + screenshots)
│
├── *.html                     # Frontend pages (17+ HTML files)
│   ├── index.html             # Hub / project selector
│   ├── login.html             # Login page
│   ├── register.html          # Registration page
│   ├── dashboard.html         # Project dashboard (module cards)
│   ├── admin.html             # Admin panel
│   ├── aufmass.html           # Aufmass data table
│   ├── einblasen.html         # Fiber blowing module
│   ├── druckprufung.html      # Pressure testing module
│   ├── kalibrieren.html       # Calibration module
│   ├── apl.html               # APL/Splicing module
│   ├── otdr.html              # OTDR testing module
│   ├── knotenpunkt-vorbereitung.html  # Junction prep module
│   ├── files.html             # File browser
│   ├── planner.html           # Calendar/planner
│   ├── new-project.html       # New project wizard
│   ├── profile.html           # User profile
│   ├── settings.html          # Settings (generator access)
│   ├── teams.html             # Teams management
│   ├── superlog.html          # Super log viewer
│   ├── calendar.html          # Calendar (design placeholder)
│   └── dobo.html              # DoBo AI assistant page
│
└── docs/                      # This documentation
```

## Request Flow

### Authentication Flow

```
Browser → GET /login.html
Browser → POST /api/login { identifier, password }
         ↓
server.js → authRoutes.js (no auth middleware — login is public)
         ↓
         rateLimiter.checkAttempt()
         passwordHelper.verifyPassword()
         (optional: 2FA → POST /api/verify-2fa)
         tokenHelper.createToken()
         ← { success, role, name, email, token }
         ↓
Browser stores token in localStorage.authToken
```

### Authenticated API Request Flow

```
Browser → fetch('/api/data?project=MyProject')
         ↓
api.js intercept:
  1. Injects Authorization: Bearer <token>
  2. Auto-refreshes if token near expiry
         ↓
server.js middleware chain:
  1. Block sensitive paths (/server.js, /controllers, etc.)
  2. express.static (serve HTML, JS, CSS)
  3. superLogger.requestLogger (log all requests)
  4. tokenHelper.authMiddleware (verify JWT, set req.user)
  5. sessionLogger.isTerminated (check force-termination)
  6. Route handler (e.g., dataRoutes.js)
     - ACL check (accessControl.canAccessProject, canAccessModule)
     - Business logic
     - Response
```

### Static File Security

The server blocks access to sensitive server-side files via middleware (before `express.static`):

```javascript
const blocked = [
    '/server.js', '/package.json', '/package-lock.json', '/dockerfile',
    '/docker-compose.yml', '/.gitignore', '/.dockerignore', '/caddyfile',
    '/controllers', '/routes', '/storage', '/src/datafiles',
    '/docs', '/.env', '/node_modules',
];
```

Any request matching these paths returns a `404` — preventing exposure of source code, configuration, or data files.

## Design System

DocPilot V3 uses an "Industrial Modern" design:

- **Sidebar:** Navy `#022448`
- **Content background:** `#F8FAFC`
- **Accent color:** Amber `#fea619`
- **Font:** Inter (via Google Fonts CDN)
- **Icons:** Google Material Symbols

All 17+ HTML pages follow this consistent design system with a collapsible sidebar navigation.

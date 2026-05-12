# VPS Server & Docker Structure

> Complete map of where everything lives on the production server.

---

## VPS Host (187.124.164.237)

```
VPS Server (Hostinger, Ubuntu)
│
├── /opt/docpilot/                    ← App source code (git clone)
│   ├── server.js
│   ├── package.json
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── .env                          ← Environment variables (secrets)
│   ├── aufmass.html
│   ├── dashboard.html
│   ├── index.html
│   ├── login.html
│   ├── register.html
│   ├── admin.html
│   ├── superlog.html
│   ├── files.html
│   ├── new-project.html
│   ├── apl.html
│   ├── druckprufung.html
│   ├── einblasen.html
│   ├── kalibrieren.html
│   ├── knotenpunkt-vorbereitung.html
│   ├── otdr.html
│   ├── profile.html
│   ├── controllers/
│   ├── routes/
│   └── src/
│       ├── js/
│       ├── css/
│       └── DataFiles/                ← NOT used in production (volume overrides this)
│
├── /opt/generators/                  ← Generators app (git clone)
│   ├── app.py
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── ...
│
├── /docker/traefik/                  ← Traefik reverse proxy
│   ├── docker-compose.yml
│   └── config/
│       └── generators.yml            ← File provider route for generators.geggos.ai
│
└── Docker Volumes (managed by Docker — NOT visible as normal folders)
    ├── geggos-storage                ← All project data (/data/storage inside container)
    └── docpilotdata                  ← App config files (/app/src/DataFiles inside container)
```

---

## Inside the Docker Container "docpilot"

When Docker builds and runs the container, it creates a self-contained environment:

```
Docker Container: docpilot
│
├── /app/                             ← App code (copied from /opt/docpilot during build)
│   ├── server.js                     ← Entry point
│   ├── node_modules/                 ← Dependencies (installed inside container by npm ci)
│   ├── package.json
│   ├── aufmass.html
│   ├── dashboard.html
│   ├── (all other .html files)
│   ├── controllers/
│   │   ├── storageConfig.js          ← Defines all paths (STORAGE_ROOT)
│   │   ├── chatDb.js
│   │   ├── nasSync.js
│   │   ├── dataVersioning.js
│   │   ├── fileMeta.js
│   │   ├── folderSync.js
│   │   ├── projectCreator.js
│   │   ├── trashHelper.js
│   │   ├── logger.js
│   │   ├── sessionLogger.js
│   │   ├── superLogger.js
│   │   └── accessControl.js
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── dataRoutes.js
│   │   ├── fileRoutes.js
│   │   ├── moduleRoutes.js
│   │   ├── projectRoutes.js
│   │   ├── chatRoutes.js
│   │   ├── adminRoutes.js
│   │   ├── accessRoutes.js
│   │   ├── profileRoutes.js
│   │   ├── projectInfoRoutes.js
│   │   └── settingsRoutes.js
│   └── src/
│       ├── js/
│       │   ├── api.js
│       │   ├── modal.js
│       │   ├── table.js
│       │   ├── dashboard.js
│       │   ├── module-shared.js
│       │   ├── auth.js
│       │   ├── force-logout.js
│       │   ├── logout.js
│       │   ├── header-avatar.js
│       │   ├── i18n.js
│       │   ├── appointment-shared.js
│       │   └── (module js files)
│       ├── css/
│       │   └── styles.css
│       │
│       └── DataFiles/                ← 🔒 DOCKER VOLUME: docpilotdata
│           │                            (persists across container rebuilds)
│           │
│           ├── users.json            ← All user accounts
│           ├── projects.json         ← Project registry (names, IDs, status)
│           ├── logs.json             ← Audit log (max 1000 entries)
│           ├── access-control.json   ← ACL rules per user
│           ├── sessions-log.json     ← Login/logout history (max 10,000)
│           ├── shares.json           ← Active file share links
│           ├── super-log.json        ← System event log (5000 entries)
│           ├── schema.json           ← Reserved (not actively used)
│           ├── terminated-sessions.json ← Force-terminated user sessions (runtime)
│           ├── project-info.json     ← Per-project metadata: description, fields, members
│           ├── settings.json         ← App settings: generator config, allowed users
│           ├── .jwt-secret           ← Auto-generated JWT signing secret
│           └── avatars/              ← Profile pictures (<userId>.jpg/png/webp)
│
└── /data/
    └── storage/                      ← 🔒 DOCKER VOLUME: geggos-storage
        │                                (persists across container rebuilds)
        │
        ├── Gemeinde Rauhenebrach/    ← Example project
        │   ├── Doku/
        │   │   ├── Aufmass/
        │   │   │   ├── datafile/
        │   │   │   │   ├── Gemeinde Rauhenebrach.txt              ← Master Aufmass data (JSON)
        │   │   │   │   ├── Gemeinde Rauhenebrach_20260405_143022.txt  ← Versioned copy
        │   │   │   │   ├── Gemeinde Rauhenebrach_20260406_091500.txt  ← Another version
        │   │   │   │   └── ...
        │   │   │   └── xlsx/
        │   │   │       ├── Gemeinde Rauhenebrach_20260405_143022.xlsx
        │   │   │       └── ...
        │   │   │
        │   │   ├── SUPPN/                        ← Cluster folder (auto-created)
        │   │   │   ├── APL/
        │   │   │   │   ├── NVT-001/              ← Knotenpunkt folder
        │   │   │   │   ├── NVT-002/
        │   │   │   │   └── ...
        │   │   │   ├── Druckprufung/
        │   │   │   │   └── NVT-001/
        │   │   │   ├── Einblasen/
        │   │   │   │   ├── BB/
        │   │   │   │   │   └── NVT-001/
        │   │   │   │   └── HA/
        │   │   │   │       └── NVT-001/
        │   │   │   ├── kalibrieren/
        │   │   │   │   └── NVT-001/
        │   │   │   ├── Knotenpunkt_Vorbereitung/
        │   │   │   │   └── NVT-001/
        │   │   │   ├── OTDR/
        │   │   │   │   └── NVT-001/
        │   │   │   ├── POP_details/              ← Cluster-level (no knotenpunkt sub)
        │   │   │   └── SCT_details/              ← Cluster-level
        │   │   │
        │   │   └── LAICH/                        ← Another cluster
        │   │       └── (same structure as SUPPN)
        │   │
        │   ├── Pläne/
        │   │   ├── SUPPN/
        │   │   └── LAICH/
        │   │
        │   ├── chat/
        │   │   ├── chat.db                       ← SQLite database for project chat
        │   │   ├── .migrated                     ← Migration flag
        │   │   └── media/                        ← Chat media attachments
        │   │       ├── 1712345678_photo.jpg
        │   │       └── ...
        │   │
        │   ├── .filemeta.json                    ← Who modified which file + when
        │   └── .trash/
        │       ├── .manifest.json                ← Trash index (30-day expiry)
        │       └── (soft-deleted files)
        │
        ├── Laich-Suppingen/                      ← Another project
        │   └── (same structure)
        │
        └── (other projects)/
```

---

## Key Concepts

### Docker Volumes Are Invisible
The two Docker volumes (`geggos-storage` and `docpilotdata`) are managed by Docker. They are NOT visible as normal folders on the VPS. You cannot `cd` into them or `scp` them directly.

### How to Access Volume Data

**Copy from container to VPS host:**
```bash
docker cp docpilot:/data/storage /tmp/docpilot-storage
docker cp docpilot:/app/src/DataFiles /tmp/docpilot-datafiles
```

**Then SCP from VPS to your PC:**
```bash
scp -r root@187.124.164.237:/tmp/docpilot-storage E:\path\to\local\storage
scp -r root@187.124.164.237:/tmp/docpilot-datafiles E:\path\to\local\src\DataFiles
```

**Or inspect volume host path:**
```bash
docker volume inspect geggos-storage --format '{{.Mountpoint}}'
docker volume inspect docpilotdata --format '{{.Mountpoint}}'
```
This shows the actual Linux path (e.g. `/var/lib/docker/volumes/geggos-storage/_data/`) which you CAN `scp` directly — but `docker cp` is simpler.

### What Survives Container Rebuilds
| What | Survives? | Where |
|------|-----------|-------|
| Project data (Aufmass, files, chat) | ✅ Yes | `geggos-storage` volume |
| User accounts, project list, logs | ✅ Yes | `docpilotdata` volume |
| App code | ❌ Rebuilt | From git + Dockerfile |
| node_modules | ❌ Rebuilt | npm ci during build |
| .env file | ✅ Yes | On VPS host at /opt/docpilot/.env |

### Local Development Setup
When running locally (not in Docker), the app uses:
- `STORAGE_ROOT=./storage` → project data in `<app-root>/storage/`
- `src/DataFiles/` → directly on disk (no volume)

---

## Domain Routing

```
Internet
│
├── geggos.ai           → Traefik (port 443)  → docpilot container (port 3000)
└── generators.geggos.ai → Traefik (port 443) → localhost:8501 (file provider route)
```

Traefik runs in `network_mode: host` on the VPS. It handles SSL via Let's Encrypt.
- DocPilot: routed via Docker labels (auto-discovered)
- Generators: routed via file provider config at `/docker/traefik/config/generators.yml`

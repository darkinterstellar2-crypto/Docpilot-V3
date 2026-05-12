# DocPilot — Complete Project Documentation (V2.6)

> Written for complete beginners in IT. Every concept is explained from scratch.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
   - 1.1 [What is DocPilot?](#11-what-is-docpilot)
   - 1.2 [Who is it for?](#12-who-is-it-for)
   - 1.3 [Tech Stack](#13-tech-stack)
   - 1.4 [Architecture Diagram](#14-architecture-diagram)
2. [Getting Started](#2-getting-started)
   - 2.1 [Prerequisites](#21-prerequisites)
   - 2.2 [Installation](#22-installation)
   - 2.3 [Environment Variables (.env)](#23-environment-variables-env)
   - 2.4 [Running Locally](#24-running-locally)
   - 2.5 [Docker Deployment](#25-docker-deployment)
   - 2.6 [Directory Structure](#26-directory-structure)
3. [Authentication & Authorization](#3-authentication--authorization)
   - 3.1 [Registration Flow (OTP-based)](#31-registration-flow-otp-based)
   - 3.2 [Login Flow](#32-login-flow)
   - 3.3 [JWT Tokens](#33-jwt-tokens)
   - 3.4 [2-Step Verification (2FA)](#34-2-step-verification-2fa)
   - 3.5 [Roles](#35-roles)
   - 3.6 [Access Control (ACL)](#36-access-control-acl)
   - 3.7 [Rate Limiting & Security](#37-rate-limiting--security)
4. [Data Architecture](#4-data-architecture)
   - 4.1 [Project Structure on Disk](#41-project-structure-on-disk)
   - 4.2 [Data File Format (V2)](#42-data-file-format-v2)
   - 4.3 [Users Data (users.json)](#43-users-data-usersjson)
   - 4.4 [Settings Data](#44-settings-data)
   - 4.5 [NAS Sync](#45-nas-sync)
5. [Pages & Modules](#5-pages--modules)
   - 5.1 [Login (login.html / index.html)](#51-login-loginhtml--indexhtml)
   - 5.2 [Register (register.html)](#52-register-registerhtml)
   - 5.3 [Dashboard (dashboard.html)](#53-dashboard-dashboardhtml)
   - 5.4 [Aufmass (aufmass.html)](#54-aufmass-aufmasshtml)
   - 5.5 [Einblasen (einblasen.html)](#55-einblasen-einblasenhtml)
   - 5.6 [APL (apl.html)](#56-apl-aplhtml)
   - 5.7 [Druckprüfung (druckprufung.html)](#57-druckprüfung-druckprufunghtml)
   - 5.8 [Kalibrieren (kalibrieren.html)](#58-kalibrieren-kalibrierenhtml)
   - 5.9 [OTDR (otdr.html)](#59-otdr-otdrhtml)
   - 5.10 [Knotenpunkt Vorbereitung (knotenpunkt-vorbereitung.html)](#510-knotenpunkt-vorbereitung-knotenpunkt-vorbereitunghtml)
   - 5.11 [Planner (planner.html)](#511-planner-plannerhtml)
   - 5.12 [Files (files.html)](#512-files-fileshtml)
   - 5.13 [Admin Panel (admin.html)](#513-admin-panel-adminhtml)
   - 5.14 [Profile (profile.html)](#514-profile-profilehtml)
   - 5.15 [New Project (new-project.html)](#515-new-project-new-projecthtml)
   - 5.16 [Super Log (superlog.html)](#516-super-log-superloghtml)
6. [API Reference](#6-api-reference)
   - 6.1 [Auth Routes (/api/auth or /api/*)](#61-auth-routes-apiauthapi)
   - 6.2 [Data Routes (/api/data/*)](#62-data-routes-apidata)
   - 6.3 [Project Routes (/api/projects/*)](#63-project-routes-apiprojects)
   - 6.4 [Module Routes (/api/modules/*)](#64-module-routes-apimodules)
   - 6.5 [File Routes (/api/files/*)](#65-file-routes-apifiles)
   - 6.6 [Admin Routes (/api/admin/*)](#66-admin-routes-apiadmin)
   - 6.7 [Profile Routes (/api/profile/*)](#67-profile-routes-apiprofile)
   - 6.8 [Settings Routes (/api/settings/*)](#68-settings-routes-apisettings)
   - 6.9 [Chat Routes (/api/chat/*)](#69-chat-routes-apichat)
   - 6.10 [Access Control Routes (/api/access/*)](#610-access-control-routes-apiaccess)
   - 6.11 [Project Info Routes (/api/project-info/*)](#611-project-info-routes-apiproject-info)
   - 6.12 [Geocode Routes (/api/geocode)](#612-geocode-routes-apigeocode)
   - 6.13 [Share Routes (/share/*)](#613-share-routes-share)
7. [Controllers & Backend Logic](#7-controllers--backend-logic)
   - 7.1 [accessControl.js](#71-accesscontroljs)
   - 7.2 [passwordHelper.js & tokenHelper.js](#72-passwordhelperjs--tokenhelperjs)
   - 7.3 [logger.js & superLogger.js](#73-loggerjs--superloggerjs)
   - 7.4 [nasSync.js](#74-nassyncjs)
   - 7.5 [Other Controllers](#75-other-controllers)
8. [Frontend Architecture](#8-frontend-architecture)
   - 8.1 [api.js — Auth Interceptor](#81-apijs--auth-interceptor)
   - 8.2 [auth.js — Login / Register / 2FA Flows](#82-authjs--login--register--2fa-flows)
   - 8.3 [module-shared.js — Shared Navigation](#83-module-sharedjs--shared-navigation)
   - 8.4 [Common Frontend Patterns](#84-common-frontend-patterns)
   - 8.5 [Shared CSS Patterns](#85-shared-css-patterns)
9. [Deployment](#9-deployment)
   - 9.1 [Docker Setup](#91-docker-setup)
   - 9.2 [VPS Deployment](#92-vps-deployment)
   - 9.3 [NAS Sync Configuration](#93-nas-sync-configuration)
   - 9.4 [Backup Strategy](#94-backup-strategy)
10. [Glossary](#10-glossary)

---

## 1. Project Overview

### 1.1 What is DocPilot?

DocPilot is a **web application for managing field data in fiber-optic/telecom infrastructure projects**. Think of it as a digital clipboard and filing system for construction crews laying fiber-optic cables.

In traditional fiber-optic projects, field technicians fill in paper forms and spreadsheets as they work — measuring cable lengths, blowing fiber into conduits, testing signal quality, and documenting installation points. DocPilot replaces all of that with a mobile-friendly web app that:

- Stores all project data in structured, searchable tables
- Lets field technicians update data in real time from their phones
- Organizes documents (photos, PDFs, measurement reports) by project, cluster, and address
- Gives project managers and admins a live overview of progress across all sites
- Tracks who changed what, and when (full audit log)
- Syncs everything to a NAS (Network-Attached Storage) device over WebDAV for backup

The application name "DocPilot" reflects its role: it **pilots (manages)** the **documentation** for telecom installation work.

### 1.2 Who is it for?

| Role | What they do in DocPilot |
|------|--------------------------|
| **Field Technician** | Opens an address, fills in measurement data, takes photos, marks work as Done |
| **Project Manager** | Monitors all addresses and their status across a project; views progress |
| **Administrator / Superadmin** | Creates projects, approves users, manages access permissions, views system logs |

### 1.3 Tech Stack

DocPilot is built with entirely standard, beginner-friendly technologies:

| Layer | Technology | What it does |
|-------|-----------|--------------|
| **Backend runtime** | Node.js v22 | Runs the server-side JavaScript code |
| **Backend framework** | Express.js v5 | Handles HTTP routes and middleware |
| **Frontend** | Vanilla HTML/CSS/JavaScript | No React or Vue — plain browser JS |
| **Data storage** | JSON files (`.txt` and `.json`) | Human-readable text files store all data |
| **Chat database** | SQLite (via `better-sqlite3`) | Per-project chat messages |
| **Authentication** | JWT (JSON Web Tokens) + bcrypt | Secure login sessions |
| **File uploads** | `multer` | Handles image/PDF uploads |
| **Excel export** | `xlsx` | Generates spreadsheet exports from data |
| **Email** | `nodemailer` | Sends OTP codes and notifications |
| **NAS sync** | `webdav` npm package | Syncs files to a NAS over WebDAV |
| **Containerization** | Docker | Packages app for easy deployment |
| **CSS framework** | Tailwind CSS (via CDN) | Utility-first CSS classes |

**Key design decision:** There is NO database like PostgreSQL or MongoDB. All project data lives in plain JSON files inside the `storage/` folder. This makes data easy to inspect, back up, and understand — but means the app is designed for dozens to hundreds of users, not thousands.

### 1.4 Architecture Diagram

```
┌────────────────────────────────────────────────────────────────┐
│                        Browser (Client)                        │
│                                                                │
│  HTML Pages (*.html)  + CSS (styles.css)  + JS (src/js/*.js)  │
│                                                                │
│  api.js intercepts every /api/ fetch → adds JWT token          │
└───────────────────────────┬────────────────────────────────────┘
                            │ HTTP requests (JSON + multipart)
                            ▼
┌────────────────────────────────────────────────────────────────┐
│                      Express Server (server.js)                │
│                                                                │
│  Middleware stack:                                             │
│  1. CORS (allow all origins)                                   │
│  2. Static files (serves HTML/CSS/JS)                          │
│  3. superRequestLogger (logs every request)                    │
│  4. JWT authMiddleware (on all /api/* routes)                  │
│  5. Force-termination check                                    │
│                                                                │
│  Routes:                                                       │
│  /api/auth/*         authRoutes.js                             │
│  /api/data/*         dataRoutes.js                             │
│  /api/projects/*     projectRoutes.js                          │
│  /api/modules/*      moduleRoutes.js                           │
│  /api/files/*        fileRoutes.js                             │
│  /api/admin/*        adminRoutes.js                            │
│  /api/profile/*      profileRoutes.js                          │
│  /api/settings/*     settingsRoutes.js                         │
│  /api/chat/*         chatRoutes.js                             │
│  /api/access/*       accessRoutes.js                           │
│  /api/project-info/* projectInfoRoutes.js                      │
│  /api/geocode        geocodeRoutes.js (public, no auth)        │
│  /share/:shareId     fileRoutes.js (public share links)        │
└──────────────┬─────────────────────────────┬───────────────────┘
               │                             │
               ▼                             ▼
┌──────────────────────────┐   ┌─────────────────────────────────┐
│   src/DataFiles/         │   │   storage/ (STORAGE_ROOT)        │
│                          │   │                                  │
│  users.json              │   │  <ProjectName>/                  │
│  projects.json           │   │    Doku/                         │
│  logs.json               │   │      Aufmass/                    │
│  access-control.json     │   │        datafile/                 │
│  project-info.json       │   │          <Project>.txt ◄─── data │
│  sessions-log.json       │   │          <Project>_DATE.txt      │
│  terminated-sessions.json│   │        xlsx/                     │
│  super-log.json          │   │      <Cluster>/                  │
│  .jwt-secret             │   │        APL/                      │
│  schema.json             │   │        OTDR/                     │
│  access-control.json     │   │        Einblasen/                │
└──────────────────────────┘   │    Pläne/                        │
                               │    chat/                         │
                               │      <project>.db (SQLite)       │
                               │      media/                      │
                               │    .trash/                       │
                               │    .filemeta.json                │
                               └────────────────┬────────────────┘
                                                │ WebDAV (optional)
                                                ▼
                                   ┌─────────────────────┐
                                   │   NAS / WebDAV       │
                                   │   (UGREEN or other)  │
                                   │   /Supreme/          │
                                   └─────────────────────┘
```

---

## 2. Getting Started

### 2.1 Prerequisites

Before you can run DocPilot, you need the following installed on your computer:

| Tool | Why you need it | How to install |
|------|----------------|----------------|
| **Node.js v18 or newer** | Runs the server | Download from [nodejs.org](https://nodejs.org) |
| **npm** | Installs JavaScript packages (comes with Node.js) | Installed with Node.js |
| **Git** | Downloads the code | Download from [git-scm.com](https://git-scm.com) |
| **Docker** (optional) | For containerized deployment | Download from [docker.com](https://docker.com) |

**What is Node.js?** Node.js lets you run JavaScript code outside of a browser — on your server or computer. Think of it as the "engine" that powers the DocPilot server.

**What is npm?** npm (Node Package Manager) downloads and manages the extra code libraries (packages) that DocPilot depends on, like Express, bcrypt, etc.

### 2.2 Installation

**Step 1: Get the code**

```bash
# Clone the repository to your computer
git clone https://github.com/rishi-dumps-here/DataManagement.git docpilot

# Enter the project folder
cd docpilot
```

**Step 2: Install dependencies**

```bash
# This reads package.json and downloads all required libraries into node_modules/
npm install
```

**Step 3: Set up environment variables**

```bash
# Copy the example .env file
cp .env.example .env

# Now open .env in a text editor and fill in your values
nano .env    # (or use any text editor)
```

**Step 4: Run the server**

```bash
npm start
# or
node server.js
```

The server will start on port 3000. Open your browser and go to:
```
http://localhost:3000
```

### 2.3 Environment Variables (.env)

The `.env` file is a plain text file that stores **configuration settings** — things like your email credentials, storage location, and NAS connection details. These are kept separate from the code so you can change them without editing the source code, and so you don't accidentally share passwords when sharing code.

**Never commit your `.env` file to Git** — it contains secrets.

Here is every variable from `.env.example` with a full explanation:

---

#### `STORAGE_ROOT`
```
STORAGE_ROOT=./storage
```
- **What it does:** Tells the server where to store all project files (data files, uploaded photos, PDFs, etc.)
- **Default:** `./storage` — a folder called `storage` inside the project directory
- **When to change it:** If you want to store data on an external drive, NAS, or a different path on your server. Example: `STORAGE_ROOT=/mnt/ssd/docpilot-data`
- **Important:** The folder is created automatically if it doesn't exist.

---

#### `SMTP_HOST`
```
SMTP_HOST=w017f912.kasserver.com
```
- **What it does:** The hostname of your email server (for sending OTP verification codes and notifications)
- **Default:** Pre-configured for a KAS server (German hosting)
- **When to change it:** If you use a different email provider (e.g., Gmail SMTP: `smtp.gmail.com`)

---

#### `SMTP_PORT`
```
SMTP_PORT=465
```
- **What it does:** The port number to connect to the SMTP server
- **Default:** `465` (standard for secure SSL email)
- **Common values:** `465` (SSL), `587` (STARTTLS)

---

#### `SMTP_USER`
```
SMTP_USER=m07e22c0
```
- **What it does:** Your SMTP server username (usually your email address or a user ID)
- **Default:** A KAS server user ID
- **When to change it:** Always change this to your own email account username

---

#### `SMTP_PASS`
```
SMTP_PASS=
```
- **What it does:** Your SMTP server password
- **Default:** Empty — **you must fill this in**
- **Security note:** Keep this secret. Never share this file or commit it to Git.

---

#### `SMTP_FROM`
```
SMTP_FROM=noreply@geggos.com
```
- **What it does:** The "From" address that recipients see when they receive emails from DocPilot
- **Default:** `noreply@geggos.com`
- **When to change it:** Change to your own domain email address

---

#### `NAS_SYNC_ENABLED`
```
NAS_SYNC_ENABLED=false
```
- **What it does:** Turns on/off the automatic file sync to your NAS device
- **Default:** `false` (sync is disabled)
- **When to change it:** Set to `true` if you have a NAS device and want automatic backup. All other `NAS_*` variables must also be configured.

---

#### `NAS_WEBDAV_URL`
```
NAS_WEBDAV_URL=
```
- **What it does:** The WebDAV URL of your NAS device
- **Default:** Empty
- **Example value:** `http://192.168.1.100:5005` or `http://100.x.x.x:5005`
- **What is WebDAV?** WebDAV (Web Distributed Authoring and Versioning) is a protocol that lets you access files on a server over HTTP. Most NAS devices support it.

---

#### `NAS_USERNAME`
```
NAS_USERNAME=
```
- **What it does:** Username to authenticate with the WebDAV server on your NAS
- **Default:** Empty

---

#### `NAS_PASSWORD`
```
NAS_PASSWORD=
```
- **What it does:** Password for the WebDAV server on your NAS
- **Default:** Empty

---

#### `NAS_SYNC_INTERVAL`
```
NAS_SYNC_INTERVAL=300000
```
- **What it does:** How often (in milliseconds) to sync files to the NAS
- **Default:** `300000` = 300 seconds = 5 minutes
- **Example:** For every 10 minutes, use `600000`

---

#### `NAS_REMOTE_BASE`
```
NAS_REMOTE_BASE=/Supreme
```
- **What it does:** The base folder path on your NAS where files will be stored
- **Default:** `/Supreme`
- **Example:** Files will be synced to `NAS_WEBDAV_URL/Supreme/ProjectName/...`

---

#### `JWT_SECRET` (not in .env.example, but important)
- **What it does:** A secret key used to sign and verify JWT login tokens
- **Default:** Auto-generated on first boot and saved to `src/DataFiles/.jwt-secret`
- **When to set manually:** In production/Docker, set this as an environment variable for consistency across restarts:
  ```
  JWT_SECRET=some-long-random-string-at-least-32-chars
  ```

---

### 2.4 Running Locally

```bash
# Start the server
npm start

# The output will look like:
# [storage] STORAGE_ROOT: /path/to/docpilot/storage
# [nas-sync] NAS_SYNC_ENABLED not set — sync disabled.
# --- Server running at http://localhost:3000 ---
```

Open `http://localhost:3000` in your browser.

**On first run, the server automatically:**
1. Creates the `storage/` directory
2. Creates missing JSON data files (`users.json`, `projects.json`, etc.) with empty defaults
3. Migrates any legacy data files from `src/DataFiles/` to the new `storage/` structure

**The first superadmin user:** You must manually add a superadmin to `src/DataFiles/users.json`. Example:

```json
[
  {
    "id": "1",
    "name": "Admin Name",
    "username": "admin",
    "email": "admin@yourcompany.com",
    "password": "yourpassword",
    "role": "superadmin",
    "isVerified": true,
    "isApproved": true
  }
]
```

> ⚠️ **Security:** Plain-text passwords in `users.json` are automatically upgraded to bcrypt hashes on first login. In production, always set a strong password.

To stop the server: press `Ctrl+C` in the terminal.

### 2.5 Docker Deployment

Docker packages the application and all its dependencies into a container that runs the same way on any server.

**What is Docker?** Think of it like a shipping container — your app is packed inside with everything it needs, and it runs identically on any machine that has Docker installed.

**Step 1: Create your `.env` file**

```bash
cp .env.example .env
# Edit .env with your real values
```

**Step 2: Build and start the container**

```bash
# Start in the background (-d = detached/background mode)
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

**What `docker-compose.yml` does:**

```yaml
services:
  docpilot:
    build: .                    # Build from the Dockerfile in this directory
    container_name: docpilot
    restart: unless-stopped     # Auto-restart if it crashes
    ports:
      - "3000:3000"             # Map port 3000 on your server to port 3000 in container
    env_file:
      - .env                    # Load environment variables from .env
    volumes:
      - geggos-storage:/data/storage        # Persistent storage for project files
      - geggos-appdata:/app/src/DataFiles   # Persistent storage for user/config data
    labels:
      # Traefik reverse proxy labels for HTTPS (optional — for production with domain)
      - "traefik.enable=true"
      - "traefik.http.routers.docpilot.rule=Host(`geggos.ai`)"
      ...
```

**Docker volumes** are where data is stored persistently. Even if you rebuild or restart the container, data in volumes survives. The two important volumes are:
- `geggos-storage` → project files (photos, PDFs, data files)
- `geggos-appdata` → users, logs, access control

**Traefik labels** (optional): If you run Traefik as a reverse proxy, these labels automatically set up HTTPS for your domain. Remove them if you're not using Traefik.

### 2.6 Directory Structure

```
docpilot/
│
├── server.js                  ← 🚀 Main entry point. Starts Express, loads routes.
├── package.json               ← Project metadata & list of npm dependencies.
├── package-lock.json          ← Exact versions of all installed packages (auto-generated).
├── .env.example               ← Template for environment variables.
├── .env                       ← Your actual config (never commit to Git!).
├── Dockerfile                 ← Instructions for building the Docker container.
├── docker-compose.yml         ← Docker Compose config (runs container + volumes).
├── DOCUMENTATION.md           ← This file.
│
├── routes/                    ← 🛣️ Express route handlers (one file per feature area)
│   ├── authRoutes.js          ← Login, register, OTP verify, 2FA, refresh, logout
│   ├── dataRoutes.js          ← Read/write project data (Aufmass table)
│   ├── projectRoutes.js       ← Create/list/reorder/delete projects
│   ├── moduleRoutes.js        ← Module navigation, file uploads, aufmass updates
│   ├── fileRoutes.js          ← File browser, upload, rename, delete, share links
│   ├── adminRoutes.js         ← User management, access control, logs (superadmin)
│   ├── profileRoutes.js       ← User profile read/write/avatar
│   ├── settingsRoutes.js      ← Generator settings
│   ├── chatRoutes.js          ← Project chat (per-project SQLite)
│   ├── accessRoutes.js        ← ACL permission queries (for frontend)
│   ├── projectInfoRoutes.js   ← Project description and metadata
│   └── geocodeRoutes.js       ← Nominatim reverse-geocode proxy (public)
│
├── controllers/               ← 🧠 Shared business logic used by routes
│   ├── accessControl.js       ← ACL engine: reads/writes access-control.json
│   ├── passwordHelper.js      ← bcrypt password hashing and verification
│   ├── tokenHelper.js         ← JWT token creation, verification, middleware
│   ├── rateLimiter.js         ← In-memory login rate limiter (anti-brute-force)
│   ├── logger.js              ← Simple action log (logs.json)
│   ├── superLogger.js         ← Advanced system event logger (ring buffer + disk)
│   ├── sessionLogger.js       ← Login/logout event tracker
│   ├── nasSync.js             ← NAS background sync engine (WebDAV)
│   ├── nasOnDemand.js         ← Fetch files from NAS on demand when locally missing
│   ├── storageConfig.js       ← Path helpers (STORAGE_ROOT, project paths)
│   ├── dataVersioning.js      ← Save timestamped .txt + Excel copies on each save
│   ├── folderSync.js          ← Sync cluster/knotenpunkt folder structure to disk
│   ├── trashHelper.js         ← Move files to .trash/ instead of permanent delete
│   ├── fileMeta.js            ← Per-project file metadata (.filemeta.json)
│   ├── chatDb.js              ← SQLite chat database manager
│   └── projectCreator.js      ← Create project folder structure + data file
│
├── src/
│   ├── DataFiles/             ← 🗄️ Application-level JSON data (NOT project data)
│   │   ├── users.json         ← All registered users
│   │   ├── projects.json      ← Project list with status and metadata
│   │   ├── access-control.json← ACL rules (who can access what)
│   │   ├── logs.json          ← Action log (last 1000 entries)
│   │   ├── super-log.json     ← System event log (last 5000 entries)
│   │   ├── sessions-log.json  ← Login/logout history
│   │   ├── terminated-sessions.json ← Force-terminated user sessions
│   │   ├── project-info.json  ← Project descriptions and info
│   │   ├── schema.json        ← Default column schema template
│   │   └── .jwt-secret        ← Auto-generated JWT signing key (keep secret!)
│   │
│   ├── js/                    ← 🖥️ Frontend JavaScript files
│   │   ├── api.js             ← Global fetch interceptor (adds JWT to every request)
│   │   ├── auth.js            ← Login and register form logic
│   │   ├── dashboard.js       ← Dashboard page logic
│   │   ├── table.js           ← Aufmass data table logic
│   │   ├── module-shared.js   ← Shared navigation class for all module pages
│   │   ├── apl.js             ← APL module logic
│   │   ├── einblasen.js       ← Einblasen module logic
│   │   ├── druckprufung.js    ← Druckprüfung module logic
│   │   ├── kalibrieren.js     ← Kalibrieren module logic
│   │   ├── otdr.js            ← OTDR module logic
│   │   ├── knotenpunkt-vorbereitung.js ← Knotenpunkt module logic
│   │   ├── planner.js         ← Planner page logic
│   │   ├── new-project.js     ← New project form logic
│   │   ├── appointment-shared.js ← Shared appointment scheduling helper
│   │   ├── geocam.js          ← GPS-stamped camera overlay
│   │   ├── header-avatar.js   ← Shows user avatar in page headers
│   │   ├── idle-logout.js     ← Auto-logout on idle
│   │   ├── force-logout.js    ← Detects force-termination and redirects to login
│   │   ├── logout.js          ← Logout button handler
│   │   ├── modal.js           ← Reusable modal dialogs (alert, confirm, prompt)
│   │   └── i18n.js            ← Internationalization (translation) helpers
│   │
│   └── css/
│       └── styles.css         ← All CSS styles for the entire app
│
├── storage/                   ← 📦 Project data and files (created at runtime)
│   └── <ProjectName>/         ← One folder per project
│       ├── Doku/
│       │   ├── Aufmass/
│       │   │   ├── datafile/
│       │   │   │   ├── <ProjectName>.txt       ← Main data file (V2 JSON format)
│       │   │   │   └── <ProjectName>_DATE.txt  ← Versioned copies (auto-created)
│       │   │   └── xlsx/
│       │   │       └── <ProjectName>_DATE.xlsx ← Excel exports (auto-created)
│       │   └── <ClusterName>/
│       │       ├── APL/
│       │       │   └── <Knotenpunkt>/
│       │       │       └── <Address>/         ← APL photos go here
│       │       ├── OTDR/
│       │       │   └── <Knotenpunkt>/         ← OTDR report files go here
│       │       ├── Einblasen/
│       │       ├── Druckprufung/
│       │       └── Kalibrieren/
│       ├── Pläne/                             ← Project plan files
│       ├── chat/
│       │   ├── <project>.db                   ← SQLite chat database
│       │   └── media/                         ← Chat image uploads
│       ├── .trash/                            ← Deleted files (recoverable)
│       └── .filemeta.json                     ← File metadata (descriptions, etc.)
│
└── node_modules/              ← npm packages (auto-generated, don't edit manually)
```

---

## 3. Authentication & Authorization

### 3.1 Registration Flow (OTP-based)

**What is OTP?** OTP stands for One-Time Password. It's a temporary code (usually 6 digits) that is sent to your email to prove you own the email address.

Here's the complete registration process step by step:

```
User fills in form → Server validates → Server generates 6-digit OTP
→ OTP stored IN MEMORY (not saved to disk yet)
→ OTP emailed to user
→ OTP also printed to server console (for local testing without email)
→ User enters OTP → Server verifies → User saved to users.json
→ Admin notified by email
→ User must WAIT for admin approval before logging in
```

**Detailed steps:**

1. **User submits registration form** (`/api/register`) with: `name`, `username`, `email`, `password`
2. **Server checks** that email/username aren't already taken (in `users.json` or in pending registrations)
3. **Password is hashed** immediately using bcrypt with 12 salt rounds (see [3.3](#33-jwt-tokens))
4. **A 6-digit OTP** is generated: `Math.floor(100000 + Math.random() * 900000)`
5. **Registration is stored in memory** (a `Map` called `pendingRegistrations`) — nothing is written to disk yet. Expires after 15 minutes.
6. **OTP is emailed** to the user via SMTP
7. **User enters OTP** (`/api/verify-otp`) — server compares with in-memory entry
8. **If OTP matches:** User object is written to `users.json` with `isVerified: true, isApproved: false`
9. **All superadmin users are emailed** a notification about the new pending user
10. **User sees:** "Email verified! Waiting for admin approval."
11. **Admin goes to admin panel** → approves or rejects the user
12. **On approval:** `isApproved: true` is set in `users.json`

**Why not save to disk until OTP is verified?** This prevents the database from filling up with unverified spam registrations.

### 3.2 Login Flow

```
User enters username/email + password
→ Rate limiter check (5 attempts max per 15 min)
→ Look up user in users.json
→ Verify password (bcrypt or legacy plaintext)
→ Check isVerified and isApproved
→ Superadmin? → Send 2FA OTP email → Verify 2FA → Issue JWT
→ Regular user? → Issue JWT immediately
→ JWT stored in localStorage on client
→ Redirect to dashboard (index.html)
```

**Login endpoint:** `POST /api/login`
- `identifier`: email address or username
- `password`: the user's password

**On success, the server returns:**
```json
{
  "success": true,
  "token": "<JWT string>",
  "role": "user",
  "name": "John Doe",
  "email": "john@example.com"
}
```

For superadmin login, see [3.4 Two-Factor Verification](#34-2-step-verification-2fa).

### 3.3 JWT Tokens

**What is a JWT?** JWT stands for JSON Web Token. It's a compact, digitally-signed string that proves who you are without the server needing to look up your session in a database.

A JWT looks like this: `xxxxx.yyyyy.zzzzz` (three Base64-encoded parts separated by dots)
- Part 1: **Header** — algorithm used (`HS256`)
- Part 2: **Payload** — your data: `{ "email": "...", "role": "user", "name": "..." }`
- Part 3: **Signature** — cryptographic proof that the server created this token

**How DocPilot uses JWTs:**

1. **On login:** Server creates a JWT signed with the secret key (`JWT_SECRET`)
2. **Client stores it:** `localStorage.setItem('authToken', token)` in the browser
3. **Every API request:** `api.js` automatically adds it to the `Authorization: Bearer <token>` header
4. **Server verifies:** `authMiddleware` in `tokenHelper.js` checks the signature. If valid, sets `req.user = { email, role, name }`

**Token expiry:**
- Regular users: **8 hours**
- Superadmin: **2 hours** (more secure — shorter session)

**Auto-refresh:** When a token has less than 30 minutes left, `api.js` automatically calls `POST /api/auth/refresh` to get a new token — silently, without any user action.

**JWT Secret:** The signing key is loaded from:
1. `JWT_SECRET` environment variable (recommended for production)
2. `src/DataFiles/.jwt-secret` file (auto-generated on first boot)
3. Auto-generated in memory (lost on restart — avoid this)

### 3.4 2-Step Verification (2FA)

**Who gets 2FA?** Only **superadmin** users are required to complete 2FA on login.

**How it works:**

1. Superadmin logs in with correct username/password
2. Server sends a 6-digit OTP to the superadmin's email
3. Server returns `{ success: true, requires2FA: true, email: "..." }` (no JWT yet)
4. Browser shows a 2FA input screen
5. Superadmin enters the 6-digit code
6. `POST /api/verify-2fa` → server validates the OTP (stored in `pending2FA` Map, expires after 5 minutes)
7. On success: JWT is issued and login is complete

**Why only superadmins?** Superadmins have elevated powers (approve users, manage all data), so extra security is justified. Regular field technicians shouldn't have friction in their workflow.

### 3.5 Roles

DocPilot has two primary roles defined in the code:

| Role | Access Level | Description |
|------|-------------|-------------|
| `superadmin` | Full access to everything | System administrator. Can approve users, manage ACL, view all logs, access all projects. **2FA required at login.** |
| `user` | Restricted by ACL | Regular user. Access is controlled entirely by the ACL (see [3.6](#36-access-control-acl)). |

> **Note:** The `users.json` may also contain an `administrator` role (visible in the example data), but the primary code distinction is `superadmin` vs everything else. Superadmin checks use `role === 'superadmin'`. ACL applies to all non-superadmin users.

**How roles are set:**
- All registrations are forced to `user` role (server-side, client cannot override)
- `superadmin` must be set manually in `users.json` by a developer/admin

### 3.6 Access Control (ACL)

The ACL (Access Control List) is a fine-grained permission system stored in `src/DataFiles/access-control.json`.

**Permission hierarchy (highest to lowest):**

1. `superadmin` role → **Always full access. ACL is NEVER checked.**
2. `fullAccess: true` in ACL entry → Same as superadmin for ACL purposes
3. Per-user ACL entry with specific permissions

**ACL data structure:**

```json
{
  "user@example.com": {
    "fullAccess": false,
    "authority": {
      "createProject": false,
      "deleteProject": false,
      "changeStatus": false,
      "reorderProjects": false,
      "downloadZip": false,
      "editProjectInfo": false
    },
    "projects": {
      "ProjectName": {
        "access": true,
        "canEdit": false,
        "modules": {
          "aufmass": true,
          "files": true,
          "druckprufung": false,
          "kalibrieren": false,
          "einblasen": true,
          "apl": true,
          "knotenpunkt": false,
          "otdr": false,
          "chat": true,
          "planner": false
        }
      }
    }
  }
}
```

**Permission flags explained:**

| Flag | Location | What it controls |
|------|----------|-----------------|
| `fullAccess` | Top-level | If `true`, all checks pass — user can do everything |
| `authority.createProject` | Top-level | Can the user create new projects? |
| `authority.deleteProject` | Top-level | Can the user delete projects? |
| `authority.changeStatus` | Top-level | Can the user change project status (Active/Paused/Done)? |
| `authority.reorderProjects` | Top-level | Can the user drag-and-drop reorder projects in dashboard? |
| `authority.downloadZip` | Top-level | Can the user download a project as a ZIP archive? |
| `authority.editProjectInfo` | Top-level | Can the user edit project info/description? |
| `projects[name].access` | Per-project | Can the user see this project at all? |
| `projects[name].canEdit` | Per-project | Can the user edit data in this project (write permission)? |
| `projects[name].modules.aufmass` | Per-module | Can the user access the Aufmass data table? |
| `projects[name].modules.files` | Per-module | Can the user access the Files page? |
| `projects[name].modules.druckprufung` | Per-module | Can the user access Druckprüfung? |
| `projects[name].modules.kalibrieren` | Per-module | Can the user access Kalibrieren? |
| `projects[name].modules.einblasen` | Per-module | Can the user access Einblasen? |
| `projects[name].modules.apl` | Per-module | Can the user access APL? |
| `projects[name].modules.knotenpunkt` | Per-module | Can the user access Knotenpunkt/NVT/Splicing? |
| `projects[name].modules.otdr` | Per-module | Can the user access OTDR? |
| `projects[name].modules.chat` | Per-module | Can the user access the project chat? |
| `projects[name].modules.planner` | Per-module | Can the user access the Planner? |

**Default when no ACL entry exists:** NO access to anything (zero access by default).

**Default when project has no module-specific entry:** If a user has `access: true` for a project but no `modules` object, they get access to all modules (default-allow within an accessible project).

### 3.7 Rate Limiting & Security

**Login rate limiting** (`controllers/rateLimiter.js`):
- Maximum **5 failed login attempts** per IP + username combination within a 15-minute window
- After 5 failures: **15-minute lockout** — further attempts return `429 Too Many Requests`
- Successful login clears the attempt counter

**Password security** (`controllers/passwordHelper.js`):
- Passwords are hashed with **bcrypt** (12 salt rounds)
- bcrypt is a deliberately slow hash algorithm designed for passwords — it makes brute-force attacks impractical
- Legacy plain-text passwords are automatically upgraded to bcrypt on first login

**Force termination** (`controllers/sessionLogger.js`):
- Admins can force-terminate a user's session from the admin panel
- Terminated users get `401 forceLogout: true` on their next API call
- The browser detects this and redirects to login
- Clearing termination happens automatically on the user's next successful login

**Idle logout** (`src/js/idle-logout.js`):
- Users are automatically logged out after a period of inactivity
- This prevents unauthorized access if someone leaves their browser unattended

**Session hijacking protection:**
- JWTs cannot be spoofed without the secret key
- Superadmin role cannot be claimed without a valid JWT (the auth middleware blocks it)
- Force-logout detects terminated sessions even if the JWT is still valid

---

## 4. Data Architecture

### 4.1 Project Structure on Disk

All project data lives under `STORAGE_ROOT` (default: `storage/` in the project root).

```
storage/
└── Laich-Suppingen/                    ← Project name (exact string from projects.json)
    ├── Doku/
    │   ├── Aufmass/
    │   │   ├── datafile/
    │   │   │   ├── Laich-Suppingen.txt            ← Main data file (always present)
    │   │   │   ├── Laich-Suppingen_20260505_143022.txt  ← Auto-versioned copies
    │   │   │   └── Laich-Suppingen_20260506_091512.txt
    │   │   └── xlsx/
    │   │       ├── Laich-Suppingen_20260505_143022.xlsx ← Excel exports
    │   │       └── Laich-Suppingen_20260506_091512.xlsx
    │   └── Cluster-A/                  ← Cluster name from data
    │       ├── APL/
    │       │   └── NVT-001/            ← Knotenpunkt (NVT) name
    │       │       └── Hauptstr-15/    ← Address (cleaned, dashes instead of spaces)
    │       │           ├── NVT-001_Hauptstr-15_APL_Box_20260505_143022.jpg
    │       │           ├── NVT-001_Hauptstr-15_Metrierung_20260505_143022.jpg
    │       │           └── ...
    │       ├── OTDR/
    │       │   └── NVT-001/
    │       │       └── report.pdf
    │       ├── Einblasen/
    │       ├── Druckprufung/
    │       └── Kalibrieren/
    ├── Pläne/                          ← Plan/map files for the project
    ├── chat/
    │   ├── Laich-Suppingen.db          ← SQLite database with chat messages
    │   └── media/                      ← Images sent in chat
    ├── .trash/                         ← Deleted files (recoverable)
    │   └── 2026-05-05_143022_deleted_file.pdf
    └── .filemeta.json                  ← File descriptions and metadata
```

**How the folder structure is kept in sync:**

Every time the Aufmass data is saved, the server reads the "Cluster" and "Knotenpunkt" columns from the data and calls `performFolderSync()`. This function:
1. Gets all unique cluster/knotenpunkt combinations from the data
2. Creates missing folders on disk for those combinations
3. Moves folders for clusters/knotenpunkte that no longer exist to `.trash/`

This means the folder structure **always mirrors the data** — if you add a new cluster "Cluster-B" to the Aufmass table, the folder `storage/ProjectName/Doku/Cluster-B/APL/NVT.../` is created automatically.

### 4.2 Data File Format (V2)

The core data file for each project is stored as a `.txt` file containing JSON. The file format is called **V2** and has this structure:

```
[E1, E2]
```

Where:
- **E1** = Array of column group names (the main headers)
- **E2** = Array where the first element is column definitions, and subsequent elements are data rows

#### E1 — Column Group Names

E1 is a simple array of strings, one per column group:

```json
["Timing", "Location", "Address", "Hardware", "Splicing", "Einblasen", "OTDR", "Notes"]
```

Each entry corresponds to a colored header that spans multiple columns in the Aufmass table.

#### E2 — Data (Column Definitions + Rows)

E2 is an array. The structure is:

```
E2 = [E2_0, row1, row2, row3, ...]
```

**E2[0] (called E2_0)** — Column sub-definitions:
An array of arrays, parallel to E1. Each element is an array of sub-column labels for that group:

```json
[
  ["Date"],                                  ← Timing group: 1 column
  ["Cluster", "Knotenpunkt"],                ← Location group: 2 columns
  ["Address Start", "Address End"],          ← Address group: 2 columns
  ["Cable Name", "Fiber Type", "Tube"],      ← Hardware group: 3 columns
  ["APL Status", "Number of Splices", ...],  ← Splicing group: many columns
  ["Einblasen Date", "Metrierung"],          ← Einblasen group: 2 columns
  ["OTDR Status", "OTDR Date"],              ← OTDR group: 2 columns
  ["Notes", "Error-Reporting"]               ← Notes group: 2 columns
]
```

**E2[1], E2[2], ... (data rows):**
Each row is an array of arrays, parallel to E1/E2_0:

```json
[
  ["2026-05-05"],                            ← Timing group values
  ["Cluster-A", "NVT-001"],                  ← Location group values
  ["Hauptstr 13", "Hauptstr 15"],             ← Address group values
  ["Kabel-24F", "G652D", "Blau"],            ← Hardware group values
  ["Done", "72", "..."],                     ← Splicing group values
  ["2026-05-01", "480m"],                    ← Einblasen group values
  ["Waiting", ""],                           ← OTDR group values
  ["", ""]                                   ← Notes group values
]
```

**The first element of every row (`row[0][0]`)** is used as the unique row ID. This is typically the same value as what's in the first column of the first group. If missing, the server uses `ROW-{index}` as a fallback.

#### Complete V2 Example

```json
[
  ["Timing", "Location", "Address", "Hardware"],
  [
    [["Date"], ["Cluster", "Knotenpunkt"], ["Addr Start", "Addr End"], ["Cable"]],
    [["2026-05-05"], ["Cluster-A", "NVT-001"], ["Hauptstr 13", "Hauptstr 15"], ["Kabel-24F"]],
    [["2026-05-06"], ["Cluster-A", "NVT-001"], ["Bahnhofstr 1", "Bahnhofstr 3"], ["Kabel-12F"]]
  ]
]
```

**Why `.txt` extension instead of `.json`?**
The `.txt` extension is intentional — it makes it easy to inspect in any text editor or file manager, and avoids confusion with the JSON config files in `src/DataFiles/`.

**File versioning:**
Every time data is saved, two things happen:
1. The main `<ProjectName>.txt` is overwritten with new data
2. A timestamped copy `<ProjectName>_YYYYMMDD_HHMMSS.txt` is saved alongside it
3. An Excel file `<ProjectName>_YYYYMMDD_HHMMSS.xlsx` is also created in the `xlsx/` folder

The server always **reads the newest versioned file** (the one with the most recent timestamp). This means data changes are non-destructive — you can always roll back by deleting the latest versioned file.

### 4.3 Users Data (users.json)

Stored at `src/DataFiles/users.json`. This file is an array of user objects:

```json
[
  {
    "id": "1774465012036",          ← Unique ID (Unix timestamp string)
    "name": "John Doe",             ← Display name
    "username": "johndoe",          ← Login username (unique)
    "email": "john@example.com",    ← Email address (unique, used for auth and notifications)
    "password": "$2b$12$...",       ← bcrypt hash (or plain text for legacy users)
    "role": "user",                 ← "user" or "superadmin"
    "isVerified": true,             ← Did they verify their email with OTP?
    "isApproved": true,             ← Did a superadmin approve their account?
    "otp": null,                    ← OTP for email verification (cleared after use)
    "createdAt": "2026-01-01T00:00:00.000Z"
  }
]
```

**Important:** This file is read from and written to disk on every auth operation. There is no database — it's a plain JSON file.

**Adding a superadmin manually:** Edit this file with a text editor and add:
```json
{
  "id": "1",
  "name": "Your Name",
  "username": "admin",
  "email": "admin@yourcompany.com",
  "password": "TemporaryPassword123!",
  "role": "superadmin",
  "isVerified": true,
  "isApproved": true,
  "otp": null
}
```
The plain-text password will be automatically upgraded to bcrypt on first login.

### 4.4 Settings Data

**`src/DataFiles/projects.json`** — The list of all projects:
```json
[
  {
    "id": "1774453517733",
    "name": "Laich-Suppingen",
    "locations": ["Location A", "SUPPN"],
    "status": "Active",
    "progress": 0,
    "createdAt": "2026-03-25T15:45:17.733Z"
  }
]
```
- `status`: `"Active"`, `"Paused"`, or `"Done"`
- `progress`: percentage (0-100), manually or calculated
- `locations`: sub-location labels within the project

**`src/DataFiles/access-control.json`** — ACL rules (see [3.6](#36-access-control-acl))

**`src/DataFiles/project-info.json`** — Rich project descriptions:
```json
{
  "ProjectName": {
    "description": "Markdown-formatted project description...",
    "updatedAt": "2026-01-01T00:00:00.000Z",
    "updatedBy": "admin@example.com"
  }
}
```

**`src/DataFiles/logs.json`** — Last 1000 action log entries

**`src/DataFiles/super-log.json`** — Last 5000 system event log entries (HTTP requests, auth events, sync events)

**`src/DataFiles/sessions-log.json`** — Login/logout history (last 10,000 entries)

**`src/DataFiles/schema.json`** — Default column schema template for new projects (defines column groups and column definitions with format codes)

### 4.5 NAS Sync

The NAS sync engine runs in the background and syncs all files in `storage/` to a WebDAV server (your NAS) automatically.

**How it works:**

1. A **sync manifest** (`storage/.sync-manifest.json`) tracks which files have been synced and their last modification time
2. Every `NAS_SYNC_INTERVAL` milliseconds, `fullSync()` walks all files in `storage/`
3. Files that have changed (different mtime than in manifest) are uploaded to the NAS
4. After 48 hours, successfully synced files are **deleted locally** to save VPS disk space. They remain on the NAS.
5. When a request needs a cleaned file (e.g., for ZIP download), it's fetched back from the NAS on-demand

**Operation queue:** Rename, move, copy, and delete operations are queued in `storage/.sync-operations.json` and replicated to the NAS on the next sync cycle.

**Protected files that are NEVER deleted locally:**
- The main `<ProjectName>.txt` data file
- The latest versioned copy per project
- All `.json` config files in `src/DataFiles/`
- SQLite `.db` files (chat databases — can't be synced/deleted while in use)

**Sync status:** Visible in the admin panel (`admin.html`) under "NAS Sync Status".

---

## 5. Pages & Modules

### 5.1 Login (login.html / index.html)

**URL:** `/login.html` (redirect target from `index.html` if not logged in)
**File:** `login.html`, `src/js/auth.js`

**What the user sees:** A clean login form with:
- A username or email input field
- A password input field
- A "Sign In" button

**What happens:**
1. Form submits to `POST /api/login`
2. If successful: JWT stored in `localStorage`, redirect to `index.html` (dashboard)
3. If 2FA required (superadmin): Form dynamically transforms into a 6-digit OTP input
4. If failed: Error message shown inline

**Key API calls:**
- `POST /api/login` — submit credentials
- `POST /api/verify-2fa` — submit 2FA code (superadmin only)

---

**`index.html`** is the **app hub/entry point**. When loaded:
- If user is NOT logged in → redirect to `login.html`
- If user IS logged in → redirect to `dashboard.html`

It acts as a routing gate, not a page itself.

### 5.2 Register (register.html)

**URL:** `/register.html`
**File:** `register.html`, `src/js/auth.js`

**What the user sees:**
1. **Registration form:** Name, username, email, password fields
2. **After submitting:** Form is replaced by a 6-digit OTP input
3. **After OTP verification:** Message "Waiting for admin approval" and redirect to login

**Key API calls:**
- `POST /api/register` — submit registration data
- `POST /api/verify-otp` — submit OTP code

### 5.3 Dashboard (dashboard.html)

**URL:** `/dashboard.html`
**File:** `dashboard.html`, `src/js/dashboard.js`

**What the user sees:** A list of all projects the user has access to. Each project card shows:
- Project name
- Status badge (Active / Paused / Done)
- Progress bar
- Location tags
- Buttons to open the project hub or manage it

**Key features:**
- Drag-and-drop reordering (if user has `reorderProjects` permission)
- Status change (Active/Paused/Done) via dropdown
- Project delete button (if `deleteProject` permission)
- ZIP download button (if `downloadZip` permission)
- "New Project" button (if `createProject` permission)
- Chat bubble badge showing unread messages

**Data flow:**
1. Page loads → `GET /api/projects/` → renders project cards
2. User clicks project → navigates to `dashboard.html?project=ProjectName`
3. Inside a project: shows module buttons (Aufmass, APL, Files, etc.) based on ACL
4. Module buttons navigate to respective pages: `aufmass.html?project=...`

**Key API calls:**
- `GET /api/projects/` — list all accessible projects
- `POST /api/projects/status` — change project status
- `POST /api/projects/reorder` — reorder projects
- `POST /api/projects/remove` — delete a project
- `GET /api/projects/zip/:projectName` — download project as ZIP

### 5.4 Aufmass (aufmass.html)

**URL:** `/aufmass.html?project=<ProjectName>`
**File:** `aufmass.html`, `src/js/table.js`

**What it is:** The main data entry table for a project. This is the heart of DocPilot — a spreadsheet-like view where every row represents a cable segment or address, and columns represent various data fields.

**What the user sees:** A large, scrollable table with:
- Column group headers (colored, spanning multiple sub-columns)
- Sub-column headers (field names like "Date", "Cluster", "Address End", etc.)
- Editable rows where each cell can be typed into
- Status badges in status columns (Done/Pending/Error, color-coded)
- Add row / delete row buttons
- Save button
- Export to Excel button

**Key features:**
- **Editable cells:** Click any cell to edit it inline
- **Column types:** Text fields, date pickers, dropdown selects, checkboxes
- **Optimistic locking:** Each row has a `_version` counter. If two users edit the same row simultaneously, the one who saves second is warned of a conflict.
- **Auto-save version:** Every save creates a timestamped backup automatically
- **OTDR auto-trigger:** If APL Status and Knotenpunkt Status are both "Done" in a row, OTDR Status is automatically set to "Waiting"
- **Read-only mode:** Users with `canEdit: false` can see data but cannot save changes

**Data flow:**
1. Page loads → `GET /api/data/?project=<name>` → renders table
2. User edits cells → clicks Save → `POST /api/data/?project=<name>` with schema + data
3. Server validates ACL, writes data file, saves versioned copy, syncs to NAS

**Key API calls:**
- `GET /api/data/?project=<name>` — read all data and schema
- `POST /api/data/?project=<name>` — save all data

### 5.5 Einblasen (einblasen.html)

**URL:** `/einblasen.html?project=<ProjectName>`
**File:** `einblasen.html`, `src/js/einblasen.js`, `src/js/module-shared.js`

**What it is:** The "cable blowing" module. "Einblasen" means "blowing in" — the process of blowing fiber-optic cables into conduits using compressed air.

**What the user sees:**
- A hierarchical navigation: Choose Cluster → Choose Knotenpunkt → Choose Address
- For each address: Shows current status, a form to upload a PDF measurement report
- Status badges: Pending / Done / Error

**Key features:**
- Upload a PDF report for each address's einblasen work
- Record the date of completion
- Mark as Done → updates "Einblasen Status" column in Aufmass data
- Error reporting: document problems at an address
- "Backfill dates" function: can retroactively fill einblasen dates from file metadata

**Data flow:**
1. Page loads → `GET /api/modules/navigation?project=<name>` → gets cluster/knotenpunkt/address hierarchy
2. User selects address → views status from Aufmass data
3. User uploads PDF → `POST /api/modules/upload`
4. User marks Done → `POST /api/modules/aufmass-update` updates the row

**Key API calls:**
- `GET /api/modules/navigation?project=<name>` — get navigation tree
- `POST /api/modules/upload` — upload PDF
- `POST /api/modules/aufmass-update` — update row status
- `GET /api/modules/list-files?project=<name>&path=<path>` — list uploaded files

### 5.6 APL (apl.html)

**URL:** `/apl.html?project=<ProjectName>`
**File:** `apl.html`, `src/js/apl.js`, `src/js/module-shared.js`

**What it is:** The APL (Abschlusspunkt Linie = Line Termination Point) module. This handles the final connection point where fiber enters a building or property.

**What the user sees:**
- Cluster → Knotenpunkt → Address navigation
- For each address: Customer/owner details (name, phone, email — clickable for calls/emails)
- Status badge: Pending / Waiting (cable blown, waiting for APL) / Done / Error
- Appointment scheduling (set/edit appointment date+time for the visit)
- 4 required photo zones + optional extra photos:
  - Metrierung (measurement) photo
  - APL Box photo
  - Splices photo
  - Inside APL photo
- Splice count input (auto-filled from Aufmass or manual entry)
- Date/time of work completion

**Key features:**
- **GeoCam integration:** If `geocam.js` is loaded, photos can be taken with GPS coordinates embedded
- **_U suffix:** Photos uploaded from device (not taken with camera) get a `_U` suffix in filename to distinguish source
- **Appointment scheduling:** Schedule visits with date/time, saved back to Aufmass row
- **Error reporting:** Report issues at an address with text description
- **Error resolution:** Fix, reopen, edit, or delete errors with a selection modal
- **File list:** View existing uploaded files for the current address

**File naming:** `{Knotenpunkt}_{Address}_{ImageType}_{Timestamp}[_U].{ext}`
Example: `NVT-001_Hauptstr-15_APL_Box_20260505_143022.jpg`

**Key API calls:**
- `GET /api/modules/navigation` — navigation tree
- `POST /api/modules/upload` — upload images
- `POST /api/modules/aufmass-update` — update status, splice count, folder path

### 5.7 Druckprüfung (druckprufung.html)

**URL:** `/druckprufung.html?project=<ProjectName>`
**File:** `druckprufung.html`, `src/js/druckprufung.js`, `src/js/module-shared.js`

**What it is:** "Druckprüfung" = pressure test. This module documents the pressure testing of conduit (Leerrohr) before fiber is blown in, verifying the pipe is sealed and intact.

**What the user sees:**
- Standard cluster → knotenpunkt → address navigation
- Upload PDF pressure test report per address
- Date and status tracking

**Uses the shared `ModuleNavigator` class** — same navigation pattern as Einblasen.

### 5.8 Kalibrieren (kalibrieren.html)

**URL:** `/kalibrieren.html?project=<ProjectName>`
**File:** `kalibrieren.html`, `src/js/kalibrieren.js`, `src/js/module-shared.js`

**What it is:** "Kalibrieren" = calibrating/cleaning. Calibration/cleaning of conduit pipes before installation — typically using a calibrating plug pushed through the pipe to verify inner diameter and clear debris.

**What the user sees:** Same navigation + PDF upload pattern as Druckprüfung.

**Uses the shared `ModuleNavigator` class.**

### 5.9 OTDR (otdr.html)

**URL:** `/otdr.html?project=<ProjectName>`
**File:** `otdr.html`, `src/js/otdr.js`, `src/js/module-shared.js`

**What it is:** OTDR = Optical Time Domain Reflectometer. A device used to test fiber-optic cable quality and find faults. This module manages OTDR test reports.

**What the user sees:**
- Cluster → Knotenpunkt navigation
- Upload OTDR report (PDF or SOR file) per knotenpunkt
- Status: Waiting (auto-triggered when APL + Knotenpunkt are Done) / Done / Error
- Date tracking

**Key feature:** OTDR status auto-triggers to "Waiting" when both APL Status and Knotenpunkt Status are "Done" in the same row. This happens automatically on the server side when data is saved.

**Uses the shared `ModuleNavigator` class.**

### 5.10 Knotenpunkt Vorbereitung (knotenpunkt-vorbereitung.html)

**URL:** `/knotenpunkt-vorbereitung.html?project=<ProjectName>`
**File:** `knotenpunkt-vorbereitung.html`, `src/js/knotenpunkt-vorbereitung.js`, `src/js/module-shared.js`

**What it is:** "Knotenpunkt Vorbereitung" = Node Point Preparation. This covers the work done at an NVT (Network Verteiler Terminal = Network Distribution Terminal) or SCT — the cabinet/enclosure where fiber splicing happens.

**What the user sees:**
- Cluster → Knotenpunkt navigation
- Upload photos/documents for each knotenpunkt
- Appointment scheduling for the work
- Status tracking: Pending / Done / Error
- Customer/owner information (if applicable)

**Uses the shared `ModuleNavigator` class.**

### 5.11 Planner (planner.html)

**URL:** `/planner.html?project=<ProjectName>`
**File:** `planner.html`, `src/js/planner.js`

**What it is:** A calendar/schedule view showing upcoming appointments across all modules (APL visits, knotenpunkt work, etc.).

**What the user sees:**
- Calendar view with appointment dots
- Click on a date → see all scheduled appointments for that day
- Filter by module type (APL, Knotenpunkt, etc.)
- Appointment details: address, type, status

**Data flow:**
- `GET /api/modules/appointments?project=<name>` → fetches all appointment data from the Aufmass rows

### 5.12 Files (files.html)

**URL:** `/files.html?project=<ProjectName>`
**File:** `files.html`

**What it is:** A full-featured file browser for all project documents — photos, PDFs, plans, etc.

**What the user sees:**
- Folder tree (left panel): Navigate the project's folder structure
- File list (right panel): Files in current folder with thumbnails for images
- Upload button (superadmin/admin only)
- Rename, delete, move, copy operations
- Download individual files or entire folders as ZIP
- Recycle bin (`.trash/`) with restore and permanent delete options
- File sharing: Create a shareable link to give read-only access to specific files/folders

**Key features:**
- Breadcrumb navigation
- Image thumbnails (inline preview)
- File metadata (size, date, description)
- Drag-and-drop upload
- Multi-file selection for bulk operations
- Share links are public (no auth required) and can have expiry

**Key API calls:**
- `GET /api/files/?project=<name>&path=<path>` — list directory contents
- `POST /api/files/upload` — upload files
- `POST /api/files/folder` — create folder
- `POST /api/files/rename` — rename file/folder
- `DELETE /api/files/` — delete (moves to trash)
- `POST /api/files/move` — move file/folder
- `POST /api/files/copy` — copy file/folder
- `GET /api/files/download` — download single file
- `GET /api/files/download-folder` — download folder as ZIP
- `GET /api/files/trash` — list trash contents
- `POST /api/files/trash/restore` — restore from trash
- `DELETE /api/files/trash/purge` — permanently delete from trash
- `POST /api/files/share` — create share link
- `GET /api/files/shares` — list share links
- `DELETE /api/files/share` — delete share link
- `GET /api/files/tree` — get full folder tree structure

### 5.13 Admin Panel (admin.html)

**URL:** `/admin.html`
**File:** `admin.html`
**Access:** Superadmin only

**What it is:** The control center for system administrators.

**What the user sees (multiple sections):**

**Users section:**
- List of all registered users with status (verified/approved/pending)
- Approve or reject pending users
- Edit user details (name, email, role, password reset)
- Force-terminate active sessions
- View session history for each user (login/logout events, device info)

**Access Control section:**
- Select a user → configure their permissions
- Toggle full access on/off
- Set per-project access, canEdit, and module permissions
- See which projects a user can access

**NAS Sync section:**
- Current sync status (connected/disconnected, last sync time)
- Pending files count
- Error log
- Manual sync trigger button

**Generator Settings section:**
- Control who can use the "schema generator" feature
- Add/remove users from the allowed list
- Enable/disable generator access for regular users

**Super Logs section:**
- Real-time log viewer (polls for new entries)
- Filter by log type (request, auth, file, sync, chat, error, system)
- Filter by log level (info, warn, error, debug)
- Full-text search across log messages

**Key API calls:**
- `GET /api/admin/users` — list all users
- `POST /api/admin/approve` — approve user
- `POST /api/admin/reject` — reject user
- `POST /api/admin/user/update` — edit user
- `POST /api/admin/terminate-session` — force-terminate session
- `GET /api/admin/user-sessions/:email` — view session history
- `GET /api/admin/sync-status` — NAS sync status
- `POST /api/admin/sync-trigger` — manually trigger sync
- `GET /api/admin/access-control` — list all ACL entries
- `GET /api/admin/access-control/:email` — get user's ACL
- `POST /api/admin/access-control/:email` — set user's ACL
- `DELETE /api/admin/access-control/:email` — remove user's ACL
- `GET /api/admin/super-logs` — get system logs
- `GET /api/admin/super-logs/stats` — get log statistics
- `GET /api/admin/logs` — get action logs

### 5.14 Profile (profile.html)

**URL:** `/profile.html`
**File:** `profile.html`

**What the user sees:**
- Profile photo (with upload/delete option)
- Display name, username, email (editable)
- Password change form (requires current password)
- Session history (recent logins, devices, IP addresses)

**Key API calls:**
- `GET /api/profile/` — get current user profile
- `PUT /api/profile/` — update name/email/username
- `PUT /api/profile/password` — change password
- `POST /api/profile/avatar` — upload profile photo
- `DELETE /api/profile/avatar` — remove profile photo
- `GET /api/profile/avatar/:filename` — serve avatar image
- `GET /api/profile/check-username?username=<u>` — check if username is available

### 5.15 New Project (new-project.html)

**URL:** `/new-project.html`
**File:** `new-project.html`, `src/js/new-project.js`
**Access:** Users with `createProject` ACL permission, or superadmin

**What the user sees:**
- Project name input
- Location names (add multiple sub-locations)
- Schema builder: define column groups and their columns with format types
- Import from existing project option
- Create button

**What happens on create:**
1. `POST /api/projects/create` with project name and schema
2. Server creates `storage/<ProjectName>/` directory structure
3. Creates the empty `<ProjectName>.txt` data file with the defined schema
4. Adds project to `projects.json`
5. Creates all standard subdirectories (Doku, Pläne, chat, etc.)

**Key API calls:**
- `POST /api/projects/create` — create new project
- `GET /api/projects/` — list existing projects (for import schema option)

### 5.16 Super Log (superlog.html)

**URL:** `/superlog.html`
**File:** `superlog.html`
**Access:** Superadmin only

**What the user sees:** A dedicated full-page log viewer (same as the logs section in admin panel, but as a standalone page with more screen real estate).

**Features:**
- Real-time streaming (auto-refreshes every few seconds)
- Filter by type: request, auth, file, sync, chat, error, system
- Filter by level: debug, info, warn, error
- Full-text search
- Log entry count and statistics

---

## 6. API Reference

All API endpoints are mounted under the Express app at `http://localhost:3000`.

**Authentication:** All `/api/*` routes (except `/api/geocode` and `/api/auth/*`) require a valid JWT in the `Authorization: Bearer <token>` header. This is added automatically by `api.js` on the frontend.

**Standard response format:**
```json
{ "success": true,  "data": ... }
{ "success": false, "message": "Error description" }
```

### 6.1 Auth Routes (/api/auth or /api/*)

> **Note:** Auth routes are mounted directly at `/api/` (not `/api/auth/`) in the current code.

---

#### `POST /api/register`
Register a new user account. Sends OTP to email. Nothing is saved to disk until OTP is verified.

**Auth required:** No

**Request body:**
```json
{
  "name": "John Doe",
  "username": "johndoe",
  "email": "john@example.com",
  "password": "SecurePassword123!"
}
```

**Response (success):**
```json
{ "success": true, "message": "Verification code sent to email." }
```

**Response (error):**
```json
{ "success": false, "message": "Email or Username already in use." }
```

---

#### `POST /api/verify-otp`
Verify the OTP code sent during registration. On success, saves user to `users.json` and notifies admins.

**Auth required:** No

**Request body:**
```json
{ "email": "john@example.com", "otp": "123456" }
```

**Response:**
```json
{ "success": true, "message": "Email verified! Waiting for admin approval." }
```

---

#### `POST /api/login`
Login with username or email + password.

**Auth required:** No

**Request body:**
```json
{ "identifier": "johndoe", "password": "SecurePassword123!" }
```

**Response (regular user success):**
```json
{
  "success": true,
  "token": "eyJ...",
  "role": "user",
  "name": "John Doe",
  "email": "john@example.com"
}
```

**Response (superadmin — requires 2FA):**
```json
{ "success": true, "requires2FA": true, "email": "admin@example.com" }
```

**Response (rate limited):**
```json
{ "success": false, "message": "Too many failed attempts. Try again in 15 minutes.", "retryAfterSec": 900 }
```

---

#### `POST /api/verify-2fa`
Complete superadmin 2FA login by verifying the OTP sent via email.

**Auth required:** No

**Request body:**
```json
{ "email": "admin@example.com", "otp": "654321" }
```

**Response:**
```json
{
  "success": true,
  "token": "eyJ...",
  "role": "superadmin",
  "name": "Admin Name",
  "email": "admin@example.com"
}
```

---

#### `POST /api/auth/refresh`
Silently refresh a JWT token that is within 30 minutes of expiry.

**Auth required:** Yes (valid but near-expiry JWT)

**Request body:** None (token taken from Authorization header)

**Response (token was refreshed):**
```json
{ "refreshed": true, "token": "eyJ..." }
```

**Response (not eligible — too early to refresh):**
```json
{ "refreshed": false }
```

---

#### `POST /api/logout`
Log the user out (records logout event in session log).

**Auth required:** Yes

**Request body:** None (email taken from JWT)

**Response:**
```json
{ "success": true, "message": "Logged out successfully." }
```

---

### 6.2 Data Routes (/api/data/*)

---

#### `GET /api/data/?project=<projectName>`
Read all data for a project.

**Auth required:** Yes. ACL check: user must have access to the project AND the `aufmass` module.

**Query params:**
- `project` (required): The project name

**Response:**
```json
{
  "success": true,
  "schema": [
    { "id": "grp-0", "title": "Timing", "cols": [{ "id": "col-0-0", "label": "Date" }] },
    { "id": "grp-1", "title": "Location", "cols": [
      { "id": "col-1-0", "label": "Cluster" },
      { "id": "col-1-1", "label": "Knotenpunkt" }
    ]}
  ],
  "data": [
    { "_id": "ROW-0", "_version": 3, "col-0-0": "2026-05-05", "col-1-0": "Cluster-A", "col-1-1": "NVT-001" }
  ]
}
```

---

#### `POST /api/data/?project=<projectName>`
Save all data for a project (replaces entire dataset).

**Auth required:** Yes. ACL check: `access`, `aufmass` module, AND `canEdit`.

**Request body:**
```json
{
  "schema": [
    { "id": "grp-0", "title": "Timing", "cols": [{ "id": "col-0-0", "label": "Date" }] }
  ],
  "data": [
    { "_id": "ROW-0", "col-0-0": "2026-05-05", "col-1-0": "Cluster-A" }
  ]
}
```

**Response:**
```json
{ "success": true, "message": "Data saved successfully." }
```

---

### 6.3 Project Routes (/api/projects/*)

---

#### `GET /api/projects/`
List all projects the current user has access to.

**Auth required:** Yes

**Response:**
```json
{
  "success": true,
  "projects": [
    { "id": "123", "name": "Laich-Suppingen", "status": "Active", "progress": 45 }
  ]
}
```

---

#### `POST /api/projects/create`
Create a new project with its folder structure and empty data file.

**Auth required:** Yes. ACL check: `createProject` authority, or superadmin.

**Request body:**
```json
{
  "name": "My New Project",
  "locations": ["Zone A", "Zone B"],
  "schema": [
    { "title": "Timing", "cols": [{ "label": "Date" }] }
  ]
}
```

---

#### `POST /api/projects/status`
Change project status (Active/Paused/Done).

**Auth required:** Yes. ACL check: `changeStatus`, or superadmin.

**Request body:**
```json
{ "projectName": "Laich-Suppingen", "status": "Paused" }
```

---

#### `POST /api/projects/reorder`
Reorder the project list.

**Auth required:** Yes. ACL check: `reorderProjects`, or superadmin.

**Request body:**
```json
{ "projects": ["Project B", "Project A", "Project C"] }
```

---

#### `POST /api/projects/remove`
Delete a project.

**Auth required:** Yes. ACL check: `deleteProject`, or superadmin.

**Request body:**
```json
{ "projectName": "Old Project" }
```

---

#### `GET /api/projects/zip/:projectName`
Download an entire project as a ZIP archive.

**Auth required:** Yes. ACL check: `downloadZip`, or superadmin.

**Note:** If NAS sync is enabled, missing files are fetched from NAS before zipping.

**Response:** Binary ZIP file download

---

#### `GET /api/projects/:projectName/clusters`
Get the list of clusters for a project (from the aufmass data file).

**Auth required:** Yes

**Response:**
```json
{ "success": true, "clusters": ["Cluster-A", "Cluster-B"] }
```

---

#### `GET /api/projects/:projectName/knotenpunkte`
Get knotenpunkte for a project (optionally filtered by cluster).

**Auth required:** Yes

**Query params:**
- `cluster` (optional): Filter by cluster name

---

### 6.4 Module Routes (/api/modules/*)

---

#### `GET /api/modules/navigation?project=<name>`
Get the full hierarchical navigation structure for module pages:
cluster → knotenpunkt → address list with all data fields.

**Auth required:** Yes

**Response:**
```json
{
  "success": true,
  "clusters": ["Cluster-A"],
  "navigation": {
    "Cluster-A": {
      "NVT-001": [
        {
          "id": "ROW-0",
          "start": "Hauptstr 13",
          "end": "Hauptstr 15",
          "cableName": "Kabel-24F",
          "fiberType": "72F",
          "data": { "col-0-0": "2026-05-05", ... }
        }
      ]
    }
  }
}
```

---

#### `POST /api/modules/upload`
Upload files (images, PDFs) to a project's module folder.

**Auth required:** Yes

**Request:** `multipart/form-data` with:
- `project`: project name
- `targetPath`: destination path relative to `storage/<project>/Doku/`
- `files`: one or more files
- `customName` (optional): override filename

---

#### `POST /api/modules/aufmass-update`
Update specific columns in a single row of the aufmass data.

**Auth required:** Yes

**Request body:**
```json
{
  "project": "My Project",
  "rowId": "ROW-0",
  "updates": {
    "col-3-0": "Done",
    "col-3-1": "72"
  },
  "module": "apl",
  "note": "APL completed"
}
```

**Response:**
```json
{ "success": true }
```

---

#### `GET /api/modules/aufmass-row?project=<name>&rowId=<id>`
Get the current data for a single row.

**Auth required:** Yes

---

#### `GET /api/modules/list-files?project=<name>&path=<path>`
List files in a module folder (e.g., list APL photos for a knotenpunkt).

**Auth required:** Yes

**Response:**
```json
{
  "success": true,
  "files": [
    { "name": "NVT-001_Addr_APL_Box_20260505.jpg", "size": 204800, "mtime": "2026-05-05T14:30:22Z" }
  ]
}
```

---

#### `GET /api/modules/appointments?project=<name>`
Get all appointment data across all addresses (for the Planner page).

**Auth required:** Yes

---

#### `GET /api/modules/done-dates?project=<name>&module=<moduleName>`
Get completion dates for all addresses in a module.

**Auth required:** Yes

---

#### `POST /api/modules/backfill-einblasen-dates`
Retroactively fill einblasen dates from uploaded file timestamps.

**Auth required:** Yes (superadmin or canEdit)

---

#### `DELETE /api/modules/clear-files`
Delete all uploaded files for an address in a module.

**Auth required:** Yes (superadmin only)

---

### 6.5 File Routes (/api/files/*)

---

#### `GET /api/files/?project=<name>&path=<path>`
List directory contents at the given path.

**Auth required:** Yes. ACL check: `files` module.

**Response:**
```json
{
  "success": true,
  "items": [
    { "name": "APL", "isDir": true, "size": null },
    { "name": "report.pdf", "isDir": false, "size": 204800, "mtime": "2026-05-05T14:30:22Z" }
  ]
}
```

---

#### `POST /api/files/upload`
Upload files to a path. Only allowed for non-user roles (superadmin).

**Auth required:** Yes (superadmin only — `requireNonUserRole` middleware)

**Request:** `multipart/form-data`

---

#### `POST /api/files/folder`
Create a new folder.

**Auth required:** Yes

---

#### `POST /api/files/rename`
Rename a file or folder.

**Auth required:** Yes

**Request body:**
```json
{ "project": "My Project", "path": "Doku/Cluster-A", "oldName": "folder1", "newName": "folder2" }
```

---

#### `DELETE /api/files/`
Delete a file or folder (moves to `.trash/`, not permanent delete).

**Auth required:** Yes

---

#### `POST /api/files/copy`
Copy a file or folder.

**Auth required:** Yes

---

#### `POST /api/files/move`
Move a file or folder.

**Auth required:** Yes

---

#### `GET /api/files/tree?project=<name>`
Get the complete folder tree for a project.

**Auth required:** Yes

---

#### `GET /api/files/download?project=<name>&path=<dir>&file=<filename>`
Download a single file.

**Auth required:** Yes

---

#### `GET /api/files/download-folder?project=<name>&path=<path>`
Download a folder (and all contents) as a ZIP.

**Auth required:** Yes. ACL check: `downloadZip`.

---

#### `GET /api/files/trash?project=<name>`
List items in the project's recycle bin.

**Auth required:** Yes

---

#### `POST /api/files/trash/restore`
Restore a file from the recycle bin to its original location.

**Auth required:** Yes

---

#### `DELETE /api/files/trash/purge`
Permanently delete items from the recycle bin.

**Auth required:** Yes (superadmin only)

---

#### `POST /api/files/share`
Create a shareable public link to a file or folder.

**Auth required:** Yes

**Request body:**
```json
{
  "project": "My Project",
  "path": "Doku/Cluster-A/APL",
  "expiresIn": 7
}
```

**Response:**
```json
{ "success": true, "shareId": "abc123", "url": "/share/abc123" }
```

---

#### `GET /api/files/shares?project=<name>`
List all active share links for a project.

**Auth required:** Yes

---

#### `DELETE /api/files/share?shareId=<id>`
Delete/revoke a share link.

**Auth required:** Yes

---

#### `GET /share/:shareId`
**Public endpoint.** Serve the share page (no auth required).

---

#### `GET /share/:shareId/browse`
**Public endpoint.** Browse a shared folder.

---

#### `GET /share/:shareId/download`
**Public endpoint.** Download a shared file.

---

### 6.6 Admin Routes (/api/admin/*)

All admin routes require `superadmin` role.

---

#### `GET /api/admin/users`
Get all registered users.

**Response:**
```json
{
  "success": true,
  "users": [
    { "id": "1", "name": "Admin", "email": "admin@example.com", "role": "superadmin", "isVerified": true, "isApproved": true }
  ]
}
```

---

#### `POST /api/admin/approve`
Approve a pending user registration.

**Request body:**
```json
{ "email": "newuser@example.com" }
```

---

#### `POST /api/admin/reject`
Reject and delete a pending user.

**Request body:**
```json
{ "email": "spammer@example.com" }
```

---

#### `POST /api/admin/user/update`
Update a user's profile fields (name, email, role, password reset, etc.).

**Auth required:** Superadmin only

---

#### `POST /api/admin/terminate-session`
Force-terminate all active sessions for a user.

**Request body:**
```json
{ "email": "troubleuser@example.com" }
```

---

#### `GET /api/admin/user-sessions/:email`
Get session history (login/logout events) for a specific user.

---

#### `GET /api/admin/user-stats/:email`
Get usage statistics for a user.

---

#### `GET /api/admin/logs`
Get the action log (last 1000 entries from `logs.json`).

---

#### `GET /api/admin/logs/search?q=<query>`
Search action logs.

---

#### `GET /api/admin/sync-status`
Get NAS sync status.

---

#### `POST /api/admin/sync-trigger`
Manually trigger a full NAS sync.

---

#### `GET /api/admin/access-control`
Get all ACL entries (entire `access-control.json`).

---

#### `GET /api/admin/access-control/:email`
Get ACL entry for a specific user.

---

#### `POST /api/admin/access-control/:email`
Set/update ACL entry for a specific user.

**Request body:**
```json
{
  "fullAccess": false,
  "authority": { "createProject": true, "downloadZip": true },
  "projects": {
    "My Project": {
      "access": true,
      "canEdit": true,
      "modules": { "aufmass": true, "apl": true, "files": true }
    }
  }
}
```

---

#### `DELETE /api/admin/access-control/:email`
Remove all ACL permissions for a user (resets to zero access).

---

#### `GET /api/admin/super-logs`
Query the super log (system event log).

**Query params (all optional):**
- `after_id`: Only entries with ID greater than this value (for pagination/polling)
- `types`: Comma-separated list (`request,auth,file,sync,chat,error,system`)
- `level`: `debug`, `info`, `warn`, or `error`
- `limit`: Max results (default 100, max 500)
- `search`: Full-text search string

---

#### `GET /api/admin/super-logs/stats`
Get summary statistics for the last 24 hours.

**Response:**
```json
{
  "total": 1523,
  "byType": { "request": 1400, "auth": 50, "sync": 73 },
  "byLevel": { "info": 1500, "warn": 20, "error": 3 },
  "since": "2026-05-04T14:30:00.000Z"
}
```

---

### 6.7 Profile Routes (/api/profile/*)

---

#### `GET /api/profile/`
Get the current user's profile.

**Auth required:** Yes

**Response:**
```json
{
  "success": true,
  "user": { "id": "123", "name": "John", "username": "johndoe", "email": "john@example.com", "role": "user" }
}
```

---

#### `PUT /api/profile/`
Update profile (name, email, username).

**Auth required:** Yes

---

#### `PUT /api/profile/password`
Change password. Requires current password for verification.

**Auth required:** Yes

**Request body:**
```json
{ "currentPassword": "OldPass123!", "newPassword": "NewPass456!" }
```

---

#### `POST /api/profile/avatar`
Upload profile avatar image.

**Auth required:** Yes. Request: `multipart/form-data` with `avatar` field.

---

#### `DELETE /api/profile/avatar`
Remove profile avatar.

**Auth required:** Yes

---

#### `GET /api/profile/avatar/:filename`
Serve the avatar image file.

**Auth required:** Yes

---

#### `GET /api/profile/check-username?username=<u>`
Check if a username is available.

**Auth required:** Yes

**Response:**
```json
{ "available": true }
```

---

### 6.8 Settings Routes (/api/settings/*)

---

#### `GET /api/settings/`
Get current application settings (e.g., generator access settings).

**Auth required:** Yes

---

#### `PUT /api/settings/`
Update settings.

**Auth required:** Yes (superadmin)

---

#### `GET /api/settings/generator-access`
Check if the current user has access to the schema generator.

**Auth required:** Yes

---

#### `POST /api/settings/verify-code`
Verify a special access code to unlock generator access.

**Auth required:** Yes

---

### 6.9 Chat Routes (/api/chat/*)

Each project has its own isolated chat using SQLite.

---

#### `GET /api/chat/:project`
Get chat messages for a project (newest messages, paginated).

**Auth required:** Yes. ACL check: `chat` module.

**Response:**
```json
{
  "success": true,
  "messages": [
    { "id": 1, "author": "John", "email": "john@example.com", "content": "Hello!", "timestamp": "2026-05-05T14:30:22Z" }
  ]
}
```

---

#### `POST /api/chat/:project`
Send a chat message (text or with media).

**Auth required:** Yes. ACL check: `chat` module.

**Request:** `multipart/form-data` or JSON with `content` field.

---

#### `GET /api/chat/:project/media/:filename`
Serve a chat media file (image).

**Auth required:** Yes

---

#### `PUT /api/chat/:project/:id`
Edit a chat message (own messages only, or superadmin).

**Auth required:** Yes

---

#### `DELETE /api/chat/:project/:id`
Delete a chat message (own messages only, or superadmin).

**Auth required:** Yes

---

### 6.10 Access Control Routes (/api/access/*)

These routes let the frontend fetch the current user's own permissions (as opposed to admin routes which manage permissions for all users).

---

#### `GET /api/access/my-permissions`
Get the current user's effective permissions.

**Auth required:** Yes

**Response:**
```json
{
  "success": true,
  "isSuperadmin": false,
  "permissions": {
    "fullAccess": false,
    "dashboard": { "createProject": false, "deleteProject": false, "changeStatus": false },
    "projects": {
      "My Project": { "canEdit": true, "modules": { "aufmass": true, "apl": true } }
    }
  }
}
```

---

#### `GET /api/access/permissions?project=<name>`
Get access permissions for a specific project (for the current user).

**Auth required:** Yes

---

### 6.11 Project Info Routes (/api/project-info/*)

---

#### `GET /api/project-info/:project`
Get project info/description.

**Auth required:** Yes

**Response:**
```json
{
  "success": true,
  "info": { "description": "## Project Description\n...", "updatedAt": "2026-01-01T00:00:00Z" }
}
```

---

#### `PUT /api/project-info/:project`
Update project description.

**Auth required:** Yes. ACL check: `editProjectInfo`, or superadmin.

---

#### `GET /api/project-info/:project/members`
Get the list of users who have access to this project.

**Auth required:** Yes

---

### 6.12 Geocode Routes (/api/geocode)

---

#### `GET /api/geocode?lat=<lat>&lng=<lng>`
Reverse-geocode GPS coordinates to an address string using Nominatim (OpenStreetMap).

**Auth required:** No (public endpoint, mounted before auth middleware)

**Rate limited:** Max 30 requests per minute per IP

**Response:**
```json
{
  "success": true,
  "address": "Hauptstraße 15, 72229 Laichingen",
  "display_name": "15, Hauptstraße, Laichingen, Alb-Donau-Kreis, Baden-Württemberg, 72229, Deutschland"
}
```

This is used by the GeoCam overlay to embed a location address into photo filenames/metadata.

### 6.13 Share Routes (/share/*)

Public endpoints — no authentication required. Used for sharing project files externally.

- `GET /share/:shareId` — Render the share page
- `GET /share/:shareId/browse` — Browse files in the shared folder
- `GET /share/:shareId/download` — Download a shared file

---

## 7. Controllers & Backend Logic

### 7.1 accessControl.js

**Location:** `controllers/accessControl.js`
**Stores data in:** `src/DataFiles/access-control.json`

This is the ACL (Access Control List) engine. It handles all permission checks throughout the application.

**Key design:** A mutex (`_writeLock`) ensures that concurrent reads and writes to `access-control.json` don't corrupt the file. All write operations are serialized through a promise chain.

**Exported functions:**

| Function | What it does |
|----------|-------------|
| `getUserAccess(email)` | Get the full ACL entry for a user |
| `setUserAccess(email, data)` | Save/update ACL for a user (uses mutex) |
| `removeUserAccess(email)` | Delete all ACL permissions for a user |
| `getAllAccessRules()` | Return the entire ACL file (for admin UI) |
| `getProjectMembers(projectName)` | Return all users who can access a project |
| `hasFullAccess(email)` | Check if user has `fullAccess: true` |
| `canDashboard(email, action)` | Check dashboard action permission |
| `canEditProject(email, projectName)` | Check write permission for a project |
| `canAccessProject(email, projectName)` | Check project visibility |
| `canAccessModule(email, projectName, module)` | Check module access |
| `getAccessibleProjects(email, allProjects)` | Filter project list to accessible ones |
| `getEffectivePermissions(email)` | Build full permissions object for frontend |

**Example usage in a route:**
```javascript
const { canAccessProject, canAccessModule } = require('../controllers/accessControl');

// In a route handler:
if (userRole !== 'superadmin') {
    if (!await canAccessProject(userEmail, projectName)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }
    if (!await canAccessModule(userEmail, projectName, 'aufmass')) {
        return res.status(403).json({ success: false, message: 'Module access denied' });
    }
}
```

### 7.2 passwordHelper.js & tokenHelper.js

**`passwordHelper.js`** — Handles password security:
- `hashPassword(plain)` → Returns bcrypt hash (12 salt rounds)
- `verifyPassword(input, stored)` → Returns `{ match: boolean, needsRehash: boolean }`
  - Automatically detects whether stored password is a bcrypt hash or legacy plain text
  - If plain text matches: returns `needsRehash: true` so the caller can upgrade it
  - This allows zero-downtime migration from old plain-text passwords to bcrypt

**`tokenHelper.js`** — Handles JWT session tokens:
- `createToken(user)` → Signs a JWT with email, role, name. Expiry: 8h (user) or 2h (superadmin)
- `verifyToken(token)` → Returns decoded payload or null if invalid/expired
- `checkRefreshEligible(token)` → Returns `{ eligible, decoded }` — true if within 30min of expiry
- `authMiddleware(req, res, next)` → Express middleware:
  - Extracts Bearer token from `Authorization` header
  - If valid: sets `req.user`, `x-user-email`, `x-user-role`, `x-user-name` headers
  - If invalid/expired: returns `401 { tokenExpired: true }` — client detects this and redirects to login
  - Blocks spoofed superadmin role claims from headerless requests

### 7.3 logger.js & superLogger.js

**`logger.js`** — Simple action log:
- Stores in `src/DataFiles/logs.json` (last 1000 entries)
- `logAction(userEmail, action, details)` → Adds entry with timestamp
- `getLogs()` → Returns all log entries
- **Used for:** User-visible audit trail (what data was changed, by whom)

**`superLogger.js`** — Advanced system event logger:
- In-memory ring buffer of last 5,000 entries
- Periodically flushed to `src/DataFiles/super-log.json` (every 30s or every 100 entries)
- **Never crashes the app** — all errors are silently swallowed
- `superLog(type, level, message, meta)` → Add a log entry
  - Types: `request`, `auth`, `file`, `sync`, `chat`, `error`, `system`
  - Levels: `debug`, `info`, `warn`, `error`
- `getSuperLogs({ after_id, types, level, limit, search })` → Query with filters
- `getLogStats()` → Summary stats for last 24h
- `requestLogger` → Express middleware that logs every HTTP request (method, path, status, response time, IP, user)
- **Used for:** Superadmin system monitoring, debugging, audit of all requests

### 7.4 nasSync.js

**Location:** `controllers/nasSync.js`
**Purpose:** Automatically sync all files in `storage/` to a NAS device over WebDAV.

**How the sync works:**

1. **`startSync()`** — Called on server startup. Creates WebDAV client, tests connectivity, schedules periodic sync.

2. **`fullSync()`** — Walks all files in `storage/`, compares mtimes against the manifest, uploads changed files. Runs on an interval (`NAS_SYNC_INTERVAL`).

3. **`syncFile(relPath)`** — Immediately upload a single file. Fire-and-forget — called after every file write.

4. **`queueOperation(op)`** — Queue a rename/delete/move/copy to be replicated on NAS.

5. **`cleanup48h()`** — Delete local copies of files that have been confirmed on NAS for more than 48 hours.

6. **`fetchFromNAS(relPath, localPath)`** — Download a file from NAS (for on-demand restore).

7. **`getSyncStatus()`** — Return current sync state (for admin panel).

**The sync manifest** (`storage/.sync-manifest.json`):
```json
{
  "files": {
    "MyProject/Doku/Aufmass/datafile/MyProject.txt": {
      "localMtime": "2026-05-05T14:30:22.000Z",
      "syncedAt": "2026-05-05T14:31:00.000Z",
      "confirmed": true,
      "size": 12345,
      "cleanedAt": null
    }
  },
  "lastFullSync": "2026-05-05T14:31:00.000Z",
  "lastCleanup": "2026-05-05T06:00:00.000Z"
}
```

**Files never synced:**
- `.sync-manifest.json` itself
- `node_modules/`, `.git/`
- SQLite files (`.db`, `.db-wal`, `.db-shm`) — these are active binary files

**Files never deleted locally:**
- The canonical `<ProjectName>.txt` data file
- The latest versioned copy of each project's data
- All JSON config files in `src/DataFiles/`

### 7.5 Other Controllers

**`sessionLogger.js`** — Tracks login/logout events:
- `logSession({ email, name, action, ip, userAgent })` — Record login/logout/failed
- `getSessionHistory(email, limit)` — Get user's login history
- `parseDevice(userAgent)` — Convert User-Agent string to "Browser on OS" label
- `terminateUser(email, terminatedBy)` — Force-terminate sessions (marks in `terminated-sessions.json`)
- `isTerminated(email)` — Check if user is force-terminated
- `clearTermination(email)` — Clear termination on next successful login

**`rateLimiter.js`** — In-memory login rate limiter:
- Tracks failed attempts by `{IP}|{identifier}` key
- `checkAttempt(ip, identifier)` — Returns `{ allowed, remainingAttempts, lockedUntil, retryAfterSec }`
- `recordFailure(ip, identifier)` — Increment failure counter; lock after 5 failures
- `clearAttempts(ip, identifier)` — Clear on successful login
- Auto-cleans stale entries every minute

**`storageConfig.js`** — Single source of truth for all file paths:
- `STORAGE_ROOT` — The base storage directory
- `getProjectRoot(name)` → `STORAGE_ROOT/<name>`
- `getDatafileDir(name)` → `STORAGE_ROOT/<name>/Doku/Aufmass/datafile`
- `getXlsxDir(name)` → `STORAGE_ROOT/<name>/Doku/Aufmass/xlsx`
- `getChatDir(name)` → `STORAGE_ROOT/<name>/chat`
- `ensureDir(path)` → Create directory recursively if it doesn't exist
- `ensureStorageRoot()` → Called on startup to create the storage root

**`dataVersioning.js`** — Creates versioned backups on every save:
- `saveVersionedCopy(filePath, E1, E2)` — Saves `<name>_YYYYMMDD_HHMMSS.txt` and Excel export

**`folderSync.js`** — Keeps folder structure in sync with data:
- `performFolderSync(project, clusterKnoten, safeNames, logAction)` — Creates/trashes folders based on cluster/knotenpunkt data
- `getExistingClusters(project)` — List clusters from disk
- `getExistingKnotenpunkte(project, cluster)` — List knotenpunkte for a cluster

**`trashHelper.js`** — Safe file deletion (to recycle bin):
- `moveToTrash(localPath, projectRoot)` → Moves file to `<project>/.trash/` with timestamp prefix

**`chatDb.js`** — SQLite chat database manager:
- One SQLite database per project at `storage/<project>/chat/<project>.db`
- Manages connection pooling (keeps DBs open for performance, closes all on shutdown)
- Tables: `messages` with columns: id, author, email, content, media_url, timestamp

**`projectCreator.js`** — Creates the full folder structure for a new project:
- Creates all standard directories (Doku, Pläne, chat, etc.)
- Writes the empty data file with the provided schema

**`nasOnDemand.js`** — Fetches files from NAS when they're missing locally:
- `ensureLocalFile(localPath, relPath)` — If file is missing locally but marked in manifest as cleaned, fetch from NAS. Returns the local path (or throws if unavailable).

**`fileMeta.js`** — Per-project file metadata:
- Stores file descriptions and custom metadata in `storage/<project>/.filemeta.json`
- `setFileMeta(project, path, meta)` — Set metadata for a file/folder
- `getProjectRoot(project)` → Returns the project's storage root

---

## 8. Frontend Architecture

### 8.1 api.js — Auth Interceptor

**Location:** `src/js/api.js`
**Included on:** Every page (before any other JS)

This script **wraps the native browser `fetch()` function** so that every single API request automatically includes the authentication headers. You don't need to manually add headers in any other JS file — `api.js` does it globally.

**What it does:**

```javascript
// Before api.js:
fetch('/api/data/?project=X')  // No auth headers → 401 Unauthorized

// After api.js:
fetch('/api/data/?project=X')  // Automatically includes:
// Authorization: Bearer eyJ...
// x-user-email: john@example.com
// x-user-role: user
```

**Token refresh logic:**
1. Before each `/api/` request, the interceptor checks if the token expires in less than 30 minutes
2. If yes: calls `POST /api/auth/refresh` to get a new token (only one refresh at a time — concurrent requests share the same refresh promise)
3. Updates `localStorage.authToken` with the new token
4. Proceeds with the original request using the fresh token

**Where tokens are stored:**
- `localStorage.authToken` — JWT token
- `localStorage.userEmail` — User's email
- `localStorage.userRole` — User's role
- `localStorage.userName` — User's display name

### 8.2 auth.js — Login / Register / 2FA Flows

**Location:** `src/js/auth.js`
**Used on:** `login.html`, `register.html`

**Login flow:**
1. Form submits → `fetch('/api/login', ...)` with identifier + password
2. If `result.requires2FA`: dynamically replaces form with 6-digit OTP input
3. If success: calls `completeLogin(result)`:
   - Saves `userRole`, `userName`, `userEmail`, `authToken` to `localStorage`
   - Redirects to `index.html`

**Registration flow:**
1. Form submits → `fetch('/api/register', ...)` with name/username/email/password
2. On success: hides registration form, shows OTP form
3. OTP form submits → `fetch('/api/verify-otp', ...)`
4. On success: shows alert, redirects to `login.html`

**2FA flow** (superadmin):
1. Login returns `requires2FA: true`
2. `show2FAInput(email)` dynamically replaces the login form
3. 6-digit code submitted → `fetch('/api/verify-2fa', ...)`
4. On success: calls `completeLogin(result)`

### 8.3 module-shared.js — Shared Navigation

**Location:** `src/js/module-shared.js`
**Used by:** druckprufung.js, einblasen.js, kalibrieren.js, otdr.js, knotenpunkt-vorbereitung.js

This file contains the `ModuleNavigator` class — a reusable component that handles the cluster → knotenpunkt → address navigation pattern common to most module pages.

**What `ModuleNavigator` does:**
1. Fetches the navigation data from `GET /api/modules/navigation?project=<name>`
2. Renders a cluster selection list
3. When cluster is selected: renders knotenpunkt list
4. When knotenpunkt is selected: renders address list with status badges
5. When address is selected: calls a callback function provided by the specific module

**Key methods:**
- `nav.getAddresses(cluster, knotenpunkt)` — Get addresses for a knotenpunkt
- `nav.findColumnId(groupName, colName)` — Find a column ID by searching schema (case-insensitive prefix match)
- `ModuleNavigator._downloadFile(url, filename)` — Trigger file download via anchor element

**`appointment-shared.js`** (`AppointmentHelper`):
- Provides shared functions for appointment scheduling (used by APL and Knotenpunkt modules)
- `AH.parseTermin(value)` — Parse appointment date/time from stored string
- `AH.terminInfoHTML(termin, isDone)` — Render appointment info card HTML
- `AH.choiceButtonsHTML(isDone, termin)` — Render "Set Appointment" or "Upload" button HTML
- `AH.renderAppointmentForm(config)` — Render the appointment edit form

### 8.4 Common Frontend Patterns

**How pages check authentication:**
```javascript
const userRole = localStorage.getItem('userRole');
const userEmail = localStorage.getItem('userEmail');

if (!userRole) { window.location.href = 'login.html'; return; }
```

**How pages get the current project:**
```javascript
const urlParams = new URLSearchParams(window.location.search);
const projectName = urlParams.get('project');

if (!projectName) { window.location.href = 'index.html'; return; }
```

**How pages load data:**
```javascript
async function loadData() {
    const res = await fetch(`/api/data/?project=${encodeURIComponent(projectName)}`);
    const result = await res.json();
    if (result.success) {
        renderTable(result.schema, result.data);
    } else {
        showError(result.message);
    }
}
```

**Force logout detection** (`src/js/force-logout.js`):
- Intercepts any API response with `{ forceLogout: true }` or `{ tokenExpired: true }`
- Clears localStorage and redirects to login page

**Idle logout** (`src/js/idle-logout.js`):
- Sets up a timer that fires after X minutes of no user interaction
- On timeout: calls `POST /api/logout` and redirects to login

**Avatar in headers** (`src/js/header-avatar.js`):
- Loads on every page, fetches the user's profile avatar and displays it in the header

**Modal dialogs** (`src/js/modal.js`):
- `showAlert(title, message)` — Async alert dialog (replaces browser `alert()`)
- `showConfirm(title, message)` → Returns `true`/`false` (replaces `confirm()`)
- `showPrompt(title, message)` → Returns text input or null (replaces `prompt()`)
- `showErrorSelectModal(title, entries)` → Custom modal for error resolution

**i18n** (`src/js/i18n.js`):
- Basic internationalization support for multi-language display
- Translates UI labels based on a language file

### 8.5 Shared CSS Patterns

**File:** `src/css/styles.css`

**Key CSS classes:**

| Class | What it styles |
|-------|---------------|
| `.glass-card` | Frosted glass card container (white with slight blur) |
| `.mod-badge` | Status badge (colored pill) |
| `.mod-badge-done` | Green "Done" badge |
| `.mod-badge-pending` | Gray "Pending" badge |
| `.mod-badge-error` | Red "Error" badge |
| `.mod-badge-waiting` | Yellow "Waiting" badge |
| `.form-inp` | Standard input field styling |
| `.form-lbl` | Standard label styling |
| `.btn-secondary` | Secondary action button |
| `.apl-upload-btn` | Primary upload button (APL module) |
| `.upload-zones-grid` | Grid of image upload zones |
| `.apl-zone` | Individual image upload zone |
| `.zone-preview` | Image preview within zone |
| `.customer-details-card` | Customer info card |
| `.customer-link` | Clickable customer detail (phone, email) |

**Design approach:** The app uses **Tailwind CSS** for utility classes (loaded from CDN in each HTML file) plus a custom `styles.css` for component-specific styles.

**The glassmorphism design language:** Most cards use a "frosted glass" effect (`background: rgba(255,255,255,0.97)`) with subtle borders and shadows, creating a modern, clean UI suitable for mobile use by field technicians.

---

## 9. Deployment

### 9.1 Docker Setup

**For production deployment, Docker is strongly recommended.** It ensures consistent behavior across different servers and makes updates and rollbacks trivial.

**Prerequisites:**
- A Linux VPS (Ubuntu 22.04+ recommended)
- Docker and Docker Compose installed
- A domain name (optional, but needed for HTTPS)

**Step 1: Get the code on your server**

```bash
ssh user@your-server.com
git clone https://github.com/rishi-dumps-here/DataManagement.git docpilot
cd docpilot
```

**Step 2: Configure environment**

```bash
cp .env.example .env
nano .env

# Required settings for production:
# STORAGE_ROOT=/data/storage  (leave default — Docker volumes handle this)
# SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
# JWT_SECRET=<generate a long random string>
```

**Generate a secure JWT secret:**
```bash
openssl rand -hex 64
```

**Step 3: Start the application**

```bash
docker compose up -d

# Check logs
docker compose logs -f

# Check status
docker compose ps
```

**Step 4: Access the app**

```
http://your-server-ip:3000
```

**Step 5: Set up a first superadmin**

```bash
# Enter the container
docker exec -it docpilot sh

# Edit the users file
vi /app/src/DataFiles/users.json
# Add your superadmin entry (see 3.5)
# Press Ctrl+C to save, then exit

exit
```

**Updating to a new version:**

```bash
cd docpilot
git pull origin main
docker compose down
docker compose up -d --build
```

### 9.2 VPS Deployment

For deployment without Docker (directly on a Linux server):

**Step 1: Install Node.js**
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Step 2: Install PM2 (process manager)**
```bash
npm install -g pm2
```

PM2 keeps the Node.js app running even after server reboots.

**Step 3: Set up the app**
```bash
git clone https://github.com/rishi-dumps-here/DataManagement.git /var/www/docpilot
cd /var/www/docpilot
npm install --production
cp .env.example .env
nano .env  # Configure your settings
```

**Step 4: Start with PM2**
```bash
pm2 start server.js --name docpilot
pm2 save  # Save process list for auto-restart on reboot
pm2 startup  # Generate startup script (follow the printed instructions)
```

**Step 5: Set up Nginx reverse proxy (for HTTPS)**

```bash
sudo apt install nginx
sudo nano /etc/nginx/sites-available/docpilot
```

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/docpilot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

**Step 6: Set up HTTPS with Certbot**
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

### 9.3 NAS Sync Configuration

**Prerequisites:**
- A NAS device that supports WebDAV (UGREEN, Synology, QNAP, TrueNAS, etc.)
- WebDAV enabled on the NAS with a user account and password
- The NAS must be reachable from the VPS (either on the same network or via VPN/Tailscale)

**Configuration:**

Edit your `.env` file:
```
NAS_SYNC_ENABLED=true
NAS_WEBDAV_URL=http://100.64.0.1:5005
NAS_USERNAME=docpilot-user
NAS_PASSWORD=your-nas-password
NAS_SYNC_INTERVAL=300000
NAS_REMOTE_BASE=/Supreme
```

**Testing connectivity:**
After starting the server, check the logs:
```bash
docker compose logs docpilot | grep nas-sync
# Should see: [nas-sync] Connected to NAS at http://...
```

**Monitoring sync status:**
Log in as superadmin → Admin Panel → NAS Sync section.

**What happens on NAS failure:**
- Sync errors are logged and retried on next cycle
- The app continues to work normally — NAS sync is always background/non-blocking
- Local files are NOT deleted if NAS check fails (safety check)

### 9.4 Backup Strategy

DocPilot has a multi-layer data protection approach:
**Layer 1: In-place versioning (automatic)**
Every Aufmass save creates a timestamped copy of the data file:
```
storage/MyProject/Doku/Aufmass/datafile/
├── MyProject.txt              ← current data
├── MyProject_20260505_143022.txt  ← yesterday's version
└── MyProject_20260506_091512.txt  ← this morning's version
```
Roll back: copy the desired versioned file over `MyProject.txt` and restart the server.

**Layer 2: Recycle bin (for files)**
Deleted files go to `.trash/` instead of permanent deletion:
```
storage/MyProject/.trash/
├── 2026-05-05_143022_important-doc.pdf
└── 2026-05-06_091512_old-photo.jpg
```
Restore from admin panel (Files page → Trash tab).

**Layer 3: NAS sync (if configured)**
All files are continuously synced to your NAS. Even if the VPS crashes or you accidentally purge the trash, the NAS has a full copy. After 48h, confirmed-synced files are cleaned from the VPS to save disk space.

**Layer 4: VPS snapshots (manual / hosting-provider)**
Recommended: Take a weekly VPS snapshot via your hosting provider. This protects against accidental deletion of the application files themselves.

**Critical files to protect:**
- `src/DataFiles/users.json` — all user accounts
- `src/DataFiles/access-control.json` — all permissions
- `storage/` — all project data (volumes in Docker)

**Backup these manually (if not using NAS sync):**
```bash
# Create a dated backup of all data
tar -czf docpilot-backup-$(date +%Y%m%d).tar.gz src/DataFiles/ storage/
```

---

## 10. Glossary

This section explains the German telecom-specific terminology used throughout DocPilot.

---

### Aufmass
**German for:** Measurement / Survey

**Context in DocPilot:** The main data table where all cable runs and addresses are recorded. Each row represents one "trasse" (cable route) or address. This is the central source of truth for the entire project.

**In a real project:** Field technicians record measured cable lengths, address data, hardware information, and completion statuses here.

---

### Einblasen
**German for:** Blowing in

**Context in DocPilot:** The process of installing fiber-optic cables into conduits (Leerrohre) by blowing them in with compressed air. A blowing machine pushes the cable through the pipe at high speed.

**In a real project:** After conduits are laid, a crew with a "Einblasgerät" (blowing machine) feeds the fiber cable in. They record the date and a measurement PDF (showing cable length, tension, etc.).

---

### APL
**German for:** Abschlusspunkt Linie (Line Termination Point)

**Context in DocPilot:** The point where the fiber cable terminates at/in a building or property — typically a small outdoor or indoor box mounted on the wall where the fiber transitions from the distribution cable to the premises installation.

**In a real project:** A technician visits each property, installs the APL box, makes the fiber splice connection, and photographs the result (4 required photos: Metrierung, APL Box, Splices, Inside APL).

---

### Druckprüfung
**German for:** Pressure test

**Context in DocPilot:** A quality check performed on conduit pipes (Leerrohre) before fiber is blown in. Compressed air is pumped in to verify the pipe is sealed and has no leaks.

**In a real project:** A technician pressurizes the pipe to a specified pressure (e.g., 1 bar) and monitors for pressure drop over time. The result is documented in a PDF report.

---

### Kalibrieren
**German for:** Calibrating / Cleaning

**Context in DocPilot:** The process of cleaning and calibrating conduit pipes before fiber installation. A calibrating plug (same diameter as the fiber cable) is pulled or pushed through the pipe to check the inner diameter and clear any obstructions.

**In a real project:** If the calibration plug passes cleanly, the pipe is ready for fiber blowing. Result documented in a PDF.

---

### OTDR
**English acronym for:** Optical Time Domain Reflectometer

**Context in DocPilot:** A test instrument used to measure fiber-optic cable quality. It sends pulses of light into the fiber and analyzes the reflected light to find faults, measure length, and check splice quality.

**In a real project:** After fiber is installed and spliced, an OTDR test is performed at each NVT/knotenpunkt. Results are saved as `.sor` files (OTDR data format) or PDF reports. OTDR status auto-triggers to "Waiting" when APL and Knotenpunkt preparation are both complete.

---

### Knotenpunkt (NVT / SCT)
**German for:** Node point / Junction point

**Context in DocPilot:** A distribution point in the fiber network where cables from multiple addresses are joined. Typically a cabinet or enclosure mounted on a utility pole, in a pit, or on a building wall.

**NVT = Netzverteiler Terminal** (Network Distribution Terminal) — the cabinet/box
**SCT = Spleißcontainer** (Splice Container) — a larger splice enclosure

**In a real project:** At each NVT, cables from multiple buildings are spliced together. A technician prepares the NVT (installs hardware, routes cables), then performs splicing. This work is documented with photos and an OTDR test.

---

### Cluster
**Context in DocPilot:** A geographic or organizational grouping of knotenpunkte within a project. Projects are divided into clusters, each cluster contains multiple NVTs, and each NVT serves multiple addresses.

**Hierarchy:**
```
Project → Cluster → Knotenpunkt (NVT) → Address
```

**Example:**
```
Laich-Suppingen
└── Cluster-A
    ├── NVT-001 (serves Hauptstr 13-25)
    ├── NVT-002 (serves Bahnhofstr 1-15)
    └── NVT-003 (serves Gartenweg 1-9)
└── Cluster-B
    ├── NVT-004
    └── NVT-005
```

---

### Trasse
**German for:** Cable route / trench route

**Context in DocPilot:** The physical path along which the conduit (Leerrohr) is laid — typically a trench in the ground, along a building façade, or through existing infrastructure.

---

### Leerrohr
**German for:** Empty pipe / conduit

**Context in DocPilot:** The plastic pipe installed in the ground (or along walls) through which fiber-optic cables are later blown. "Leer" means empty — the pipe is installed first, cables are added later.

---

### Splicing / Spleißen
**German/English:** Splicing

**Context in DocPilot:** The process of joining two fiber-optic cables together permanently. A fusion splicer melts the glass fibers together at extremely high temperatures, creating a near-invisible joint.

**"Number of Splices":** The APL module tracks how many splice connections were made at each address. This is cross-checked against the planned count in the Aufmass data.

---

### Metrierung
**German for:** Metering / Length measurement

**Context in DocPilot:** In the APL module, one of the four required photos is a "Metrierung" photo — a picture showing the cable length measurement at the APL point (typically a measurement sticker on the cable showing the length from the NVT to this address).

---

### Eigentümer
**German for:** Owner / Proprietor

**Context in DocPilot:** The property owner at an address. The APL module displays Eigentümer data (name, phone, email) pulled from the Aufmass table, making it easy for field technicians to contact property owners directly from their phone.

---

### Doku
**German for:** Documentation (short for Dokumentation)

**Context in DocPilot:** The top-level folder inside each project's storage. All module-specific files live under `Doku/` (e.g., `Doku/Cluster-A/APL/NVT-001/`).

---

### Pläne
**German for:** Plans / Blueprints

**Context in DocPilot:** The `Pläne/` folder within a project's storage is for project plan files (e.g., network topology maps, installation drawings, CAD files, PDFs).

---

### GeoCam
**Context in DocPilot:** A custom camera overlay built into the app (`src/js/geocam.js`). When a field technician taps "Take Photo", the GeoCam overlay:
1. Opens the device camera in fullscreen
2. Fetches the current GPS location
3. Reverse-geocodes it to a street address using Nominatim
4. Embeds the location and timestamp as a text overlay on the captured photo

Photos taken with GeoCam do NOT get the `_U` (Upload) suffix. Photos uploaded from the device gallery DO get the `_U` suffix.

---

### WebDAV
**Full name:** Web Distributed Authoring and Versioning

**Context in DocPilot:** The protocol used to sync files to the NAS. WebDAV extends HTTP to support file operations (create, read, update, delete, copy, move). Most NAS devices (UGREEN, Synology, QNAP) have built-in WebDAV servers.

---

### JWT (JSON Web Token)
**Context in DocPilot:** The authentication mechanism. After login, the server issues a JWT that proves your identity. The token is stored in `localStorage` and automatically sent with every API request by `api.js`.

---

### ACL (Access Control List)
**Context in DocPilot:** The permission system that controls which users can see and do what. Stored in `src/DataFiles/access-control.json`. Configured by the superadmin via the Admin Panel.

---

*End of DocPilot Documentation*

---

## Changelog

### V2.6 — UI Redesign (2026-05-12)

This release is a full UI overhaul across all 17 HTML pages. No backend logic or API changes — purely frontend.

#### Design System: Industrial Modern

A new, consistent design system was applied across the entire application:

| Token | Value | Usage |
|-------|-------|-------|
| **Sidebar background** | `#022448` (dark navy) | Sidebar panel on all pages |
| **Content background** | `#F8FAFC` (off-white) | Main content area |
| **Accent color** | `#fea619` (amber) | Buttons, active states, highlights |
| **Primary font** | Inter (Google Fonts) | All body text and UI labels |
| **Icon set** | Material Symbols Outlined | All icons throughout the app |

#### Pages Redesigned

All **17 HTML pages** were redesigned with the new system:

1. `index.html` — App hub / routing gate
2. `login.html` — Login form
3. `register.html` — Registration + OTP flow
4. `dashboard.html` — Project list and hub
5. `aufmass.html` — Main data table
6. `einblasen.html` — Cable blowing module
7. `apl.html` — APL / line termination module
8. `druckprufung.html` — Pressure test module
9. `kalibrieren.html` — Calibration module
10. `knotenpunkt-vorbereitung.html` — Node preparation module
11. `otdr.html` — OTDR test module
12. `planner.html` — Appointment calendar
13. `files.html` — File browser
14. `profile.html` — User profile
15. `new-project.html` — Project creation wizard
16. `admin.html` — Admin control panel
17. `superlog.html` — System log viewer

#### Key Design Decisions

**Mobile-first approach:**
- All pages designed for mobile use first, then scaled up for desktop
- 48px+ tap targets on all interactive elements (buttons, nav links, upload zones)
- Large, thumb-friendly upload zones for field technicians working outdoors
- Bottom navigation bar on all pages for one-thumb mobile access

**Layout structure:**
- Desktop: Fixed dark navy sidebar (left) + light content area (right)
- Mobile: Bottom navigation bar (replaces sidebar) + full-width content
- Consistent header with project name, back button, and user avatar

**Glassmorphism — controlled usage:**
- Glassmorphism effects (frosted glass, backdrop-blur) restricted to **modals only**
- All other UI uses solid, clean surfaces for readability in bright outdoor light

**Status badge system (standardized):**

| Status | Color | Hex |
|--------|-------|-----|
| Done | Green | `#16a34a` |
| Pending | Grey | `#6b7280` |
| Waiting | Blue | `#2563eb` |
| Error | Red | `#dc2626` |

**Design tokens applied consistently across all pages** — no page uses one-off color values. All colors reference the design system variables.

#### Other Changes in V2.6

- **`BUGS.md` created** — A running log of known issues discovered during the redesign. Located at `/BUGS.md` in the repo root. Issues are categorized by page and include severity ratings. Nothing was fixed in this sprint — bugs are logged for the next development cycle.
- **Repo renamed:** `TheApp` (GitHub: `rishi-dumps-here/DataManagement`) → **`Docpilot-V3`** (GitHub: `git@github.com:darkinterstellar2-crypto/Docpilot-V3.git`). All future commits go to the new remote.
- **Worker-optimized UX:** UI decisions throughout prioritize field-use scenarios — large text, high contrast, minimal gestures required.
- **Clear status indicators** prominently displayed at the top of each address view, not buried in forms.

---

> **Last updated:** V2.6 — 2026-05-12 (UI Redesign Sprint)
> **For questions or updates:** Check the source code in `routes/`, `controllers/`, and `src/js/`.

# DocPilot V3 — Complete Documentation

**Version:** V3.7.1  
**Last Updated:** June 2026  

DocPilot is a full-stack field operations management platform built for German fiber optic (FTTX) construction crews. It enables teams to track, document, and manage every phase of fiber optic installation — from cable blowing (Einblasen) to splice verification (OTDR testing) — with per-project file storage, role-based access control, real-time chat, and an optional AI assistant.

---

## Table of Contents

| # | Document | Description |
|---|----------|-------------|
| 1 | [Getting Started](./getting-started.md) | Prerequisites, installation, environment setup, first run, Docker deployment |
| 2 | [Architecture](./architecture.md) | Overall architecture, tech stack, folder structure, request flow |
| 3 | [Authentication](./authentication.md) | Login/register flow, JWT handling, OTP verification, 2FA, session management |
| 4 | [Access Control](./access-control.md) | ACL system, roles, permissions, the `access-control.json` structure |
| 5 | [API Reference](./api-reference.md) | Every API endpoint — method, path, auth, request/response |
| 6 | [Database & Data Storage](./database.md) | JSON file storage, SQLite chat DB, data file format, schema |
| 7 | [Work Modules](./modules.md) | Each field module: Aufmass, Einblasen, Druckprüfung, APL, OTDR, Kalibrieren, Knotenpunkt-Vorbereitung |
| 8 | [Projects](./projects.md) | Project creation, folder structure, project data, clusters, Knotenpunkte |
| 9 | [File Management](./file-management.md) | File browser, upload, download, trash, share links, WebDAV/NAS sync |
| 10 | [AI Integration (DoBo)](./ai-integration.md) | DoBo AI assistant — architecture, controllers, security, memory, cost tracking |
| 11 | [Frontend](./frontend.md) | Frontend architecture, shared JS modules, CSS/Tailwind, design system |
| 12 | [Deployment](./deployment.md) | Docker, Caddy/Traefik reverse proxy, environment variables, production setup |
| 13 | [Admin Panel](./admin.md) | Admin panel, super log, user management, settings, session management |
| 14 | [Teams](./teams.md) | Teams system — CRUD, members, team pictures |
| 15 | [Planner & Calendar](./planner.md) | Appointment scheduling, calendar, termin columns |
| 16 | [Logging](./logging.md) | Three-tier logging: action logs, super logs, session logs |
| 17 | [Internationalization](./i18n.md) | English/German language toggle system |
| 18 | [Security](./security.md) | Security measures: rate limiting, path traversal prevention, input validation, CORS |
| 19 | [Data Versioning](./data-versioning.md) | Aufmass data versioning, Excel export, optimistic locking |
| 20 | [Troubleshooting](./troubleshooting.md) | Common issues, debugging tips, known limitations |

---

## Quick Start

```bash
# Clone the repository
git clone git@github.com:darkinterstellar2-crypto/Docpilot-V3.git
cd Docpilot-V3

# Install dependencies
npm install

# Copy environment file and configure
cp .env.example .env
# Edit .env with your settings

# Start the server
npm start
# → Server running at http://localhost:3000
```

See [Getting Started](./getting-started.md) for detailed setup instructions.

---

## Key Concepts

- **Project** — A fiber optic construction project (e.g., a city/region build-out). Contains clusters, Knotenpunkte, and addresses.
- **Cluster** — A geographical grouping within a project (e.g., a neighborhood or sector).
- **Knotenpunkt (NVT)** — A network junction point within a cluster. Each Knotenpunkt has multiple addresses.
- **Address** — A single fiber optic connection point (street address). Each address goes through multiple work modules.
- **Module** — A work phase: Einblasen (fiber blowing), Druckprüfung (pressure test), Kalibrieren (calibration), APL (splicing), OTDR (testing), Knotenpunkt-Vorbereitung (junction prep).
- **Aufmass** — The master data table tracking all addresses and their status across all modules.
- **DoBo** — The built-in AI assistant (Document Bot).

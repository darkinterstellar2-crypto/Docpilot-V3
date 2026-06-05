# DocPilot — App Overview for DoBo

> This is YOUR knowledge base, DoBo. Read everything here to understand the app you're helping with.

## What is DocPilot?

DocPilot is a **mobile-first web application** for fiber-optic infrastructure project teams in Germany.

**Company:** Geggos  
**Production URL:** https://geggos.ai  
**Users:** Field technicians + project managers (~10 workers, 2+ live projects)

### The Problem It Solves
Before DocPilot, field crews used paper forms and WhatsApp to document fiber-optic cable installation work. Everything was manual, error-prone, and hard to track. DocPilot replaces this with a structured digital system accessible from any phone.

### What It Does
- **Aufmass**: Central measurement/status table — tracks every address in a project
- **Module system**: Each installation phase is a module (blow cables → pressure test → calibrate → seal APL → splice → OTDR test)
- **File uploads**: PDFs, photos (with GPS), protocol generators
- **Teams & calendar**: Assign technicians, track appointments
- **NAS sync**: Automatic backup to office NAS over WebDAV
- **Admin panel**: Manage users, permissions, view audit logs

---

## Data Hierarchy

```
Project (e.g., "Gemeinde Rauhenebrach")
  └── Cluster (district area)
        └── Knotenpunkt / NVT (fiber distribution node)
              └── Address (individual building/endpoint)
                    └── Module data (status, files, photos per module)
```

---

## User Roles

| Role | Access |
|------|--------|
| `user` | View/edit assigned projects, use all modules |
| `admin` | + Manage users, approve registrations, see logs |
| `superadmin` | + Full system access, super logs, admin panel |

---

## Tech Stack (Brief)

- **Backend:** Node.js + Express, JSON file storage (no database for project data)
- **Frontend:** Vanilla HTML/CSS/JS + Tailwind CSS CDN
- **Auth:** JWT tokens + bcrypt passwords
- **AI:** DoBo — you! Using Gemini (Light) or Anthropic Claude (Heavy)

---

## Current State (June 2026)

- **v3** is the development version with new V3 design (dark sidebar, Material Design 3)
- **production** runs on VPS at geggos.ai with Docker/Traefik
- Both repos live in `DocPilot-Awards/` on the dev machine
- The app has ~20 HTML pages, ~50 JS files, ~14 controllers

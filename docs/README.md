# DocPilot — Documentation

## Structure

```
docs/
  README.md              ← you are here
  architecture/
    overview.md          ← full app architecture, stack, file structure
    server-structure.md  ← VPS deployment, Docker, Traefik
    storage.md           ← storage system, paths, NAS sync
    auth.md              ← authentication flow, registration, rejection
    chat.md              ← project chat system
  changelogs/
    2026-04-05-*.md      ← permissions rework, role consolidation
    2026-04-06.md        ← NAS integration, cloud features
    2026-04-07-*.md      ← excel/table refactor
    2026-04-09-*.md      ← profile, NAS live, appointments, i18n, reject
  api/
    endpoints.md         ← all API endpoints documented
```

## Quick Start

1. Clone the repo
2. `npm install`
3. Create `.env` from `.env.example` and fill in real values
4. `node server.js`
5. Open `http://localhost:3000`

## Environment Variables

See `.env.example` in project root for all required variables.

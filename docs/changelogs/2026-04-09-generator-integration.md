# 2026-04-09 — Generator Integration in Einblasen

## Overview
Integrated the Einblasprotokoll Generator as an embedded iframe within the Einblasen module. Access controlled via admin-configurable code.

## New Files
- `routes/settingsRoutes.js` — Settings CRUD API
- `src/DataFiles/settings.json` — Generator code + URLs config

## Modified Files
- `server.js` — Mount settings routes
- `admin.html` — Generator Settings section (code, frontend URL, API URL)
- `src/js/einblasen.js` — Upload page with code verification, iframe embed, postMessage listener for auto-upload
- `src/js/module-shared.js` — Added `renderUploadFormInto()` method

## Flow
1. **Admin Panel** → Generator Settings → set code (`GEGGOS2026`), frontend URL, API URL
2. **Einblasen** → Upload Work → enter code → Verify
3. Code matches → iframe loads generator with pre-filled params from aufmass
4. User generates data, reviews, clicks "Approve & Send"
5. Generator sends `postMessage` with base64 PDF + start/end meters
6. DocPilot receives → auto-uploads PDF → updates aufmass (status=Done, metrierung, file location)

## API Endpoints
- `GET /api/settings` — Get settings (superadmin only)
- `PUT /api/settings` — Update settings (superadmin only)
- `POST /api/settings/verify-code` — Verify generator code (any authenticated user)

## Pre-fill Params (passed to generator via URL)
`project_id`, `section`, `company`, `fibers`, `pipe_color`, `gps`, `api_url`, `cluster`, `knotenpunkt`, `address`

## PDF Filename Convention
`{Cluster}_{YYYYMMDD}_{HHMMSS}_{AddressStart}_bis_{AddressEnd}.pdf`

## Commits
- `c076233` — Generator integration (settings, admin panel, einblasen iframe, postMessage)
- `4f5a7bf` — API URL configurable
- `3b4488c` — Inline styles fix for code input
- `b052a5a` — Scoping fix for generator settings in admin panel

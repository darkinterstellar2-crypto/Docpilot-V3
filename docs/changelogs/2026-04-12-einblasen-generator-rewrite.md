# 2026-04-12 — Einblasen Generator Integration Rewrite

## Summary
Complete rewrite of the DocPilot ↔ Generator iframe communication. DocPilot controls the generator via postMessage; iframe displays and generates.

---

## Architecture

### Communication Flow
1. **Code verified** → iframe loads once with project params (section, fibers, company, cluster, knotenpunkt)
2. **User types details** → `pushToIframe()` sends `einblas-details-update` postMessage on every keystroke
3. **Generate button** → sends `einblas-command generate` via postMessage → iframe calls `/api/generate` → graph + data appear → `einblas-generated` sent back
4. **Export PDF** → sends `einblas-command export` → iframe downloads PDF
5. **Approve & Send** → sends `einblas-command approve` → iframe generates PDF → sends `einblas-approved` with base64 blob → DocPilot uploads to storage + updates aufmass

### postMessage Types
| Direction | Type | Purpose |
|-----------|------|---------|
| DocPilot → iframe | `einblas-details-update` | Live sync form fields (start/end meter, date, time, color, operator, GPS, remarks, pipe params, cable params, device, compressor, lube) |
| DocPilot → iframe | `einblas-command` | Actions: `generate`, `export`, `approve` |
| iframe → DocPilot | `einblas-generated` | Generation complete (logCount, einblaszeit) |
| iframe → DocPilot | `einblas-generate-error` | Generation failed |
| iframe → DocPilot | `einblas-approved` | PDF blob + meters for upload |

### Stale Closure Solution
Generator uses `useRef` pattern:
- `ref.current` always has latest `formData`, `distance`, `speed`, `logData`, `zeit`
- Single `useEffect([], [])` — handler registered once, reads from refs
- All action functions (`doGenerate`, `doExport`, `doApprove`) read from `ref.current`

---

## DocPilot Changes (`src/js/einblasen.js`)

### Page Structure
1. Upload section (always visible, manual file upload)
2. Generator section (hidden until permission check passes):
   - Code input → verify
   - Details form: Date, Time, Start Meter, End Meter, Metrierung Total (auto-calc), Fiber Colour
   - Advanced Configuration (collapsed `<details>`): Operator, GPS, Remarks, Pipe Mfr/Type/Dim, Cable Mfr, Device/S/N, Kompressor, Gleitmittel
   - Action buttons: Generate, Export PDF, Approve & Send
   - Status message area
   - Iframe (hidden until code verified)

### Button Behavior
- **Generate**: disabled during generation, push details → 150ms delay → send command
- **Export PDF / Approve & Send**: disabled until `einblas-generated` confirmed
- **Approve & Send**: receives PDF blob from iframe, uploads to DocPilot storage, updates aufmass (status=Done, metrierung, file location, date, time)

---

## Generator Changes (`app/page.tsx`)

### Rewritten from scratch
- **154 lines** (down from 274)
- `initFormData()` reads URL params once at mount
- Current date/time as default (not hardcoded)
- Default GPS: `49.8667, 10.5667` (Rauhenebrach)
- Weather auto-fetched from Open-Meteo after generation using GPS + date
- Toolbar still functional (distance, speed slider, generate/export/approve buttons inside iframe)

---

## Commits
| Repo | Hash | Description |
|------|------|-------------|
| generator-web | `a45ac0c` | Rewrite page.tsx |
| generator-web | `d4c3257` | Color + advanced fields + weather |
| generator-web | `efb9130` | Fix variable name collision |
| generator-web | `fb31596` | Default GPS to Rauhenebrach |
| DocPilot | `edfaac8` | Rewrite einblasen generator integration |
| DocPilot | `aebb7f8` | Color + advanced config dropdown |
| DocPilot | `a716e16` | Pre-fill GPS, pass all advanced fields |

## Deploy
```bash
cd /opt/docpilot && git pull && docker compose up -d --build
cd /opt/generator-web && git pull && docker compose up -d --build
```

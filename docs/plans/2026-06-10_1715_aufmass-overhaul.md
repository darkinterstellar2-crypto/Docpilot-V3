# Aufmass Overhaul — Plan

> Date: 2026-06-10 17:15 (Europe/Berlin)
> Author: Cleo (Opus 4.8)
> Repo: Docpilot-V3 (work in V3, local-only until RK approves deploy)
> Goal: Move ONLY the Aufmass data to PostgreSQL + rebuild the Aufmass grid into a
>       highly customizable, Excel-LIKE (not actual Excel), own-built data grid.

---

## 0. Guardrails (non-negotiable)

- **Aufmass-only migration.** Users, projects.json, access-control, chat (SQLite),
  logs, settings, project-info → ALL STAY as flat files. Untouched.
- **Custom build.** No third-party grid library (Handsontable/AG Grid rejected by RK).
  We enhance the existing `src/js/table.js` (already custom). The result must NOT
  look AI-generated — design grounded in real references (see §6).
- **Local-only.** Everything built + tested in /data/.openclaw/workspace/DocPilot/.
  Server is NOT touched until RK explicitly approves deployment.
- **Keep flat-file snapshots.** Continue writing the timestamped `.txt` + `.xlsx`
  versioned copies as a safety net during/after transition.
- **Same API response shape where possible** so we can swap the backend without
  breaking the frontend on day one.

---

## 1. The Data Reality (important)

- Local `storage/` has ONE project folder (`Laich-Suppingen`) but its Aufmass
  `.txt` is **0 bytes** (empty). We have the schema template (`src/DataFiles/schema.json`)
  but **no real row data locally**.
- Real field data lives only on the server (in the `geggos-storage` Docker volume,
  mounted at /data/storage inside the container).

**Decision needed from RK:**
- **(B) Build against realistic generated data now** (recommended) — Cleo generates a
  believable German fiber dataset matching the exact schema, builds + tests everything,
  then we dry-run against REAL server data only at deploy time to confirm the parser.
- **(A) RK provides one real `.txt`** — most accurate, but blocks progress until supplied.

Plan assumes **(B)** for building, with **(A) validation before any real migration**.

---

## 2. Current Aufmass Format (what we're migrating FROM)

File: `storage/<Project>/Doku/Aufmass/datafile/<Project>.txt` (JSON, UTF-8)

```
rawData = [E1, E2]
E1 = ["Identification", "Timing", "Location", ...]        // group titles
E2 = [E2_0, row1, row2, ...]
E2_0 = [["Unique Project ID","Metadata"], ["Date"], ["Cluster","NVT"], ...]  // sub-cols per group
rowN = [["ROW-ID",""], ["2026-01-15"], ["Cluster1","NVT-001"], ...]          // values per group
row[0][0] = unique row id (used for optimistic locking)
```

Schema template groups (from schema.json): Timing, Location, Address, Hardware,
LWL Specs, Einblasen, Kalibrieren, Druckprüfung, APL Splicing, OTDR Testing, Notes.
Status columns flagged `isBadge: true`.

---

## 3. New Database Model (what we migrate TO)

Two tables. Aufmass-only. JSONB for flexibility (add/retype/reorder columns with
no schema migration). Single-tenant: a hardcoded TENANT_ID filter in the app layer
(no RLS complexity needed for one tenant — we learned that lesson in V3.6).

### Table: `aufmass_schema` (one row per project) — the blueprint
```
id              UUID PK
project_name    TEXT  (FK-by-name to flat projects.json; unique)
schema_json     JSONB  -- array of groups, each group has columns w/ rich metadata
version         INTEGER  -- bumped on schema change
updated_at      TIMESTAMPTZ
updated_by      TEXT
```

**`schema_json` per-column metadata (this is what makes it "Excel-like customizable"):**
```json
{
  "id": "col-ein-status",
  "label": "Status",
  "group": "Einblasen",
  "type": "status",          // text | number | date | dropdown | status | checkbox | currency
  "options": ["Done","Pending","Waiting","Error","N/A"],   // for dropdown/status
  "format": { "decimals": 2, "unit": "m", "dateFormat": "DD.MM.YYYY" },
  "validation": { "required": false, "min": null, "max": null },
  "display": { "width": 140, "align": "left", "frozen": false, "hidden": false,
               "color": null, "bold": false },
  "totals": "none"           // none | sum | avg | count  (footer roll-up)
}
```

### Table: `aufmass_row` (many rows per project) — the data
```
id            UUID PK
project_name  TEXT  (indexed)
row_id        TEXT  -- preserves the original ROW-ID for continuity
cells         JSONB -- { "col-date": "2026-01-15", "col-cluster": "C1", ... }
sort_order    INTEGER
version       INTEGER  -- optimistic locking (replaces row-versions.json)
created_at    TIMESTAMPTZ
updated_at    TIMESTAMPTZ
updated_by    TEXT
```

Indexes: `(project_name, sort_order)`, GIN on `cells` for future search/filter.

Why JSONB: columns are user-defined and change over time. A rigid column-per-field
table would need a migration every time a user adds a column. JSONB lets the schema
table define structure and the row table just stores a flexible key→value bag.

---

## 4. Infrastructure (Docker)

DocPilot runs as a single container behind Traefik. Add a sibling postgres container.

- `docker-compose.yml`: add `docpilot-postgres` (postgres:16-alpine), own volume
  `docpilot-pgdata`, healthcheck, `depends_on` wiring.
- `controllers/db.js`: pg Pool, connects via DATABASE_URL = host `docpilot-postgres`.
- `.env`: add `DATABASE_URL`, `PG_PASSWORD`, `TENANT_ID` (single canonical value).
- Schema created by ONE SQL file (`migrations/aufmass-schema.sql`) — just the 2 tables
  + indexes. No RLS, no 22-table multi-tenant complexity. Aufmass-only = simple.

---

## 5. Backend Changes

- **`controllers/aufmassStore.js`** (NEW) — the data access layer. Functions:
  `getSchema(project)`, `saveSchema(project, schemaJson, user)`,
  `getRows(project)`, `saveRows(project, rows, user)`, `updateCell(...)`,
  `addRow / deleteRow / reorderRows`, `addColumn / removeColumn / reorderColumns`.
  Also writes the legacy `.txt` + `.xlsx` snapshot (fire-and-forget) for backup.
- **`routes/dataRoutes.js`** — swap flat-file reads/writes for `aufmassStore` calls.
  Keep the SAME response shape (`{ schema, data, rowVersions }`) so `table.js`
  keeps working during transition, then we extend it.
- **Optimistic locking** moves from `row-versions.json` to the `version` column.
- **OTDR auto-trigger** logic preserved (APL Done + Knoten Done → OTDR Waiting).

---

## 6. Frontend — The Excel-Like Grid (the visible overhaul)

Rebuild `src/js/table.js` into a customizable grid. Scope = **Tier 1 + Tier 2**
(structure, types, sort, filter, totals). Formulas/conditional-format = later.

### Features (Tier 1 + 2)
**Structure & types**
- Add / remove / rename columns and groups inline
- Per-column data types: text, number, date, dropdown, status, checkbox, currency
- Custom dropdown lists per column (managed in a column settings popover)
- Drag to reorder columns; drag to reorder rows
- Column resize (drag handle on separator)
- Show / hide columns; freeze first column(s) + sticky header

**Data power**
- Sort by any column (asc/desc, click header chevron)
- Filter: global search + per-column filter
- Footer roll-up row: sum / avg / count per column
- Display density toggle (Condensed 40px / Regular 48px / Relaxed 56px)
- State preservation (per browser session) + "Reset to default" view

### Design principles (grounded in real UX sources, NOT generic AI look)
Sourced from Pencil&Paper enterprise data-table analysis + Linear/Notion/Airtable patterns:
- **Alignment:** text left-aligned; quantitative numbers right-aligned w/ tabular
  (monospace) figures; dates left-aligned. Headers match their column alignment.
- **Dividers:** NO zebra stripes (they conflict with hover/selected/edit states).
  Use a single 1px light divider that "melts into the background." Optional thin
  vertical separators only where grouping needs it.
- **Density presets:** 40/48/56px rows, user-switchable, icon switcher OUTSIDE the table.
- **Sticky:** header always sticky; first column frozen on horizontal scroll; footer
  roll-up row sticky at bottom.
- **Hover-revealed actions:** keep the UI calm — show row checkbox, row drag handle,
  and the column "⋯" menu only on hover. Discoverability without clutter.
- **Inline edit affordance:** text cursor + subtle cell focus ring on hover; confirm
  on Enter / blur; Esc cancels. Inline checkmark micro-confirm on save.
- **Keyboard nav:** Tab / Shift-Tab between cells, Enter to next row, arrow keys move
  selection, type-to-edit. (Excel muscle memory without being Excel.)
- **Status cells:** colored pill badges (Done=green, Pending=amber, Waiting=blue,
  Error=red, N/A=grey) — ties into existing `isBadge` flag + navy/amber system.
- **Micro-interactions:** smooth 120–160ms ease transitions on hover/focus/sort;
  no bouncy/over-animated effects. Restraint = looks designed, not AI-generated.
- **Color system:** stay on DocPilot's navy #022448 / amber #fea619 / slate neutrals.
  Accent (amber) used sparingly for active sort, selected cell, primary action only.
- **Empty + loading states:** real skeleton rows on load; a proper empty state
  ("No rows yet — add your first measurement") not a blank void.

### Column settings popover (the "customizable" heart)
Click a column's "⋯" → popover with: rename, pick type, edit dropdown options,
set alignment/width, toggle freeze/hide, choose footer roll-up (sum/avg/count),
delete column. This is where Excel-like power lives without looking like Excel.

---

## 7. Build Phases (subagents, Sonnet 4.6, 30-min each, sequential where dependent)

- **Phase 0 — DB foundation:** docker-compose postgres service, `db.js`,
  `migrations/aufmass-schema.sql` (2 tables + indexes), `.env` additions. Verify db.js loads.
- **Phase 1 — Migration script (aufmass-only):** `scripts/migrate-aufmass-to-pg.js`
  reads each project's `.txt`, parses nested format → schema_json + rows. `--dry-run`
  prints per-project counts, rolls back. Build against generated data (option B).
- **Phase 2 — Backend:** `aufmassStore.js` + rewire `dataRoutes.js`. Keep `.txt`/`.xlsx`
  snapshot writes. Same API shape. Node syntax + smoke test.
- **Phase 3 — Frontend grid:** rebuild `table.js` with Tier 1+2 features + the design
  principles above. New `aufmass-grid.css`. This is the big visual phase.
- **Phase 4 — Column settings + polish:** the per-column popover, density toggle,
  totals row, state preservation, empty/loading states.

Each phase: read real code first, build, test, then `git pull → commit → push` to V3.

---

## 8. Risks & Mitigations
- **No real local data** → build against generated data, validate against real `.txt`
  via dry-run before any actual migration. (RK to supply one real file at that point.)
- **API shape drift** → keep `{schema,data,rowVersions}` response stable through Phase 2.
- **Looking AI-generated** → explicit design principles in §6 from real sources;
  restraint over flashiness; DocPilot's existing color system, not new gradients.
- **Production safety** → local-only; server untouched; flat-file snapshots retained.

---

## 9. Open Decisions for RK (before build starts)
1. **Data:** confirm Option B (generate data now, validate real later)? [recommended]
2. **Scope:** confirm Tier 1+2 today, formulas/conditional-format later? [recommended]
3. **Deploy:** confirm local-only, no server touch until explicit go? [yes per your rule]
4. Anything design-wise you want me to specifically reference or avoid?

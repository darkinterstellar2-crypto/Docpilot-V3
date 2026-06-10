# QA Report — Aufmass Overhaul (Backend + Frontend)

> Reviewer: Cleo (Opus 4.8), independent pass — verified files directly, not trusting subagent reports.
> Date: 2026-06-10 ~18:00
> Commits reviewed: 60f60f2 (backend), 7b524bc (frontend)

## Verdict: SOLID. Ready for RK to test locally. One real inconsistency flagged (minor, non-blocking).

---

## What was verified (evidence-based)

### Backend (commit 60f60f2)
- ✅ All files present: db.js, aufmassStore.js, migrate-aufmass-to-pg.js, aufmass-schema.sql
- ✅ `node --check` passes on all changed JS
- ✅ **Parser tested against the REAL 280-row file** (Gemeinde-Rauhenebrach):
  - 280 rows, 12 groups, 30 columns parsed correctly
  - Stable semantic IDs generated (col-location-cluster, col-splicing-apl-status…)
  - Type inference correct: statuses→status pills, dates→date, LWL/splices/metrierung→number, cluster/knoten/fiber/type→dropdown
  - Identification group hidden by default
- ✅ aufmassStore uses the SAME stable IDs the migration creates (round-trips correctly)
- ✅ API response shape `{success, schema, data, rowVersions}` preserved on BOTH paths
- ✅ moduleRoutes reads aufmass via aufmassStore (DB-first, .txt fallback); file-upload logic untouched

### Frontend (commit 7b524bc)
- ✅ table.js (1981 lines) + aufmass-grid.css (830 lines), node --check passes
- ✅ **No positional col-x-y addressing in table.js** — all by stable col.id
- ✅ Data contract matches backend exactly (schema.cols, data rows with _id/_version, cells by col.id)
- ✅ Design principles implemented & verified in CSS:
  - zebra stripes actively KILLED (nth-child override → flat bg)
  - 120/140/160ms easings present
  - navy #022448 / amber #fea619 tokens present
  - all 5 status pill classes present
- ✅ module-shared.js / new-project.js / dashboard.js still compatible (read schema generically)

---

## 🚩 FLAGGED — real inconsistency (minor, non-blocking, fix later)

**Two different column-ID schemes depending on migration status:**
- Legacy `.txt` fallback path (dataRoutes.js ~line 191) builds **positional IDs**: `col-${i}-${j}` (e.g. `col-2-0`)
- DB/migrated path builds **stable semantic IDs**: `col-location-cluster`

**Consequences:**
1. RK's Q1 goal ("kill the col-1-2 gymnastics") is only fully achieved AFTER a project is migrated to DB. Pre-migration, the fallback still uses positional IDs.
2. Per-column view state (widths, hidden, sort, totals) is saved in localStorage keyed by col.id. When a project flips from .txt→DB, saved view-state keys won't match → silently lost (cosmetic only; data is fine).

**Why non-blocking:** The fallback is transitional. Once a project is migrated, everything uses stable IDs. Data integrity is never at risk — this only affects saved view preferences across the migration boundary.

**Recommended fix (later):** make the legacy fallback build the SAME stable IDs as the migration (reuse the slugify/buildSchemaJson logic in the fallback). ~30 min job. Not urgent.

---

## Other honest notes (from subagent, confirmed reasonable)
- Cross-group column drag not supported (within-group only). Tier 3.
- Freeze = first column only (no per-column freeze toggle yet). Tier 3.
- "Type" columns (Kalibrieren/Druckprüfung/OTDR) inferred as dropdown — change to text if preferred (1-liner).
- No browser test env here — pure logic verified against real data; visual/interaction testing is RK's local step.

---

## Bottom line
Backend transform is proven correct on real data. Frontend contract matches, design rules are actually implemented (not just claimed), no positional addressing, no breakage in module pages. The one flagged inconsistency is transitional and cosmetic. **Green light for local testing.**

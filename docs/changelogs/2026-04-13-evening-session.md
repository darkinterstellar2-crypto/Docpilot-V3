# DocPilot Changelog - 2026-04-13 Evening Session

## Commits: a4ad148 → 8934e2b

### Done Dates System (a4ad148 → a553d4e)
- **Search bar + filters** added to Einblasen and APL address lists (text search, date filter, status filter)
- **Done dates** displayed next to Done badge in green: `● DD.MM.YYYY, HH:MM`
- **Multiple iterations** to find correct data source:
  - Timing columns are APL-only, not Einblasen
  - File path was wrong (`Cluster/Einblasen/BB/Knotenpunkt/` vs actual `Cluster/Einblasen/Knotenpunkt/`)
  - Final approach: new `Einblasen-Date` column (col-6-4) populated from filenames
- **Filename format discovered**: `{Cluster}_{YYYYMMDD}_{HHMMSS}_{Knotenpunkt}_bis_{Address}.pdf`
- **Date extraction**: Parsed directly from filename, no dependency on file system mtime
- **File location column** (col-6-2): Now stores full path to latest uploaded file
- **Backfill endpoint**: `POST /api/modules/backfill-einblasen-dates` scans existing files and populates empty Einblasen-Date + file location columns (superadmin only)
- **51/52 existing Done addresses backfilled** via browser API (Weinleite 12 has no file)

### Error-Reporting System (99ced1a)
- **New column**: `Error-Reporting` in Notes group stores persistent error log
- **Format**: `EB:description;` for Einblasen, `APL:description;` for APL
- **Fixed errors**: Marked with `#` before `;` (e.g., `EB:cable broke#;`)
- **Report Error**: Now prompts for description text (was just a confirm dialog)
- **Clear Error**: Marks latest unfixed entry as fixed, only clears status if all entries fixed
- **Error history**: Shown on choice screen with active errors (red) and fixed errors (green)
- **Delete-all-files**: Also cleans related error log entries (EB: or APL: prefix)
- **Separator guard**: Ensures `;` delimiter even if field was manually edited

### Bug Fixes
- **Address matching** (b1bfe6d): `Mühlleite-1` no longer matches `Mühlleite-10/15/17/19` (boundary check)
- **Download links** (99ced1a): Split `path` and `file` params correctly for `/api/files/download`
- **Recycle bin** (b1bfe6d): NAS-only files (cleaned from VPS after 48h) can now be deleted (fetches from NAS first)
- **File location lookup** (a553d4e): Was searching for wrong column label `einblasen file location` instead of `file location`
- **Regex anchoring** (8934e2b): `replace('#','')` could strip `#` from error description text
- **Timestamp comparison** (8934e2b): Filename timestamps (20240101120000) vs Unix ms were incomparable
- **Status mutation** (8934e2b): try/finally around upload form status trick to prevent data corruption on error
- **Bogus Error status**: Cleared Schindelsee 1a (ROW-220) which had Error with no actual error reported

### Data Cleanup
- Stopped writing to Timing columns on Einblasen upload (those are APL-only)
- Now writes to Einblasen-Date and file location columns in Einblasen group

### Aufmass Columns (Einblasen Group - Gemeinde Rauhenebrach)
| Column ID | Label | Purpose |
|-----------|-------|---------|
| col-6-0 | Status Einblasen | Done/Pending/Error |
| col-6-1 | Metrierung total | Cable metering |
| col-6-2 | file location | Path to latest uploaded file |
| col-6-3 | Einblasen-Termin | Appointment date |
| col-6-4 | Einblasen-Date | Work completion date from filename |

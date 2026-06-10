# Data Versioning

**File:** `controllers/dataVersioning.js`

## Automatic Versioning

Every time Aufmass data is saved (via `dataRoutes.js` or `moduleRoutes.js`), two versioned copies are automatically created:

### 1. Versioned .txt Copy

```
storage/<Project>/Doku/Aufmass/datafile/<ProjectName>_YYYYMMDD_HHMMSS.txt
```

This is an exact copy of the saved data in the same JSON format as the main data file.

### 2. Excel Export

```
storage/<Project>/Doku/Aufmass/xlsx/<ProjectName>_YYYYMMDD_HHMMSS.xlsx
```

The Excel file contains:
- **Row 1:** Main group headers (merged across sub-columns)
- **Row 2:** Sub-column headers
- **Row 3+:** Data rows

## Reading Behavior

When loading data (`dataRoutes.js` and `moduleRoutes.js`), the system reads the **latest versioned file** (by timestamp in filename), falling back to the base `<ProjectName>.txt` if no versioned files exist.

This means:
- The base file is the canonical "always exists" copy
- Versioned files are the actual source of truth for reads
- If NAS has cleaned old versions, `nasOnDemand.js` transparently fetches them back

## Optimistic Locking

**Storage:** `storage/<Project>/row-versions.json`

Prevents concurrent edit conflicts:

```json
{
  "ROW-0": 5,
  "ROW-1": 3,
  "ROW-7": 12
}
```

### How It Works

1. Client fetches data → each row includes `_version` from `row-versions.json`
2. Client saves changes → sends `_version` for each modified row
3. Server compares client version vs. stored version
4. If they match: save succeeds, version incremented
5. If they don't match: `409 Conflict` response:

```json
{
  "success": false,
  "conflict": true,
  "message": "1 row(s) were modified by another user. Please refresh the page.",
  "conflicts": [
    { "rowId": "ROW-7", "serverVersion": 13, "clientVersion": 12 }
  ]
}
```

### Scope

Optimistic locking applies to:
- Full table saves (`POST /api/data`)
- Single-row module updates (`POST /api/modules/aufmass-update`)

## NAS Sync Integration

- Versioned `.txt` copies are synced to NAS via `syncFile()` (fire-and-forget after each save)
- NAS cleanup preserves the **latest** versioned `.txt` per project (never cleans the newest one)
- The base `<ProjectName>.txt` is **never** cleaned from local storage
- Excel exports are synced to NAS on the next full sync cycle

## Cell-Level Diff Logging

When data is saved, the system computes a cell-level diff against the previous version:

```
Row "ROW-7" | Cluster: SUPPN | Knotenpunkt: NVT-001
  - "Einblasen Status": "" → "Done"
  - "LWL Count": "12" → "24"
  - [OTDR auto-triggered → "Waiting"]
```

This diff is written to the action log (`logs.json`) and includes:
- Row ID and context (cluster, Knotenpunkt)
- Column label and old → new values
- OTDR auto-trigger annotations

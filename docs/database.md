# Database & Data Storage

DocPilot does NOT use a traditional database server. All data is stored in JSON files (for structured data) and SQLite (for chat messages only).

## JSON File Storage

All JSON data files live in `src/DataFiles/`. They are read/written directly by the controllers.

### users.json

User accounts. Each entry:

```json
{
  "id": "1718000000000",
  "name": "Max Mustermann",
  "username": "max",
  "email": "max@example.com",
  "password": "$2b$12$hashedpassword...",
  "role": "user",
  "isVerified": true,
  "isApproved": true,
  "avatar": "/api/profile/avatar/1718000000000.jpg",
  "twoFAEnabled": false,
  "createdAt": "2026-01-15T10:00:00.000Z"
}
```

- `id`: Timestamp-based string ID
- `role`: Either `"superadmin"` or `"user"` (no other values)
- `password`: bcrypt hash (auto-migrated from plain text on first login)
- `isVerified`: Set to `true` after OTP verification
- `isApproved`: Set to `true` after admin approval (superadmin is always approved)

### projects.json

List of all projects:

```json
[
  {
    "id": "1718000000000",
    "name": "ProjectName",
    "locations": ["Cluster-1", "Cluster-2"],
    "status": "Active",
    "progress": 0,
    "createdAt": "2026-03-01T12:00:00.000Z"
  }
]
```

- `locations`: Array of cluster names (created during project setup)
- `status`: User-defined string (typically "Active", "Completed", "On Hold")

### access-control.json

See [Access Control](./access-control.md) for the full structure.

### schema.json

Default Aufmass column schema used as a template for new projects. Defines the column groups and their sub-columns:

```json
[
  {
    "id": "grp-timing",
    "title": "Timing",
    "cols": [{ "id": "col-date", "label": "Date" }]
  },
  {
    "id": "grp-location",
    "title": "Location",
    "cols": [
      { "id": "col-cluster", "label": "Cluster" },
      { "id": "col-nvt", "label": "NVT" }
    ]
  },
  ...
]
```

The default schema includes groups: Timing, Location, Address, Hardware, LWL Specs, Einblasen, Kalibrieren, Druckprüfung, APL Splicing, OTDR Testing, Notes.

### project-info.json

Project metadata (descriptions, custom fields, member lists):

```json
{
  "ProjectName": {
    "description": "Fiber optic build-out in Munich North",
    "fields": [
      { "label": "Client", "value": "Deutsche Telekom" },
      { "label": "Contract #", "value": "DT-2026-0042" }
    ],
    "members": ["user1@example.com", "user2@example.com"]
  }
}
```

### settings.json

App-level settings (currently only generator access):

```json
{
  "generatorCode": "secret-code",
  "generatorUrl": "https://generator.example.com",
  "generatorApiUrl": "https://api.generator.example.com",
  "generatorAllowedUsers": ["user@example.com"]
}
```

### logs.json

Action log (last 1000 entries, newest first):

```json
[
  {
    "id": "1718000000000",
    "timestamp": "2026-06-01T14:30:00.000Z",
    "user": "admin@example.com",
    "action": "Data Saved",
    "details": "Row \"ROW-7\" | Cluster: SUPPN | Knotenpunkt: NVT-001\n  - \"Status\": \"\" → \"Done\""
  }
]
```

### super-log.json

System event ring buffer (max 5000 entries). See [Logging](./logging.md).

### sessions-log.json

Login/logout events with device info:

```json
[
  {
    "email": "user@example.com",
    "name": "Max",
    "action": "login",
    "timestamp": "2026-06-01T14:30:00.000Z",
    "ip": "192.168.1.100",
    "userAgent": "Mozilla/5.0...",
    "device": "Chrome on Windows"
  }
]
```

Max 10,000 entries (trimmed on write).

### terminated-sessions.json

Map of force-terminated users:

```json
{
  "user@example.com": {
    "at": "2026-06-01T14:30:00.000Z",
    "by": "admin@example.com"
  }
}
```

### shares.json

Active file/folder share links:

```json
{
  "shares": {
    "abc123token": {
      "project": "ProjectName",
      "filePath": "Doku/ClusterA/Einblasen/BB/report.pdf",
      "fileName": "report.pdf",
      "type": "file",
      "createdBy": "admin@example.com",
      "createdAt": "2026-06-01T14:00:00.000Z",
      "expiresAt": "2026-06-08T14:00:00.000Z",
      "accessCount": 3
    }
  }
}
```

### .jwt-secret

Auto-generated JWT signing key (64 random bytes as hex). Created on first boot if not present.

## Aufmass Data Files (.txt)

The master data for each project is stored as a `.txt` file containing JSON. Located at:

```
storage/<ProjectName>/Doku/Aufmass/datafile/<ProjectName>.txt
```

### Data Format

The file contains a JSON array with two elements: `[E1, E2]`

```json
[
  ["Identification", "Timing", "Location", "Address", ...],   // E1: group header names
  [
    [                                                           // E2[0]: sub-headers
      ["Unique Project ID", "Metadata"],                        // Group 0 sub-cols
      ["Date"],                                                 // Group 1 sub-cols
      ["Cluster", "NVT"],                                       // Group 2 sub-cols
      ...
    ],
    [                                                           // E2[1]: first data row
      ["ROW-0", ""],                                            // Group 0 values
      ["2026-03-15"],                                           // Group 1 values
      ["SUPPN", "NVT-001"],                                     // Group 2 values
      ...
    ],
    [                                                           // E2[2]: second data row
      ["ROW-1", ""],
      ...
    ]
  ]
]
```

- **E1** (index 0): Array of group header names (strings)
- **E2** (index 1): Array of arrays:
  - **E2[0]**: Sub-header definitions — `E2[0][i]` is an array of column names for group `i`
  - **E2[1..n]**: Data rows — `E2[r][i][j]` is the value for row `r`, group `i`, column `j`
- **Row ID**: Always stored at `row[0][0]` — the first column of the first (hidden) "Identification" group

### Versioned Copies

On every save, `dataVersioning.js` creates:
1. A timestamped `.txt` copy: `<ProjectName>_YYYYMMDD_HHMMSS.txt`
2. An Excel export: `<ProjectName>_YYYYMMDD_HHMMSS.xlsx` in the `xlsx/` sibling folder

When reading, `dataRoutes.js` loads the **latest versioned file** if any exist, falling back to the base file.

### Optimistic Locking

Row versions are tracked in `storage/<ProjectName>/row-versions.json`:

```json
{
  "ROW-0": 5,
  "ROW-1": 3
}
```

Clients send `rowVersion` with updates. If it doesn't match the server version, a `409 Conflict` is returned.

## SQLite Chat Database

**File:** `controllers/chatDb.js`

Each project gets its own SQLite database at:

```
storage/<ProjectName>/chat/chat.db
```

### Schema

```sql
CREATE TABLE messages (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email        TEXT NOT NULL,
    user_name         TEXT NOT NULL,
    message           TEXT NOT NULL DEFAULT '',
    media_url         TEXT DEFAULT NULL,
    media_type        TEXT DEFAULT NULL,
    original_filename TEXT DEFAULT NULL,
    created_at        DATETIME DEFAULT (datetime('now')),
    edited_at         DATETIME DEFAULT NULL,
    deleted           INTEGER DEFAULT 0
);

CREATE INDEX idx_messages_id ON messages(id);
CREATE INDEX idx_messages_created ON messages(created_at);
```

### Connection Pool

- Uses `better-sqlite3` (synchronous, no async needed)
- LRU connection pool: max 20 open databases at once
- Least-recently-used DB is closed when pool is full
- All connections closed on graceful shutdown (SIGTERM/SIGINT)
- WAL mode enabled for better concurrent performance

### Legacy Migration

On first access of a project's chat DB, if a legacy single-DB at `src/DataFiles/chat.db` exists, messages for that project are migrated to the per-project DB. A `.migrated` flag file prevents re-migration.

## Per-Project File Metadata

**File:** `storage/<ProjectName>/.filemeta.json`

Tracks who last modified each file/folder:

```json
{
  "Doku/ClusterA/Einblasen/report.pdf": {
    "modifiedBy": "user@example.com",
    "modifiedAt": "2026-06-01T14:30:00.000Z"
  }
}
```

Updated on file upload, folder creation, rename, and move operations.

## Trash System

Each project has a `.trash` directory with a `.manifest.json`:

```json
{
  "items": [
    {
      "id": "1718000000000",
      "originalName": "old-report.pdf",
      "originalPath": "Doku/ClusterA/Einblasen",
      "trashName": "old-report.pdf_1718000000000",
      "deletedBy": "user@example.com",
      "deletedAt": "2026-05-15T10:00:00.000Z",
      "isDir": false,
      "expiresAt": "2026-06-14T10:00:00.000Z"
    }
  ]
}
```

- Items expire after 30 days and are permanently deleted
- Cleanup runs on server startup for all projects

# DocPilot Data Model — DoBo Reference

## Storage Architecture

DocPilot uses **JSON files** (not a SQL database) for all project data.

```
storage/
  ├── _data/                          — App-level config
  │     ├── users.json                — All user accounts
  │     └── access.json               — ACL permissions per user
  └── {ProjectName}/                  — One folder per project
        ├── Doku/
        │     ├── Aufmass/
        │     │     ├── datafile/
        │     │     │     └── aufmass.txt   — THE CENTRAL DATA FILE (JSON in .txt)
        │     │     └── xlsx/               — Excel exports
        │     ├── APL/
        │     ├── Einblasen/
        │     ├── Druckprufung/
        │     ├── Kalibrieren/
        │     ├── OTDR/
        │     └── Knotenpunkt/
        ├── Files/                    — General file storage
        └── chat/                     — SQLite chat DB per project
```

---

## The Aufmass File (aufmass.txt)

This is the heart of every project. It's a JSON array of address objects:

```json
[
  {
    "id": "unique-address-id",
    "strasse": "Hauptstraße 12",
    "nvt": "KVz-001",
    "cluster": "A",
    "einblasen": "done",
    "druckprufung": "pending",
    "kalibrieren": "pending",
    "apl": "waiting",
    "knotenpunkt": "pending",
    "otdr": "n/a",
    "eingeblasenDate": "2026-05-01",
    "notes": "Cable from north side",
    "technician": "Max Mustermann"
  }
]
```

### Status Values per Module
Each module field (einblasen, druckprufung, kalibrieren, apl, knotenpunkt, otdr) can be:
- `"pending"` — Not started
- `"waiting"` — In progress / waiting
- `"done"` — Completed
- `"error"` — Has issues
- `"n/a"` — Not applicable

---

## Users File (users.json)

```json
[
  {
    "id": "uuid",
    "email": "user@example.com",
    "name": "Max Mustermann",
    "passwordHash": "bcrypt hash",
    "role": "user",
    "status": "approved",
    "language": "de",
    "createdAt": "2026-01-01T00:00:00Z"
  }
]
```

### Roles
- `"user"` — Standard field worker
- `"admin"` — Can manage users and projects
- `"superadmin"` — Full system access (RK = Rishi Kumar)

### Status
- `"pending"` — Just registered, waiting for admin approval
- `"approved"` — Can log in and use the app
- `"revoked"` — Account disabled

---

## Access/ACL File (access.json)

```json
{
  "user@example.com": {
    "projects": ["Projekt Alpha", "Projekt Beta"],
    "modules": {
      "aufmass": true,
      "einblasen": true,
      "druckprufung": false,
      "apl": true,
      "otdr": false
    }
  }
}
```

---

## Chat Database (SQLite)

Per-project SQLite file at `storage/{project}/chat/{project}.db`.

Table: `messages`
```sql
id INTEGER PRIMARY KEY
user_email TEXT
role TEXT (user|assistant)
content TEXT
timestamp INTEGER
session_id TEXT
```

---

## DoBo Memory Files

Per-user markdown files at `storage/_data/ai-memory/{userId}.md`

Structure:
```markdown
# DoBo Memory — {username}

## User Preferences
- Language: German
- Working on: Projekt Alpha

## Recent Context
- Last discussed: APL module, address "Hauptstr. 12"
- Had trouble with: OTDR file upload

## Notes
- User prefers brief answers
- Usually works in the mornings
```

---

## File Naming Conventions

### Module uploads
- `{addressId}_{timestamp}_{filename}.pdf`
- `{addressId}_photo_{1|2|3|4}.jpg` (APL photos)
- `{addressId}_otdr_{fiberNumber}.sor`

### Protocol files (auto-generated)
- `{projectName}_{cluster}_{nvt}_{addressId}_protokoll_{timestamp}.pdf`

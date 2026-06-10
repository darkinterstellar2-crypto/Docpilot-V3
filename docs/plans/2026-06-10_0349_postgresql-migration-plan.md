# DocPilot V3.8 — PostgreSQL Migration Plan
> Created: 2026-06-10 03:49 GMT+2
> Status: PLANNING
> Risk level: HIGH — 10 workers on production daily
> Estimated time: 2-3 weeks (working in phases)

---

## Guiding Principle

**Zero downtime. Zero data loss. Workers never notice the switch.**

We run PostgreSQL ALONGSIDE flat files. Migrate one module at a time. Each phase is independently deployable and rollback-safe. Only after everything works do we remove the old flat file code.

---

## PHASE 0: Foundation (Day 1)
> *Get PostgreSQL running, create the database, verify connection*

### Tasks:
1. **Install PostgreSQL on the VPS** (187.124.164.237)
   - `apt install postgresql-16`
   - Create database: `docpilot_db`
   - Create app user: `docpilot_app` (not superuser)
   - Configure `pg_hba.conf` for local connections only

2. **Add `pg` (node-postgres) to the project**
   - `npm install pg`
   - Create `controllers/db.js` — connection pool, query helper, error handling
   - Environment variables: `DATABASE_URL` or `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE`

3. **Run the migration SQL files** (already designed)
   - `01-global-tables.sql` — tenants, users, tenant_memberships
   - `02-tenant-tables.sql` — projects, aufmass_rows, access_control, etc.
   - `03-rls-policies.sql` — tenant isolation (enable later)
   - `04-indexes.sql` — GIN on JSONB, B-tree on promoted columns
   - `05-seeds.sql` — default tenant for Geggos

4. **Build the migration script** — `scripts/migrate-flat-to-pg.js`
   - Reads all current flat JSON files
   - Transforms data to match the new schema
   - Inserts into PostgreSQL
   - Verifies row counts match
   - This is a ONE-TIME script, run once when switching

### Deliverable: PostgreSQL running, empty schema ready, migration script written
### Risk: None — old system still running, nothing changes for users

---

## PHASE 1: Data Access Layer (Day 2-3)
> *Abstract ALL data operations behind a clean interface*

### The problem right now:
Every controller reads/writes files directly:
```js
// Current — scattered everywhere
const data = JSON.parse(fs.readFileSync('src/DataFiles/users.json'));
data.push(newUser);
fs.writeFileSync('src/DataFiles/users.json', JSON.stringify(data));
```

### The solution — a DAL (Data Access Layer):
```
controllers/
  dal/
    index.js          ← exports all DAL modules
    users.js          ← findByEmail(), create(), update(), list(), approve()
    projects.js       ← list(), create(), remove(), updateStatus(), reorder()
    aufmass.js        ← getRows(), saveRows(), getSchema(), updateCell()
    accessControl.js  ← getUserAccess(), setAccess(), getProjectMembers()
    logs.js           ← logAction(), getLogs(), search()
    sessions.js       ← logSession(), getHistory(), terminate()
    chat.js           ← sendMessage(), getMessages(), editMessage()
    files.js          ← getMeta(), setMeta(), getShares(), createShare()
    teams.js          ← list(), create(), update(), addMember()
    settings.js       ← get(), update()
```

### Each DAL module has TWO backends:
```js
// controllers/dal/users.js
const { usePostgres } = require('../db');

module.exports = {
  async findByEmail(email) {
    if (usePostgres()) {
      // PostgreSQL path
      const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
      return rows[0] || null;
    } else {
      // Flat file path (current code, extracted here)
      const users = JSON.parse(fs.readFileSync(USERS_FILE));
      return users.find(u => u.email === email) || null;
    }
  },

  async create(userData) {
    if (usePostgres()) {
      await db.query('INSERT INTO users (...) VALUES (...)', [...]);
    } else {
      // current flat file logic
    }
  }
};
```

### Feature flag in .env:
```
USE_POSTGRES=false    # Phase 1: false (still using files)
                      # Phase 3+: true (switched to PG)
```

### Tasks:
1. Create `controllers/db.js` — pool, query helper, transaction helper
2. Extract ALL data operations from current controllers into DAL modules
3. Every route handler calls `dal.users.findByEmail()` instead of reading files directly
4. **Test with `USE_POSTGRES=false`** — everything must work EXACTLY as before
5. This is a REFACTOR, not a feature — behavior must be identical

### Deliverable: All data access goes through DAL, still using flat files, zero behavior change
### Risk: LOW — same flat files, just cleaner code path

---

## PHASE 2: PostgreSQL Backend for DAL (Day 4-6)
> *Write the PostgreSQL implementation for every DAL method*

### Tasks:
1. Implement PostgreSQL path for each DAL module:
   - `users.js` — all queries against `users` table
   - `projects.js` — `projects` + `project_clusters` + `project_knotenpunkte`
   - `accessControl.js` — `access_control` + `access_control_projects`
   - `aufmass.js` — **THE BIG ONE** — `aufmass_schemas` + `aufmass_rows`
   - `logs.js` — `action_logs`
   - `sessions.js` — `session_logs` + `terminated_sessions`
   - `chat.js` — `chat_messages` (replaces SQLite)
   - `files.js` — `file_meta` + `file_shares` + `file_trash`
   - `teams.js` — `teams` table
   - `settings.js` — `tenant_settings`

2. **Aufmass DAL** — the most complex:
   ```js
   // dal/aufmass.js — PostgreSQL path
   
   async getSchema(projectId) {
     const { rows } = await db.query(
       'SELECT schema_json FROM aufmass_schemas WHERE project_id = $1 ORDER BY version DESC LIMIT 1',
       [projectId]
     );
     return rows[0]?.schema_json;
   }

   async getRows(projectId, { filters, sort, limit, offset } = {}) {
     let query = 'SELECT * FROM aufmass_rows WHERE project_id = $1';
     const params = [projectId];
     
     // Dynamic filters
     if (filters?.cluster) {
       query += ' AND cluster = $' + (params.push(filters.cluster));
     }
     if (filters?.status) {
       query += " AND data->>$" + (params.push(filters.statusKey)) + " = $" + (params.push(filters.status));
     }
     
     // Sorting
     if (sort) {
       query += ` ORDER BY data->>'${sort.key}' ${sort.dir}`;
     }
     
     return db.query(query, params);
   }

   async saveRow(projectId, rowKey, data, expectedVersion) {
     // Optimistic locking built into the UPDATE
     const result = await db.query(
       `UPDATE aufmass_rows 
        SET data = $1, version = version + 1, updated_at = NOW(), updated_by = $2
        WHERE project_id = $3 AND row_key = $4 AND version = $5
        RETURNING *`,
       [data, userEmail, projectId, rowKey, expectedVersion]
     );
     
     if (result.rowCount === 0) {
       throw new ConflictError('Row was modified by another user');
     }
     return result.rows[0];
   }

   async addRow(projectId, rowData) {
     return db.query(
       `INSERT INTO aufmass_rows (tenant_id, project_id, row_key, cluster, knotenpunkt, data, version)
        VALUES ($1, $2, $3, $4, $5, $6, 1)
        RETURNING *`,
       [tenantId, projectId, rowData.rowKey, rowData.cluster, rowData.knotenpunkt, rowData.data]
     );
   }

   async deleteRow(projectId, rowKey) { ... }
   
   async getAggregates(projectId, groupBy, aggregateKey) {
     // SUM, AVG, COUNT per cluster — impossible with flat files!
     return db.query(
       `SELECT cluster, 
               COUNT(*) as count,
               SUM((data->>$2)::numeric) as total,
               AVG((data->>$2)::numeric) as average
        FROM aufmass_rows 
        WHERE project_id = $1
        GROUP BY cluster`,
       [projectId, aggregateKey]
     );
   }
   ```

3. Write integration tests — DAL with `USE_POSTGRES=true` produces same results as flat files

### Deliverable: Full PostgreSQL backend ready, tested, not yet activated
### Risk: LOW — still running on flat files in production

---

## PHASE 3: The Switch (Day 7)
> *Run migration script, flip the flag, verify everything*

### Tasks:
1. **Announce maintenance window** to workers (pick a quiet time — Sunday morning?)
2. `git pull` on server
3. Run `scripts/migrate-flat-to-pg.js` — imports all flat file data into PostgreSQL
4. Verify: row counts, spot-check random rows, test every route
5. Set `USE_POSTGRES=true` in `.env`
6. Restart the app
7. Test EVERY feature manually:
   - [ ] Login/register/OTP
   - [ ] Dashboard — projects load, create, delete, reorder
   - [ ] Aufmass — edit cells, dropdowns, save, versioning
   - [ ] Each module — navigation, upload, status
   - [ ] File manager — browse, upload, download, share
   - [ ] Chat — send, receive, media
   - [ ] Admin — approve users, ACL, logs
   - [ ] SuperLog — entries appear
   - [ ] DoBo — if enabled
8. Keep flat files as backup (don't delete them)

### Rollback plan:
If anything breaks: set `USE_POSTGRES=false`, restart. Instant rollback to flat files.

### Deliverable: Production running on PostgreSQL
### Risk: MEDIUM — mitigated by instant rollback

---

## PHASE 4: Rich Aufmass (Day 8-12)
> *NOW we build the Excel-like features — only possible with PostgreSQL*

### 4a. Schema Builder Upgrade
- New project wizard gets rich column configuration:
  - Column type picker: text, number, date, time, currency, dropdown, status, formula, checkbox
  - Per-column formatting: color, font, alignment, width
  - Dropdown option editor (fixed options OR dynamic source)
  - Formula builder (simple: column A + column B)
  - Conditional formatting rules (if Status = Error → red background)

### 4b. Aufmass Table Engine Rewrite
- **Server-side sorting** — click column header → `ORDER BY data->>'col' ASC/DESC`
- **Server-side filtering** — filter bar sends query params → `WHERE` clause
- **Server-side pagination** — 50 rows per page, load more on scroll
- **Column totals/averages** — footer row with `SUM()`, `AVG()`, `COUNT()`
- **Column show/hide** — saved per user in localStorage
- **Column reorder** — drag column headers
- **Cell-level formatting** — `cellOverrides` for individual cell styles
- **Cell notes** — hover tooltip on any cell
- **Multi-select** — select rows for batch status update
- **Excel export** — server-side with proper formatting (not just data dump)
- **Undo/redo** — client-side edit history

### 4c. Rich Cell Types
- **Date picker** — calendar popup, DD.MM.YYYY format
- **Time picker** — clock popup, HH:mm format
- **Currency input** — right-aligned, € format, decimal handling
- **Status badge** — colored pill with dropdown (Done 🟢, Pending 🟡, Error 🔴)
- **Formula cell** — auto-calculated, non-editable, highlighted background
- **Checkbox** — toggle on click
- **Number with unit** — `387.2 m`, `96 Fasern`
- **Linked dropdown** — Knotenpunkt filtered by selected Cluster (already exists, make it better)

### 4d. New API Endpoints
```
GET  /api/aufmass/:project/rows?sort=g0-c0&dir=desc&filter[g5-c0]=Done&page=1&limit=50
GET  /api/aufmass/:project/schema
PUT  /api/aufmass/:project/schema          ← update column config
PUT  /api/aufmass/:project/rows/:rowKey    ← update single row (optimistic locking)
POST /api/aufmass/:project/rows            ← add row
DEL  /api/aufmass/:project/rows/:rowKey    ← delete row
GET  /api/aufmass/:project/aggregates?groupBy=cluster&columns=g4-c2,g6-c2
GET  /api/aufmass/:project/export/xlsx     ← rich Excel export
PUT  /api/aufmass/:project/rows/:rowKey/cells/:colKey/override  ← cell formatting
```

### Deliverable: Full Excel-like Aufmass with sorting, filtering, totals, rich types
### Risk: LOW — this is additive, doesn't break existing data

---

## PHASE 5: Cleanup + SuperLog Migration (Day 13-14)
> *Remove flat file code, migrate remaining systems*

### Tasks:
1. Remove all flat file read/write code from DAL (keep only PostgreSQL path)
2. Remove `USE_POSTGRES` flag — always PostgreSQL
3. Migrate SuperLog from ring buffer to partitioned PostgreSQL table
4. Remove SQLite dependency (chat.db → PostgreSQL chat_messages)
5. Remove `better-sqlite3` from package.json
6. Update `.env.example` with all PostgreSQL vars
7. Update deployment docs (docker-compose.yml with PostgreSQL container)

### Deliverable: Clean codebase, single data layer, no flat files
### Risk: LOW — by this point PostgreSQL is proven

---

## PHASE 6: Multi-Tenant RLS (Future — when DocPilot Pro launches)
> *Not now — this is for when you sell to multiple companies*

### What it adds:
- `SET LOCAL app.tenant_id = 'xxx'` on every request
- RLS policies enforce tenant isolation automatically
- One database serves all companies
- Tenant admin panel for managing instances

### Why not now:
- Only Geggos uses DocPilot right now
- RLS adds complexity to every query
- Better to get PostgreSQL stable first, then add multi-tenancy

---

## FILE STRUCTURE AFTER MIGRATION

```
TheApp/
├── controllers/
│   ├── db.js                    ← NEW: PostgreSQL pool + helpers
│   ├── dal/                     ← NEW: Data Access Layer
│   │   ├── index.js
│   │   ├── users.js
│   │   ├── projects.js
│   │   ├── aufmass.js
│   │   ├── accessControl.js
│   │   ├── logs.js
│   │   ├── sessions.js
│   │   ├── chat.js
│   │   ├── files.js
│   │   ├── teams.js
│   │   └── settings.js
│   ├── storageConfig.js         ← KEPT (still need file paths for uploads)
│   ├── nasSync.js               ← KEPT (NAS sync for binary files)
│   ├── ... (other controllers simplified — use DAL instead of direct file I/O)
│
├── migrations/                  ← NEW: SQL migration files
│   ├── 001-global-tables.sql
│   ├── 002-tenant-tables.sql
│   ├── 003-rls-policies.sql
│   ├── 004-indexes.sql
│   └── 005-seeds.sql
│
├── scripts/                     ← NEW
│   ├── migrate-flat-to-pg.js    ← One-time migration script
│   └── run-migrations.js        ← Applies SQL files in order
```

---

## WHAT STAYS AS FILES

PostgreSQL handles ALL structured data. But binary files stay on disk/NAS:
- Uploaded photos, PDFs, documents (module files)
- Chat media attachments
- User avatars
- Excel exports (generated on demand)
- NAS sync continues for binary files

---

## TIMELINE

| Phase | Days | What | Can deploy independently? |
|-------|------|------|--------------------------|
| 0 — Foundation | 1 | PostgreSQL installed, schema created | ✅ No user impact |
| 1 — DAL | 2 | Refactor all controllers to use DAL | ✅ Same behavior |
| 2 — PG Backend | 3 | Write PostgreSQL queries for all DAL methods | ✅ Not activated |
| 3 — The Switch | 1 | Run migration, flip flag | ⚠️ Maintenance window |
| 4 — Rich Aufmass | 5 | Excel-like features, new UI | ✅ Additive features |
| 5 — Cleanup | 2 | Remove flat files, SQLite | ✅ Internal cleanup |
| **Total** | **~14 days** | | |

---

## WHAT WORKERS WILL NOTICE

### During migration (Phase 3): Nothing — 15 min maintenance window at most
### After migration:
- **Everything faster** — queries instead of file reads
- **Aufmass is now Excel-like** — sorting, filtering, totals, colored status badges
- **New column types** — date pickers, currency fields, formulas
- **No more weird save conflicts** — proper database locking
- **Nothing breaks** — same URLs, same login, same navigation

---

*This plan assumes 4-6 hours of work per day. Subagents do the heavy lifting. Adjust timeline based on RK's availability for testing.*

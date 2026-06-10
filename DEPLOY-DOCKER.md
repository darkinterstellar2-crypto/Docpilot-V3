# DocPilot — PostgreSQL Migration Deployment (Docker)

> Server: 187.124.164.237 (srv1489035)
> Path: /opt/docpilot
> App runs as a Docker container behind Traefik. DB will be a sibling postgres container.

---

## Architecture

```
Traefik (SSL) ──> docpilot container (Node, port 3000)
                        │
                        └──> docpilot-postgres container (PostgreSQL 16)
                             via DATABASE_URL host = "docpilot-postgres"
```

Data volumes:
- `geggos-storage`  → /data/storage      (field data: aufmass .txt, files)
- `geggos-appdata`  → /app/src/DataFiles  (users.json, projects.json, ACL)
- `docpilot-pgdata` → postgres data (NEW)

---

## Step 0 — Backup first (safety)

```bash
cd /opt/docpilot
docker run --rm -v geggos-storage:/data -v $(pwd):/backup alpine \
    tar czf /backup/backup-storage-$(date +%Y%m%d-%H%M).tar.gz -C /data .
docker run --rm -v geggos-appdata:/data -v $(pwd):/backup alpine \
    tar czf /backup/backup-appdata-$(date +%Y%m%d-%H%M).tar.gz -C /data .
ls -lh backup-*.tar.gz
```

These tarballs are your undo button. Keep them safe.

---

## Step 1 — Pull latest code

```bash
cd /opt/docpilot
git pull origin main
```

---

## Step 2 — Add DB credentials to .env

```bash
nano .env
```

Add these lines (pick a strong password, use it in BOTH places):

```
PG_PASSWORD=YOUR_STRONG_DB_PASSWORD
DATABASE_URL=postgresql://docpilot_app:YOUR_STRONG_DB_PASSWORD@docpilot-postgres:5432/docpilot_db
TENANT_ID=aaaaaaaa-0000-4000-a000-000000000001
```

NOTE: the DB host is `docpilot-postgres` (the container name), NOT localhost.
Keep the existing `STORAGE_ROOT=/data/storage` line as-is.

Save: Ctrl+O, Enter, Ctrl+X

---

## Step 3 — Start the postgres container

```bash
docker compose up -d docpilot-postgres
```

Wait for it to be healthy:

```bash
docker compose ps
```

Look for `docpilot-postgres` status = healthy (give it ~15s).

---

## Step 4 — Create schema (run all SQL files inside the postgres container)

```bash
for f in migrations/001-global-tables.sql \
         migrations/002-tenant-tables.sql \
         migrations/003-rls-policies.sql \
         migrations/004-indexes.sql \
         migrations/005-seeds.sql; do
    echo "Running $f ..."
    docker exec -i docpilot-postgres psql -U docpilot_app -d docpilot_db -v ON_ERROR_STOP=1 < "$f"
done
```

`docpilot_app` is the container superuser, so it can create roles, policies, and seed data. Watch for errors — ON_ERROR_STOP halts on the first one.

Verify tables:

```bash
docker exec -i docpilot-postgres psql -U docpilot_app -d docpilot_db -c "\dt"
```

You should see 22 tables.

---

## Step 5 — Rebuild the app image (gets new code + pg dependency)

```bash
docker compose build docpilot
```

---

## Step 6 — DRY RUN the data migration (inside a temporary app container)

```bash
docker compose run --rm docpilot node scripts/migrate-flat-to-pg.js --dry-run
```

This starts a one-off container with the same volumes + .env, reads your flat
files from /data/storage and /app/src/DataFiles, inserts into postgres, prints
counts, then ROLLS BACK.

STOP and read the output:
- Does the project count match reality?
- Does the aufmass row count look right?
- Any errors?

If anything looks wrong — DO NOT proceed. Capture the output.

---

## Step 7 — Real migration (only if dry-run was clean)

```bash
docker compose run --rm docpilot node scripts/migrate-flat-to-pg.js
```

Same thing, but COMMITs. Your data is now in PostgreSQL.

---

## Step 8 — Restart the app with the new stack

```bash
docker compose up -d
```

This recreates the docpilot container with depends_on postgres, new image, DB env.

---

## Step 9 — Verify

```bash
docker compose ps
docker compose logs --tail 50 docpilot
```

Then open https://geggos.ai → login → dashboard loads projects → open a project →
aufmass data shows → files → admin users list.

---

## Rollback (if something breaks)

The app still has the flat-file volumes intact (migration only READS them).
To revert: restore the old docker-compose.yml (git), `docker compose up -d`, and
the app runs on flat files again. Your data was never deleted.

To wipe postgres and retry:
```bash
docker compose down docpilot-postgres
docker volume rm docpilot_docpilot-pgdata
```
Then redo from Step 3.

-- migrations/aufmass-schema.sql
-- Aufmass-only PostgreSQL schema for DocPilot.
-- Single-tenant: project_name is the tenant discriminator (no RLS).
-- Run once on a fresh DB, or re-run idempotently (all statements use IF NOT EXISTS).

-- ─── Prerequisites ────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- provides gen_random_uuid()

-- ─── Table: aufmass_schema ────────────────────────────────────────────────────
-- One row per project: the blueprint (groups + columns + metadata).
-- schema_json shape: [ { id, title, columns: [ { id, label, type, options,
--   format, validation, display, totals }, ... ] }, ... ]

CREATE TABLE IF NOT EXISTS aufmass_schema (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_name TEXT        UNIQUE NOT NULL,
    schema_json  JSONB       NOT NULL,
    version      INTEGER     NOT NULL DEFAULT 1,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by   TEXT
);

COMMENT ON TABLE  aufmass_schema IS 'Per-project Aufmass column/group schema blueprint.';
COMMENT ON COLUMN aufmass_schema.project_name IS 'Matches the folder name under STORAGE_ROOT and the key in projects.json.';
COMMENT ON COLUMN aufmass_schema.schema_json  IS 'Array of group objects. Each group: {id,title,columns:[{id,label,type,...}]}.';
COMMENT ON COLUMN aufmass_schema.version      IS 'Bumped on every schema change. Used to detect stale schema on the client.';

-- ─── Table: aufmass_row ───────────────────────────────────────────────────────
-- One row per Aufmass data row.
-- cells JSONB: { "<col-id>": "<value>", ... } — keyed by the stable column ids
--   from aufmass_schema.schema_json[*].columns[*].id

CREATE TABLE IF NOT EXISTS aufmass_row (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_name TEXT        NOT NULL,
    row_id       TEXT        NOT NULL,   -- original ROW-ID (row[0][0]) for continuity
    cells        JSONB       NOT NULL DEFAULT '{}',
    sort_order   INTEGER,
    version      INTEGER     NOT NULL DEFAULT 1,  -- optimistic locking
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by   TEXT,

    CONSTRAINT aufmass_row_project_rowid_uq UNIQUE (project_name, row_id)
);

COMMENT ON TABLE  aufmass_row IS 'Per-project Aufmass data rows. cells JSONB keyed by column ids from aufmass_schema.';
COMMENT ON COLUMN aufmass_row.row_id     IS 'Preserves original ROW-ID from flat-file format (row[0][0]). Used for optimistic locking.';
COMMENT ON COLUMN aufmass_row.cells      IS 'Key→value bag: { "col-location-cluster": "C1", ... }. Keys are stable col ids.';
COMMENT ON COLUMN aufmass_row.version    IS 'Incremented on every cell update. Client must submit current version to avoid conflict (409).';

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Primary access pattern: fetch all rows for a project, ordered by sort_order
CREATE INDEX IF NOT EXISTS aufmass_row_project_sort_idx
    ON aufmass_row (project_name, sort_order);

-- GIN index on cells for future full-text / containment search (@>, ?)
CREATE INDEX IF NOT EXISTS aufmass_row_cells_gin_idx
    ON aufmass_row USING GIN (cells);

-- ─── updated_at auto-update trigger ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aufmass_row_updated_at ON aufmass_row;
CREATE TRIGGER aufmass_row_updated_at
    BEFORE UPDATE ON aufmass_row
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS aufmass_schema_updated_at ON aufmass_schema;
CREATE TRIGGER aufmass_schema_updated_at
    BEFORE UPDATE ON aufmass_schema
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

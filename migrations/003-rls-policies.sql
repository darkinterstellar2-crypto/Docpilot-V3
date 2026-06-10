-- =============================================================================
-- DocPilot-V3 — Row Level Security Policies
-- =============================================================================
-- All tenant-scoped tables are isolated by RLS.
-- Application layer sets: SET LOCAL app.tenant_id = '<uuid>';
-- Service role (migrations, admin CLI) bypasses RLS.
--
-- Policy pattern used: USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID)
-- The TRUE arg makes current_setting() return NULL instead of raising if not set.
-- NULLs never match → safety net prevents cross-tenant leakage.
--
-- Roles used:
--   app_user     — application DB user (all API requests)
--   service_role — migration scripts, admin CLI, background jobs
-- =============================================================================

-- =============================================================================
-- Create application roles (run once)
-- =============================================================================
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role BYPASSRLS;  -- BYPASSRLS = ignores all RLS policies
    END IF;
END $$;

-- Grant schema access
GRANT USAGE ON SCHEMA public TO app_user;
GRANT USAGE ON SCHEMA public TO service_role;

-- =============================================================================
-- Helper: enable RLS + create standard tenant isolation policy
-- =============================================================================
-- The macro below is repeated for every tenant-scoped table.
-- Pattern: enable RLS → create SELECT/INSERT/UPDATE/DELETE policies.

-- ─────────────────────────────────────────────────────────────────────────────
-- projects
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;  -- Applies even to table owner

CREATE POLICY projects_tenant_isolation ON projects
    AS PERMISSIVE
    FOR ALL
    TO app_user
    USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

-- Service role bypass (migrations can see/write everything)
GRANT ALL ON projects TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- project_clusters
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE project_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_clusters FORCE ROW LEVEL SECURITY;

CREATE POLICY project_clusters_tenant_isolation ON project_clusters
    AS PERMISSIVE FOR ALL TO app_user
    USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

GRANT ALL ON project_clusters TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_clusters TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- project_knotenpunkte
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE project_knotenpunkte ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_knotenpunkte FORCE ROW LEVEL SECURITY;

CREATE POLICY project_knotenpunkte_tenant_isolation ON project_knotenpunkte
    AS PERMISSIVE FOR ALL TO app_user
    USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

GRANT ALL ON project_knotenpunkte TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_knotenpunkte TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- project_info
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE project_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_info FORCE ROW LEVEL SECURITY;

CREATE POLICY project_info_tenant_isolation ON project_info
    AS PERMISSIVE FOR ALL TO app_user
    USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

GRANT ALL ON project_info TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_info TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- project_info_fields
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE project_info_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_info_fields FORCE ROW LEVEL SECURITY;

CREATE POLICY project_info_fields_tenant_isolation ON project_info_fields
    AS PERMISSIVE FOR ALL TO app_user
    USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

GRANT ALL ON project_info_fields TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_info_fields TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- aufmass_schemas
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE aufmass_schemas ENABLE ROW LEVEL SECURITY;
ALTER TABLE aufmass_schemas FORCE ROW LEVEL SECURITY;

CREATE POLICY aufmass_schemas_tenant_isolation ON aufmass_schemas
    AS PERMISSIVE FOR ALL TO app_user
    USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

GRANT ALL ON aufmass_schemas TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON aufmass_schemas TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- aufmass_rows
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE aufmass_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE aufmass_rows FORCE ROW LEVEL SECURITY;

CREATE POLICY aufmass_rows_tenant_isolation ON aufmass_rows
    AS PERMISSIVE FOR ALL TO app_user
    USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

GRANT ALL ON aufmass_rows TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON aufmass_rows TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- access_control
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE access_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_control FORCE ROW LEVEL SECURITY;

-- Users can read their OWN ACL entry. Superadmins (role check at app layer) can read all.
-- The app_user role sees all rows for the current tenant (app layer enforces superadmin-only writes).
CREATE POLICY access_control_tenant_isolation ON access_control
    AS PERMISSIVE FOR ALL TO app_user
    USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

GRANT ALL ON access_control TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON access_control TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- access_control_projects
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE access_control_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_control_projects FORCE ROW LEVEL SECURITY;

CREATE POLICY access_control_projects_tenant_isolation ON access_control_projects
    AS PERMISSIVE FOR ALL TO app_user
    USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

GRANT ALL ON access_control_projects TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON access_control_projects TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- module_files
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE module_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_files FORCE ROW LEVEL SECURITY;

CREATE POLICY module_files_tenant_isolation ON module_files
    AS PERMISSIVE FOR ALL TO app_user
    USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

GRANT ALL ON module_files TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON module_files TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- file_shares
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE file_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_shares FORCE ROW LEVEL SECURITY;

CREATE POLICY file_shares_tenant_isolation ON file_shares
    AS PERMISSIVE FOR ALL TO app_user
    USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

-- SPECIAL: Public share access (the /share/:shareId route is unauthenticated)
-- The API layer must use service_role or a special lookup function to find shares by ID.
-- Public share resolution: app checks expiry + increments access_count via service_role bypass.
CREATE POLICY file_shares_public_read ON file_shares
    AS PERMISSIVE FOR SELECT TO PUBLIC
    USING (expires_at > NOW());
    -- Anyone can SELECT an unexpired share (for the public /share/:shareId endpoint)
    -- No tenant_id check here — share ID is the secret

GRANT ALL ON file_shares TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON file_shares TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- file_trash
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE file_trash ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_trash FORCE ROW LEVEL SECURITY;

CREATE POLICY file_trash_tenant_isolation ON file_trash
    AS PERMISSIVE FOR ALL TO app_user
    USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

GRANT ALL ON file_trash TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON file_trash TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- chat_messages
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages FORCE ROW LEVEL SECURITY;

CREATE POLICY chat_messages_tenant_isolation ON chat_messages
    AS PERMISSIVE FOR ALL TO app_user
    USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

GRANT ALL ON chat_messages TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_messages TO app_user;
GRANT USAGE, SELECT ON SEQUENCE chat_messages_id_seq TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- action_logs
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE action_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY action_logs_tenant_isolation ON action_logs
    AS PERMISSIVE FOR ALL TO app_user
    USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

GRANT ALL ON action_logs TO service_role;
GRANT SELECT, INSERT ON action_logs TO app_user;  -- Logs are append-only at app layer

-- ─────────────────────────────────────────────────────────────────────────────
-- session_logs
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE session_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY session_logs_tenant_isolation ON session_logs
    AS PERMISSIVE FOR ALL TO app_user
    USING (
        tenant_id IS NULL  -- Global events (failed logins before tenant context)
        OR tenant_id = current_setting('app.tenant_id', TRUE)::UUID
    )
    WITH CHECK (
        tenant_id IS NULL
        OR tenant_id = current_setting('app.tenant_id', TRUE)::UUID
    );

GRANT ALL ON session_logs TO service_role;
GRANT SELECT, INSERT ON session_logs TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- super_logs (partitioned)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE super_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE super_logs FORCE ROW LEVEL SECURITY;

-- Super logs: only superadmin can read (enforced at app layer).
-- RLS restricts to tenant context OR system-level (no tenant).
CREATE POLICY super_logs_tenant_isolation ON super_logs
    AS PERMISSIVE FOR ALL TO app_user
    USING (
        tenant_id IS NULL
        OR tenant_id = current_setting('app.tenant_id', TRUE)::UUID
    )
    WITH CHECK (
        tenant_id IS NULL
        OR tenant_id = current_setting('app.tenant_id', TRUE)::UUID
    );

GRANT ALL ON super_logs TO service_role;
GRANT SELECT, INSERT ON super_logs TO app_user;
GRANT USAGE, SELECT ON SEQUENCE super_logs_id_seq TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- tenant_settings
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_settings_tenant_isolation ON tenant_settings
    AS PERMISSIVE FOR ALL TO app_user
    USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

GRANT ALL ON tenant_settings TO service_role;
GRANT SELECT, UPDATE ON tenant_settings TO app_user;  -- No INSERT from app (created by service_role on tenant creation)

-- ─────────────────────────────────────────────────────────────────────────────
-- Global tables — NO RLS (app_user needs read access)
-- ─────────────────────────────────────────────────────────────────────────────
GRANT SELECT ON tenants TO app_user;
GRANT SELECT, INSERT, UPDATE ON users TO app_user;
GRANT SELECT, INSERT, DELETE ON tenant_memberships TO app_user;
GRANT SELECT ON platform_admins TO app_user;
GRANT SELECT, INSERT, DELETE ON terminated_sessions TO app_user;
GRANT ALL ON tenants TO service_role;
GRANT ALL ON users TO service_role;
GRANT ALL ON tenant_memberships TO service_role;
GRANT ALL ON platform_admins TO service_role;
GRANT ALL ON terminated_sessions TO service_role;

-- =============================================================================
-- Application Context Setting Function
-- =============================================================================
-- Call this at the start of every DB transaction to set the tenant context.
-- Example: SELECT set_tenant_context('550e8400-e29b-41d4-a716-446655440000');
-- =============================================================================

CREATE OR REPLACE FUNCTION set_tenant_context(p_tenant_id UUID)
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.tenant_id', p_tenant_id::TEXT, TRUE);
    -- TRUE = local to current transaction only (safe for connection pooling)
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION set_tenant_context IS 'Sets app.tenant_id for the current transaction. Must be called before any tenant-scoped query. Use SET LOCAL variant for connection pool safety.';

-- =============================================================================
-- Notes on Connection Pooling (PgBouncer / Supabase)
-- =============================================================================
-- When using a connection pool in transaction mode:
-- 1. SET LOCAL app.tenant_id = '<uuid>' — valid only for current transaction
-- 2. Never use SET app.tenant_id (session-level) — leaks across pooled connections
-- 3. Always wrap API requests in a transaction: BEGIN; SET LOCAL ...; queries; COMMIT;
-- 4. Supabase Edge Functions: use supabaseClient with service_role for admin ops

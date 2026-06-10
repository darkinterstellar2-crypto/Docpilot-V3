-- =============================================================================
-- DocPilot-V3 — Seed Data
-- =============================================================================
-- Default data for a fresh installation.
-- Run as service_role (bypasses RLS).
-- =============================================================================

-- =============================================================================
-- 1. Default Platform (First Tenant — the production DocPilot SaaS instance)
-- =============================================================================
-- This represents "Geggos" as the initial tenant being migrated from V2.
-- Replace UUIDs with actual values during migration.

INSERT INTO tenants (id, slug, name, email, plan, status, max_users, max_projects)
VALUES (
    'aaaaaaaa-0000-4000-a000-000000000001',
    'geggos',
    'Geggos',
    'admin@geggos.ai',
    'enterprise',
    'active',
    100,
    999
)
ON CONFLICT (slug) DO NOTHING;

-- =============================================================================
-- 2. Default Superadmin User
-- =============================================================================
-- Source: TheApp/src/DataFiles/users.example.json
-- Password: MUST BE CHANGED IMMEDIATELY after first login.
-- The hash below is bcrypt of 'CHANGE_ME_IMMEDIATELY' (cost factor 12).
-- Generate fresh: node -e "const bcrypt=require('bcryptjs'); bcrypt.hash('yourpass',12).then(h=>console.log(h))"

-- ⚠️ DISABLED FOR MIGRATION DEPLOYMENT (June 2026):
-- The real superadmin (and all users) are imported from src/DataFiles/users.json
-- by scripts/migrate-flat-to-pg.js WITH their real bcrypt password hashes.
-- If we seed a placeholder superadmin here FIRST, the migration's
-- ON CONFLICT (email) DO NOTHING would skip the real user, leaving an
-- unusable placeholder password → superadmin locked out.
--
-- For a TRULY FRESH install with NO migration, uncomment the block below and
-- replace the password_hash with a real bcrypt hash:
--   node -e "const b=require('bcryptjs');b.hash('yourpass',12).then(h=>console.log(h))"
--
-- INSERT INTO users (id, email, username, name, password_hash, role, is_verified, is_approved, created_at)
-- VALUES (
--     'aaaaaaaa-0000-4000-a000-000000000002',
--     'admin@geggos.ai', 'admin', 'Admin',
--     '$2a$12$REPLACE_WITH_REAL_BCRYPT_HASH',
--     'superadmin', TRUE, TRUE, NOW()
-- )
-- ON CONFLICT (email) DO NOTHING;
--
-- INSERT INTO tenant_memberships (tenant_id, user_id, role)
-- VALUES ('aaaaaaaa-0000-4000-a000-000000000001', 'aaaaaaaa-0000-4000-a000-000000000002', 'superadmin')
-- ON CONFLICT (tenant_id, user_id) DO NOTHING;
--
-- INSERT INTO platform_admins (user_id)
-- VALUES ('aaaaaaaa-0000-4000-a000-000000000002')
-- ON CONFLICT (user_id) DO NOTHING;

-- =============================================================================
-- 3. Default Tenant Settings
-- =============================================================================
-- Source: TheApp/src/DataFiles/settings.json
-- Default values match the V2 defaults.

INSERT INTO tenant_settings (tenant_id, generator_code, generator_url, generator_api_url, generator_allowed_users)
VALUES (
    'aaaaaaaa-0000-4000-a000-000000000001',
    '',           -- Empty by default — set via admin settings panel
    '',           -- Generator URL: set after deploying generator service
    '',           -- Generator API URL: set after deploying generator service
    ARRAY[]::TEXT[]  -- No allowed users by default (superadmin always has access)
)
ON CONFLICT (tenant_id) DO NOTHING;

-- =============================================================================
-- 4. Default Aufmass Schema (the 12-group standard schema from schema.json)
-- =============================================================================
-- This is NOT inserted as a project schema (those are per-project).
-- Instead, this is a TEMPLATE that can be used when creating new projects.
-- The actual per-project schema is populated during project creation.

-- NOTE: The 12-group standard schema from TheApp/src/DataFiles/schema.json:
-- Groups: Timing, Location, Address, Hardware, LWL Specs, Einblasen,
--         Kalibrieren, Druckprüfung, APL Splicing, OTDR Testing, Notes
-- Plus a hidden Group 0 for the Row ID (col-0-0 = _id)

-- The schema_json matches the API output format:
-- [{ id: "grp-0", title: "Timing", cols: [{ id: "col-0-0", label: "Date" }] }, ...]

-- This is stored as reference/template data — actual project schemas are created
-- during migration (one aufmass_schemas row per project, populated from its .txt file).

-- =============================================================================
-- 5. Helper: Create New Tenant (function for onboarding)
-- =============================================================================
-- Call this when onboarding a new customer in V3.

CREATE OR REPLACE FUNCTION create_tenant(
    p_slug       TEXT,
    p_name       TEXT,
    p_email      TEXT,
    p_plan       TEXT DEFAULT 'starter',
    p_max_users  INTEGER DEFAULT 5,
    p_max_projects INTEGER DEFAULT 10
) RETURNS UUID AS $$
DECLARE
    v_tenant_id UUID;
BEGIN
    INSERT INTO tenants (slug, name, email, plan, status, max_users, max_projects)
    VALUES (LOWER(p_slug), p_name, p_email, p_plan, 'active', p_max_users, p_max_projects)
    RETURNING id INTO v_tenant_id;

    -- Auto-create default settings row
    INSERT INTO tenant_settings (tenant_id)
    VALUES (v_tenant_id);

    RETURN v_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_tenant IS 'Onboarding helper: creates a tenant + default settings row in one call.';

-- =============================================================================
-- 6. Helper: Approve User into Tenant (equivalent to V2 admin/approve route)
-- =============================================================================

CREATE OR REPLACE FUNCTION approve_user_for_tenant(
    p_user_id   UUID,
    p_tenant_id UUID,
    p_role      TEXT DEFAULT 'user'
) RETURNS VOID AS $$
BEGIN
    -- Mark user as approved
    UPDATE users SET is_approved = TRUE WHERE id = p_user_id;

    -- Add to tenant
    INSERT INTO tenant_memberships (tenant_id, user_id, role)
    VALUES (p_tenant_id, p_user_id, p_role)
    ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = p_role;

    -- Create zero-access ACL entry (mirrors V2 ensureZeroAccessACL behavior)
    INSERT INTO access_control (
        tenant_id, user_id,
        full_access,
        can_create_project, can_delete_project, can_change_status,
        can_reorder_projects, can_download_zip, can_edit_project_info
    )
    VALUES (
        p_tenant_id, p_user_id,
        FALSE,
        FALSE, FALSE, FALSE, FALSE, FALSE, FALSE
    )
    ON CONFLICT (tenant_id, user_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION approve_user_for_tenant IS 'Approves a user and creates zero-access ACL entry. Mirrors V2 adminRoutes.js approve + ensureZeroAccessACL logic.';

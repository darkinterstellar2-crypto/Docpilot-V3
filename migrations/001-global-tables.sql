-- =============================================================================
-- DocPilot-V3 — Global Tables (No RLS)
-- =============================================================================
-- These tables are NOT tenant-scoped and have NO Row Level Security.
-- They are shared across the entire platform.
-- Source: TheApp/routes/authRoutes.js, TheApp/src/DataFiles/users.example.json
-- =============================================================================

-- Enable UUID extension (required for gen_random_uuid())
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- TABLE: tenants
-- =============================================================================
-- The subscribing companies. Every tenant gets their own isolated data space.
-- Source: New in V3 — not in V2 (was single-tenant).
-- =============================================================================
CREATE TABLE tenants (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                            -- Unique tenant identifier used as FK in all tenant-scoped tables

    slug        TEXT        NOT NULL UNIQUE,
                            -- URL-safe identifier (e.g. "acme-corp"). Used in subdomains.
                            -- Business rule: lowercase, 3-63 chars, alphanumeric + hyphens

    name        TEXT        NOT NULL,
                            -- Display name of the company (e.g. "ACME Corp GmbH")

    email       TEXT        NOT NULL,
                            -- Primary contact/billing email for the tenant account

    plan        TEXT        NOT NULL DEFAULT 'free',
                            -- Subscription plan: 'free' | 'starter' | 'pro' | 'enterprise'

    status      TEXT        NOT NULL DEFAULT 'active',
                            -- Account status: 'active' | 'suspended' | 'trial' | 'cancelled'

    max_users   INTEGER     NOT NULL DEFAULT 5,
                            -- Maximum number of users allowed on this tenant

    max_projects INTEGER    NOT NULL DEFAULT 10,
                            -- Maximum number of projects allowed on this tenant

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            -- When the tenant account was created

    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            -- Last time any tenant metadata was updated

    CONSTRAINT tenants_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]$')
);

COMMENT ON TABLE tenants IS 'Subscribing companies. Root anchor for all multi-tenant data isolation.';
COMMENT ON COLUMN tenants.slug IS 'URL-safe tenant identifier. Used for subdomain routing (e.g. acme.docpilot.app).';

-- =============================================================================
-- TABLE: users
-- =============================================================================
-- Global user accounts. One record per person, regardless of tenant membership.
-- Source: TheApp/routes/authRoutes.js (registration flow), TheApp/src/DataFiles/users.example.json
-- V2 fields: id, name, username, email, password, role, otp, isVerified, isApproved, createdAt, avatar
-- =============================================================================
CREATE TABLE users (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                                -- Unique user identifier. Replaces V2's timestamp-string id.

    email           TEXT        NOT NULL UNIQUE,
                                -- Primary identifier for login. UNIQUE globally.
                                -- Source: users.json → email field

    username        TEXT        NOT NULL UNIQUE,
                                -- Display handle. UNIQUE globally (enforced in V2 authRoutes.js).
                                -- Source: users.json → username field
                                -- Business rule: 3+ chars

    name            TEXT        NOT NULL,
                                -- Full display name.
                                -- Source: users.json → name field

    password_hash   TEXT        NOT NULL,
                                -- bcrypt hash of password. V2 uses bcryptjs.
                                -- Source: users.json → password field (stored as hash)
                                -- Business rule: min 8 chars enforced at app layer

    role            TEXT        NOT NULL DEFAULT 'user',
                                -- App-level role. Only 'superadmin' | 'user' in V2.
                                -- Source: users.json → role field
                                -- Per authRoutes.js: "Everyone registers as 'user' — superadmin is set manually"

    is_verified     BOOLEAN     NOT NULL DEFAULT FALSE,
                                -- Email verified via OTP.
                                -- Source: users.json → isVerified field
                                -- Set to true in /verify-otp route

    is_approved     BOOLEAN     NOT NULL DEFAULT FALSE,
                                -- Admin has approved this account.
                                -- Source: users.json → isApproved field
                                -- Set via /api/admin/approve route

    avatar_url      TEXT        DEFAULT NULL,
                                -- Relative URL to avatar image (e.g. /api/profile/avatar/12345.jpg)
                                -- Source: users.json → avatar field
                                -- File stored in src/DataFiles/avatars/<userId>.<ext>

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                                -- Account creation timestamp (when OTP was verified, not when registered).
                                -- Source: users.json → createdAt field (ISO string)

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                                -- Last profile update.

    CONSTRAINT users_role_check CHECK (role IN ('superadmin', 'user'))
);

COMMENT ON TABLE users IS 'Global user accounts. One record per person. Email and username are globally unique.';
COMMENT ON COLUMN users.role IS 'Only superadmin or user. No other roles in V2. ACL controls fine-grained access.';
COMMENT ON COLUMN users.password_hash IS 'bcrypt hash. V2 auto-migrates legacy plaintext on first login (verifyPassword + needsRehash logic).';

-- Index for login lookup (email OR username)
CREATE UNIQUE INDEX idx_users_email    ON users (LOWER(email));
CREATE UNIQUE INDEX idx_users_username ON users (LOWER(username));

-- =============================================================================
-- TABLE: tenant_memberships
-- =============================================================================
-- Many-to-many: which user belongs to which tenant.
-- Source: New in V3. V2 was single-tenant; roles embedded in users.json.
-- =============================================================================
CREATE TABLE tenant_memberships (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                            -- The tenant this membership belongs to

    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                            -- The user who is a member of this tenant

    role        TEXT        NOT NULL DEFAULT 'user',
                            -- Role within THIS tenant: 'superadmin' | 'user'
                            -- Superadmin here = superadmin in the tenant context (app admin)
                            -- NOT the same as platform_admins

    joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            -- When this membership was created (user approved into tenant)

    UNIQUE (tenant_id, user_id),
                -- A user can only be a member of a tenant once

    CONSTRAINT memberships_role_check CHECK (role IN ('superadmin', 'user'))
);

COMMENT ON TABLE tenant_memberships IS 'User ↔ Tenant membership with role. One user can belong to multiple tenants in V3.';

CREATE INDEX idx_memberships_tenant ON tenant_memberships (tenant_id);
CREATE INDEX idx_memberships_user   ON tenant_memberships (user_id);

-- =============================================================================
-- TABLE: platform_admins
-- =============================================================================
-- Platform-level operators (RK, Cleo) who manage tenants.
-- NOT the same as superadmin inside a tenant.
-- Source: New in V3.
-- =============================================================================
CREATE TABLE platform_admins (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id     UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                            -- The user who has platform admin rights

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by  UUID        REFERENCES platform_admins(id) ON DELETE SET NULL
                            -- Who granted this admin access (self-referential)
);

COMMENT ON TABLE platform_admins IS 'Platform-level administrators. Can manage tenants, billing, and global settings.';

-- =============================================================================
-- TABLE: terminated_sessions
-- =============================================================================
-- Force-logout state. Any request from a user in this table returns 401 forceLogout.
-- Source: TheApp/controllers/sessionLogger.js → terminated-sessions.json
-- V2 structure: { "email": { "at": ISO, "by": email } }
-- Global table (not tenant-scoped) because termination is per user identity.
-- =============================================================================
CREATE TABLE terminated_sessions (
    user_email      TEXT        PRIMARY KEY,
                                -- Email of the user whose session is force-terminated.
                                -- Source: terminated-sessions.json → key (lowercased)

    terminated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                                -- When termination was applied.
                                -- Source: terminated-sessions.json → at field

    terminated_by   TEXT        NOT NULL,
                                -- Email of the admin who terminated this session.
                                -- Source: terminated-sessions.json → by field
                                -- Set by terminateUser() in sessionLogger.js
                                -- Cleared by clearTermination() on successful re-login
);

COMMENT ON TABLE terminated_sessions IS 'Force-logout registry. Presence of an email here means all their JWT tokens are invalid until they re-login.';

-- =============================================================================
-- TRIGGERS: updated_at maintenance
-- =============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

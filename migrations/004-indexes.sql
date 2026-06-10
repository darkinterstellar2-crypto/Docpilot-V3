-- =============================================================================
-- DocPilot-V3 — Indexes
-- =============================================================================
-- Performance-critical queries identified from V2 API patterns.
-- All indexes are NON-UNIQUE unless otherwise noted (unique constraints
-- are already defined in 01/02 DDL files).
-- =============================================================================

-- =============================================================================
-- GLOBAL TABLES
-- =============================================================================

-- tenants: lookup by slug (used for subdomain routing)
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants (LOWER(slug));
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants (status);

-- users: already have unique indexes on email+username from DDL
-- Additional: lookup by role (find all superadmins)
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_is_approved ON users (is_approved);
CREATE INDEX IF NOT EXISTS idx_users_is_verified ON users (is_verified);

-- tenant_memberships: heavily used for auth context
CREATE INDEX IF NOT EXISTS idx_memberships_tenant_user ON tenant_memberships (tenant_id, user_id);

-- terminated_sessions: checked on every /api/* request (fast PK lookup is enough)
-- PK index on user_email already exists — no additional needed.

-- =============================================================================
-- PROJECTS
-- =============================================================================

-- Critical query: GET /api/projects (list all projects for a tenant, sorted by sort_order)
-- Source: projectRoutes.js GET /
CREATE INDEX IF NOT EXISTS idx_projects_tenant_order
    ON projects (tenant_id, sort_order ASC);

-- Lookup by name within tenant (used in almost every route as identifier)
CREATE INDEX IF NOT EXISTS idx_projects_tenant_name
    ON projects (tenant_id, LOWER(name));

-- Filter by status (dashboard filtering)
CREATE INDEX IF NOT EXISTS idx_projects_tenant_status
    ON projects (tenant_id, status);

-- =============================================================================
-- PROJECT_CLUSTERS
-- =============================================================================

-- List clusters for a project (GET /api/projects/:name/clusters)
CREATE INDEX IF NOT EXISTS idx_clusters_project
    ON project_clusters (project_id, sort_order ASC);

CREATE INDEX IF NOT EXISTS idx_clusters_tenant_project
    ON project_clusters (tenant_id, project_id);

-- =============================================================================
-- PROJECT_KNOTENPUNKTE
-- =============================================================================

-- List knotenpunkte for a cluster (GET /api/projects/:name/knotenpunkte?cluster=X)
CREATE INDEX IF NOT EXISTS idx_knoten_cluster
    ON project_knotenpunkte (cluster_id);

CREATE INDEX IF NOT EXISTS idx_knoten_project_cluster
    ON project_knotenpunkte (project_id, cluster_id);

-- =============================================================================
-- AUFMASS_ROWS
-- =============================================================================
-- This is the hottest table — every Aufmass load and save hits it.

-- Primary query: fetch all rows for a project (GET /api/data?project=X)
-- Critical: tenant_id + project_id filter is the base of every query
CREATE INDEX IF NOT EXISTS idx_aufmass_rows_project
    ON aufmass_rows (tenant_id, project_id);

-- Optimistic lock lookup: find specific row by project + row_key
-- Source: dataRoutes.js conflict detection: rowVersions[rowId]
CREATE INDEX IF NOT EXISTS idx_aufmass_rows_key
    ON aufmass_rows (tenant_id, project_id, row_key);

-- Filter by cluster (navigation tree, planner view, per-cluster summaries)
CREATE INDEX IF NOT EXISTS idx_aufmass_rows_cluster
    ON aufmass_rows (tenant_id, project_id, cluster)
    WHERE cluster IS NOT NULL;

-- Filter by cluster + knotenpunkt (module navigation: GET /api/modules/navigation)
CREATE INDEX IF NOT EXISTS idx_aufmass_rows_cluster_knoten
    ON aufmass_rows (tenant_id, project_id, cluster, knotenpunkt)
    WHERE cluster IS NOT NULL;

-- Status filters (dashboard/planner: filter by ein_status, apl_status, etc.)
CREATE INDEX IF NOT EXISTS idx_aufmass_rows_ein_status
    ON aufmass_rows (tenant_id, project_id, ein_status)
    WHERE ein_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_aufmass_rows_apl_status
    ON aufmass_rows (tenant_id, project_id, apl_status)
    WHERE apl_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_aufmass_rows_otdr_status
    ON aufmass_rows (tenant_id, project_id, otdr_status)
    WHERE otdr_status IS NOT NULL;

-- OTDR auto-trigger query: find rows where apl+kp done but otdr not done/waiting
-- Source: dataRoutes.js OTDR auto-trigger logic
CREATE INDEX IF NOT EXISTS idx_aufmass_rows_otdr_trigger
    ON aufmass_rows (tenant_id, project_id, apl_status, kp_status, otdr_status);

-- GIN index on JSONB data (for future full-text/key-value searches on data)
CREATE INDEX IF NOT EXISTS idx_aufmass_rows_data_gin
    ON aufmass_rows USING GIN (data);

-- =============================================================================
-- ACCESS_CONTROL
-- =============================================================================

-- Lookup user ACL entry (canAccessProject, canEditProject, etc.)
-- Source: accessControl.js — called on virtually every API route
CREATE INDEX IF NOT EXISTS idx_acl_tenant_user
    ON access_control (tenant_id, user_id);

-- Access control projects: find all project permissions for a user
CREATE INDEX IF NOT EXISTS idx_acp_acl_id
    ON access_control_projects (access_control_id);

-- Find all users who have access to a specific project (getProjectMembers)
-- Source: accessControl.js getProjectMembers()
CREATE INDEX IF NOT EXISTS idx_acp_project
    ON access_control_projects (project_id, can_access)
    WHERE can_access = TRUE;

-- =============================================================================
-- CHAT_MESSAGES
-- =============================================================================

-- Fetch messages for a project (oldest-first, paginated)
-- Source: chatDb.js getMessages() — ORDER BY id ASC LIMIT ? OFFSET ?
CREATE INDEX IF NOT EXISTS idx_chat_project_id
    ON chat_messages (tenant_id, project_id, id ASC)
    WHERE deleted = FALSE;

-- Long-poll: getNewMessages WHERE id > after_id
-- Source: chatDb.js getNewMessages()
CREATE INDEX IF NOT EXISTS idx_chat_project_after_id
    ON chat_messages (tenant_id, project_id, id)
    WHERE deleted = FALSE;

-- =============================================================================
-- ACTION_LOGS
-- =============================================================================

-- List logs (admin panel: GET /api/admin/logs — newest first)
-- Source: logger.js getLogs() — unshift (newest first in V2)
CREATE INDEX IF NOT EXISTS idx_action_logs_tenant_ts
    ON action_logs (tenant_id, timestamp DESC);

-- Search logs by action or details
-- Source: GET /api/admin/logs/search?query=X
CREATE INDEX IF NOT EXISTS idx_action_logs_action
    ON action_logs (tenant_id, LOWER(action));

CREATE INDEX IF NOT EXISTS idx_action_logs_user
    ON action_logs (tenant_id, user_email, timestamp DESC);

-- Full-text search on details (GIN index)
CREATE INDEX IF NOT EXISTS idx_action_logs_details_gin
    ON action_logs USING GIN (to_tsvector('german', COALESCE(details, '')));

-- =============================================================================
-- SESSION_LOGS
-- =============================================================================

-- Get session history for a user (GET /api/admin/user-sessions/:email)
-- Source: sessionLogger.js getSessionHistory()
CREATE INDEX IF NOT EXISTS idx_session_logs_email_ts
    ON session_logs (user_email, timestamp DESC);

-- Get last login (getLastLogin = filter action='login', last entry)
CREATE INDEX IF NOT EXISTS idx_session_logs_email_action
    ON session_logs (user_email, action, timestamp DESC);

-- Tenant-scoped session query
CREATE INDEX IF NOT EXISTS idx_session_logs_tenant_ts
    ON session_logs (tenant_id, timestamp DESC)
    WHERE tenant_id IS NOT NULL;

-- =============================================================================
-- SUPER_LOGS (partitioned)
-- =============================================================================
-- Indexes must be created on each partition or on parent (PG 11+ creates on all partitions)

-- Filter by type (most common query: getSuperLogs({ types: ['auth'] }))
-- Source: superLogger.js getSuperLogs() filters
CREATE INDEX IF NOT EXISTS idx_super_logs_tenant_type_ts
    ON super_logs (tenant_id, type, timestamp DESC);

-- Filter by level
CREATE INDEX IF NOT EXISTS idx_super_logs_level_ts
    ON super_logs (level, timestamp DESC);

-- After-id polling: getSuperLogs({ after_id: N })
CREATE INDEX IF NOT EXISTS idx_super_logs_id ON super_logs (id DESC);

-- GIN on meta JSONB for flexible filtering
CREATE INDEX IF NOT EXISTS idx_super_logs_meta_gin
    ON super_logs USING GIN (meta);

-- =============================================================================
-- FILE_SHARES
-- =============================================================================

-- Public share lookup by ID (the /share/:shareId route)
-- PK lookup is already indexed. Additional: find unexpired shares.
CREATE INDEX IF NOT EXISTS idx_file_shares_expires
    ON file_shares (expires_at)
    WHERE expires_at > NOW();

-- List shares for a project + file path
-- Source: fileRoutes.js GET /api/files/shares?project=X&filePath=Y
CREATE INDEX IF NOT EXISTS idx_file_shares_project_path
    ON file_shares (tenant_id, project_id, file_path);

-- =============================================================================
-- FILE_TRASH
-- =============================================================================

-- List trash items for a project
-- Source: fileRoutes.js GET /api/files/trash?project=X
CREATE INDEX IF NOT EXISTS idx_file_trash_project
    ON file_trash (tenant_id, project_id, expires_at);

-- Cleanup expired trash (cleanExpiredTrash)
CREATE INDEX IF NOT EXISTS idx_file_trash_expires
    ON file_trash (expires_at);

-- =============================================================================
-- MODULE_FILES
-- =============================================================================

-- Lookup file metadata by project + path
-- Source: fileMeta.js getFileMeta() — called on file listing and uploads
CREATE INDEX IF NOT EXISTS idx_module_files_project_path
    ON module_files (tenant_id, project_id, relative_path);

-- =============================================================================
-- PERFORMANCE NOTES
-- =============================================================================
-- 1. aufmass_rows is the hottest table. The GIN index on data JSONB is expensive
--    to write but enables powerful search. Monitor write performance after 10k+ rows.
--
-- 2. super_logs is high-volume (every HTTP request). The PARTITION BY RANGE 
--    strategy means each month's data is in a smaller table. Add new partition 
--    monthly via a cron job:
--    CREATE TABLE super_logs_2026_07 PARTITION OF super_logs
--        FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
--
-- 3. chat_messages uses BIGSERIAL (not UUID) to match V2's integer ID for 
--    the after_id long-poll cursor. This is intentional.
--
-- 4. action_logs full-text search uses 'german' dictionary to match the 
--    German-language details strings (Aufmass column names are German).

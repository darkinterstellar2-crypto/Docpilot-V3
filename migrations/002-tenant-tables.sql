-- =============================================================================
-- DocPilot-V3 — Tenant-Scoped Tables
-- =============================================================================
-- ALL tables here have: tenant_id UUID NOT NULL
-- ALL tables here will have RLS policies (see 03-rls-policies.sql)
-- Sources: All TheApp/routes/ and TheApp/controllers/ files
-- =============================================================================

-- =============================================================================
-- TABLE: projects
-- =============================================================================
-- Project metadata. Each project is one fiber-optic build job.
-- Source: TheApp/routes/projectRoutes.js, TheApp/src/DataFiles/projects.json
-- V2 structure: [{ name, locations: [], status }] (JSON array, name is PK)
-- =============================================================================
CREATE TABLE projects (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                            -- Which tenant owns this project.

    name        TEXT        NOT NULL,
                            -- Project name. The primary human key used everywhere in V2.
                            -- Source: projects.json → name field
                            -- Used as folder name in storage: storage/<name>/
                            -- Business rule: UNIQUE per tenant (case-insensitive enforced)

    status      TEXT        NOT NULL DEFAULT 'active',
                            -- Project status. Values seen in code: 'active', 'completed', 'on-hold'.
                            -- Source: projects.json → status field
                            -- Changed via POST /api/projects/status (canDashboard changeStatus)

    sort_order  INTEGER     NOT NULL DEFAULT 0,
                            -- Display order. V2 allows reordering left/right (POST /reorder).
                            -- Source: Implicit in projects.json array index order

    storage_path TEXT       DEFAULT NULL,
                            -- Absolute path to project storage dir on disk/object storage.
                            -- V2: STORAGE_ROOT/<name>/ — in V3 this becomes a bucket prefix.
                            -- Stored here for reference during migration.

    created_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
                            -- User who created this project.
                            -- Source: authRoutes x-user-email header on POST /api/projects/create

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (tenant_id, LOWER(name))
                            -- Project names are unique per tenant (case-insensitive)
);

COMMENT ON TABLE projects IS 'Fiber-optic build projects. One project = one physical deployment job. Each has its own Aufmass table, file storage, and modules.';
COMMENT ON COLUMN projects.name IS 'Human-readable project name. Also used as the filesystem folder name. Unique per tenant.';

CREATE TRIGGER projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- TABLE: project_clusters
-- =============================================================================
-- Clusters within a project (geographic zones / construction batches).
-- Source: TheApp/routes/projectRoutes.js → locations[] array in projects.json
-- V2: projects.json → { name, locations: ["SUPPN", "BHUEL", ...], status }
-- =============================================================================
CREATE TABLE project_clusters (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                            -- Tenant isolation column.

    project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                            -- Which project this cluster belongs to.

    name        TEXT        NOT NULL,
                            -- Cluster name (e.g. "SUPPN", "BHUEL").
                            -- Source: projects.json → locations[] items
                            -- Also the folder name: storage/<P>/Doku/<ClusterName>/

    sort_order  INTEGER     NOT NULL DEFAULT 0,
                            -- Order within the project. Mirrors the array index in V2.

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (tenant_id, project_id, LOWER(name))
                            -- Cluster names are unique per project (case-insensitive)
);

COMMENT ON TABLE project_clusters IS 'Geographic clusters within a project. Formerly the locations[] array in projects.json.';

-- =============================================================================
-- TABLE: project_knotenpunkte
-- =============================================================================
-- NVT/Knotenpunkt junction points within a cluster.
-- Source: TheApp/routes/projectRoutes.js → GET/POST /:projectName/knotenpunkte
-- V2: Derived from filesystem (APL/<Knotenpunkt>/ folders) + aufmass data file
-- =============================================================================
CREATE TABLE project_knotenpunkte (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    cluster_id  UUID        NOT NULL REFERENCES project_clusters(id) ON DELETE CASCADE,
                            -- Which cluster this knotenpunkt belongs to.

    name        TEXT        NOT NULL,
                            -- Knotenpunkt name (e.g. "NVT-001", "Bestand Schacht_1").
                            -- Source: Filesystem folder names + aufmass data column 'Knotenpunkt'/'NVT'
                            -- Also used as subfolder: storage/<P>/Doku/<Cluster>/APL/<Knotenpunkt>/

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (tenant_id, project_id, cluster_id, LOWER(name))
);

COMMENT ON TABLE project_knotenpunkte IS 'NVT/junction points within a cluster. Formerly implicit in the filesystem folder structure and aufmass data.';

-- =============================================================================
-- TABLE: project_info
-- =============================================================================
-- Project description and custom label:value fields.
-- Source: TheApp/routes/projectInfoRoutes.js, TheApp/src/DataFiles/project-info.json
-- V2 structure: { "ProjectName": { description: "", fields: [{label, value}], members: [] } }
-- =============================================================================
CREATE TABLE project_info (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    project_id      UUID        NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
                                -- One-to-one with projects. UNIQUE enforced.
                                -- Source: project-info.json → keyed by project name

    description     TEXT        NOT NULL DEFAULT '',
                                -- Free-text project description.
                                -- Source: project-info.json → description field
                                -- Set via PUT /api/project-info/:project

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE project_info IS 'Human-readable project description and custom fields. Formerly project-info.json.';

CREATE TRIGGER project_info_updated_at
    BEFORE UPDATE ON project_info
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- TABLE: project_info_fields
-- =============================================================================
-- Custom label:value fields per project (the fields[] array in project-info.json).
-- Source: TheApp/routes/projectInfoRoutes.js → fields array
-- V2: project-info.json → { "Project": { fields: [{ label, value }] } }
-- =============================================================================
CREATE TABLE project_info_fields (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    project_info_id UUID        NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
                                -- Parent project_info record.

    label           TEXT        NOT NULL,
                                -- Field label (e.g. "Auftraggeber", "Baustart").
                                -- Source: project-info.json → fields[i].label
                                -- Validated: typeof label === 'string' (projectInfoRoutes)

    value           TEXT        NOT NULL DEFAULT '',
                                -- Field value (free text).
                                -- Source: project-info.json → fields[i].value

    sort_order      INTEGER     NOT NULL DEFAULT 0
                                -- Display order within the project's fields array.
);

COMMENT ON TABLE project_info_fields IS 'Custom label:value fields per project. Formerly the fields[] array in project-info.json.';

-- =============================================================================
-- TABLE: aufmass_schemas
-- =============================================================================
-- The column schema configuration for a project's Aufmass table.
-- Source: TheApp/routes/dataRoutes.js, TheApp/src/DataFiles/schema.json
-- V2: Stored inline in the .txt data file as E1 (group names) + E2[0] (sub-columns).
-- Also the static default schema.json (12 groups).
-- =============================================================================
CREATE TABLE aufmass_schemas (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- The schema is stored as JSONB matching the API response format:
    -- [{ id: "grp-0", title: "Timing", cols: [{ id: "col-0-0", label: "Date" }] }, ...]
    -- Source: dataRoutes.js GET /api/data → schema array (built from E1 + E2_0)
    schema_json JSONB       NOT NULL DEFAULT '[]',
                            -- Full schema definition as returned by the API.
                            -- Each item: { id, title, cols: [{id, label}] }

    -- Also store raw E1 + E2_0 for reconstruction:
    e1_json     JSONB       NOT NULL DEFAULT '[]',
                            -- E1 = ["GroupName0", "GroupName1", ...]
                            -- Source: raw .txt file → rawData[0]

    e2_0_json   JSONB       NOT NULL DEFAULT '[]',
                            -- E2[0] = [["SubCol0a", "SubCol0b"], ["SubCol1a"], ...]
                            -- Source: raw .txt file → rawData[1][0]

    version     INTEGER     NOT NULL DEFAULT 1,
                            -- Schema version counter. Incremented when schema changes.

    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
                            -- Whether this is the current active schema for the project.

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by  UUID        REFERENCES users(id) ON DELETE SET NULL
);

COMMENT ON TABLE aufmass_schemas IS 'Column schema for a project Aufmass table. Stores E1 (group names) and E2_0 (sub-column labels). One active schema per project.';
COMMENT ON COLUMN aufmass_schemas.schema_json IS 'Schema in API format: [{id, title, cols:[{id,label}]}]. Matches what GET /api/data returns.';
COMMENT ON COLUMN aufmass_schemas.e1_json IS 'Raw E1 array from .txt file format: ["GroupName0", ...]. Needed for file reconstruction during migration.';

-- Only one active schema per project
CREATE UNIQUE INDEX idx_aufmass_schemas_active
    ON aufmass_schemas (project_id)
    WHERE is_active = TRUE;

-- =============================================================================
-- TABLE: aufmass_rows
-- =============================================================================
-- One row per cable segment in the Aufmass table.
-- Source: TheApp/routes/dataRoutes.js, actual data in storage/.../datafile/*.txt
-- V2: Each .txt file row = one segment. Row ID = row[0][0] (e.g. "ROW-0", "ROW-47")
--
-- DESIGN DECISION: JSONB (Option B) for data storage.
-- See 00-schema-overview.md for full rationale.
-- Promoted columns for fast querying: row_key, cluster, knotenpunkt, + key statuses.
-- =============================================================================
CREATE TABLE aufmass_rows (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    project_id      UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    schema_id       UUID        REFERENCES aufmass_schemas(id) ON DELETE SET NULL,
                                -- Which schema version this row was written with.

    row_key         TEXT        NOT NULL,
                                -- The original row _id from V2 (e.g. "ROW-0", "ROW-47").
                                -- Source: data rows → row[0][0]
                                -- Used for optimistic locking and import identity.

    version         INTEGER     NOT NULL DEFAULT 0,
                                -- Optimistic lock version. Source: storage/<P>/row-versions.json
                                -- V2: rowVersions[rowId] (integer, starts at 0)
                                -- Incremented on every successful save of this row.

    -- === PROMOTED COLUMNS (for fast queries/filters) ===

    cluster         TEXT        DEFAULT NULL,
                                -- Value of the 'Cluster' column for this row.
                                -- Source: col labeled 'cluster' in schema (case-insensitive match)
                                -- Example: "SUPPN", "BHUEL"

    knotenpunkt     TEXT        DEFAULT NULL,
                                -- Value of 'Knotenpunkt' or 'NVT' column.
                                -- Source: col labeled 'knotenpunkt' or 'nvt' in schema
                                -- Example: "NVT-001", "Bestand Schacht_1"

    row_date        TEXT        DEFAULT NULL,
                                -- Value of 'Date' column (stored as text to preserve German format "DD.MM.YYYY").
                                -- Source: col labeled 'date' in schema

    -- === MODULE STATUS COLUMNS (for dashboard/planner queries) ===

    ein_status      TEXT        DEFAULT NULL,
                                -- Einblasen status. Values: 'Done', 'Waiting', 'In Progress', '', 'N/A'
                                -- Source: col labeled 'einblasen' group → 'Status' sub-col
                                -- Auto-populated from data JSONB on write.

    kal_status      TEXT        DEFAULT NULL,
                                -- Kalibrieren status. Same value set as ein_status.

    dru_status      TEXT        DEFAULT NULL,
                                -- Druckprüfung status. Same value set.

    apl_status      TEXT        DEFAULT NULL,
                                -- APL Splicing status. Can also be 'Waiting for Weigenheim' (added 2026-05-05).
                                -- Source: col labeled 'apl status' (case-insensitive)

    kp_status       TEXT        DEFAULT NULL,
                                -- Knotenpunkt status (part of the Splicing group in V2).
                                -- Source: col labeled 'knotenpunkt status'

    otdr_status     TEXT        DEFAULT NULL,
                                -- OTDR Testing status.
                                -- Source: col labeled 'otdr' group → 'Status' sub-col
                                -- Business rule: auto-set to 'Waiting' when apl_status='Done' AND kp_status='Done'

    -- === FULL DATA ===

    data            JSONB       NOT NULL DEFAULT '{}',
                                -- All column values keyed by col-id: { "col-0-0": "ROW-5", "col-1-0": "24.11.2025", ... }
                                -- Source: flatData object from V2 API response
                                -- Business rule: col IDs are "col-{groupIdx}-{colIdx}" (0-based)

    -- === AUDIT ===

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
                                -- Last user to save this row.
                                -- Source: x-user-email header on POST /api/data

    is_deleted      BOOLEAN     NOT NULL DEFAULT FALSE,
                                -- Soft delete flag (future use).

    UNIQUE (tenant_id, project_id, row_key)
                                -- row_key is unique per project (V2 invariant)
);

COMMENT ON TABLE aufmass_rows IS 'One row per fiber cable segment in the Aufmass table. Stores all column data as JSONB with promoted columns for frequent query fields.';
COMMENT ON COLUMN aufmass_rows.data IS 'Full column data: {"col-0-0": "ROW-5", "col-1-0": "24.11.2025", ...}. Keys match schema col IDs.';
COMMENT ON COLUMN aufmass_rows.version IS 'Optimistic lock counter. V2 reads this from row-versions.json. Check version matches before UPDATE.';

CREATE TRIGGER aufmass_rows_updated_at
    BEFORE UPDATE ON aufmass_rows
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- TABLE: access_control
-- =============================================================================
-- Per-user, per-tenant ACL entry with global flags and authority permissions.
-- Source: TheApp/controllers/accessControl.js, src/DataFiles/access-control.json
-- V2 structure per email:
--   { fullAccess: bool, authority: { createProject, deleteProject, ... }, projects: { ... } }
-- =============================================================================
CREATE TABLE access_control (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                -- The user this ACL entry applies to.
                                -- V2 keyed by email; V3 uses UUID.

    -- === GLOBAL FLAGS ===

    full_access     BOOLEAN     NOT NULL DEFAULT FALSE,
                                -- If true: user has read+write on EVERYTHING in this tenant.
                                -- Source: access-control.json → fullAccess
                                -- Example: MrO AI account has fullAccess: true
                                -- Bypasses all project/module checks.

    -- === AUTHORITY / DASHBOARD PERMISSIONS ===
    -- Source: access-control.json → authority (V2 also calls this 'dashboard' — backward compat)

    can_create_project  BOOLEAN NOT NULL DEFAULT FALSE,
                                -- Source: authority.createProject
                                -- Checked by canDashboard('createProject') in projectRoutes.js

    can_delete_project  BOOLEAN NOT NULL DEFAULT FALSE,
                                -- Source: authority.deleteProject
                                -- Checked by canDashboard('deleteProject')

    can_change_status   BOOLEAN NOT NULL DEFAULT FALSE,
                                -- Source: authority.changeStatus
                                -- Checked by canDashboard('changeStatus')

    can_reorder_projects BOOLEAN NOT NULL DEFAULT FALSE,
                                -- Source: authority.reorderProjects
                                -- Checked by canDashboard('reorderProjects')

    can_download_zip    BOOLEAN NOT NULL DEFAULT FALSE,
                                -- Source: authority.downloadZip
                                -- Checked by canDashboard('downloadZip')

    can_edit_project_info BOOLEAN NOT NULL DEFAULT FALSE,
                                -- Source: authority.editProjectInfo (added later in V2)
                                -- Checked in projectInfoRoutes.js PUT handler

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (tenant_id, user_id)
                                -- One ACL entry per user per tenant
);

COMMENT ON TABLE access_control IS 'Per-user ACL entry for a tenant. Stores global fullAccess flag and dashboard authority permissions. Formerly access-control.json.';
COMMENT ON COLUMN access_control.full_access IS 'fullAccess=true means all project and module checks return true. Used for MrO AI assistant account.';

CREATE TRIGGER access_control_updated_at
    BEFORE UPDATE ON access_control
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- TABLE: access_control_projects
-- =============================================================================
-- Per-user, per-project permissions within the ACL.
-- Source: access-control.json → projects[ProjectName] → { access, canEdit, modules: {...} }
-- =============================================================================
CREATE TABLE access_control_projects (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    access_control_id UUID      NOT NULL REFERENCES access_control(id) ON DELETE CASCADE,
                                -- Parent ACL entry (user + tenant).

    project_id      UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                                -- Which project these permissions apply to.
                                -- V2: access-control.json → projects[ProjectName]

    can_access      BOOLEAN     NOT NULL DEFAULT FALSE,
                                -- Can this user see this project?
                                -- Source: projects[Name].access

    can_edit        BOOLEAN     NOT NULL DEFAULT FALSE,
                                -- Can this user write/edit data in this project?
                                -- Source: projects[Name].canEdit
                                -- Checked by canEditProject() in dataRoutes, fileRoutes

    -- Module permissions stored as JSONB to match V2's dynamic module list.
    -- Known modules: aufmass, files, druckprufung, kalibrieren, einblasen, apl,
    --                knotenpunkt, otdr, chat, planner
    -- Source: projects[Name].modules → { "aufmass": true, "files": false, ... }
    modules         JSONB       NOT NULL DEFAULT '{}',
                                -- Example: {"aufmass": true, "files": true, "chat": true, "planner": false}
                                -- Checked by canAccessModule() in accessControl.js
                                -- Business rule: missing key = allowed by default (within accessible project)

    UNIQUE (tenant_id, access_control_id, project_id)
);

COMMENT ON TABLE access_control_projects IS 'Per-project permissions for a user ACL entry. Stores access, canEdit, and per-module flags. Formerly projects[Name] in access-control.json.';
COMMENT ON COLUMN access_control_projects.modules IS 'JSONB map of module name → boolean. Known modules: aufmass, files, druckprufung, kalibrieren, einblasen, apl, knotenpunkt, otdr, chat, planner.';

-- =============================================================================
-- TABLE: module_files
-- =============================================================================
-- File metadata: who uploaded/modified a file and when.
-- Source: TheApp/controllers/fileMeta.js, storage/<P>/.filemeta.json
-- V2 structure: { "rel/path/to/file": { modifiedBy: email, modifiedAt: ISO } }
-- =============================================================================
CREATE TABLE module_files (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    project_id      UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    relative_path   TEXT        NOT NULL,
                                -- Relative path within the project storage root.
                                -- Source: .filemeta.json → key (forward slashes, no leading slash)
                                -- Example: "Doku/SUPPN/APL/NVT-001/photo.jpg"

    modified_by     TEXT        NOT NULL,
                                -- Email of user who uploaded/last modified this file.
                                -- Source: .filemeta.json → modifiedBy
                                -- Stored as email (TEXT) not UUID because uploads come from x-user-email header

    modified_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                                -- When the file was last modified.
                                -- Source: .filemeta.json → modifiedAt (ISO string)

    file_size       BIGINT      DEFAULT NULL,
                                -- File size in bytes. Not in V2 but useful for V3.

    mime_type       TEXT        DEFAULT NULL,
                                -- MIME type. Not in V2 but useful for V3.

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (tenant_id, project_id, relative_path)
                                -- One metadata entry per file path per project
);

COMMENT ON TABLE module_files IS 'File metadata: who uploaded what and when. Formerly .filemeta.json in each project root.';
COMMENT ON COLUMN module_files.relative_path IS 'Path relative to project storage root. Forward slashes. Example: "Doku/SUPPN/APL/NVT-001/photo.jpg"';

-- =============================================================================
-- TABLE: file_shares
-- =============================================================================
-- Share link tokens for files and folders.
-- Source: TheApp/routes/fileRoutes.js share routes, src/DataFiles/shares.json
-- V2 structure: { shares: { "<shareId>": { project, filePath, fileName, type, createdBy, createdAt, expiresAt, accessCount } } }
-- =============================================================================
CREATE TABLE file_shares (
    id              TEXT        PRIMARY KEY,
                                -- Cryptographically secure 12-char base64url token.
                                -- Source: crypto.randomBytes(9).toString('base64url')
                                -- Used in URL: /share/<shareId>

    tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    project_id      UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    file_path       TEXT        NOT NULL,
                                -- Relative path to the shared file/folder within the project.
                                -- Source: shares.json → filePath

    file_name       TEXT        NOT NULL,
                                -- Display name (basename of file_path).
                                -- Source: shares.json → fileName (path.basename(filePath))

    type            TEXT        NOT NULL DEFAULT 'file',
                                -- 'file' or 'folder'.
                                -- Source: shares.json → type (derived from fs.stat().isDirectory())

    created_by      TEXT        NOT NULL,
                                -- Email of user who created the share.
                                -- Source: shares.json → createdBy (x-user-email header)

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                                -- Source: shares.json → createdAt

    expires_at      TIMESTAMPTZ NOT NULL,
                                -- Expiry time. V2: 1–720 hours (default 168 = 7 days).
                                -- Source: shares.json → expiresAt

    access_count    INTEGER     NOT NULL DEFAULT 0
                                -- Number of times this share has been accessed.
                                -- Source: shares.json → accessCount (incremented on each download)
);

COMMENT ON TABLE file_shares IS 'Share link tokens. Each row is one public link to a file or folder. Formerly shares.json.';
COMMENT ON COLUMN file_shares.id IS '12-char base64url token from crypto.randomBytes(9). Public share URL: /share/<id>';
COMMENT ON COLUMN file_shares.expires_at IS 'V2 enforces 1–720 hour expiry window (default 168h = 7 days).';

-- =============================================================================
-- TABLE: file_trash
-- =============================================================================
-- Trash manifest: files/folders moved to project .trash directory.
-- Source: TheApp/controllers/trashHelper.js, TheApp/routes/fileRoutes.js
-- Source: storage/<P>/.trash/.manifest.json
-- V2 manifest structure: { items: [{ id, originalName, originalPath, trashName, deletedBy, deletedAt, isDir, expiresAt }] }
-- =============================================================================
CREATE TABLE file_trash (
    id              TEXT        PRIMARY KEY,
                                -- V2 uses timestamp (Date.now().toString()) as the ID.
                                -- Source: .manifest.json → id field

    tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    project_id      UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    original_name   TEXT        NOT NULL,
                                -- Original filename or folder name.
                                -- Source: .manifest.json → originalName

    original_path   TEXT        NOT NULL DEFAULT '',
                                -- Relative path of the parent directory where the item lived.
                                -- Source: .manifest.json → originalPath
                                -- Used for restore: path.join(originalPath, originalName)

    trash_name      TEXT        NOT NULL,
                                -- Name in the .trash folder: "<originalName>_<timestamp>"
                                -- Source: .manifest.json → trashName
                                -- Used to locate the file for restore/purge

    deleted_by      TEXT        NOT NULL DEFAULT 'System',
                                -- Email of user who deleted, or 'System' for auto-trash.
                                -- Source: .manifest.json → deletedBy

    deleted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                                -- Source: .manifest.json → deletedAt

    expires_at      TIMESTAMPTZ NOT NULL,
                                -- 30-day expiry from deleted_at.
                                -- Source: trashHelper.js: new Date(now + 30*24*60*60*1000)
                                -- Items past this are permanently deleted on next cleanExpiredTrash().

    is_dir          BOOLEAN     NOT NULL DEFAULT FALSE
                                -- Is this a directory or a file?
                                -- Source: .manifest.json → isDir (always true in trashHelper.js, variable in fileRoutes.js)
);

COMMENT ON TABLE file_trash IS 'Trash manifest. One row per trashed item. Files physically live in storage/<P>/.trash/<trashName>. Formerly .manifest.json.';
COMMENT ON COLUMN file_trash.expires_at IS '30-day expiry. Past this date, item is permanently deleted. Source: trashHelper.js 30*24*60*60*1000 ms.';

-- =============================================================================
-- TABLE: chat_messages
-- =============================================================================
-- All chat messages across all projects (replaces per-project SQLite).
-- Source: TheApp/controllers/chatDb.js SQLite schema + migration logic
-- V2 SQLite schema: messages(id, user_email, user_name, message, media_url, media_type, original_filename, created_at, edited_at, deleted)
-- =============================================================================
CREATE TABLE chat_messages (
    id              BIGSERIAL   PRIMARY KEY,
                                -- Auto-incrementing ID. V2 uses SQLite AUTOINCREMENT (integer PK).
                                -- Used for long-polling: getNewMessages WHERE id > after_id

    tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    project_id      UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                                -- Which project's chat this message belongs to.
                                -- V2: Per-project DB at storage/<P>/chat/chat.db (no project column needed)

    user_email      TEXT        NOT NULL,
                                -- Sender's email address.
                                -- Source: chatDb.js → user_email column

    user_name       TEXT        NOT NULL,
                                -- Sender's display name at time of sending.
                                -- Source: chatDb.js → user_name column
                                -- Note: Stored denormalized (name can change later, this is historical)

    message         TEXT        NOT NULL DEFAULT '',
                                -- Message text content. Can be empty if media-only.
                                -- Source: chatDb.js → message column

    media_url       TEXT        DEFAULT NULL,
                                -- Relative URL to attached media file.
                                -- Source: chatDb.js → media_url column
                                -- Physical file at storage/<P>/chat/media/<filename>

    media_type      TEXT        DEFAULT NULL,
                                -- MIME type of attached media (e.g. 'image/jpeg', 'video/mp4').
                                -- Source: chatDb.js → media_type column

    original_filename TEXT      DEFAULT NULL,
                                -- Original filename of uploaded attachment.
                                -- Source: chatDb.js → original_filename column

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                                -- Source: chatDb.js → created_at (SQLite datetime('now'))

    edited_at       TIMESTAMPTZ DEFAULT NULL,
                                -- Set when message text is edited.
                                -- Source: chatDb.js → edited_at (updated by editMessage())

    deleted         BOOLEAN     NOT NULL DEFAULT FALSE
                                -- Soft-delete flag. V2 uses INTEGER 0/1.
                                -- Source: chatDb.js → deleted column (soft delete via UPDATE SET deleted=1)
                                -- Superadmin can delete any message; users only their own.
);

COMMENT ON TABLE chat_messages IS 'All chat messages. Replaces per-project SQLite DBs at storage/<P>/chat/chat.db. Uses BIGSERIAL for long-poll compatibility (after_id cursor).';
COMMENT ON COLUMN chat_messages.media_url IS 'Relative path to media file. Physical file stays in object storage/filesystem.';

-- =============================================================================
-- TABLE: action_logs
-- =============================================================================
-- Audit trail of user actions.
-- Source: TheApp/controllers/logger.js, src/DataFiles/logs.json
-- V2 structure: [{ id (timestamp string), timestamp, user (email), action, details }]
-- V2 limit: last 1000 entries (oldest popped). DB has no such limit.
-- =============================================================================
CREATE TABLE action_logs (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    user_email      TEXT        NOT NULL,
                                -- Email of user who performed the action.
                                -- Source: logs.json → user field
                                -- Stored as TEXT (not FK) to preserve historical email even if user deleted

    action          TEXT        NOT NULL,
                                -- Short action label.
                                -- Source: logs.json → action field
                                -- Examples: 'Login Success', 'Data Saved', 'Project Created', 'User Approved'

    details         TEXT        NOT NULL DEFAULT '',
                                -- Human-readable detail string (may be multi-line for Aufmass diffs).
                                -- Source: logs.json → details field
                                -- Example: 'Row "ROW-5" | Cluster: SUPPN\n  - "ein_status": "" → "Done"'

    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
                                -- When the action occurred.
                                -- Source: logs.json → timestamp (ISO string)
);

COMMENT ON TABLE action_logs IS 'Audit trail of all user actions. Formerly logs.json (capped at 1000). DB is uncapped with archival strategy.';
COMMENT ON COLUMN action_logs.details IS 'Can be multi-line for Aufmass cell diffs. Format matches V2 logAction() output.';

-- =============================================================================
-- TABLE: session_logs
-- =============================================================================
-- Login/logout/force-terminate events with device and IP info.
-- Source: TheApp/controllers/sessionLogger.js, src/DataFiles/sessions-log.json
-- V2 structure: [{ email, name, action, timestamp, ip, userAgent, device }]
-- =============================================================================
CREATE TABLE session_logs (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id       UUID        REFERENCES tenants(id) ON DELETE SET NULL,
                                -- Nullable: failed logins before tenant context is known have no tenant_id.

    user_email      TEXT        NOT NULL,
                                -- Source: sessions-log.json → email

    user_name       TEXT        NOT NULL DEFAULT 'Unknown',
                                -- Display name at time of event.
                                -- Source: sessions-log.json → name

    action          TEXT        NOT NULL,
                                -- 'login' | 'logout' | 'login_failed' | 'force_terminated'
                                -- Source: sessions-log.json → action
                                -- logSession() in sessionLogger.js

    ip_address      TEXT        NOT NULL DEFAULT 'unknown',
                                -- Client IP address.
                                -- Source: sessions-log.json → ip (req.ip)

    user_agent      TEXT        NOT NULL DEFAULT '',
                                -- Raw User-Agent header string.
                                -- Source: sessions-log.json → userAgent

    device          TEXT        NOT NULL DEFAULT 'Unknown',
                                -- Parsed friendly device label: "Chrome on Windows".
                                -- Source: sessions-log.json → device (parseDevice() output)

    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                                -- Source: sessions-log.json → timestamp (ISO string)

    CONSTRAINT session_logs_action_check CHECK (action IN ('login', 'logout', 'login_failed', 'force_terminated'))
);

COMMENT ON TABLE session_logs IS 'Login/logout events with IP and device info. Formerly sessions-log.json (capped at 10000).';

-- =============================================================================
-- TABLE: super_logs
-- =============================================================================
-- High-volume HTTP request log + system events (superadmin only).
-- Source: TheApp/controllers/superLogger.js, src/DataFiles/super-log.json
-- V2 structure: [{ id, timestamp, type, level, message, meta }]
-- V2: In-memory ring buffer (5000 entries) + flushed to disk every 30s.
-- V3: Write to DB. PARTITION BY RANGE (timestamp) for performance.
-- =============================================================================
CREATE TABLE super_logs (
    id              BIGSERIAL   PRIMARY KEY,
                                -- Sequential ID. V2 uses in-memory counter.
                                -- Used for polling: getSuperLogs WHERE id > after_id

    tenant_id       UUID        REFERENCES tenants(id) ON DELETE SET NULL,
                                -- Nullable: system-level events may not have a tenant.

    type            TEXT        NOT NULL DEFAULT 'system',
                                -- Log category.
                                -- Source: superLogger.js → type param
                                -- Values: 'request' | 'auth' | 'file' | 'sync' | 'chat' | 'error' | 'system' | 'admin'

    level           TEXT        NOT NULL DEFAULT 'info',
                                -- Log severity.
                                -- Source: superLogger.js → level param
                                -- Values: 'debug' | 'info' | 'warn' | 'error'

    message         TEXT        NOT NULL DEFAULT '',
                                -- Human-readable log message.
                                -- Source: super-log.json → message
                                -- Example: "POST /api/data 200 45ms user@example.com"

    meta            JSONB       NOT NULL DEFAULT '{}',
                                -- Structured metadata for the event.
                                -- Source: super-log.json → meta object
                                -- For 'request' type: { method, url, query, status, responseTime, ip, userEmail }
                                -- For 'auth' type: { email, ip, userAgent, role }

    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
                                -- Source: super-log.json → timestamp (ISO string)

) PARTITION BY RANGE (timestamp);
                                -- Partition by month for performance. Create partitions:
                                -- super_logs_2026_05, super_logs_2026_06, etc.

COMMENT ON TABLE super_logs IS 'HTTP request log + system events. Partitioned by month. Replaces in-memory ring buffer + super-log.json.';
COMMENT ON COLUMN super_logs.meta IS 'Structured metadata. For request logs: {method, url, status, responseTime, ip, userEmail}. For auth: {email, ip, role}.';

-- Create initial partition (add more monthly)
CREATE TABLE super_logs_2026_05 PARTITION OF super_logs
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE super_logs_2026_06 PARTITION OF super_logs
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

-- =============================================================================
-- TABLE: tenant_settings
-- =============================================================================
-- Per-tenant configuration (formerly global settings.json).
-- Source: TheApp/routes/settingsRoutes.js, src/DataFiles/settings.json
-- V2 structure: { generatorCode, generatorUrl, generatorApiUrl, generatorAllowedUsers: [] }
-- =============================================================================
CREATE TABLE tenant_settings (
    id                      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id               UUID    NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
                                    -- One settings row per tenant. UNIQUE enforced.

    generator_code          TEXT    NOT NULL DEFAULT '',
                                    -- Access code for the generator tool.
                                    -- Source: settings.json → generatorCode
                                    -- Example: "GEGGOS2026"

    generator_url           TEXT    NOT NULL DEFAULT '',
                                    -- URL of the generator service.
                                    -- Source: settings.json → generatorUrl
                                    -- Example: "http://localhost:3001"

    generator_api_url       TEXT    NOT NULL DEFAULT '',
                                    -- API URL of the generator service.
                                    -- Source: settings.json → generatorApiUrl
                                    -- Example: "http://localhost:8000"

    generator_allowed_users TEXT[]  NOT NULL DEFAULT '{}',
                                    -- Emails of users who can access the generator tool.
                                    -- Source: settings.json → generatorAllowedUsers (array of email strings)
                                    -- Superadmin always has access regardless of this list.

    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE tenant_settings IS 'Per-tenant configuration. Formerly global settings.json. Currently only generator tool settings; will expand.';
COMMENT ON COLUMN tenant_settings.generator_allowed_users IS 'Array of email strings. Superadmins always have access. Others need to be listed here.';

CREATE TRIGGER tenant_settings_updated_at
    BEFORE UPDATE ON tenant_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

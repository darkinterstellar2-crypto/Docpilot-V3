#!/bin/bash
# =============================================================================
# setup-postgres.sh — Install PostgreSQL 16 and set up DocPilot database
# Run on VPS: 187.124.164.237
#
# Usage:
#   bash scripts/setup-postgres.sh
#
# Reads credentials from .env in the project root (or environment variables).
# Required vars: PG_USER, PG_PASSWORD, PG_DATABASE
# =============================================================================

set -euo pipefail

# ─── Load .env if present ────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [[ -f "$ENV_FILE" ]]; then
    echo "[setup] Loading .env from $ENV_FILE"
    set -o allexport
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +o allexport
fi

# ─── Config (with defaults) ──────────────────────────────────────────────────

DB_USER="${PG_USER:-docpilot_app}"
DB_PASS="${PG_PASSWORD:-}"
DB_NAME="${PG_DATABASE:-docpilot_db}"
MIGRATIONS_DIR="$SCRIPT_DIR/../migrations"

if [[ -z "$DB_PASS" ]]; then
    echo "❌ ERROR: PG_PASSWORD is not set. Add it to .env or export it."
    exit 1
fi

echo ""
echo "============================================================"
echo " DocPilot-V3 PostgreSQL Setup"
echo "============================================================"
echo " DB_NAME : $DB_NAME"
echo " DB_USER : $DB_USER"
echo " MIGRATIONS_DIR: $MIGRATIONS_DIR"
echo ""

# ─── 1. Install PostgreSQL 16 ────────────────────────────────────────────────

echo "[1/5] Installing PostgreSQL 16..."

if command -v psql &> /dev/null; then
    PG_VERSION=$(psql --version | grep -oP '\d+' | head -1)
    echo "      PostgreSQL $PG_VERSION already installed."
else
    echo "      Installing PostgreSQL 16 via apt..."
    apt-get update -qq

    # Add PostgreSQL official repo
    apt-get install -y -qq gnupg2 curl lsb-release
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | \
        gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg

    echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list

    apt-get update -qq
    apt-get install -y -qq postgresql-16 postgresql-client-16

    echo "      Starting PostgreSQL service..."
    systemctl enable postgresql
    systemctl start postgresql
    echo "      PostgreSQL 16 installed and started."
fi

# ─── 2. Create database ──────────────────────────────────────────────────────

echo ""
echo "[2/5] Creating database '$DB_NAME'..."

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" \
    | grep -q 1 && echo "      Database already exists." || \
    sudo -u postgres psql -c "CREATE DATABASE $DB_NAME ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' TEMPLATE template0;"

# ─── 3. Create user ──────────────────────────────────────────────────────────

echo ""
echo "[3/5] Creating user '$DB_USER'..."

sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER'" \
    | grep -q 1 && echo "      User already exists." || \
    sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"

# Grant privileges
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
sudo -u postgres psql -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO $DB_USER;"
sudo -u postgres psql -d "$DB_NAME" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DB_USER;"
sudo -u postgres psql -d "$DB_NAME" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;"

echo "      User created and granted privileges."

# ─── 4. Run SQL migration files ──────────────────────────────────────────────

echo ""
echo "[4/5] Running SQL migration files..."

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
    echo "❌ ERROR: migrations directory not found at $MIGRATIONS_DIR"
    exit 1
fi

SQL_FILES=(
    "001-global-tables.sql"
    "002-tenant-tables.sql"
    "003-rls-policies.sql"
    "004-indexes.sql"
    "005-seeds.sql"
)

for FILE in "${SQL_FILES[@]}"; do
    SQL_PATH="$MIGRATIONS_DIR/$FILE"
    if [[ -f "$SQL_PATH" ]]; then
        echo "      Running (as postgres superuser): $FILE"
        # CREATE ROLE / RLS policies / seed INSERTs need superuser + RLS bypass.
        # Run as postgres, NOT as the limited app login role.
        sudo -u postgres psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$SQL_PATH"
        echo "      ✓ $FILE done"
    else
        echo "      ⚠️  Skipping (not found): $FILE"
    fi
done

# ─── 5. Verify tables ────────────────────────────────────────────────────────

echo ""
echo "[5/5] Verifying tables..."

EXPECTED_TABLES=(
    "tenants"
    "users"
    "tenant_memberships"
    "platform_admins"
    "terminated_sessions"
    "projects"
    "project_clusters"
    "project_knotenpunkte"
    "project_info"
    "project_info_fields"
    "access_control"
    "access_control_projects"
    "aufmass_schemas"
    "aufmass_rows"
    "module_files"
    "file_shares"
    "file_trash"
    "chat_messages"
    "action_logs"
    "session_logs"
    "super_logs"
    "tenant_settings"
)

ALL_OK=true
for TABLE in "${EXPECTED_TABLES[@]}"; do
    EXISTS=$(sudo -u postgres psql -d "$DB_NAME" -tc \
        "SELECT to_regclass('public.$TABLE');" | tr -d '[:space:]')
    if [[ "$EXISTS" == "$TABLE" ]]; then
        echo "      ✓ $TABLE"
    else
        echo "      ✗ MISSING: $TABLE"
        ALL_OK=false
    fi
done

echo ""
if $ALL_OK; then
    echo "============================================================"
    echo " ✅ Setup complete! All tables verified."
    echo "============================================================"
    echo ""
    echo " Connection string:"
    echo "   DATABASE_URL=postgresql://$DB_USER:****@localhost:5432/$DB_NAME"
    echo ""
    echo " Next steps:"
    echo "   1. Add to .env: DATABASE_URL=postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME"
    echo "   2. Run: npm run migrate:dry"
    echo "   3. Review output, then run: npm run migrate"
    echo ""
else
    echo "============================================================"
    echo " ⚠️  Setup complete with warnings — some tables are missing."
    echo "    Check the SQL files in migrations/ for errors."
    echo "============================================================"
    exit 1
fi

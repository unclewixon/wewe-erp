#!/usr/bin/env bash
# One-command local setup for WEWE ERP: database + schema + demo data.
# Prereqs: PostgreSQL running, pnpm installed, and `pnpm install` already run.
# Usage:  bash scripts/local-setup.sh
set -euo pipefail

DB_NAME="${DB_NAME:-wewe_erp}"
DB_USER="${DB_USER:-wewe}"
DB_PASSWORD="${DB_PASSWORD:-wewe_dev}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

echo "▶ WEWE ERP local database setup"
echo "  target: ${DATABASE_URL}"

command -v psql >/dev/null 2>&1 || { echo "✗ psql not found — install PostgreSQL (brew install postgresql@16 && brew services start postgresql@16)"; exit 1; }
pg_isready -h "$DB_HOST" -p "$DB_PORT" >/dev/null 2>&1 || { echo "✗ PostgreSQL not accepting connections on ${DB_HOST}:${DB_PORT} — start it first"; exit 1; }

# Fast path: if the app database already answers, skip all admin work.
if psql "$DATABASE_URL" -tAc "select 1" >/dev/null 2>&1; then
  echo "  database + role already exist — skipping creation"
else
  echo "▶ creating role '${DB_USER}' and database '${DB_NAME}'…"
  # Find a connection with rights to CREATE ROLE/DATABASE: current OS user (macOS Homebrew
  # default superuser), then 'postgres', then the wewe role itself (has CREATEDB).
  ADMIN=""
  for U in "$(whoami)@" "postgres@" ""; do
    if psql "postgresql://${U}${DB_HOST}:${DB_PORT}/postgres" -tAc "select 1" >/dev/null 2>&1; then
      ADMIN="postgresql://${U}${DB_HOST}:${DB_PORT}/postgres"; break
    fi
  done
  [ -n "$ADMIN" ] || { echo "✗ No superuser connection to create the role/database. Create them manually:
    createdb ${DB_NAME}; psql -c \"CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}' CREATEDB;\" -c \"ALTER DATABASE ${DB_NAME} OWNER TO ${DB_USER};\"
  then re-run this script."; exit 1; }
  echo "  admin connection: ${ADMIN}"
  psql "$ADMIN" -v ON_ERROR_STOP=1 -tAc \
    "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${DB_USER}') THEN CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}' CREATEDB; END IF; END \$\$;"
  psql "$ADMIN" -v ON_ERROR_STOP=1 -tAc \
    "SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='${DB_NAME}')\gexec"
fi

echo "▶ applying schema (drizzle push)…"
pnpm --filter api exec drizzle-kit push

echo "▶ seeding demo organisation…"
pnpm --filter api seed

echo ""
echo "✓ Database ready."
echo "  Next:  pnpm --filter api start:dev   (API :3001, docs at /docs)"
echo "         pnpm --filter web dev          (web :5173)"
echo "  Sign in: ibrahim.musa@wewe.org / Password1!"
echo "  Personas: ?as=finance|supervisor|initiator|md|audit|hr|procurement|admin|extaudit"

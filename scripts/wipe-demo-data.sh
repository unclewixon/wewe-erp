#!/usr/bin/env bash
# Wipe demo data on the droplet, keeping users, departments and budget structure.
# Takes a full backup FIRST — the wipe is irreversible without it.
#
#   ./scripts/wipe-demo-data.sh                 # against 157.245.35.226
#   HOST=1.2.3.4 ./scripts/wipe-demo-data.sh    # somewhere else
#
# Restore, if it goes wrong:
#   ssh root@$HOST 'cd /opt/wewe-erp && docker compose exec -T db psql -U wewe -d wewe_erp' < wewe-backup-<stamp>.sql
set -euo pipefail

HOST="${HOST:-157.245.35.226}"
# The app is deployed to /opt, and the database is DB_NAME from its .env (default
# wewe_erp) — NOT /root/wewe-erp and not "wewe". Both were wrong in the first draft
# of this script and would have failed on the backup step, before deleting anything.
APP_DIR="${APP_DIR:-/opt/wewe-erp}"
DB_NAME="$(ssh "root@${HOST}" "grep -E '^DB_NAME=' ${APP_DIR}/.env 2>/dev/null | cut -d= -f2- || echo wewe_erp")"
DB_USER="$(ssh "root@${HOST}" "grep -E '^DB_USER=' ${APP_DIR}/.env 2>/dev/null | cut -d= -f2- || echo wewe")"
DB_NAME="${DB_NAME:-wewe_erp}"; DB_USER="${DB_USER:-wewe}"
echo "    target: ${APP_DIR} · database ${DB_NAME} as ${DB_USER}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="wewe-backup-${STAMP}.sql"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> 1/3  backing up to ./${BACKUP}"
ssh "root@${HOST}" "cd ${APP_DIR} && docker compose exec -T db pg_dump -U ${DB_USER} ${DB_NAME}" > "${BACKUP}"
BYTES=$(wc -c < "${BACKUP}" | tr -d ' ')
if [ "${BYTES}" -lt 10000 ]; then
  echo "!!  backup is only ${BYTES} bytes — that is not a real dump. Stopping before anything is deleted."
  exit 1
fi
echo "    ${BYTES} bytes written"

echo "==> 2/3  stopping demo re-seeding on future boots (SEED_DEMO=0)"
ssh "root@${HOST}" "cd ${APP_DIR} && (grep -q '^SEED_DEMO=' .env 2>/dev/null \
  && sed -i 's/^SEED_DEMO=.*/SEED_DEMO=0/' .env \
  || echo 'SEED_DEMO=0' >> .env) && grep '^SEED_DEMO=' .env"

echo "==> 3/3  wiping"
ssh "root@${HOST}" "cd ${APP_DIR} && docker compose exec -T db psql -U ${DB_USER} -d ${DB_NAME} -v ON_ERROR_STOP=1" < "${HERE}/wipe-demo-data.sql"

echo
echo "Done. Backup kept at ./${BACKUP} — do not delete it until you are sure."
echo "Sign-in still works: users, departments and role grants were not touched."

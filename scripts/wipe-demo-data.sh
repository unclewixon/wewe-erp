#!/usr/bin/env bash
# Wipe demo data on the droplet, keeping users, departments and budget structure.
# Takes a full backup FIRST — the wipe is irreversible without it.
#
#   ./scripts/wipe-demo-data.sh                 # against 157.245.35.226
#   HOST=1.2.3.4 ./scripts/wipe-demo-data.sh    # somewhere else
#
# Restore, if it goes wrong:
#   ssh root@$HOST 'cd /root/wewe-erp && docker compose exec -T db psql -U wewe -d wewe' < wewe-backup-<stamp>.sql
set -euo pipefail

HOST="${HOST:-157.245.35.226}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="wewe-backup-${STAMP}.sql"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> 1/3  backing up to ./${BACKUP}"
ssh "root@${HOST}" 'cd /root/wewe-erp && docker compose exec -T db pg_dump -U wewe wewe' > "${BACKUP}"
BYTES=$(wc -c < "${BACKUP}" | tr -d ' ')
if [ "${BYTES}" -lt 10000 ]; then
  echo "!!  backup is only ${BYTES} bytes — that is not a real dump. Stopping before anything is deleted."
  exit 1
fi
echo "    ${BYTES} bytes written"

echo "==> 2/3  stopping demo re-seeding on future boots (SEED_DEMO=0)"
ssh "root@${HOST}" 'cd /root/wewe-erp && (grep -q "^SEED_DEMO=" .env 2>/dev/null \
  && sed -i "s/^SEED_DEMO=.*/SEED_DEMO=0/" .env \
  || echo "SEED_DEMO=0" >> .env) && grep "^SEED_DEMO=" .env'

echo "==> 3/3  wiping"
ssh "root@${HOST}" 'cd /root/wewe-erp && docker compose exec -T db psql -U wewe -d wewe -v ON_ERROR_STOP=1' < "${HERE}/wipe-demo-data.sql"

echo
echo "Done. Backup kept at ./${BACKUP} — do not delete it until you are sure."
echo "Sign-in still works: users, departments and role grants were not touched."

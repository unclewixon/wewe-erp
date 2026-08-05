#!/usr/bin/env bash
# Nightly PostgreSQL backup with 14-day rotation (NFR: RPO <= 24h).
# Cron:  15 01 * * *  /path/to/repo/scripts/backup.sh
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:-/var/backups/wewe-erp}"
mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M)
docker compose exec -T db pg_dump -U "${DB_USER:-wewe}" "${DB_NAME:-wewe_erp}" | gzip > "$BACKUP_DIR/wewe-erp-$STAMP.sql.gz"
# documents / exports / outbox live in the apivar volume
docker run --rm -v "$(docker compose ps -q api | xargs docker inspect -f '{{ range .Mounts }}{{ if eq .Destination "/app/apps/api/var" }}{{ .Name }}{{ end }}{{ end }}')":/var/data -v "$BACKUP_DIR":/backup alpine tar czf "/backup/wewe-erp-files-$STAMP.tar.gz" -C /var/data .
find "$BACKUP_DIR" -name 'wewe-erp-*' -mtime +14 -delete
echo "backup complete: $BACKUP_DIR/wewe-erp-$STAMP.sql.gz"

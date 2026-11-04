#!/bin/sh
# Dump comprimido do Postgres e remoção dos backups mais antigos que RETENTION_DAYS.
set -eu
ts=$(date -u +%Y%m%dT%H%M%SZ)
file="/backups/tracado-$ts.sql.gz"
pg_dump --no-owner --no-privileges | gzip -9 > "$file.tmp"
mv "$file.tmp" "$file"
find /backups -name 'tracado-*.sql.gz' -mtime +"${RETENTION_DAYS:-14}" -delete
echo "backup ok: $file ($(du -h "$file" | cut -f1))"

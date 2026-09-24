#!/usr/bin/env bash
# AfeySync encrypted MongoDB backups.
#   deploy/backup.sh all                 # platform meta DB + every tenant DB
#   deploy/backup.sh tenant <slug>       # one facility
#   deploy/backup.sh verify <file.enc>   # decrypt + integrity check + dry-run restore
# Requires: mongodump/mongorestore (MongoDB Database Tools), openssl.
# Key: BACKUP_KEY_FILE (random 32+ bytes, stored OFF the server, e.g. `openssl rand -base64 48 > backup.key`).
# Schedule with cron, e.g.: 30 1 * * * /opt/afeysync/deploy/backup.sh all >> /var/log/afeysync-backup.log 2>&1
set -euo pipefail

MONGO_URI="${MONGO_URI:-mongodb://127.0.0.1:27017}"
META_DB="${META_DB:-afeysync_meta}"
PREFIX="${TENANT_DB_PREFIX:-afeysync_tenant_}"
DEST="${BACKUP_DIR:-/var/backups/afeysync}"
KEY_FILE="${BACKUP_KEY_FILE:?Set BACKUP_KEY_FILE}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$DEST"
chmod 700 "$DEST"

dump_db() {
  local db="$1" out="$DEST/${db}_${STAMP}.archive.gz.enc"
  mongodump --uri="$MONGO_URI" --db="$db" --archive --gzip --quiet \
    | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$KEY_FILE" -out "$out"
  sha256sum "$out" > "$out.sha256"
  echo "backup ok: $out"
}

verify() {
  local file="$1"
  sha256sum -c "$file.sha256"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$KEY_FILE" -in "$file" \
    | mongorestore --uri="$MONGO_URI" --archive --gzip --dryRun --quiet
  echo "verify ok: $file"
}

case "${1:-}" in
  all)
    dump_db "$META_DB"
    for db in $(mongosh "$MONGO_URI" --quiet --eval "db.adminCommand({listDatabases:1,nameOnly:true}).databases.map(d=>d.name).filter(n=>n.startsWith('$PREFIX')).join(' ')"); do
      dump_db "$db"
    done
    find "$DEST" -name '*.enc*' -mtime +"$RETENTION_DAYS" -delete
    ;;
  tenant)
    dump_db "${PREFIX}${2//-/_}"
    ;;
  verify)
    verify "$2"
    ;;
  *)
    echo "usage: $0 all | tenant <slug> | verify <file.enc>" >&2
    exit 1
    ;;
esac

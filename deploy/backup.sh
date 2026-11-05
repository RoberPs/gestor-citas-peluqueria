#!/usr/bin/env bash
# Daily encrypted copy of the database (deploy/README.md, «Copias»). Run by
# root from /etc/cron.d/gestor-citas; by hand: sudo /srv/gestor-citas/deploy/backup.sh
#
# 1. pg_dump in custom format, from inside the db container, so the client
#    is always the server's own version.
# 2. Encrypted on the way out with gpg (AES-256, with integrity check) and the
#    key in backup.key. Nothing unencrypted ever touches the disk.
# 3. Verified before it counts: decrypted again and listed by pg_restore. A
#    copy that does not pass is deleted and the script fails.
# 4. Left as <dir>/gestor-citas__<UTC>__daily.cbak, owned by `operador` and
#    0600, where descargar-copias.ps1 fetches it with plain scp. While it is
#    being written it is a `.cbak.partial`, which that script ignores.
# 5. Copies older than RETENTION_DAYS are deleted here; the PC keeps them all.
#
# The paths can be moved with variables, which is how it is tried out locally.
set -euo pipefail
umask 077

BASE=${GESTOR_DIR:-/srv/gestor-citas}
COMPOSE_FILE=${GESTOR_COMPOSE_FILE:-$BASE/deploy/docker-compose.prod.yml}
DIR=${GESTOR_BACKUP_DIR:-$BASE/niza/backups}
KEY=${GESTOR_BACKUP_KEY:-$BASE/backup.key}
OWNER=${GESTOR_BACKUP_OWNER-operador}
RETENTION_DAYS=${GESTOR_BACKUP_RETENTION_DAYS:-14}

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }
gpg_batch() { gpg --batch --quiet --no-tty --pinentry-mode loopback --passphrase-file "$KEY" "$@"; }

[[ -s "$KEY" ]] || { echo "no backup key at $KEY" >&2; exit 1; }
[[ -d "$DIR" ]] || { echo "no backup directory at $DIR" >&2; exit 1; }

final="$DIR/gestor-citas__$(date -u +%Y%m%dT%H%M%SZ)__daily.cbak"
partial="$final.partial"
trap 'rm -f "$partial"' EXIT

compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump -U postgres --format=custom --dbname=salon' |
  gpg_batch --symmetric --cipher-algo AES256 --output "$partial"

# The copy must open with the key and be an archive pg_restore can read.
tables=$(gpg_batch --decrypt "$partial" | compose exec -T db pg_restore --list | grep -c ' TABLE ' || true)
if [[ "$tables" -lt 1 ]]; then
  echo "the copy did not verify: pg_restore saw $tables table(s)" >&2
  exit 1
fi

mv "$partial" "$final"
if [[ -n "$OWNER" ]]; then chown "$OWNER:$OWNER" "$final"; fi
chmod 600 "$final"

find "$DIR" -maxdepth 1 -name 'gestor-citas__*__daily.cbak' -mtime +"$RETENTION_DAYS" -delete

echo "ok $(basename "$final"): $(stat -c %s "$final") bytes, $tables tables"

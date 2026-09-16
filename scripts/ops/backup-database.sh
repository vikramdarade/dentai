#!/bin/sh
# Nightly logical backup of the clinical database.
#
#   bun run ops:backup                 # writes to ./backups
#   BACKUP_DIR=/mnt/dumps bun run ops:backup
#
# Why a script rather than "the provider does it": provider history protects you
# from a bad migration on the same provider plan, but not from a billing lapse, a
# deleted project, or an account compromise. A dump you hold yourself is the copy
# that survives those.
#
# This script only *creates* the backup. It deliberately does not upload it
# anywhere: clinical data must not travel to a destination chosen by a script.
# Point it at storage you control and encrypt it there — see
# docs/runbooks/backup-and-restore.md for the operator procedure, retention rule
# and the monthly restore rehearsal.
#
# Exit codes: 0 ok, 2 misconfigured, 1 backup failed. Cron should alert on non-zero.
set -eu

BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date +%Y-%m-%d-%H%M)"
FILENAME="dentai-${STAMP}.dump.gz"
DEST="${BACKUP_DIR}/${FILENAME}"

fail() {
  echo "ERROR: $1" >&2
  exit 2
}

if [ -z "${DATABASE_URL:-}" ]; then
  fail "DATABASE_URL is not set. Export the production connection string (or source the env file the app uses)."
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  fail "pg_dump is not on PATH. Install the Postgres client tools (postgresql-client-16 or later)."
fi

mkdir -p "$BACKUP_DIR"

echo "Backing up to ${DEST}"
# --format=custom keeps the dump restorable with pg_restore, including indexes.
# --no-owner/--no-acl make it portable to a differently-provisioned database,
# which is exactly what a restore into a scratch database looks like.
if ! pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl | gzip > "$DEST"; then
  rm -f "$DEST"
  echo "ERROR: pg_dump failed; no backup was written." >&2
  exit 1
fi

SIZE="$(wc -c < "$DEST" | tr -d ' ')"
if [ "$SIZE" -lt 1024 ]; then
  # A dump this small means an empty or wrong database. Fail loudly rather than
  # letting a "successful" backup lull the operator into deleting the good ones.
  echo "ERROR: ${DEST} is only ${SIZE} bytes, which is too small to be a real backup." >&2
  exit 1
fi

echo "Wrote ${DEST} ($(du -h "$DEST" | cut -f1))"
echo
echo "Now do the part this script cannot:"
echo "  1. Upload it to encrypted storage you control (object storage with SSE, or age/gpg first)."
echo "  2. Keep 30 days, then delete. Long-lived copies multiply breach exposure."
echo "  3. Rehearse a restore monthly: sh ./scripts/ops/restore-database.sh <dump> --target <scratch-url>"
echo "  4. Never store a dump beside the database credentials."

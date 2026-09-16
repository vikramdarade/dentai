#!/bin/sh
# Restore a backup into a scratch database — the monthly rehearsal, and the real
# recovery procedure when something has gone wrong.
#
#   sh ./scripts/ops/restore-database.sh backups/dentai-2026-09-15-0200.dump.gz \
#     --target "$SCRATCH_DATABASE_URL"
#
# Safety rules baked in, because the failure mode here is destroying the records
# you were trying to recover:
#   * A target must be named explicitly. There is no "default to production".
#   * Restoring into the database the app is currently using is refused unless
#     DENTAI_CONFIRM_DESTRUCTIVE=true, and even then it warns first.
#   * Row counts and the newest record are printed afterwards, so the rehearsal
#     produces the evidence that your backups actually contain the data
#     (docs/runbooks/backup-and-restore.md asks you to record them).
#
# Exit codes: 0 ok, 2 misconfigured or refused, 1 restore failed.
set -eu

usage() {
  cat <<'USAGE'
Usage: sh ./scripts/ops/restore-database.sh <dump-file> --target <connection-string>

  <dump-file>   A .dump or .dump.gz produced by scripts/ops/backup-database.sh
  --target      Connection string of the database to restore INTO. Create a
                throwaway branch/database first — never restore over production.
USAGE
}

DUMP="${1:-}"
if [ -z "$DUMP" ] || [ "$DUMP" = "-h" ] || [ "$DUMP" = "--help" ]; then
  usage
  exit 2
fi
shift || true

TARGET=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --target)
      TARGET="${2:-}"
      shift 2 || true
      ;;
    *)
      echo "ERROR: unexpected argument '$1'." >&2
      usage >&2
      exit 2
      ;;
  esac
done

fail() {
  echo "ERROR: $1" >&2
  exit 2
}

[ -n "$TARGET" ] || fail "--target is required. Name the scratch database explicitly; there is no default."
[ -f "$DUMP" ] || fail "dump file '$DUMP' not found."

if [ -n "${DATABASE_URL:-}" ] && [ "$TARGET" = "$DATABASE_URL" ]; then
  if [ "${DENTAI_CONFIRM_DESTRUCTIVE:-}" != "true" ]; then
    fail "target is the live database (DATABASE_URL). Restore into a scratch database instead — see the runbook. Set DENTAI_CONFIRM_DESTRUCTIVE=true only for a deliberate disaster recovery."
  fi
  echo "WARNING: you are restoring over the live database. Every record written since this dump will be lost."
  echo "Press Ctrl-C within 10 seconds to abort."
  sleep 10
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  fail "pg_restore is not on PATH. Install the Postgres client tools (postgresql-client-16 or later)."
fi

echo "Restoring ${DUMP} into the target database…"
case "$DUMP" in
  *.gz) gunzip -c "$DUMP" | pg_restore --no-owner --no-acl --clean --if-exists --dbname "$TARGET" ;;
  *)    pg_restore --no-owner --no-acl --clean --if-exists --dbname "$TARGET" "$DUMP" ;;
esac
RESTORE_STATUS=$?
# pg_restore exits non-zero on warnings (for example a comment it could not
# attach). Continue to verification, which is what actually proves the restore.
if [ "$RESTORE_STATUS" -ne 0 ]; then
  echo "NOTE: pg_restore reported issues (exit ${RESTORE_STATUS}). Verification below decides whether the data arrived."
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not on PATH, skipping verification queries."
  exit 0
fi

echo
echo "Verification — record these numbers:"
psql "$TARGET" -Atc "SELECT 'dentists=' || count(*) FROM dentists;" || true
psql "$TARGET" -Atc "SELECT 'consultations=' || count(*) FROM consultations;" || true
psql "$TARGET" -Atc "SELECT 'audit_logs=' || count(*) FROM audit_logs;" || true
psql "$TARGET" -Atc "SELECT 'newest_record=' || COALESCE(max(created_at)::text, 'none') FROM consultations;" || true
psql "$TARGET" -Atc "SELECT 'schema=' || COALESCE(max(version)::text, 'none') FROM schema_migrations WHERE rolled_back_at IS NULL;" || true

echo
echo "If the newest record is older than your backup window, your backups are not running."
echo "Then tear the scratch database down."

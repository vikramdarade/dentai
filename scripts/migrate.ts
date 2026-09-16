/**
 * Schema migration CLI.
 *
 *   bun run db:migrate            # apply everything pending
 *   bun run db:migrate:status     # what has run, what is pending
 *   bun run db:migrate:down       # roll back the most recent migration
 *   bun run db:migrate:down 2     # roll back the two most recent
 *
 * Why a CLI rather than "apply on boot": boot-time schema changes are
 * forward-only by necessity, so a bad change could previously only be undone by
 * restoring a backup and losing everything written since. This gives the reverse
 * operation a command of its own.
 *
 * The connection uses `pg` (TCP) rather than the Neon HTTP driver the app uses,
 * for two reasons: it works against both Neon and a plain Postgres, so the same
 * command runs in CI and on a developer's laptop, and it avoids depending on the
 * app's module-level connection so a maintenance command never inherits a
 * half-initialised server.
 *
 * Safety rails:
 *  - Refuses to run without an explicit `DATABASE_URL`.
 *  - `down` requires `DENTAI_CONFIRM_DESTRUCTIVE=true`, because it drops tables
 *    and columns.
 *  - `up` refuses to touch a migration whose recorded checksum changed, unless
 *    `DENTAI_MIGRATION_FORCE=true` (same rule the boot path applies).
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { Pool } from 'pg';
import {
  LATEST_VERSION,
  MIGRATIONS,
  listAppliedMigrations,
  pendingVersions,
  rollbackMigration,
  runMigrations,
  schemaVersionLabel,
} from '../src/lib/migrations';

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const log = (message: string) => console.log(message);

function createPgTag(pool: Pool) {
  return async (strings: TemplateStringsArray, ...values: any[]) => {
    const text = strings.reduce(
      (acc, part, index) => acc + part + (index < values.length ? `$${index + 1}` : ''),
      ''
    );
    const result = await pool.query(text, values);
    return result.rows;
  };
}

function connectionString(): string {
  // DENTAI_MIGRATE_DATABASE_URL lets an operator rehearse a migration against a
  // scratch branch without editing the value the app itself uses.
  const url = process.env.DENTAI_MIGRATE_DATABASE_URL || process.env.DATABASE_URL || '';
  if (!url) {
    console.error(
      `${RED}No database configured.${RESET} Set DATABASE_URL (or DENTAI_MIGRATE_DATABASE_URL) ` +
        `to the database you want to migrate.`
    );
    process.exit(2);
  }
  return url;
}

/**
 * Host and database only — never the password. Operator output is copied into
 * tickets and chat messages, so a connection string must not land in one.
 */
function describeTarget(): string {
  const url = process.env.DENTAI_MIGRATE_DATABASE_URL || process.env.DATABASE_URL || '';
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`;
  } catch {
    return '(unparseable connection string)';
  }
}

/**
 * Turns driver errors into something an operator can act on at 8am. The common
 * cases are a typo'd URL, a database that is not reachable from this network, and
 * a database that exists but was never initialised.
 */
function explainConnectionError(err: any): string | null {
  const code = err?.code || '';
  const target = describeTarget();
  switch (code) {
    case 'ECONNREFUSED':
      return `Could not connect to ${target} — nothing is listening there. Check the host and port.`;
    case 'ENOTFOUND':
      return `Could not resolve the database host in ${target}. Check the hostname (and that you are online).`;
    case 'ETIMEDOUT':
      return `Timed out connecting to ${target}. A managed database may need your IP allowed, or TLS.`;
    case '28P01':
    case '28000':
      return `Authentication failed for ${target}. Check the user and password in the connection string.`;
    case '3D000':
      return `The database in ${target} does not exist. Create it (or fix the name) and run this again.`;
    case '42P01':
      return `Connected to ${target}, but it has no application schema yet. Run \`bun run db:migrate\` first.`;
    default:
      if (/does not exist/i.test(String(err?.message || ''))) {
        return `Connected to ${target}, but the schema is missing. Run \`bun run db:migrate\` first.`;
      }
      return null;
  }
}

async function withPool<T>(fn: (pool: Pool, sql: any) => Promise<T>): Promise<T> {
  // Neon and other managed Postgres providers require TLS; a local container
  // generally does not present a certificate, so this mirrors what the tests do
  // and stays permissive rather than failing closed on a self-signed chain.
  const pool = new Pool({ connectionString: connectionString(), max: 2 });
  try {
    return await fn(pool, createPgTag(pool));
  } finally {
    await pool.end();
  }
}

async function status(): Promise<number> {
  return withPool(async (pool, sql) => {
    const applied = await listAppliedMigrations(sql);
    const active = applied.filter((row) => !row.rolled_back_at);
    const activeVersions = new Set(active.map((row) => row.version));
    const pending = pendingVersions(applied);

    log(`Schema: ${schemaVersionLabel(applied)}  ${DIM}(${pool.options.database ?? 'database'})${RESET}`);
    log('');
    for (const migration of MIGRATIONS) {
      const record = active.find((row) => row.version === migration.version);
      const rolledBack = applied.find(
        (row) => row.version === migration.version && row.rolled_back_at
      );
      if (record) {
        log(
          `  ${GREEN}applied${RESET}  ${String(migration.version).padStart(3, '0')}  ${migration.name}` +
            `  ${DIM}${record.applied_at}${RESET}`
        );
      } else if (rolledBack) {
        log(
          `  ${YELLOW}rolled back${RESET}  ${String(migration.version).padStart(3, '0')}  ${migration.name}` +
            `  ${DIM}was applied ${rolledBack.applied_at}${RESET}`
        );
      } else {
        log(`  ${YELLOW}pending${RESET}  ${String(migration.version).padStart(3, '0')}  ${migration.name}`);
      }
    }
    log('');

    if (pending.length === 0) {
      log(`${GREEN}Up to date${RESET} — every migration through ${LATEST_VERSION} has been applied.`);
      return 0;
    }
    log(
      `${YELLOW}${pending.length} migration(s) pending:${RESET} ${pending.join(', ')}. ` +
        `Run ${DIM}bun run db:migrate${RESET} to apply them.`
    );
    return activeVersions.has(LATEST_VERSION) ? 0 : 1;
  });
}

async function up(args: string[]): Promise<number> {
  const targetFlag = args.indexOf('--target');
  const target = targetFlag >= 0 ? Number(args[targetFlag + 1]) : undefined;
  if (targetFlag >= 0 && (!Number.isInteger(target) || (target as number) < 1)) {
    console.error(`${RED}--target expects a migration version number.${RESET}`);
    return 2;
  }

  const force = process.env.DENTAI_MIGRATION_FORCE === 'true';
  return withPool(async (_pool, sql) => {
    try {
      const result = await runMigrations(sql, { target, force, log });
      if (result.applied.length === 0) {
        log(`${GREEN}Nothing to do${RESET} — schema already at ${schemaVersionLabel(await listAppliedMigrations(sql))}.`);
      } else {
        log(`${GREEN}Applied${RESET} migration(s): ${result.applied.join(', ')}.`);
      }
      return 0;
    } catch (err: any) {
      const friendly = explainConnectionError(err);
      if (friendly) {
        console.error(`${RED}${friendly}${RESET}`);
        return 2;
      }
      console.error(`${RED}Migration failed:${RESET} ${err.message}`);
      console.error(
        `${DIM}Every migration is written to be re-runnable, so the usual fix is to correct the ` +
          `cause and run the same command again.${RESET}`
      );
      return 1;
    }
  });
}

async function down(args: string[]): Promise<number> {
  const steps = args[0] ? Number(args[0]) : 1;
  if (!Number.isInteger(steps) || steps < 1) {
    console.error(`${RED}db:migrate:down takes a positive number of steps (default 1).${RESET}`);
    return 2;
  }
  if (process.env.DENTAI_CONFIRM_DESTRUCTIVE !== 'true') {
    console.error(
      `${RED}Refusing to roll back without confirmation.${RESET}\n` +
        `Rolling back drops tables and columns, and any rows in them.\n` +
        `Re-run with ${DIM}DENTAI_CONFIRM_DESTRUCTIVE=true${RESET} once you are sure — and ` +
        `rehearse it against a scratch database first (docs/runbooks/backup-and-restore.md).`
    );
    return 2;
  }

  return withPool(async (_pool, sql) => {
    const rolled: number[] = [];
    for (let i = 0; i < steps; i += 1) {
      const migration = await rollbackMigration(sql, undefined, log);
      if (!migration) {
        log(`${YELLOW}No applied migration left to roll back.${RESET}`);
        break;
      }
      rolled.push(migration.version);
    }
    if (rolled.length === 0) return 0;
    log(`${GREEN}Rolled back${RESET} migration(s): ${rolled.join(', ')}.`);
    log(
      `${DIM}The application code still expects those columns, so redeploy the matching build ` +
        `or re-apply with ${DIM}bun run db:migrate${RESET}.${RESET}`
    );
    return 0;
  });
}

async function main(): Promise<void> {
  const [command = 'up', ...args] = process.argv.slice(2);
  let code: number;

  switch (command) {
    case 'up':
      code = await up(args);
      break;
    case 'down':
      code = await down(args);
      break;
    case 'status':
      code = await status();
      break;
    default:
      console.error(
        `Unknown command "${command}". Use one of: up, down [steps], status.\n` +
          `  bun run db:migrate\n  bun run db:migrate:status\n  bun run db:migrate:down`
      );
      code = 2;
  }

  process.exit(code);
}

main().catch((err) => {
  const friendly = explainConnectionError(err);
  if (friendly) {
    console.error(`${RED}${friendly}${RESET}`);
    process.exit(2);
  }
  console.error(`${RED}Unexpected error:${RESET} ${err?.stack || err}`);
  process.exit(1);
});

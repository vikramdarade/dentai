/**
 * Operator account control: retire every session for a clinician, and
 * optionally lock the account against new sign-ins.
 *
 * This is the action to take when a workstation is lost, a clinician reports
 * someone else using their profile, or a device is being handed on. It exists
 * so that "lock this account now" never requires deleting the account — which
 * would destroy the patient records the clinic is legally required to keep.
 *
 * What it does:
 *   - advances the account's session epoch, instantly invalidating every token
 *     minted before now (all devices signed out);
 *   - optionally writes a durable lockout that blocks new sign-ins until the
 *     expiry passes (default 24h) — the clinician recovers with an
 *     operator-issued token (scripts/issue-recovery-token.ts);
 *   - writes an audit event with the operator identity.
 *
 * Usage:
 *   bun run scripts/lockout-account.ts --name "Dr. Sarah Jenkins" --hours 24
 *   bun run scripts/lockout-account.ts --id <dentist-id>
 *   bun run scripts/lockout-account.ts --id <dentist-id> --unlock
 *   bun run scripts/lockout-account.ts --list
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  dbEnabled,
  dbGetDentists,
  dbGetDentistById,
  dbGetDentistByName,
  dbBumpSessionEpoch,
  dbAppendAudit
} from '../src/lib/db';
import { LOGIN_LOCKOUT_MS } from '../src/lib/authPolicy';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DENTAI_DATA_DIR
  ? path.resolve(process.env.DENTAI_DATA_DIR)
  : path.resolve(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ATTEMPTS_FILE = path.join(DATA_DIR, 'login_attempts.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.json');

const OPERATOR = process.env.USER || process.env.USERNAME || 'operator';
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}
function writeJson(file: string, data: unknown): void {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

async function listClinicians(): Promise<Array<{ id: string; name: string }>> {
  if (dbEnabled) return (await dbGetDentists()).map((d: any) => ({ id: d.id, name: d.name }));
  return readJson<{ dentists: any[] }>(USERS_FILE, { dentists: [] }).dentists.map((d: any) => ({
    id: d.id,
    name: d.name
  }));
}

async function audit(event: string, dentistId: string, detail: Record<string, any>): Promise<void> {
  if (dbEnabled) {
    await dbAppendAudit(event, dentistId, detail);
    return;
  }
  const store = readJson<{ events: any[] }>(AUDIT_FILE, { events: [] });
  store.events.push({ event, dentistId, detail, timestamp: new Date().toISOString() });
  writeJson(AUDIT_FILE, store);
}

async function main(): Promise<void> {
  if (args.includes('--help') || args.length === 0) {
    console.log(`Lock, unlock, or sign out all sessions for a clinician.

Usage:
  bun run scripts/lockout-account.ts --list
  bun run scripts/lockout-account.ts --name "Dr. Sarah Jenkins" [--hours 24]
  bun run scripts/lockout-account.ts --id <dentist-id> [--hours 24]
  bun run scripts/lockout-account.ts --id <dentist-id> --unlock

Persistence: ${dbEnabled ? 'Postgres (DATABASE_URL is set)' : `JSON store (${DATA_DIR})`}
Operator recorded in the audit trail: ${OPERATOR}`);
    return;
  }

  if (args.includes('--list')) {
    const clinicians = await listClinicians();
    console.log(`\nClinicians (${clinicians.length}):`);
    for (const c of clinicians) console.log(`  ${c.id}  ${c.name}`);
    console.log('');
    return;
  }

  const id = flag('--id');
  const name = flag('--name');
  if (!id && !name) {
    console.error('Provide --id or --name (or --list). See --help.');
    process.exit(1);
  }

  const dentist: any = dbEnabled
    ? id
      ? await dbGetDentistById(id)
      : await dbGetDentistByName(name!)
    : (readJson<{ dentists: any[] }>(USERS_FILE, { dentists: [] }).dentists.find((d: any) =>
        id ? d.id === id : d.name.toLowerCase() === name!.toLowerCase()
      ) ?? null);

  if (!dentist) {
    console.error(`No clinician found for ${id ? `id "${id}"` : `name "${name}"`}.`);
    process.exit(1);
  }

  const unlock = args.includes('--unlock');
  const epoch = dbEnabled ? await dbBumpSessionEpoch(dentist.id) : await bumpJsonEpoch(dentist.id);
  const lockUntil = unlock ? 0 : Date.now() + (Number(flag('--hours')) || 24) * 60 * 60 * 1000;

  if (dbEnabled) {
    const { sql } = await import('../src/lib/db');
    // Two keys are used by the login handler: the account and the address.
    if (unlock) {
      await sql!`DELETE FROM login_attempts WHERE key = ${'dentist:' + dentist.id}`;
    } else {
      await sql!`
        INSERT INTO login_attempts (key, failures, locked_until, updated_at)
        VALUES (${'dentist:' + dentist.id}, 0, ${new Date(lockUntil).toISOString()}::timestamptz, now())
        ON CONFLICT (key) DO UPDATE SET locked_until = ${new Date(lockUntil).toISOString()}::timestamptz, updated_at = now()
      `;
    }
  } else {
    const store = readJson<Record<string, any>>(ATTEMPTS_FILE, {});
    if (unlock) delete store[`dentist:${dentist.id}`];
    else store[`dentist:${dentist.id}`] = { failures: 0, lockedUntil: lockUntil };
    writeJson(ATTEMPTS_FILE, store);
  }

  await audit(unlock ? 'account_unlocked_by_operator' : 'account_locked_by_operator', dentist.id, {
    operator: OPERATOR,
    epoch,
    lockUntil: unlock ? null : new Date(lockUntil).toISOString()
  });

  console.log(`
${unlock ? 'Unlocked' : 'Locked out'} ${dentist.name} (${dentist.id})

  Sessions        : all retired (epoch advanced to ${epoch})
  New sign-ins    : ${unlock ? 'allowed' : `blocked until ${new Date(lockUntil).toISOString()}`}
  Audit event     : ${unlock ? 'account_unlocked_by_operator' : 'account_locked_by_operator'} by ${OPERATOR}
  Recovery        : bun run scripts/issue-recovery-token.ts --id ${dentist.id}

The account and its records are untouched — never delete a clinician profile to
respond to a suspected compromise; that destroys records the clinic must keep.
`);
}

async function bumpJsonEpoch(dentistId: string): Promise<number> {
  const users = readJson<{ dentists: any[] }>(USERS_FILE, { dentists: [] });
  const idx = users.dentists.findIndex((d: any) => d.id === dentistId);
  if (idx === -1) return 0;
  const next = Number(users.dentists[idx].sessionEpoch ?? 0) + 1;
  users.dentists[idx].sessionEpoch = next;
  writeJson(USERS_FILE, users);
  return next;
}

// Referenced for the documented default when no --hours is supplied.
void LOGIN_LOCKOUT_MS;

main().catch((err) => {
  console.error('Account control failed:', err);
  process.exit(1);
});

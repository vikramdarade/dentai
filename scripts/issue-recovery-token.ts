/**
 * Issue a single-use, expiring credential-recovery token for one clinician.
 *
 * This is the deliberate replacement for the "universal PIN" / "master
 * recovery" pattern this product must never have. A universal credential means
 * one leaked value exposes every patient record on the platform, and it makes
 * a legitimate recovery indistinguishable from an intrusion in the audit log.
 *
 * Properties of this mechanism:
 *   - scoped to ONE dentist id (not to everyone);
 *   - expires (default 60 minutes) and is single-use (consumption is atomic);
 *   - stored only as a SHA-256 hash — the raw token exists only in this
 *     terminal and in the handover to the clinician;
 *   - every issue and every redemption is written to the audit log with the
 *     operator identity, so the trail shows a recovery happened and who did it.
 *
 * Hand the token to the clinician over a channel you trust, have them open
 *   <app>/#/recover
 * and enter it with a new PIN. Redemption also retires every existing session
 * for that account.
 *
 * Usage (run from the machine that holds the data):
 *   bun run scripts/issue-recovery-token.ts --name "Dr. Sarah Jenkins"
 *   bun run scripts/issue-recovery-token.ts --id <dentist-id> --hours 2
 *   bun run scripts/issue-recovery-token.ts --list
 *
 * Persistence mode is detected automatically: DATABASE_URL (Postgres) or the
 * JSON store in DENTAI_DATA_DIR (default ./data).
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  dbEnabled,
  dbGetDentists,
  dbGetDentistById,
  dbGetDentistByName,
  dbInsertRecoveryToken,
  dbAppendAudit
} from '../src/lib/db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DENTAI_DATA_DIR
  ? path.resolve(process.env.DENTAI_DATA_DIR)
  : path.resolve(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const RECOVERY_FILE = path.join(DATA_DIR, 'recovery_tokens.json');
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
  if (dbEnabled) {
    return (await dbGetDentists()).map((d: any) => ({ id: d.id, name: d.name }));
  }
  const users = readJson<{ dentists: any[] }>(USERS_FILE, { dentists: [] });
  return users.dentists.map((d: any) => ({ id: d.id, name: d.name }));
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
    console.log(`Issue a single-use credential recovery token.

Usage:
  bun run scripts/issue-recovery-token.ts --list
  bun run scripts/issue-recovery-token.ts --name "Dr. Sarah Jenkins" [--hours 1]
  bun run scripts/issue-recovery-token.ts --id <dentist-id> [--hours 1]

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

  const hours = Math.max(1, Math.min(24, Number(flag('--hours')) || 1));
  const dentist = dbEnabled
    ? ((id ? await dbGetDentistById(id) : await dbGetDentistByName(name!)) as any)
    : (readJson<{ dentists: any[] }>(USERS_FILE, { dentists: [] }).dentists.find(
        (d: any) => (id ? d.id === id : d.name.toLowerCase() === name!.toLowerCase())
      ) ?? null);

  if (!dentist) {
    console.error(`No clinician found for ${id ? `id "${id}"` : `name "${name}"`}.`);
    process.exit(1);
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

  if (dbEnabled) {
    await dbInsertRecoveryToken({ tokenHash, dentistId: dentist.id, issuedBy: OPERATOR, expiresAt });
  } else {
    const store = readJson<{ tokens: Record<string, any> }>(RECOVERY_FILE, { tokens: {} });
    store.tokens[tokenHash] = {
      dentistId: dentist.id,
      issuedBy: OPERATOR,
      expiresAt: expiresAt.toISOString(),
      usedAt: null,
      createdAt: new Date().toISOString()
    };
    writeJson(RECOVERY_FILE, store);
  }

  await audit('recovery_token_issued', dentist.id, { issuedBy: OPERATOR, expiresAt: expiresAt.toISOString() });

  console.log(`
Recovery token issued.

  Clinician : ${dentist.name} (${dentist.id})
  Expires   : ${expiresAt.toISOString()} (${hours}h)
  Single use: yes — the first redemption consumes it
  Recorded  : audit event "recovery_token_issued" by ${OPERATOR}

  Token (share only with ${dentist.name}, over a channel you trust):

    ${token}

  Instructions for the clinician: open the app, go to the recovery screen
  (#/recover), paste the token, and set a new 4-digit PIN. All other sessions
  for this account are signed out at that moment.
`);
}

main().catch((err) => {
  console.error('Failed to issue recovery token:', err);
  process.exit(1);
});

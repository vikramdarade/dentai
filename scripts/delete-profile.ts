/**
 * Maintenance script: remove a dentist profile WITHOUT needing their PIN.
 *
 * The app's delete endpoint deliberately requires the 4-digit PIN (it is the
 * account's only credential). This tool is for the operator who owns the
 * database and needs to clean up stray/test profiles whose PIN is unknown.
 * Run it from the machine that has the data (the sandbox for JSON mode, or
 * with DATABASE_URL set for Postgres/Neon).
 *
 * Usage:
 *   bun run scripts/delete-profile.ts --list
 *   bun run scripts/delete-profile.ts --name "Den"
 *   bun run scripts/delete-profile.ts --name "Den" --yes     # skip confirm
 *   bun run scripts/delete-profile.ts --id <dentist-id> --yes
 *
 * What it removes for the profile: the dentist record, their consultations,
 * their clinic memberships, and any clinic they own (plus that clinic's
 * members). The audit trail is left intact by design — it is append-only and
 * is what records that the deletion happened.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbEnabled, sql } from '../src/lib/db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERS_FILE = path.resolve(__dirname, '..', 'data', 'users.json');
const CONSULTATIONS_FILE = path.resolve(__dirname, '..', 'data', 'consultations.json');
const CLINICS_FILE = path.resolve(__dirname, '..', 'data', 'clinics.json');

const args = process.argv.slice(2);
const getFlag = (name: string) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
};
const hasFlag = (name: string) => args.includes(name);

interface DentistSummary {
  id: string;
  name: string;
  specialty: string;
}

async function listProfiles(): Promise<DentistSummary[]> {
  if (dbEnabled) {
    const rows = (await sql!`SELECT id, name, specialty FROM dentists ORDER BY created_at ASC`) as any[];
    return rows.map((r) => ({ id: r.id, name: r.name, specialty: r.specialty }));
  }
  const usersData = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  return (usersData.dentists || []).map((d: any) => ({
    id: d.id,
    name: d.name,
    specialty: d.specialty
  }));
}

async function deleteInPostgres(dentistId: string): Promise<void> {
  // Consultations have no FK to dentists, so delete explicitly.
  await sql!`DELETE FROM consultations WHERE dentist_id = ${dentistId}`;
  // Memberships reference dentist_id without an FK; clinics the dentist owns
  // cascade their members away via clinic_members.clinic_id ON DELETE CASCADE.
  await sql!`DELETE FROM clinic_members WHERE dentist_id = ${dentistId}`;
  await sql!`DELETE FROM clinics WHERE owner_dentist_id = ${dentistId}`;
  await sql!`DELETE FROM dentists WHERE id = ${dentistId}`;
}

async function deleteInJson(dentistId: string): Promise<void> {
  // Dentist record
  const usersData = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  usersData.dentists = (usersData.dentists || []).filter((d: any) => d.id !== dentistId);
  fs.writeFileSync(USERS_FILE, JSON.stringify(usersData, null, 2));

  // Their consultations
  const consData = JSON.parse(fs.readFileSync(CONSULTATIONS_FILE, 'utf-8'));
  consData.consultations = (consData.consultations || []).filter(
    (c: any) => c.dentistId !== dentistId
  );
  fs.writeFileSync(CONSULTATIONS_FILE, JSON.stringify(consData, null, 2));

  // Memberships + owned clinics
  const clinicsData = JSON.parse(fs.readFileSync(CLINICS_FILE, 'utf-8'));
  const remaining: any[] = [];
  for (const clinic of clinicsData.clinics || []) {
    if (clinic.ownerDentistId === dentistId) continue; // drop owned clinic entirely
    clinic.members = (clinic.members || []).filter((m: any) => m.dentistId !== dentistId);
    remaining.push(clinic);
  }
  clinicsData.clinics = remaining;
  fs.writeFileSync(CLINICS_FILE, JSON.stringify(clinicsData, null, 2));
}

async function main(): Promise<void> {
  if (hasFlag('--help') || args.length === 0) {
    console.log(`Delete a dentist profile without their PIN.

Usage:
  bun run scripts/delete-profile.ts --list
  bun run scripts/delete-profile.ts --name "Den" [--yes]
  bun run scripts/delete-profile.ts --id <dentist-id> [--yes]

Persistence mode: ${dbEnabled ? 'Postgres (DATABASE_URL is set)' : 'JSON files (data/*.json)'}`);
    return;
  }

  if (hasFlag('--list')) {
    const profiles = await listProfiles();
    console.log(`\nProfiles (${profiles.length}):`);
    for (const p of profiles) {
      console.log(`  ${p.id}  ${p.name}  (${p.specialty})`);
    }
    console.log('');
    return;
  }

  const name = getFlag('--name');
  const id = getFlag('--id');
  if (!name && !id) {
    console.error('Provide --name or --id (or --list). See --help.');
    process.exit(1);
  }

  const profiles = await listProfiles();
  const targets = profiles.filter((p) =>
    id ? p.id === id : p.name.toLowerCase() === name!.toLowerCase()
  );

  if (targets.length === 0) {
    console.error(`No profile found matching ${id ? `id "${id}"` : `name "${name}"`}.`);
    process.exit(1);
  }

  console.log('Targeting:');
  for (const t of targets) console.log(`  ${t.id}  ${t.name}`);
  if (targets.length > 1) {
    console.error('\nMultiple profiles match — be explicit (use --id). Nothing deleted.');
    process.exit(1);
  }

  const target = targets[0];
  if (!hasFlag('--yes')) {
    // Dry run: show what would happen, then require --yes to actually delete.
    console.log(`\nDry run — nothing deleted. This would permanently remove:\n`);
    console.log(`  ${target.id}  ${target.name} (${target.specialty})`);
    console.log(`  + their consultations, clinic memberships, and any owned clinic`);
    console.log(`\nRe-run with --yes to execute.`);
    return;
  }

  if (dbEnabled) {
    await deleteInPostgres(target.id);
  } else {
    deleteInJson(target.id);
  }
  console.log(`Deleted ${target.name} (${target.id}). Audit trail left intact by design.`);
}

main().catch((err) => {
  console.error('Deletion failed:', err);
  process.exit(1);
});
/**
 * Database Factory Reset Script
 * Performs a complete factory wipe of both PostgreSQL and local JSON data stores.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import fs from 'fs';
import path from 'path';
import { neon } from '@neondatabase/serverless';

async function main() {
  console.log('--- Initiating DentAI Complete Factory Reset ---');

  // 1. Clear PostgreSQL Database
  const connectionString = process.env.DATABASE_URL || '';
  if (connectionString) {
    console.log('[PostgreSQL] Connecting to database...');
    const sql = neon(connectionString);
    try {
      console.log('[PostgreSQL] Wiping tables...');
      
      try {
        await sql`TRUNCATE TABLE clinic_members, clinics, consultations, note_jobs, usage_events, login_attempts, revoked_sessions, recovery_tokens, subscriptions, audit_logs, dentists, app_meta CASCADE`;
        console.log('  ✓ Truncated all tables in single cascade statement');
      } catch (err: any) {
        console.warn('  ! Cascaded truncate failed, truncating tables individually:', err.message);
        const tables = [
          'clinic_members',
          'clinics',
          'consultations',
          'note_jobs',
          'usage_events',
          'login_attempts',
          'revoked_sessions',
          'recovery_tokens',
          'subscriptions',
          'audit_logs',
          'dentists',
          'app_meta'
        ];
        for (const t of tables) {
          try {
            if (t === 'clinic_members') await sql`TRUNCATE TABLE clinic_members CASCADE`;
            else if (t === 'clinics') await sql`TRUNCATE TABLE clinics CASCADE`;
            else if (t === 'consultations') await sql`TRUNCATE TABLE consultations CASCADE`;
            else if (t === 'note_jobs') await sql`TRUNCATE TABLE note_jobs CASCADE`;
            else if (t === 'usage_events') await sql`TRUNCATE TABLE usage_events CASCADE`;
            else if (t === 'login_attempts') await sql`TRUNCATE TABLE login_attempts CASCADE`;
            else if (t === 'revoked_sessions') await sql`TRUNCATE TABLE revoked_sessions CASCADE`;
            else if (t === 'recovery_tokens') await sql`TRUNCATE TABLE recovery_tokens CASCADE`;
            else if (t === 'subscriptions') await sql`TRUNCATE TABLE subscriptions CASCADE`;
            else if (t === 'audit_logs') await sql`TRUNCATE TABLE audit_logs CASCADE`;
            else if (t === 'dentists') await sql`TRUNCATE TABLE dentists CASCADE`;
            else if (t === 'app_meta') await sql`TRUNCATE TABLE app_meta CASCADE`;
            console.log(`  ✓ Truncated ${t}`);
          } catch (tErr: any) {
            console.warn(`  ! Could not truncate ${t}:`, tErr.message);
          }
        }
      }

      // Mark json_seed_done as true so it doesn't automatically re-import ancient legacy seeds
      try {
        await sql`INSERT INTO app_meta (key, value) VALUES ('json_seed_done', 'true') ON CONFLICT (key) DO UPDATE SET value = 'true'`;
        console.log('  ✓ Initialized app_meta (json_seed_done = true)');
      } catch (err: any) {
        console.warn('  ! Error setting app_meta:', err.message);
      }
      console.log('[PostgreSQL] Successfully wiped all database tables.');
    } catch (err: any) {
      console.error('[PostgreSQL] Error during database reset:', err);
    }
  } else {
    console.log('[PostgreSQL] DATABASE_URL not set; skipping remote database wipe.');
  }

  // 2. Clear Local JSON Data Files
  const dataDir = path.resolve(process.cwd(), 'data');
  if (fs.existsSync(dataDir)) {
    console.log('[JSON Store] Wiping local data directory...');
    const jsonFiles: Record<string, any> = {
      'consultations.json': { consultations: [] },
      'patients.json': { patients: [] },
      'chair_sessions.json': { sessions: {} },
      'note_jobs.json': { jobs: [] },
      'billing_events.json': { events: [] },
      'usage_events.json': { events: [] },
      'audit.json': { events: [] },
      'rate_limits.json': { limits: {} },
      'revoked_sessions.json': { tokens: [] },
      'subscriptions.json': { subscriptions: [] },
      'clinics.json': { clinics: [] },
      'users.json': { dentists: [] }
    };

    for (const [filename, content] of Object.entries(jsonFiles)) {
      const filePath = path.join(dataDir, filename);
      fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n', 'utf-8');
      console.log(`  ✓ Cleared ${filename}`);
    }
    console.log('[JSON Store] All local JSON data stores cleared.');
  }

  console.log('--- DentAI Complete Factory Reset Finished Successfully ---');
}

main().catch(err => {
  console.error('Fatal error during factory reset:', err);
  process.exit(1);
});

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();
import { neon } from '@neondatabase/serverless';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log('No DATABASE_URL set, skipping.');
    return;
  }
  const sql = neon(process.env.DATABASE_URL);
  try {
    await sql`DELETE FROM rate_limit_counters WHERE key LIKE '%signup%'`;
    console.log('Cleared signup rate limits from Postgres successfully.');
  } catch (err: any) {
    console.warn('Could not clear rate limits:', err?.message || err);
  }
}

main().catch(console.error);

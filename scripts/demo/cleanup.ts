/**
 * Cleanup: remove the demo dentists (and their clinics/consultations) from
 * the live data after recording. Delegates to the existing operator script,
 * which deletes the profile + consultations + memberships and owned clinics,
 * leaving the append-only audit trail intact by design.
 */
import { execSync } from 'child_process';
import { DEMO } from './config';

for (const person of [DEMO.owner, DEMO.member]) {
  const displayName = person.name;
  try {
    execSync(`bun run scripts/delete-profile.ts --name "${displayName}" --yes`, {
      stdio: 'inherit'
    });
  } catch (err: any) {
    console.warn(`⚠ could not delete ${displayName}:`, err.message || err);
  }
}
console.log('Demo profiles cleaned up.');

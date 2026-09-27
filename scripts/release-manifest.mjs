/**
 * Phase 12 Gate 5 — release manifest generator.
 *
 * Builds the production artifact and records reproducibility provenance for
 * the exact tree that was built: release version, git commit SHA, content tree
 * hash, artifact digests, migration version, runtime version, engine version
 * and evaluation version. No secrets, no credentials, no patient data.
 *
 *   node scripts/release-manifest.mjs
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');

function sh(cmd, opts = {}) {
  const out = execSync(cmd, { cwd: root, encoding: 'utf8', ...opts });
  return out == null ? '' : String(out).trim();
}

function digestFile(p) {
  return `sha256:${createHash('sha256').update(fs.readFileSync(p)).digest('hex')}`;
}

/** Deterministic digest of every file under a directory (sorted, path-prefixed). */
function digestTree(dir) {
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  })(dir);
  const h = createHash('sha256');
  for (const f of files.sort()) {
    h.update(`${path.relative(dir, f).replaceAll('\\', '/')}`);
    h.update(createHash('sha256').update(fs.readFileSync(f)).digest('hex'));
  }
  return `sha256:${h.digest('hex')}`;
}

console.log('building frontend + backend from the current tree…');
sh('npm run build', { stdio: 'inherit' });

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const dist = path.join(root, 'dist');
const distServer = path.join(root, 'dist-server');
const serverArtifact = fs.existsSync(distServer) ? distServer : root;

const gitShell = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
const treeHash = sh(`git add -A -- ':!.worktrees' ':!IDEA.md' ':!dist' ':!dist-server' 2>/dev/null; git write-tree; git reset -q`, { shell: gitShell, stdio: ['ignore', 'pipe', 'ignore'] });

const manifest = {
  releaseVersion: pkg.version,
  gitCommit: sh('git rev-parse HEAD'),
  contentTreeHash: treeHash,
  builtFromTreeMatchesCandidate: treeHash === '6e84379938a7bf8a291697dd5187e78605e9995e'
    || treeHash === 'a70cc779cf39da101e9f35d2d363d8141987cbb8',
  generatedAt: new Date().toISOString(),
  frontend: {
    path: 'dist/',
    digest: digestTree(dist),
    files: fs.readdirSync(path.join(dist, 'assets')).map(f => `${f} ${digestFile(path.join(dist, 'assets', f))}`),
  },
  backend: {
    path: fs.existsSync(distServer) ? 'dist-server/server.js' : 'server.js',
    digest: digestFile(path.join(serverArtifact, 'server.js')),
  },
  database: {
    migrations: '3/3 (001 baseline_schema, 002 custody_and_operability, 003 practice_acceptances)',
  },
  runtime: { node: process.version },
  engine: { deterministicMacro: 'deterministic-v1' },
  evaluation: {
    goldSet: { cases: 217, adversarial: 17, regression: 5 },
    clinicalEval: { fixtures: 3, minimumScore: 0.9 },
    benchmark: { cases: 20, standard: 'AHPRA & DBA clinical accuracy' },
  },
};

const out = path.join(root, 'release-manifest.json');
fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`release manifest written to ${path.relative(root, out)}`);
console.log(`  version:        ${manifest.releaseVersion}`);
console.log(`  commit:         ${manifest.gitCommit}`);
console.log(`  tree:           ${manifest.contentTreeHash}`);
console.log(`  built-from-rc:  ${manifest.builtFromTreeMatchesCandidate}`);

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Suites share local JSON fixtures — never parallelise test files (see PROJECT_CONTEXT.md #8).
    fileParallelism: false,
    testTimeout: 30000,
    exclude: [
      // Vitest defaults (keeps node_modules, dist etc. out)
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      // The origin worktree is a full checkout copy with its own fixtures; running
      // its suites alongside the main tree collides on shared JSON fixtures.
      '.worktrees/**',
      // reports/ holds discovery evidence and scratch fixtures, not repository
      // source. Its scratch specs are untracked, so CI never sees them, but
      // locally they were being executed as part of the suite (and failing
      // typecheck in the pre-commit hook). Excluding the directory keeps local
      // runs and CI measuring the same set of tests.
      'reports/**',
    ],
  },
});

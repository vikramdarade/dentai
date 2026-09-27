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
    ],
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Starts one in-memory MongoDB for the run; each API test file uses its own database.
    globalSetup: ['tests/setup/mongo-global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 120_000, // first run downloads the mongod binary
  },
});

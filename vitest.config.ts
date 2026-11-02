import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/setup/mongo-global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});

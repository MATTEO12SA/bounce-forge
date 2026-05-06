import { defineConfig } from 'vitest/config';

const base = process.env.VITE_BASE_PATH ?? './';

export default defineConfig({
  base,
  build: {
    chunkSizeWarningLimit: 1400
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts']
  }
});

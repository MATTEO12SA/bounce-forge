import { defineConfig } from 'vitest/config';

const base = process.env.VITE_BASE_PATH ?? './';

export default defineConfig({
  base,
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.API_PORT ?? '8787'}`,
        changeOrigin: true
      }
    }
  },
  build: {
    chunkSizeWarningLimit: 1400
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts']
  }
});

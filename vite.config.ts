import { defineConfig } from 'vitest/config';

const base = process.env.VITE_BASE_PATH ?? './';

export default defineConfig({
  base,
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.API_PORT ?? '8787'}`,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.headers.host) {
              proxyReq.setHeader('x-forwarded-host', req.headers.host);
            }
          });
        }
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

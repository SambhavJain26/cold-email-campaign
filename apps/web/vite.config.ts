import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));

// docs/11 §4: VITE_API_MODE=mock (default) serves MSW over golden fixtures;
// 'real' proxies /api to the Fastify server. Default matches the server's PORT
// default (docs/16); override with VITE_API_TARGET when running it elsewhere.
const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:3001';
const appBase = process.env.VITE_APP_BASE ?? '/';
const buildVersion = randomUUID();

export default defineConfig({
  base: appBase,
  define: { __BUILD_VERSION__: JSON.stringify(buildVersion) },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'application-version',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ version: buildVersion }),
        });
      },
    },
  ],
  resolve: {
    alias: { '@': path.resolve(root, 'src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
      '/email-campaign/api': {
        target: apiTarget,
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/email-campaign/, ''),
      },
    },
  },
});

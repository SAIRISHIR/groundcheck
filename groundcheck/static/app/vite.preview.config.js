import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Local preview build: the same app with @forge/bridge replaced by sample
// data, for screenshots and design checks outside Jira. Not deployed.
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: { '@forge/bridge': fileURLToPath(new URL('./preview/bridge-mock.js', import.meta.url)) },
  },
  build: { outDir: 'preview-build' },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Forge serves the built files from a sub-path inside an iframe, so asset
// URLs must be relative (base: './') rather than starting with "/".
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'build' },
});

import { defineConfig } from 'vite';
export default defineConfig({
  root: __dirname,
  server: { port: 4751, proxy: { '/api': 'http://127.0.0.1:4750' } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 2000 },
});

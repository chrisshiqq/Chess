import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/Chess/',
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  build: {
    outDir: 'docs',
    emptyOutDir: true,
  },
  plugins: [react()],
  define: {
  },
  resolve: {
    alias: {
      '@chess-worker': path.resolve(__dirname, 'src/worker/chess-worker-constructor.ts'),
      '@': path.resolve(__dirname, '.'),
    }
  }
});

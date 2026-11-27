import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: 'dist-standalone',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@chess-worker': path.resolve(__dirname, 'src/worker/chess-worker-constructor-inline.ts'),
      '@': path.resolve(__dirname, '.'),
    }
  }
});

import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const API = process.env.VITE_API_PROXY ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
        // O cookie de refresh é emitido com path=/auth pela API; no navegador a rota é /api/auth.
        cookiePathRewrite: { '/auth': '/api/auth' },
      },
      '/ws': { target: API.replace(/^http/, 'ws'), ws: true },
    },
  },
  preview: { port: 4173 },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: { manualChunks: { pixi: ['pixi.js'], react: ['react', 'react-dom', 'react-router'] } },
    },
  },
});

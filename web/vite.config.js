import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // The API is proxied so the browser only ever talks to one origin.
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001',
        changeOrigin: true,
        secure: false,
      },
    },
    // Allow the Arena preview host and any sandbox subdomain.
    allowedHosts: true,
    hmr: { clientPort: 443 },
  },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true, allowedHosts: true },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('monaco')) return 'monaco';
          if (id.includes('recharts') || id.includes('d3-')) return 'charts';
          if (id.includes('react-router') || id.includes('/react/') || id.includes('react-dom')) return 'vendor';
          return undefined;
        },
      },
    },
  },
});

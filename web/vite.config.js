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
        /**
         * Only Monaco is split out; everything else is left to the bundler.
         *
         * There used to be `charts` and `icons` chunks here, and both were a
         * trap. Putting recharts in a manual chunk made that chunk a dependency
         * of the entry, so 463 kB of chart code (with React bundled inside it)
         * downloaded before the chat could paint, even though recharts is only
         * reachable through a `lazy()` renderer. Left alone, it splits into a
         * lazy `AreaChart`/`LineChart` pair and the entry stays ~20 kB.
         *
         * Monaco keeps its own chunk: it is genuinely huge and the practice
         * editor wants it as one unit.
         */
        manualChunks(id) {
          if (id.includes('node_modules') && id.includes('monaco')) return 'monaco';
          return undefined;
        },
      },
    },
  },
});

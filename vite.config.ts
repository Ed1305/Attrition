import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(({mode}) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    host: '0.0.0.0',
    // The dev server runs behind a proxy (AI Studio / Arena preview / any
    // tunnel), so the Host header is not the machine's own name.
    allowedHosts: true,
    port: Number(process.env.PORT ?? 3000),
    strictPort: false,
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify — file watching is disabled to prevent flickering during
    // agent edits.
    hmr: process.env.DISABLE_HMR === 'true' ? false : { overlay: false },
    watch: process.env.DISABLE_HMR === 'true' ? null : undefined,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/xlsx')) return 'xlsx';
          if (id.includes('node_modules/motion') || id.includes('node_modules/framer-motion')) return 'motion';
          return undefined;
        },
      },
    },
  },
}));

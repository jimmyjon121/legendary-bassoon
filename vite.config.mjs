import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: './',
  root: 'src',
  publicDir: '../public',
  // Strip debugger statements in production. We keep console.* so that
  // renderer-side errors and diagnostics are visible in DevTools and via
  // the main process's `console-message` handler. If you want the smallest
  // possible release bundle, add DEVFORGE_DROP_CONSOLE=1 at build time.
  esbuild: {
    drop: mode === 'production'
      ? (process.env.DEVFORGE_DROP_CONSOLE === '1' ? ['console', 'debugger'] : ['debugger'])
      : [],
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: false, // Disable sourcemaps for production (faster build)
    minify: 'esbuild', // Use esbuild for faster minification
    target: 'esnext', // Modern browsers only
    rollupOptions: {
      output: {
        // Electron loads from file://, so stable names avoid stale hashed-chunk lookups
        // when a background session survives a rebuild.
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: (assetInfo) => {
          const ext = path.extname(assetInfo.name || '');
          const name = path.basename(assetInfo.name || 'asset', ext);
          return `assets/${name}${ext}`;
        },
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('/react/')) return 'vendor-react';
            if (id.includes('framer-motion')) return 'vendor-motion';
            if (id.includes('lucide-react')) return 'vendor-ui';
            // Keep React-adjacent state/query libs in the same chunk as React.
            // This avoids circular chunk imports like vendor-react <-> vendor-data
            // that can leave React undefined during production startup.
            if (id.includes('zustand') || id.includes('@tanstack')) return 'vendor-react';
            if (id.includes('monaco-editor') || id.includes('@monaco-editor')) return 'vendor-editor';
            if (id.includes('marked') || id.includes('dompurify') || id.includes('highlight.js')) return 'vendor-markdown';
            if (id.includes('three') || id.includes('@react-three')) return 'vendor-three';
            if (id.includes('reactflow')) return 'vendor-flow';
          }
        }
      }
    },
    chunkSizeWarningLimit: 1000, // Increase warning threshold for vendor chunks
  },
  optimizeDeps: {
    include: [
      'react', 
      'react-dom', 
      'framer-motion', 
      'zustand',
      'lucide-react',
      'marked',
      'dompurify',
    ],
    esbuildOptions: {
      target: 'esnext', // Modern browsers only
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@services': path.resolve(__dirname, './src/services'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@stores': path.resolve(__dirname, './src/stores'),
      '@utils': path.resolve(__dirname, './src/utils')
    }
  },
  server: {
    port: 5173,
    strictPort: true
  },
  // Enable CSS code splitting
  css: {
    devSourcemap: false,
  }
}));

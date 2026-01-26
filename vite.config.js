import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: './',
  root: 'src',
  publicDir: '../public',
  // Strip console.* and debugger statements in production
  esbuild: {
    drop: mode === 'production' ? ['console', 'debugger'] : [],
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: false, // Disable sourcemaps for production (faster build)
    minify: 'esbuild', // Use esbuild for faster minification
    target: 'esnext', // Modern browsers only
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks - loaded once, cached
          'vendor-react': ['react', 'react-dom'],
          'vendor-motion': ['framer-motion'],
          'vendor-ui': ['lucide-react'],
          'vendor-data': ['zustand', '@tanstack/react-query', '@tanstack/react-virtual'],
          'vendor-editor': ['@monaco-editor/react', 'monaco-editor'],
          'vendor-markdown': ['marked', 'dompurify', 'highlight.js'],
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

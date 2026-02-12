import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          'pdfjs-dist': ['pdfjs-dist'],
          'xlsx': ['xlsx'],
          'html5-qrcode': ['html5-qrcode'],
          'framer-motion': ['framer-motion'],
          'vendor': ['react', 'react-dom']
        }
      }
    }
  }
})

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const api = process.env.STREETMEND_API ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // MapLibre GL (~1 MB) and three.js (~0.7 MB) go in their own long-cached chunks.
  build: {
    chunkSizeWarningLimit: 1100,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'maplibre', test: /node_modules[\/]maplibre-gl/ },
            { name: 'three', test: /node_modules[\/]three/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: api, changeOrigin: true } },
  },
  preview: {
    port: 4173,
    proxy: { '/api': { target: api, changeOrigin: true } },
  },
})

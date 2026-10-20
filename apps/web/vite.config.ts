import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const api = process.env.STREETMEND_API ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // MapLibre GL alone is ~1 MB minified; one chunk is fine for this app.
  build: { chunkSizeWarningLimit: 1700 },
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

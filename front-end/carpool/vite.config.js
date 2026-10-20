import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // `npm run build:hosted` makes the claude.ai-hosted build, which is served from
  // a sub-path and so needs relative asset URLs.
  ...(mode === "hosted" ? { base: "./", build: { outDir: "dist-hosted" } } : {}),
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
}))

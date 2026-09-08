import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/short-drama-studio/',
  plugins: [react()],
  server: {
    port: 5179,
    host: true,
    proxy: {
      // Mirror apps/api LiteLLM: browser -> Vite -> http://127.0.0.1:4000
      '/litellm': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/litellm/, ''),
      },
    },
  },
})

import { defineConfig } from 'vite'
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  server: {
    fs: {
      // Allow Vite to serve files from the parent repo — needed when running
      // from a git worktree where node_modules is symlinked to the main checkout.
      allow: ['..', '../../..'],
    },
  },
  plugins: [
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
})

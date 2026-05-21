import { defineConfig } from 'vite'
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { FontaineTransform } from 'fontaine'

export default defineConfig({
  server: {
    fs: {
      // Allow Vite to serve files from the parent repo — needed when running
      // from a git worktree where node_modules is symlinked to the main checkout.
      allow: ['..', '../../..'],
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split heavy client vendors into their own cacheable chunks so they
        // don't bloat the entry/route chunks that gate hydration (INP). Only
        // affects the browser build; SSR ignores chunking.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/motion/') || id.includes('/framer-motion/')) return 'motion'
          if (id.includes('/@sentry/')) return 'sentry'
          if (id.includes('/@portabletext/')) return 'portabletext'
          return
        },
      },
    },
  },
  plugins: [
    tailwindcss(),
    // Generates metric-matched "* Variable Fallback" @font-face rules from the
    // self-hosted @fontsource faces so the fallback→webfont swap causes no CLS.
    // The generated family names are referenced in app.css --font-* stacks.
    FontaineTransform.vite({
      fallbacks: ['system-ui', 'Arial', 'Times New Roman'],
      fallbackName: (family) => `${family} Fallback`,
    }),
    reactRouter(),
    tsconfigPaths(),
  ],
})

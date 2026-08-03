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
    // Generates metric-matched fallback @font-face rules from the self-hosted
    // @fontsource faces so the fallback→webfont swap causes no reflow (and so
    // the swap does not register a fresh, larger LCP candidate).
    //
    // The `family` fontaine hands us is NOT stable across modes: in dev it is
    // the @font-face family from the fontsource CSS ("DM Sans Variable"), and
    // in the production build it is derived from the font file basename
    // ("DM", from dm-sans-latin-wght-normal.woff2). A naive
    // `${family} Fallback` therefore emits "DM Sans Variable Fallback" in dev
    // and "DM Fallback" in prod, so any single name written into the app.css
    // --font-* stacks is guaranteed to be wrong in one of the two — which is
    // how the metric-matched layer silently went dead in production.
    //
    // Normalising away the Variable/Sans/Mono qualifiers collapses both inputs
    // onto one name, so the stacks in app.css resolve in dev and prod alike.
    // If you change this, re-check both:
    //   grep -o 'font-family:[A-Za-z ]*Fallback' build/client/assets/app-*.css
    //   and the same query against the dev server's stylesheet.
    FontaineTransform.vite({
      fallbacks: ['system-ui', 'Arial', 'Times New Roman'],
      fallbackName: (family) => `${family.replace(/\s*\b(Variable|Sans|Mono)\b/g, '').trim()} Fallback`,
    }),
    reactRouter(),
    tsconfigPaths(),
  ],
})

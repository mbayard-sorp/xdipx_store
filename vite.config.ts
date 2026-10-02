import { defineConfig, type Plugin } from 'vite'
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { FontaineTransform } from 'fontaine'

// Collapses fontaine's mode-dependent family spelling ("DM Sans Variable" in
// dev, "DM" in the production build) onto one stable key. See the fontaine
// comment below for why both the fallback name and the fallback lookup need it.
const normaliseFontFamily = (family: string) =>
  family.replace(/\s*\b(Variable|Sans|Mono)\b/g, '').trim()

// Local fonts each self-hosted family's metric-matched fallback is built from.
// fontaine emits one @font-face per entry, declared in REVERSE order, and the
// browser tries the last-declared face first, so the first entry here is the
// first one tried. Each list runs desktop fonts first, then the Android / Linux
// system faces (Noto, Roboto), because a list with no font the device actually
// has makes the whole fallback family fail and drops the text to an unadjusted
// system face that reflows when the webfont swaps in.
// Only families with capsize metrics generate a face. Liberation is absent from
// fontaine's metrics set, so Linux is covered by METRIC_CLONES below instead.
const SERIF_FALLBACKS = ['Times New Roman', 'Georgia', 'Noto Serif']
const SANS_FALLBACKS = ['Arial', 'Helvetica Neue', 'Roboto', 'Noto Sans']
const MONO_FALLBACKS = ['Courier New', 'Roboto Mono', 'Noto Sans Mono']
const FONT_FALLBACKS: Record<string, string[]> = {
  Newsreader: SERIF_FALLBACKS,
  DM: SANS_FALLBACKS,
  JetBrains: MONO_FALLBACKS,
  Caveat: SANS_FALLBACKS,
}

// Linux ships Liberation Serif / Sans / Mono instead of Times New Roman, Arial
// and Courier New, and local() matches real font names only, never fontconfig
// aliases. Without this, every fallback face fails on Linux (the Lighthouse CI
// runner, very likely PageSpeed too) and the text reflows on swap. Liberation is
// metric-compatible with the font it replaces by design, so it can share the
// same face and overrides as a second local() source.
const METRIC_CLONES: Record<string, string> = {
  'Times New Roman': 'Liberation Serif',
  Arial: 'Liberation Sans',
  'Courier New': 'Liberation Mono',
}

const fontFallbackMetricClones = (): Plugin => ({
  name: 'xdipx:font-fallback-metric-clones',
  enforce: 'pre',
  transform(code, id) {
    if (!/\.css(\?|$)/.test(id) || !code.includes('local(')) return
    return code.replace(
      /src:\s*local\("(Times New Roman|Arial|Courier New)"\)/g,
      (match, font: string) => `${match}, local("${METRIC_CLONES[font]}")`,
    )
  },
})

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
    //
    // `fallbacks` must be per family. A flat array overrides every family at
    // once, which is how the serif headline ended up with Arial as its
    // fallback on Mac and nothing at all on Android, reflowing the LCP <h1>
    // when Newsreader arrived (PSI 2026-10-02: mobile LCP 4.4s, desktop CLS
    // 0.116). fontaine looks the list up by its raw, mode-dependent family, so
    // the lookup goes through the same normaliser as the name.
    FontaineTransform.vite({
      fallbacks: new Proxy(FONT_FALLBACKS, {
        get: (target, family) =>
          typeof family === 'string' ? target[normaliseFontFamily(family)] : undefined,
      }),
      fallbackName: (family) => `${normaliseFontFamily(family)} Fallback`,
    }),
    // Must stay after FontaineTransform: it rewrites the faces fontaine emits.
    fontFallbackMetricClones(),
    reactRouter(),
    tsconfigPaths(),
  ],
})

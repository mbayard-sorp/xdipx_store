import type { Config } from '@react-router/dev/config'

export default {
  ssr: true,
  // `lazy` (the default) makes hydration fetch /__manifest for every <Link>
  // in the DOM, which put that endpoint at 24% of the site's crawl requests
  // and made it the third-busiest path in production. `initial` ships the
  // whole route table as an immutable, hash-named asset instead: no
  // /__manifest calls at all, and no client-side failure path when the
  // endpoint is unreachable (a failed fetcher-triggered discovery escalates
  // to the root error boundary and blanks the page).
  routeDiscovery: { mode: 'initial' },
  future: {
    unstable_optimizeDeps: true,
  },
} satisfies Config

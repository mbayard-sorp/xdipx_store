import 'dotenv/config'
import { initSentryServer } from '../app/lib/sentry.server.js'
// Initialize Sentry before any other module so instrumentation patches cleanly.
initSentryServer()

import express from 'express'
import compression from 'compression'
import { createRequestHandler } from '@react-router/express'
import type { ServerBuild } from 'react-router'
import { createCronRoutes } from './cron.js'
import { createWebhookRoutes } from './webhooks.js'
import { validateStartupEnv } from '../app/lib/env.server.js'

const isProduction = process.env['NODE_ENV'] === 'production'

validateStartupEnv()

const viteDevServer = isProduction
  ? undefined
  : await import('vite').then((vite) =>
      vite.createServer({
        server: { middlewareMode: true },
        appType: 'custom',
      }),
    )

const app = express()

// ─── gzip/brotli-friendly compression for HTML/JSON responses ────────────
// Static asset handlers below set their own immutable caching; compression
// skips pre-compressed assets automatically via the default filter.
app.use(compression())

// ─── Static assets (production only; Vite serves them in dev) ────────────
if (!viteDevServer) {
  app.use(
    '/assets',
    express.static('build/client/assets', { immutable: true, maxAge: '1y' }),
  )
  app.use(express.static('build/client', { maxAge: '1h' }))
}

// ─── Vite dev middleware (HMR + module transforms) ───────────────────────
if (viteDevServer) {
  app.use(viteDevServer.middlewares)
}

// ─── Cron routes — protected by x-cron-secret header ─────────────────────
app.use('/cron', express.json({ limit: '64kb' }), createCronRoutes())

// ─── Shopify webhooks — raw body for HMAC verification ────────────────────
app.use(
  '/webhooks',
  express.raw({ type: 'application/json', limit: '1mb' }),
  createWebhookRoutes(),
)

// ─── CORS for Sanity Studio API routes ───────────────────────────────────
// Studio is the only trusted cross-origin caller. Echo allowed origins only;
// never a wildcard in production.
const STUDIO_ORIGINS = new Set(
  (process.env['STUDIO_ALLOWED_ORIGINS'] ?? 'http://localhost:3333')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
)
app.use('/api/', (req, res, next) => {
  const origin = req.headers.origin
  if (origin && STUDIO_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-studio-secret')
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  next()
})

// ─── React Router handles everything else ────────────────────────────────
// Do NOT install global express.json/urlencoded here — they drain the request
// body before React Router's handler can call `request.formData()`, which
// silently turns every form submission into empty fields (regression: admin
// login reported "Email and password are required" with valid input).
// Route-specific parsers (cron, webhooks) already set their own limits.
const build: ServerBuild | (() => Promise<ServerBuild>) = viteDevServer
  ? () =>
      viteDevServer.ssrLoadModule(
        'virtual:react-router/server-build',
      ) as Promise<ServerBuild>
  : ((await import(
      // @ts-expect-error — resolved at runtime after `react-router build`
      '../build/server/index.js'
    )) as ServerBuild)

app.all(
  '*',
  createRequestHandler({
    build,
    getLoadContext() {
      return {}
    },
  }),
)

const port = process.env['PORT'] ?? 3000
app.listen(port, () => {
  console.log(`\n🌊 xdipx running on http://localhost:${port}\n`)
})

export default app

import 'dotenv/config'
import { initSentryServer } from '../app/lib/sentry.server.js'
// Initialize Sentry before any other module so instrumentation patches cleanly.
initSentryServer()

import express from 'express'
import { createRequestHandler } from '@react-router/express'
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

// ─── Body size caps for all remaining routes ─────────────────────────────
// Admin upload routes that need more should set their own limit at the route.
app.use(express.json({ limit: '64kb' }))
app.use(express.urlencoded({ extended: true, limit: '64kb' }))

// ─── React Router handles everything else ────────────────────────────────
const build = viteDevServer
  ? () =>
      viteDevServer.ssrLoadModule(
        'virtual:react-router/server-build',
      ) as Promise<Parameters<typeof createRequestHandler>[0]['build']>
  : ((await import(
      // @ts-expect-error — resolved at runtime after `react-router build`
      '../build/server/index.js'
    )) as Parameters<typeof createRequestHandler>[0]['build'])

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

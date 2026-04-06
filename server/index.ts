import 'dotenv/config'
import express from 'express'
import { createRequestHandler } from '@react-router/express'
import { createCronRoutes } from './cron.js'
import { createWebhookRoutes } from './webhooks.js'

// In production the build exists; in dev React Router handles this via HMR
const getBuild = async () => {
  if (process.env['NODE_ENV'] === 'production') {
    return import('../build/server/index.js' as string)
  }
  // Dev: React Router dev server handles compilation
  return import('../build/server/index.js' as string).catch(() => ({
    default: undefined,
  })) as ReturnType<typeof import('../build/server/index.js')>
}

const app = express()

// ─── Static assets ────────────────────────────────────────────────────────
app.use(
  '/assets',
  express.static('build/client/assets', { immutable: true, maxAge: '1y' }),
)
app.use(express.static('build/client', { maxAge: '1h' }))

// ─── Cron routes — protected by x-cron-secret header ─────────────────────
app.use('/cron', express.json(), createCronRoutes())

// ─── Shopify webhooks — raw body for HMAC verification ────────────────────
app.use(
  '/webhooks',
  express.raw({ type: 'application/json' }),
  createWebhookRoutes(),
)

// ─── CORS for Sanity Studio API routes ───────────────────────────────────
// The studio runs on a different origin (localhost:3333); any /api/ route
// it calls needs CORS headers on both the OPTIONS preflight AND the response.
// We handle it here at the Express level so it works regardless of how
// React Router routes the request internally.
app.use('/api/', (_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-studio-secret')
  if (_req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  next()
})

// ─── React Router handles everything else ────────────────────────────────
app.all(
  '*',
  createRequestHandler({
    // @ts-expect-error — build types resolved at runtime
    build: await getBuild(),
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

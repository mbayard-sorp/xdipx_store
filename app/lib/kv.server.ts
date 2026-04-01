/**
 * Vercel KV wrapper — gracefully no-ops when KV is not configured (local dev).
 * All Vercel-specific code stays in server/ or here; never imported inside app/routes.
 */

let _kv: Awaited<ReturnType<typeof import('@vercel/kv').createClient>> | null = null

async function getKV() {
  if (_kv) return _kv
  if (!process.env['KV_REST_API_URL'] || !process.env['KV_REST_API_TOKEN']) return null
  const { createClient } = await import('@vercel/kv')
  _kv = createClient({
    url:   process.env['KV_REST_API_URL']!,
    token: process.env['KV_REST_API_TOKEN']!,
  })
  return _kv
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const kv = await getKV()
  if (!kv) return null
  return kv.get<T>(key)
}

export async function kvSet(key: string, value: unknown, exSeconds?: number): Promise<void> {
  const kv = await getKV()
  if (!kv) return
  if (exSeconds) {
    await kv.set(key, value, { ex: exSeconds })
  } else {
    await kv.set(key, value)
  }
}

export async function kvIncr(key: string): Promise<number> {
  const kv = await getKV()
  if (!kv) return 0
  return kv.incr(key)
}

export async function kvDel(key: string): Promise<void> {
  const kv = await getKV()
  if (!kv) return
  await kv.del(key)
}

// ─── Named KV Keys ────────────────────────────────────────────────────────

export const KV_KEYS = {
  feedCache:           'nalpac:feed:cache',
  feedCacheTimestamp:  'nalpac:feed:timestamp',
  socialProof:         (handle: string) => `social:proof:${handle}`,
  dealOfDay:           'deal:today',
  viewerCount:         (handle: string) => `viewers:${handle}`,
} as const

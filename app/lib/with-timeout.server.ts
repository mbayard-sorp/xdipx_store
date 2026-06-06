/**
 * with-timeout.server.ts
 *
 * Generic "race a promise against a wall-clock budget" helper. On timeout it
 * resolves to `fallback` (it never rejects) and logs a warning, so a single
 * slow upstream (Shopify / Sanity / Neon / KV) can't blow a serverless
 * function's maxDuration and hand Googlebot a 502/504/499 instead of real
 * server-rendered HTML.
 *
 * Mirrors the Twilio-scoped helper in twilio.server.ts but with a neutral log
 * namespace so it can be reused anywhere (loaders, crons, rails).
 */
export async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  fallback: T,
  label = 'op',
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[with-timeout] ${label} timed out after ${ms}ms — using fallback`)
      resolve(fallback)
    }, ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

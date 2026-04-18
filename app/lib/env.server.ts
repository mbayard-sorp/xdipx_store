import crypto from 'node:crypto'

const isProd = process.env['NODE_ENV'] === 'production'

/**
 * Constant-time compare an incoming shared-secret header against an env value.
 * Returns false on any nullish/empty input so callers can write a single guard.
 */
export function verifyInternalSecret(
  header: string | null | undefined,
  envName: string,
): boolean {
  const expected = process.env[envName]
  if (!expected || !header) return false
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export function requireSecret(name: string): string {
  const value = process.env[name]
  if (!value) {
    if (isProd) {
      throw new Error(`[env] Required secret ${name} is not set. Refusing to boot.`)
    }
    return `dev-${name.toLowerCase()}-not-set`
  }
  return value
}

const REQUIRED_IN_PRODUCTION = [
  'SESSION_SECRET',
  'CRON_SECRET',
  'SHOPIFY_WEBHOOK_SECRET',
  'SHOPIFY_STORE_DOMAIN',
  'SHOPIFY_STOREFRONT_TOKEN',
  'DATABASE_URL',
  'ANTHROPIC_API_KEY',
  'APP_URL',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER',
  'IVR_WS_URL',
  'IVR_WS_SECRET',
  'ELEVENLABS_VOICE_ID_IVR',
  'INTERNAL_API_SECRET',
]

export function validateStartupEnv(): void {
  if (!isProd) return
  const missing = REQUIRED_IN_PRODUCTION.filter((k) => !process.env[k])
  if (missing.length > 0) {
    throw new Error(`[env] Missing required env vars in production: ${missing.join(', ')}`)
  }
}

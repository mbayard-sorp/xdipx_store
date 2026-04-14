const isProd = process.env['NODE_ENV'] === 'production'

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
]

export function validateStartupEnv(): void {
  if (!isProd) return
  const missing = REQUIRED_IN_PRODUCTION.filter((k) => !process.env[k])
  if (missing.length > 0) {
    throw new Error(`[env] Missing required env vars in production: ${missing.join(', ')}`)
  }
}

/**
 * Home page variant flag resolution for the "Find you in a product" rebuild.
 *
 * Resolution order (first match wins):
 *   1. `?variant=a|b` query string  → forces a value, no cookie write
 *      (preview/QA only — won't pin the user)
 *   2. `xdipx_home_variant=a|b`     → cookie pin (set explicitly via UI)
 *   3. `HOME_VARIANT` env var       → org-wide default (a, b, or unset)
 *   4. fallback `'a'`               → safe default
 *
 * No cookie bucketing here — that's a follow-up if/when we want a
 * proper 50/50 split with sticky assignment + analytics tracking.
 */

import type { HomeVariant } from '~/types/discovery'

const COOKIE_NAME = 'xdipx_home_variant'
const VALID = new Set<HomeVariant>(['a', 'b'])

function isValid(v: unknown): v is HomeVariant {
  return typeof v === 'string' && VALID.has(v as HomeVariant)
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

export interface HomeVariantResolution {
  variant: HomeVariant
  source:  'query' | 'cookie' | 'env' | 'default'
}

export function resolveHomeVariant(request: Request): HomeVariantResolution {
  const url = new URL(request.url)
  const q = url.searchParams.get('variant')
  if (isValid(q)) return { variant: q, source: 'query' }

  const c = readCookie(request, COOKIE_NAME)
  if (isValid(c)) return { variant: c, source: 'cookie' }

  const env = process.env['HOME_VARIANT']?.trim().toLowerCase()
  if (isValid(env)) return { variant: env, source: 'env' }

  return { variant: 'a', source: 'default' }
}

/**
 * Build a `Set-Cookie` header value to pin a user to a variant. 60-day TTL.
 * Use from a route action (e.g. an admin "preview as B" toggle) — never
 * automatically, since variant assignment is not the same thing as a real
 * A/B test bucket.
 */
export function pinHomeVariantCookie(variant: HomeVariant): string {
  const sixtyDays = 60 * 24 * 60 * 60
  const parts = [
    `${COOKIE_NAME}=${variant}`,
    'Path=/',
    `Max-Age=${sixtyDays}`,
    'SameSite=Lax',
  ]
  if (process.env['NODE_ENV'] === 'production') parts.push('Secure')
  return parts.join('; ')
}

export const HOME_VARIANT_COOKIE = COOKIE_NAME

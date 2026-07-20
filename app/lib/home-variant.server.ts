/**
 * Home page variant flag resolution for the "Find you in a product" rebuild.
 *
 * Resolution order (first match wins):
 *   1. `?variant=a|b` query string  → forces a value, no cookie write
 *      (preview/QA only — won't pin the user)
 *   2. `xdipx_home_variant=a|b`     → cookie pin (set explicitly via UI)
 *   3. Sanity homeConfig.activeVariant ('a' or 'b' only — 'off' falls through)
 *   4. `HOME_VARIANT` env var       → org-wide default (a, b, or unset)
 *   5. fallback `'b'`               → the storefront home ("Emma's Edit")
 *
 * The code-level default IS the flip switch (owner direction 2026-07-20,
 * design-critic gate + team review in PR #273): baking 'b' in here rather
 * than only in Sanity/env means a Sanity outage can't silently revert `/`
 * to the legacy daily-deal home. Editors can still force 'a'/'b' from
 * Sanity homeConfig without a deploy; rolling back to legacy is a revert
 * of this commit.
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

/** The resolver can return 'legacy' in addition to the pinnable variants. */
export type ResolvedVariant = HomeVariant | 'legacy'

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
  variant: ResolvedVariant
  source:  'query' | 'cookie' | 'sanity' | 'env' | 'default'
}

/**
 * Resolve which home page variant to render.
 *
 * @param request       - Incoming request (for query string + cookie).
 * @param sanityVariant - Value from Sanity homeConfig.activeVariant.
 *                        Pass null/undefined when Sanity is unavailable.
 *                        'off' is treated as "no Sanity opinion" and falls
 *                        through to env/default — only 'a' or 'b' pin a variant.
 */
export function resolveHomeVariant(
  request: Request,
  sanityVariant?: 'a' | 'b' | 'off' | null,
): HomeVariantResolution {
  const url = new URL(request.url)
  const q = url.searchParams.get('variant')
  if (isValid(q)) return { variant: q, source: 'query' }

  const c = readCookie(request, COOKIE_NAME)
  if (isValid(c)) return { variant: c, source: 'cookie' }

  // Sanity wins only when the value is an explicit 'a' or 'b'.
  // 'off' intentionally falls through so editors can revert to the env/default
  // path without needing to coordinate a code deploy.
  if (sanityVariant === 'a' || sanityVariant === 'b') {
    return { variant: sanityVariant, source: 'sanity' }
  }

  const env = process.env['HOME_VARIANT']?.trim().toLowerCase()
  if (isValid(env)) return { variant: env, source: 'env' }

  return { variant: 'b', source: 'default' }
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

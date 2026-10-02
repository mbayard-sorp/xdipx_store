/**
 * POST /api/team/social-candidates — read-only social product candidate pool
 * (ticket #12876, owner 2026-10-01 companion to #12875's bare-product-reference
 * fix): social kept reusing the same handful of products (14 distinct in 21
 * days against ~4,800 in stock) because nothing supplied candidates or
 * tracked per-product post counts — the agent picked from memory.
 *
 *   { op: 'candidates', platform, cooldownDays?, newWithinDays?, limit?,
 *     productType? }
 *     -> { candidates: SocialCandidate[] }
 *     platform: 'instagram' | 'x'. cooldownDays/newWithinDays/limit default
 *     to 21/21/20. productType, when passed, exact-matches (case-insensitive)
 *     Shopify's native product_type. Never writes a row, never spends.
 *
 * Read-only pool source for routine-social-daily.md Step 2.9 item 1 ("Build
 * the pool before choosing anything") — this is the new first source in that
 * ordered list, ahead of the brief's socialShortlist / product-news rows /
 * the storefront's /new listing it already named.
 *
 * Scoring, cooldown exclusion, and the Instagram category filter all live in
 * `~/lib/social-candidates.server.ts` as a pure, unit-tested function; this
 * route is the thin HTTP/auth wrapper around it.
 */
import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import { getSocialCandidates } from '~/lib/social-candidates.server'
import { apiError } from '~/lib/api-error.server'

const PLATFORMS = ['instagram', 'x'] as const

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>

  if (b['op'] !== 'candidates') {
    return new Response('Bad Request: op must be "candidates"', { status: 400 })
  }

  const platform = str(b['platform'])
  if (!platform || !(PLATFORMS as readonly string[]).includes(platform)) {
    return new Response(`Bad Request: platform must be one of ${PLATFORMS.join('|')}`, { status: 400 })
  }

  try {
    const cooldownDays = num(b['cooldownDays'])
    const newWithinDays = num(b['newWithinDays'])
    const limit = num(b['limit'])
    const productType = str(b['productType'])
    const candidates = await getSocialCandidates({
      platform: platform as 'instagram' | 'x',
      ...(cooldownDays !== undefined ? { cooldownDays } : {}),
      ...(newWithinDays !== undefined ? { newWithinDays } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(productType !== undefined ? { productType } : {}),
    })
    return Response.json({ candidates })
  } catch (err) {
    return apiError('team-social-candidates', err, 'social-candidates op failed')
  }
}

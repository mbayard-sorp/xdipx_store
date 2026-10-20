/**
 * Signed one-tap approve links for the owner digest (ticket #16432, plan §5
 * and §9.8).
 *
 *   GET /admin/ads/approve?id=<id>&exp=<unix seconds>&sig=<hex>
 *   sig = HMAC-SHA256(CRON_SECRET, `${id}.${exp}`)
 *
 * A link lives 24 hours. The route checks the signature AND the admin
 * session, never one without the other: the signature proves the link came
 * from the digest, and the session proves the owner is the one tapping it.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export const APPROVE_LINK_TTL_SECONDS = 24 * 3600
export const APPROVE_PATH = '/admin/ads/approve'

export type ApproveLinkRefusal = 'malformed' | 'tampered' | 'expired' | 'no_secret'

export type ApproveLinkVerdict =
  | { ok: true; id: number; exp: number }
  | { ok: false; code: ApproveLinkRefusal; message: string }

/** Plain sentences the route shows for a refused link. */
export const REFUSAL_MESSAGES: Readonly<Record<ApproveLinkRefusal, string>> = {
  malformed: 'This approve link is incomplete, so nothing was approved. Open the actions page and tap Approve there.',
  tampered: 'This approve link does not match its signature, so nothing was approved. Open the actions page and tap Approve there.',
  expired: 'This approve link is more than a day old, so nothing was approved. Open the actions page and tap Approve there.',
  no_secret: 'Approve links are switched off on this server because CRON_SECRET is not set. Open the actions page and tap Approve there.',
}

function secretOr(secret: string | undefined): string | null {
  const s = secret ?? process.env['CRON_SECRET']
  return s && s.length > 0 ? s : null
}

export function signApproval(id: number, exp: number, secret: string): string {
  return createHmac('sha256', secret).update(`${id}.${exp}`).digest('hex')
}

/** The full link for one ledger row, valid for 24 hours from `now`. */
export function buildApproveLink(
  id: number,
  opts: { now?: Date | undefined; secret?: string | undefined; baseUrl?: string | undefined } = {},
): string | null {
  const secret = secretOr(opts.secret)
  if (!secret) return null
  const exp = Math.floor((opts.now ?? new Date()).getTime() / 1000) + APPROVE_LINK_TTL_SECONDS
  // Vite sets BASE_URL to "/" in dev and tests; an email link has to be absolute.
  const envBase = process.env['BASE_URL']
  const base = (opts.baseUrl || (envBase && /^https?:\/\//.test(envBase) ? envBase : 'https://xdipx.com')).replace(/\/+$/, '')
  return `${base}${APPROVE_PATH}?id=${id}&exp=${exp}&sig=${signApproval(id, exp, secret)}`
}

const refuse = (code: ApproveLinkRefusal): ApproveLinkVerdict => ({ ok: false, code, message: REFUSAL_MESSAGES[code] })

/**
 * Checks a link's three parameters. The signature is compared in constant
 * time before the expiry is read, so a forged link learns nothing about
 * timing from either check.
 */
export function verifyApproveLink(
  rawId: string | null | undefined,
  rawExp: string | null | undefined,
  rawSig: string | null | undefined,
  opts: { now?: Date; secret?: string } = {},
): ApproveLinkVerdict {
  const secret = secretOr(opts.secret)
  if (!secret) return refuse('no_secret')
  if (!rawId || !/^\d{1,15}$/.test(rawId) || !rawExp || !/^\d{1,12}$/.test(rawExp) || !rawSig || !/^[0-9a-f]{64}$/i.test(rawSig)) {
    return refuse('malformed')
  }
  const id = Number(rawId)
  const exp = Number(rawExp)
  if (!(id > 0)) return refuse('malformed')
  const expected = Buffer.from(signApproval(id, exp, secret), 'hex')
  const given = Buffer.from(rawSig.toLowerCase(), 'hex')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return refuse('tampered')
  const nowSec = Math.floor((opts.now ?? new Date()).getTime() / 1000)
  if (exp <= nowSec) return refuse('expired')
  // A correctly signed link never asks for more than its 24 hours.
  if (exp - nowSec > APPROVE_LINK_TTL_SECONDS + 300) return refuse('tampered')
  return { ok: true, id, exp }
}

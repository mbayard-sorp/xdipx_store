/**
 * Owner blocker list: the pure half.
 *
 * Types, the probe vocabulary and its human phrasing, and the email renderer.
 * No database, no IO, so /admin/blockers can render a probe description in a
 * component without dragging the Neon client into the client bundle. The DB
 * probe implementations and every write live in owner-blockers.server.ts.
 *
 * Same split as outreach-core / outreach.server.
 */

export const BLOCKER_CATEGORIES = [
  'migration', 'valve', 'console', 'credential', 'approval', 'merge', 'execute', 'other',
] as const
export type BlockerCategory = (typeof BLOCKER_CATEGORIES)[number]

export const BLOCKER_SOURCES = [
  'blocker-scout', 'session', 'agent', 'ops-doc', 'sweep', 'owner',
] as const
export type BlockerSource = (typeof BLOCKER_SOURCES)[number]

export interface OwnerBlocker {
  id: number
  dedupeKey: string
  title: string
  detail: string | null
  unblocks: string | null
  whereToGo: string | null
  category: string
  priority: number
  status: string
  source: string
  sourceRef: string | null
  evidence: string | null
  verifyProbe: string | null
  verifyArg: string | null
  lastVerifiedAt: string | null
  lastVerifyOk: boolean | null
  firstSeenAt: string
  lastSeenAt: string
  ageDays: number
}

export interface BlockerInput {
  dedupeKey: string
  title: string
  detail?: string | null
  unblocks?: string | null
  whereToGo?: string | null
  category?: string | null
  priority?: number | null
  source?: string | null
  sourceRef?: string | null
  evidence?: string | null
  verifyProbe?: string | null
  verifyArg?: string | null
}

/**
 * A probe answers one question: "is this blocker still true?"
 *
 *   true  -> the condition the owner was asked for is now satisfied. Auto-clear.
 *   false -> still blocked. Leave it open and age it.
 *   null  -> cannot tell right now (probe errored, arg malformed, DB hiccup).
 *            Never clears a row on null: silently closing a real blocker is
 *            strictly worse than leaving a stale one open.
 *
 * Vocabulary-wide invariant (#4702): `false` is reserved for an AUTHORITATIVE
 * "still blocked" — the probe asked the right source with the right credential
 * and got a real negative. A "could not ask" (the source raised, a credential
 * is missing, a scoped-to-caller read came back success-shaped-empty) MUST be
 * `null`, never `false`. Collapsing those two is exactly what turned a healthy
 * integration into a P1 owner blocker on 2026-08-21 ("CONFIRMED: zero Shopify
 * webhooks registered" when all six existed, asked through the wrong app). The
 * runner boundary in owner-blockers.server.ts enforces the throw->null half of
 * this so no probe can leak a could-not-ask as a false; each runner owns the
 * success-shaped-empty half for its own source.
 */
export type ProbeVerdict = boolean | null

const IDENT = /^[a-z_][a-z0-9_]*$/

/** Guard against interpolating anything that is not a plain SQL identifier. */
export function isIdent(s: string): boolean {
  return IDENT.test(s) && s.length <= 63
}

/**
 * The probe vocabulary and how each one reads in a sentence. The runners live
 * server-side; this is the part the owner sees ("clears itself when ...").
 */
export const PROBE_DESCRIPTIONS: Record<string, (arg: string) => string> = {
  table_exists:  a => `table ${a} exists`,
  column_exists: a => `column ${a} exists`,
  setting_true:  a => `pipeline_settings.${a} is true`,
  setting_false: a => `pipeline_settings.${a} is false`,
  rows_exist:    a => `${a} has at least one row`,
  routine_ran:   a => {
    const [team, runType, days] = a.split('|')
    return `${team}/${runType} ran in the last ${days ?? 7} days`
  },
  /* Arg is a Shopify webhook topic (e.g. ORDERS_CREATE), or `all` for the full
   * expected set. See the runner for why this probe exists at all. */
  webhook_registered: a =>
    a === 'all'
      ? 'every expected Shopify webhook topic is registered'
      : `Shopify webhook ${a} is registered`,
}

export function isProbe(name: unknown): name is string {
  return typeof name === 'string' && Object.hasOwn(PROBE_DESCRIPTIONS, name)
}

/**
 * Does this title assert a measured fact ("CONFIRMED: ...")? Such a blocker
 * claims something was checked and found true, so it MUST name the credential,
 * app, token, or network path the check ran with — otherwise a credential-
 * scoped absence (a success-shaped-empty read through the wrong app/token) gets
 * filed as a fact about the world. That is the exact P1 this guard exists to
 * stop (#4702): on 2026-08-21 "CONFIRMED: zero Shopify webhooks registered" was
 * filed and independently repeated when all six existed, because the query ran
 * through a different app than the one that owns them. Word-boundary, case-
 * insensitive, so "confirmed", "CONFIRMED:", "(confirmed)" all match but
 * "unconfirmed" does not.
 */
export function titleClaimsConfirmed(title: string): boolean {
  return /\bconfirmed\b/i.test(title)
}

/** What clears this row, in words. Null probe means only a human can close it. */
export function describeProbe(probe: string | null, arg: string | null): string | null {
  if (!probe || !isProbe(probe)) return null
  try {
    return PROBE_DESCRIPTIONS[probe]!(arg ?? '')
  } catch {
    return null
  }
}

/* ── Email rendering (pure, so it is testable without SMTP) ────────────────── */

const BAD = '#d93a15'
const WARN = '#b57d0a'
const GOOD = '#1c7c43'
const MUTED = '#6f645c'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function ageColor(days: number): string {
  return days >= 14 ? BAD : days >= 5 ? WARN : MUTED
}

export function agePhrase(days: number): string {
  if (days <= 0) return 'today'
  if (days === 1) return '1 day'
  return `${days} days`
}

/**
 * The whole email body. Deliberately not the digest: no gates, no valves, no
 * SEO table, no run log. One numbered list of things only the owner can do,
 * each with where to go and what it unblocks, and nothing else competing for
 * attention. If this ever grows a second table it has failed at its job.
 *
 * Titles and detail can originate in a mined transcript, which is third-party
 * text, so everything interpolated here is escaped.
 */
export function renderBlockerEmail(
  open: readonly OwnerBlocker[],
  cleared: readonly OwnerBlocker[],
  baseUrl: string,
): string {
  const items = open.map(b => {
    const bits: string[] = []
    if (b.detail) bits.push(`<div style="margin:2px 0 0;color:#2b2b2b;">${esc(b.detail)}</div>`)
    if (b.whereToGo) bits.push(`<div style="margin:2px 0 0;"><strong>Where:</strong> ${esc(b.whereToGo)}</div>`)
    if (b.unblocks) bits.push(`<div style="margin:2px 0 0;color:${GOOD};"><strong>Unblocks:</strong> ${esc(b.unblocks)}</div>`)
    const probe = describeProbe(b.verifyProbe, b.verifyArg)
    bits.push(
      `<div style="margin:3px 0 0;color:${MUTED};font-size:11px;">` +
      `open ${agePhrase(b.ageDays)} &middot; ${esc(b.category)} &middot; #${b.id}` +
      (probe ? ` &middot; clears itself when ${esc(probe)}` : ' &middot; <em>no auto-check, tell me when it is done</em>') +
      `</div>`,
    )
    return `<li style="margin:0 0 12px;">
      <span style="font-weight:600;color:${ageColor(b.ageDays)};">${esc(b.title)}</span>
      ${bits.join('')}
    </li>`
  }).join('')

  const clearedLine = cleared.length
    ? `<p style="margin:14px 0 0;color:${GOOD};font-size:12px;">Cleared in the last 7 days: ${
        cleared.map(c => esc(c.title)).join(', ')
      }</p>`
    : ''

  const body = open.length === 0
    ? `<p style="margin:0;color:${GOOD};font-size:14px;">Nothing is waiting on you today.</p>${clearedLine}`
    : `<ol style="margin:0;padding-left:20px;font-family:Inter,sans-serif;font-size:13px;">${items}</ol>${clearedLine}`

  return `<body style="margin:0;padding:16px;background:#faf7f2;">
    <div style="max-width:640px;font-family:Inter,sans-serif;">
      <h2 style="font-size:16px;margin:0 0 2px;">Your list${open.length ? ` &middot; ${open.length} item${open.length === 1 ? '' : 's'}` : ''}</h2>
      <p style="margin:0 0 14px;color:${MUTED};font-size:12px;">Only things an agent cannot do for you.</p>
      ${body}
      <p style="font-size:11px;color:${MUTED};margin-top:20px;">
        Manage at <a href="${esc(baseUrl)}/admin/blockers" style="color:#FF5A36;">${esc(baseUrl)}/admin/blockers</a>.
        Rows close themselves when their check passes. Sent by /cron/blocker-list.
      </p>
    </div>
  </body>`
}

export function blockerEmailSubject(open: readonly OwnerBlocker[]): string {
  if (open.length === 0) return 'xdipx: nothing waiting on you'
  const oldest = open.reduce((a, b) => (b.ageDays > a.ageDays ? b : a), open[0]!)
  const stale = oldest.ageDays >= 5 ? `, oldest ${agePhrase(oldest.ageDays)}` : ''
  const subject = open.length === 1 ? '1 thing needs you' : `${open.length} things need you`
  return `xdipx: ${subject}${stale}`
}

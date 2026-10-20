/**
 * The owner digest's Ads section (ticket #16432, plan §9.8 lines 6 and 7).
 *
 *   Machine did: paused img07 (L1: $24, 0 leads). Undo: <link>.
 *   Your taps: 2. Top: raise the budget on Proven from $10.00 to $12.00 a day, expected +$18.00 over 7d.
 *
 * "Machine did" lists ledger rows applied in the last 24 hours. Undo is a
 * link to the console's Applied tab, where each row's before and after sit
 * side by side; a signed inverse proposal is a later step. "Your taps" counts
 * proposed rows still inside their 48h and shows the top three, ranked by
 * after.expectedContribution7dCents when a row carries it (plan §9.4: at most
 * three one-tap cards a day), each with a signed one-tap approve link.
 *
 * gatherAdsDigest() reads the ledger and never throws; null means the
 * section could not be read this run. renderAdsDigestSection() is pure HTML.
 */
import type { AdActionRow } from './ledger.server'
import { buildApproveLink } from './approve-link.server'

export const MACHINE_WINDOW_MS = 24 * 3_600_000
export const TAP_TTL_MS = 48 * 3_600_000
export const MAX_TAP_CARDS = 3
export const MAX_MACHINE_LINES = 6
export const APPLIED_TAB_URL = 'https://xdipx.com/admin/ads/actions?tab=applied'
export const PENDING_TAB_URL = 'https://xdipx.com/admin/ads/actions'

export interface DigestEntity {
  platform: string
  externalId: string
  name: string | null
  level: string
}

export interface AdsDigestStore {
  appliedSince(since: Date): Promise<AdActionRow[]>
  /** Proposed rows, newest first. */
  pending(limit: number): Promise<AdActionRow[]>
  entities(externalIds: readonly string[]): Promise<DigestEntity[]>
}

export interface MachineLine {
  id: number
  text: string
  undoUrl: string
}

export interface TapCard {
  id: number
  text: string
  expectedCents: number | null
  approveUrl: string | null
}

export interface AdsDigestFacts {
  machine: MachineLine[]
  machineMore: number
  tapCount: number
  taps: TapCard[]
}

const LEVEL_WORD: Record<string, string> = { campaign: 'campaign', adset: 'ad set', ad: 'ad', creative: 'creative' }

function usd(cents: number): string {
  return `$${(Math.abs(cents) / 100).toFixed(2)}`
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function targetName(row: Pick<AdActionRow, 'platform' | 'targetLevel' | 'targetExternalId' | 'verb'>, names: ReadonlyMap<string, string>): string {
  if (row.verb === 'halt_all' && row.targetExternalId === 'all') return `the ${row.platform} account`
  const name = names.get(`${row.platform}|${row.targetExternalId}`)
  return name ?? `${LEVEL_WORD[row.targetLevel] ?? row.targetLevel} ${row.targetExternalId}`
}

/** "paused img07" or "pause img07": the verb, its target, and a budget's numbers. */
export function actionPhrase(row: AdActionRow, target: string, tense: 'past' | 'ask'): string {
  const past = tense === 'past'
  switch (row.verb) {
    case 'pause': return `${past ? 'paused' : 'pause'} ${target}`
    case 'resume': return `${past ? 'resumed' : 'resume'} ${target}`
    case 'halt_all': return `${past ? 'halted everything on' : 'halt everything on'} ${target}`
    case 'audience_sync': return past ? 'refreshed the M8 exclusion audiences' : 'refresh the M8 exclusion audiences'
    case 'update_creative': return `${past ? 'swapped the creative on' : 'swap the creative on'} ${target}`
    case 'set_budget': {
      const params = (row.params ?? {}) as Record<string, unknown>
      const before = (row.before ?? {}) as Record<string, unknown>
      const field = num(params['dailyBudgetCents']) != null ? 'dailyBudgetCents' : 'lifetimeBudgetCents'
      const to = num(params[field])
      const from = num(before[field])
      const unit = field === 'dailyBudgetCents' ? ' a day' : ' lifetime'
      if (to == null) return `${past ? 'changed the budget on' : 'change the budget on'} ${target}`
      // "set" and "cut" read the same in both tenses.
      const verb = from == null ? 'set' : to > from ? (past ? 'raised' : 'raise') : 'cut'
      return `${verb} the budget on ${target}${from != null ? ` from ${usd(from)}` : ''} to ${usd(to)}${unit}`
    }
    default: return `${row.verb} ${target}`
  }
}

/** "L1: $24, 0 leads" from proposed_by and the reason, or just the source. */
export function whyOf(row: Pick<AdActionRow, 'proposedBy' | 'reason'>): string {
  const who = row.proposedBy.startsWith('rule:') ? row.proposedBy.slice(5) : row.proposedBy
  const reason = (row.reason ?? '').replace(/^Dry run:[^.]*\.\s*/, '').trim()
  return reason ? `${who}: ${clip(reason, 140)}` : who
}

export function expectedOf(row: Pick<AdActionRow, 'after'>): number | null {
  return num((row.after ?? {})['expectedContribution7dCents'])
}

/** Highest expected 7-day contribution first; rows without one after, oldest first. */
export function rankTaps(rows: readonly AdActionRow[]): AdActionRow[] {
  return [...rows].sort((a, b) => {
    const ea = expectedOf(a)
    const eb = expectedOf(b)
    if (ea != null && eb != null && ea !== eb) return eb - ea
    if (ea != null && eb == null) return -1
    if (ea == null && eb != null) return 1
    return a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id
  })
}

export function buildAdsDigestFacts(
  input: { applied: readonly AdActionRow[]; pending: readonly AdActionRow[]; entities: readonly DigestEntity[] },
  opts: { now: Date; secret?: string | undefined; baseUrl?: string | undefined },
): AdsDigestFacts {
  const names = new Map(input.entities.filter(e => e.name?.trim()).map(e => [`${e.platform}|${e.externalId}`, e.name!.trim()]))
  const sinceMs = opts.now.getTime() - MACHINE_WINDOW_MS
  const applied = input.applied
    .filter(r => r.status === 'applied' && (r.appliedAt ?? r.createdAt).getTime() >= sinceMs)
    .sort((a, b) => (b.appliedAt ?? b.createdAt).getTime() - (a.appliedAt ?? a.createdAt).getTime())
  const machine = applied.slice(0, MAX_MACHINE_LINES).map(r => {
    const tapped = r.approvedBy && r.approvedBy !== 'auto' ? ', after your tap' : ''
    return {
      id: r.id,
      text: `${actionPhrase(r, targetName(r, names), 'past')} (${whyOf(r)}${tapped})`,
      undoUrl: APPLIED_TAB_URL,
    }
  })

  const live = input.pending.filter(r => r.status === 'proposed'
    && opts.now.getTime() - r.createdAt.getTime() < TAP_TTL_MS
    && !(r.expiresAt && r.expiresAt.getTime() <= opts.now.getTime()))
  const taps = rankTaps(live).slice(0, MAX_TAP_CARDS).map(r => {
    const expected = expectedOf(r)
    const tail = expected != null ? `, expected ${expected >= 0 ? '+' : '-'}${usd(expected)} over 7d` : ''
    return {
      id: r.id,
      text: `${actionPhrase(r, targetName(r, names), 'ask')}${tail}`,
      expectedCents: expected,
      approveUrl: r.tier === 'owner' ? null : buildApproveLink(r.id, { now: opts.now, secret: opts.secret, baseUrl: opts.baseUrl }),
    }
  })
  return { machine, machineMore: Math.max(0, applied.length - machine.length), tapCount: live.length, taps }
}

const LINK = 'color:#c2410c;'

/** Lines 6 and 7 of plan §9.8, as the digest's other sections render: a short list. */
export function renderAdsDigestSection(f: AdsDigestFacts): string {
  const lines: string[] = []
  if (f.machine.length === 0) {
    lines.push('Machine did: nothing in the last 24 hours.')
  } else {
    for (const m of f.machine) {
      lines.push(`Machine did: ${esc(m.text)}. Undo: <a href="${esc(m.undoUrl)}" style="${LINK}">applied actions</a>.`)
    }
    if (f.machineMore > 0) lines.push(`And ${f.machineMore} more on the <a href="${APPLIED_TAB_URL}" style="${LINK}">Applied tab</a>.`)
  }
  if (f.tapCount === 0) {
    lines.push('Your taps: 0. Nothing is waiting for you.')
  } else {
    const top = f.taps[0]
    lines.push(`Your taps: ${f.tapCount}.${top ? ` Top: ${esc(top.text)}.` : ''} All of them are on the <a href="${PENDING_TAB_URL}" style="${LINK}">Pending tab</a>.`)
    for (const t of f.taps) {
      const approve = t.approveUrl
        ? `<a href="${esc(t.approveUrl)}" style="${LINK}">Approve #${t.id}</a> (link works for 24 hours, admin login required)`
        : 'owner only: make this change in Ads Manager'
      lines.push(`${esc(t.text)}. ${approve}.`)
    }
  }
  return `<ul style="margin:0;padding-left:18px;">${lines.map(l => `<li style="margin-bottom:3px;">${l}</li>`).join('')}</ul>`
}

// ---------------------------------------------------------------------------

async function drizzleDigestStore(): Promise<AdsDigestStore> {
  const [{ db }, { adActions, adPlatformEntities }, { and, desc, eq, gte, inArray }] = await Promise.all([
    import('~/lib/db.server'), import('../../../db/schema'), import('drizzle-orm'),
  ])
  return {
    appliedSince: since => db.select().from(adActions)
      .where(and(eq(adActions.status, 'applied'), gte(adActions.appliedAt, since)))
      .orderBy(desc(adActions.appliedAt)).limit(50),
    pending: limit => db.select().from(adActions)
      .where(eq(adActions.status, 'proposed'))
      .orderBy(desc(adActions.createdAt)).limit(limit),
    async entities(ids) {
      if (ids.length === 0) return []
      return db.select({
        platform: adPlatformEntities.platform,
        externalId: adPlatformEntities.externalId,
        name: adPlatformEntities.name,
        level: adPlatformEntities.level,
      }).from(adPlatformEntities).where(inArray(adPlatformEntities.externalId, [...ids]))
    },
  }
}

export async function gatherAdsDigest(
  opts: { store?: AdsDigestStore; now?: Date; secret?: string | undefined; baseUrl?: string | undefined } = {},
): Promise<AdsDigestFacts | null> {
  try {
    const now = opts.now ?? new Date()
    const store = opts.store ?? await drizzleDigestStore()
    const [applied, pending] = await Promise.all([
      store.appliedSince(new Date(now.getTime() - MACHINE_WINDOW_MS)),
      store.pending(200),
    ])
    const ids = [...new Set([...applied, ...pending].map(r => r.targetExternalId).filter(id => id !== 'all'))]
    const entities = await store.entities(ids)
    return buildAdsDigestFacts({ applied, pending, entities }, { now, secret: opts.secret, baseUrl: opts.baseUrl })
  } catch (err) {
    console.warn('[owner-digest] ads section unavailable:', String(err).slice(0, 200))
    return null
  }
}

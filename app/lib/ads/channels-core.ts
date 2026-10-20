/**
 * Channel enablement checklist and the channels page rows (ticket #16438,
 * plan sections 6 and 7 phase 7a). Client-safe and pure: the page renders
 * these shapes and the server half (channels-page.server.ts) builds them.
 *
 * A channel's mutate capability reads as blocked until every item below is
 * checked. Prohibited channels (TikTok, X, Reddit, Pinterest) get no
 * checklist at all and stay blocked, because no adapter exists for them and
 * none is built until the policy row is re-verified and the owner codifies a
 * lane (plan section 6).
 */
import type { ChannelCapabilities, ChannelId, PolicyState } from './channels/types'

export interface ChecklistItemDef {
  key: string
  label: string
  /** What to write in the evidence field. */
  evidenceHint: string
}

/** The nine items from plan section 6, in the plan's order. */
export const CHECKLIST_ITEMS = [
  {
    key: 'policy_row',
    label: 'Policy row in docs/ads-policy.md verified with date and source URL, and an owner-codified lane',
    evidenceHint: 'Verification date and source URL',
  },
  {
    key: 'account_ids',
    label: 'Account id and a test or sandbox account',
    evidenceHint: 'Live account id, test account id',
  },
  {
    key: 'billing_descriptor',
    label: 'Billing descriptor XDIPX confirmed',
    evidenceHint: 'Where you saw XDIPX on the statement or invoice',
  },
  {
    key: 'token_health',
    label: 'Token strategy documented and the health probe green',
    evidenceHint: 'Doc path, and the date the probe read ok',
  },
  {
    key: 'insights_smoke',
    label: "Insights smoke: yesterday's spend reconciles with the platform UI",
    evidenceHint: 'Day, our figure, the platform figure',
  },
  {
    key: 'paused_create_smoke',
    label: 'Paused-create smoke: create PAUSED, read back through entity sync, delete',
    evidenceHint: 'Test campaign id and the date it was deleted',
  },
  {
    key: 'utm_template',
    label: 'UTM template confirmed to carry utm_content=<creative id>',
    evidenceHint: 'A landing URL as the platform served it',
  },
  {
    key: 'cron_expectations',
    label: 'cron-expectations.ts entry',
    evidenceHint: 'Cron path, or the PR that added it',
  },
  {
    key: 'spend_cap',
    label: 'Platform-side spend cap set',
    evidenceHint: 'Cap amount and the date it was set',
  },
] as const satisfies readonly ChecklistItemDef[]

export type ChecklistItemKey = (typeof CHECKLIST_ITEMS)[number]['key']

const ITEM_KEYS = new Set<string>(CHECKLIST_ITEMS.map(i => i.key))

export function isChecklistItem(key: string): key is ChecklistItemKey {
  return ITEM_KEYS.has(key)
}

/** What the channels page says for a prohibited channel, verbatim from plan section 6. */
export const PROHIBITED_REASON = 'policy: prohibited, no adapter'

/** Longest evidence string stored. Enough for a sentence and two URLs. */
export const EVIDENCE_MAX = 1000

/** One stored checklist row, as the page reads it. */
export interface ChecklistRow {
  channel: string
  item: string
  checkedAt: string | null
  checkedBy: string | null
  evidence: string | null
}

export interface ChecklistItemState {
  key: ChecklistItemKey
  label: string
  evidenceHint: string
  checked: boolean
  checkedAt: string | null
  checkedBy: string | null
  evidence: string | null
}

/**
 * The checklist for one channel, or null for a prohibited one. Rows for
 * other channels and item keys this list does not know are ignored.
 */
export function checklistFor(
  channel: ChannelId | string,
  policyState: PolicyState,
  rows: readonly ChecklistRow[],
): ChecklistItemState[] | null {
  if (policyState === 'prohibited') return null
  const mine = new Map<string, ChecklistRow>()
  for (const r of rows) if (r.channel === channel) mine.set(r.item, r)
  return CHECKLIST_ITEMS.map(def => {
    const r = mine.get(def.key)
    return {
      key: def.key,
      label: def.label,
      evidenceHint: def.evidenceHint,
      checked: r?.checkedAt != null,
      checkedAt: r?.checkedAt ?? null,
      checkedBy: r?.checkedBy ?? null,
      evidence: r?.evidence ?? null,
    }
  })
}

export interface MutateState {
  mutateBlocked: boolean
  /** Why mutate is blocked, in plain words. Empty when it is not. */
  reasons: string[]
  checkedCount: number
  totalCount: number
}

/**
 * mutateBlocked is true unless every checklist item is checked. A
 * prohibited channel is always blocked with PROHIBITED_REASON. A channel
 * with no adapter, or an adapter that exposes no mutate verbs, is also
 * reported as blocked, since there is nothing that could change it yet.
 */
export function mutateStateFor(input: {
  policyState: PolicyState
  hasAdapter: boolean
  capabilities: ChannelCapabilities | null
  checklist: ChecklistItemState[] | null
}): MutateState {
  const total = CHECKLIST_ITEMS.length
  if (input.policyState === 'prohibited' || input.checklist === null) {
    return { mutateBlocked: true, reasons: [PROHIBITED_REASON], checkedCount: 0, totalCount: total }
  }
  const checkedCount = input.checklist.filter(i => i.checked).length
  const reasons: string[] = []
  if (checkedCount < total) reasons.push(`${total - checkedCount} of ${total} checklist items open`)
  if (!input.hasAdapter) reasons.push('no adapter yet')
  else if (!input.capabilities || input.capabilities.mutate.length === 0) reasons.push('the adapter has no mutate verbs')
  return { mutateBlocked: reasons.length > 0, reasons, checkedCount, totalCount: total }
}

/** The token health columns the page shows. */
export interface ChannelTokenLite {
  state: 'ok' | 'expiring' | 'invalid' | 'unknown'
  checkedAt: string
  expiresAt: string | null
  error: string | null
}

export interface ChannelPageRow {
  id: ChannelId
  label: string
  policyState: PolicyState
  policyNote: string
  hasAdapter: boolean
  capabilities: ChannelCapabilities | null
  /** Null when no reading exists for the channel. */
  token: ChannelTokenLite | null
  /** ISO timestamps from the mirror and insights tables, null when never. */
  lastEntitySyncAt: string | null
  lastInsightsPullAt: string | null
  checklist: ChecklistItemState[] | null
  mutate: MutateState
}

export interface ChannelsPage {
  channels: ChannelPageRow[]
  /** Names of the reads that failed. Their columns read "unknown". */
  failed: string[]
}

/** "read, insights, mutate: pause, resume, audiences: read, preview", or "none". */
export function capabilitiesWords(c: ChannelCapabilities | null): string {
  if (!c) return 'none'
  const parts: string[] = []
  if (c.read) parts.push('read')
  if (c.insights) parts.push('insights')
  if (c.mutate.length > 0) parts.push(`mutate: ${c.mutate.join(', ')}`)
  if (c.audiences !== 'none') parts.push(`audiences: ${c.audiences}`)
  if (c.preview) parts.push('preview')
  return parts.length > 0 ? parts.join(', ') : 'none'
}

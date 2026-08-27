/**
 * web-fresh-start-reset.test.ts
 *
 * Ticket #5657 — P1 web-chat stale-state + fabricated-referent bug (daily
 * support review, web turns 1606-1621, 2026-08-25). The web analogue of the
 * voice-session-not-reset family (PR #657 / #3221).
 *
 * On turn 1606 a returning cookie started a fresh shopping intent
 * (STOP_HELP_START) while a prior visit's currentPitchHandle (prowler-prostate)
 * was still set. The 24h rotation clears that state (#5656), but this fresh
 * start was WITHIN the window, so nothing cleared it: turn 1611 then fired an
 * UPSELL off the stale handle and told a man shopping for his wife that an
 * anal glide "fits right with what you picked" when nothing had been picked.
 *
 * The fix clears the session-scoped shopping handles on a web fresh start
 * (STOP_HELP_START, or a session sitting at RECONNECT) before dispatch. Once
 * the handle is genuinely session-scoped, guardStagePreconditions and the
 * upsell handler's own guard do the rest.
 *
 * Three layers pinned here, all pure / hermetic:
 *   (a) isWebFreshStart — which turns trip the reset, and which must NOT.
 *   (b) with the handle cleared, a pairing ask can no longer reach UPSELL.
 *   (c) with no session selection, the upsell handler emits no pitch and no
 *       "fits right with what you picked" referent — only the neutral fallback.
 */
import { describe, it, expect, vi } from 'vitest'

// upsell.server pulls in shopify.server transitively; the no-handle path under
// test returns before any Shopify call, but mock it so the import is hermetic.
vi.mock('~/lib/shopify.server', () => ({
  getProductByHandle: vi.fn(async () => null),
  getCuratedUpsellCandidates: vi.fn(async () => ({ pitchedTags: [], candidates: [] })),
}))

import { isWebFreshStart } from '../adapters/web.server'
import { pickEffectiveStage, guardStagePreconditions } from '../stage-dispatch.server'
import { executeUpsellStage } from '../stages/upsell.server'
import type { EmmaContext, Intent, IntentResult, Stage } from '../types.server'

function intent(i: Intent, confidence = 0.95): IntentResult {
  return { intent: i, confidence, source: 'haiku' }
}

// ─── (a) isWebFreshStart — the reset trigger ───────────────────────────────────

describe('isWebFreshStart (#5657)', () => {
  it('trips on an explicit STOP_HELP_START, from any stage', () => {
    for (const s of ['DISCOVERY', 'PRESENTATION', 'UPSELL', 'RECONNECT'] as Stage[]) {
      expect(isWebFreshStart('STOP_HELP_START', s)).toBe(true)
    }
  })

  it('trips when the session is sitting at RECONNECT, for any intent', () => {
    for (const i of ['NAME_ITEM', 'RESEARCH', 'OFF_TOPIC', 'ASK_UPSELL'] as Intent[]) {
      expect(isWebFreshStart(i, 'RECONNECT')).toBe(true)
    }
  })

  it('does NOT trip on a plain discovery turn', () => {
    expect(isWebFreshStart('NAME_ITEM', 'DISCOVERY')).toBe(false)
    expect(isWebFreshStart('RESEARCH', 'DISCOVERY')).toBe(false)
  })

  it('does NOT trip on the forward purchase flow (must keep the slate it is building)', () => {
    // The exact case a too-eager reset would break: committing to a product and
    // accepting an upsell must not wipe currentPitchHandle mid-checkout.
    expect(isWebFreshStart('COMMIT_PICK', 'PRESENTATION')).toBe(false)
    expect(isWebFreshStart('UPSELL_ACCEPT', 'UPSELL')).toBe(false)
    expect(isWebFreshStart('UPSELL_DECLINE', 'UPSELL')).toBe(false)
  })
})

// ─── (b) With the handle cleared, a pairing ask cannot reach UPSELL ─────────────

describe('post-reset stage resolution (#5657 DONE WHEN b)', () => {
  function resolveEffectiveStage(
    stage: Stage,
    it: IntentResult,
    conv: { currentPitchHandle?: string | null; lastQuoteUrl?: string | null },
  ): Stage {
    return guardStagePreconditions(pickEffectiveStage(stage, it, conv.currentPitchHandle), conv, stage)
  }

  it('an ASK_UPSELL after the reset falls to DISCOVERY, not UPSELL', () => {
    // The reset has set currentPitchHandle=null. Even an explicit pairing ask
    // has nothing to pair against, so no upsell fires off a prior-session handle.
    const conv = { currentPitchHandle: null, lastQuoteUrl: null }
    expect(resolveEffectiveStage('RECONNECT', intent('ASK_UPSELL'), conv)).toBe('DISCOVERY')
    expect(resolveEffectiveStage('DISCOVERY', intent('ASK_UPSELL'), conv)).toBe('DISCOVERY')
  })

  it('contrast: the SAME ask WOULD have reached UPSELL with the stale handle intact', () => {
    // Documents what the reset prevents: this is the pre-fix behaviour.
    const stale = { currentPitchHandle: 'prowler-prostate', lastQuoteUrl: null }
    expect(resolveEffectiveStage('DISCOVERY', intent('ASK_UPSELL'), stale)).toBe('UPSELL')
  })
})

// ─── (c) No session selection → no pitch, no fabricated "what you picked" ───────

describe('upsell handler with no session selection (#5657 DONE WHEN c)', () => {
  function noHandleCtx(): EmmaContext {
    return {
      channel: 'web',
      conversation: {
        conversationId: 'conv-1',
        stage: 'UPSELL',
        currentPitchHandle: null,
        currentUpsellHandle: null,
        lastQuoteUrl: null,
        pitchedHandlesLog: null,
      },
    } as unknown as EmmaContext
  }

  it('emits no upsell pitch and no "what you picked" referent when nothing is selected', async () => {
    const res = await executeUpsellStage(noHandleCtx(), intent('COMMIT_PICK'), '')
    // No product card — nothing was pitched.
    expect(res.segments[0]?.productCard).toBeUndefined()
    // Neutral fallback only; never the possessive-referent closer.
    const prose = res.segments.map((s) => s.prose).join(' ').toLowerCase()
    expect(prose).not.toContain('what you picked')
    expect(prose).not.toContain('fits right')
    expect(prose).not.toContain('picked')
  })
})

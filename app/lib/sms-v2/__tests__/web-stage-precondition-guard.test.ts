/**
 * web-stage-precondition-guard.test.ts
 *
 * Ticket #5656 — P1 web-chat state-machine bug (support review, web turns
 * 1606-1621, 2026-08-25).
 *
 * The web machine advanced past discovery without the preconditions:
 *   - Turn 1610: "I want to give her an amazing orgasm" (a discovery/desire
 *     statement) was classified ASK_UPSELL and the machine jumped straight to
 *     UPSELL, firing an upsell before ANY product had been selected this
 *     session — off a stale currentPitchHandle (prowler-prostate) that survived
 *     the RECONNECT because the web 24h rotation never cleared it.
 *   - Turns 1612-1617 then ran in POST_CHECKOUT although no checkout occurred.
 *   - Turn 1614: "the two of us" (a direct answer to Emma's solo-or-together
 *     question) was classified OFF_TOPIC.
 *
 * Three defenses, all covered here (the rotation clear itself lives in
 * getOrCreateWebConversation and is exercised end-to-end; here we pin the two
 * pure, hermetic layers that back it up):
 *   (a) guardStagePreconditions — UPSELL requires a selected product,
 *       POST_CHECKOUT requires a completed checkout, else fall to DISCOVERY.
 *   (b) the intent classifier no longer routes plain discovery answers to
 *       ASK_UPSELL / OFF_TOPIC.
 *   (c) the turn-1606..1621 sequence replayed through the machine stays in
 *       DISCOVERY until a product is actually chosen.
 */
import { describe, it, expect } from 'vitest'
import { pickEffectiveStage, guardStagePreconditions } from '../stage-dispatch.server'
import { classifyIntent } from '../intent-classifier.server'
import type { Intent, IntentResult, Stage } from '../types.server'

function intent(i: Intent, confidence = 0.95): IntentResult {
  return { intent: i, confidence, source: 'haiku' }
}

// The full effective-stage resolution as the adapters run it: intent-driven
// override, then the precondition guard.
function resolveEffectiveStage(
  stage: Stage,
  it: IntentResult,
  conv: { currentPitchHandle?: string | null; lastQuoteUrl?: string | null },
): Stage {
  return guardStagePreconditions(
    pickEffectiveStage(stage, it, conv.currentPitchHandle),
    conv,
    stage,
  )
}

// ─── (a) Precondition guards ───────────────────────────────────────────────────

describe('guardStagePreconditions (#5656)', () => {
  it('blocks UPSELL when no product is selected this session', () => {
    expect(guardStagePreconditions('UPSELL', { currentPitchHandle: null })).toBe('DISCOVERY')
    expect(guardStagePreconditions('UPSELL', { currentPitchHandle: '' })).toBe('DISCOVERY')
    expect(guardStagePreconditions('UPSELL', {})).toBe('DISCOVERY')
  })

  it('allows UPSELL when a product IS selected this session', () => {
    expect(guardStagePreconditions('UPSELL', { currentPitchHandle: 'aurora-wand' })).toBe('UPSELL')
  })

  it('blocks POST_CHECKOUT when no checkout completed this session', () => {
    expect(guardStagePreconditions('POST_CHECKOUT', { lastQuoteUrl: null })).toBe('DISCOVERY')
    expect(guardStagePreconditions('POST_CHECKOUT', {})).toBe('DISCOVERY')
  })

  it('allows POST_CHECKOUT when a checkout WAS completed this session', () => {
    expect(
      guardStagePreconditions('POST_CHECKOUT', { lastQuoteUrl: 'https://xdipx.com/cart/c/abc' }),
    ).toBe('POST_CHECKOUT')
  })

  it('passes every other stage through untouched', () => {
    for (const s of ['DISCOVERY', 'PRESENTATION', 'OBJECTION', 'CHECKOUT', 'RESEARCH', 'SUPPORT'] as Stage[]) {
      expect(guardStagePreconditions(s, { currentPitchHandle: null, lastQuoteUrl: null })).toBe(s)
    }
  })

  it('is the belt to the rotation suspenders: a stale ASK_UPSELL can no longer reach UPSELL once the handle is cleared', () => {
    // After the web rotation fix, a reconnected session has currentPitchHandle=null.
    // pickEffectiveStage already routes ASK_UPSELL → DISCOVERY with no handle;
    // the guard is a second line for any other stage the machine lands in.
    const conv = { currentPitchHandle: null, lastQuoteUrl: null }
    expect(resolveEffectiveStage('DISCOVERY', intent('ASK_UPSELL'), conv)).toBe('DISCOVERY')
  })
})

// ─── (b) Classifier no longer mislabels discovery answers ──────────────────────

describe('classifyIntent — discovery desire / audience answers (#5656)', () => {
  const desireLines = [
    'I want to give her an amazing orgasm', // the literal turn-1610 message
    'I want to make him finish',
    "I'd like to surprise my wife",
    'I want to help them relax together',
  ]
  for (const text of desireLines) {
    it(`"${text}" is not ASK_UPSELL and not OFF_TOPIC (regex, hermetic)`, async () => {
      const res = await classifyIntent({ stage: 'DISCOVERY' }, text)
      expect(res.source).toBe('regex') // short-circuits before Haiku — no network
      expect(res.intent).not.toBe('ASK_UPSELL')
      expect(res.intent).not.toBe('OFF_TOPIC')
      expect(res.intent).toBe('NAME_ITEM')
    })
  }

  const audienceLines = [
    'the two of us', // the literal turn-1614 message
    'both of us',
    'us two',
    'me and my wife',
    'just me',
    'for us',
  ]
  for (const text of audienceLines) {
    it(`"${text}" is not OFF_TOPIC (regex, hermetic)`, async () => {
      const res = await classifyIntent({ stage: 'POST_CHECKOUT' }, text)
      expect(res.source).toBe('regex')
      expect(res.intent).not.toBe('OFF_TOPIC')
      expect(res.intent).not.toBe('ASK_UPSELL')
      expect(res.intent).toBe('NAME_ITEM')
    })
  }

  it('still lets a genuine pairing ask reach ASK_UPSELL (regression guard)', async () => {
    const res = await classifyIntent({ stage: 'PRESENTATION' }, 'what pairs with this')
    expect(res.intent).toBe('ASK_UPSELL')
  })

  it('still lets a real buy signal win (regression guard)', async () => {
    const res = await classifyIntent({ stage: 'PRESENTATION' }, "I'll take it for her")
    expect(res.intent).toBe('COMMIT_PICK')
  })

  it('does not steal a support/research phrasing about a partner', async () => {
    // "I want to make sure ... for her" must not be captured as a desire line;
    // it should fall through to the RESEARCH heuristic.
    const res = await classifyIntent({ stage: 'DISCOVERY' }, 'I want to make sure this is body safe for her')
    expect(res.intent).not.toBe('NAME_ITEM')
    expect(res.intent).toBe('RESEARCH')
  })
})

// ─── (c) Replay of the turn-1606..1621 sequence ────────────────────────────────

describe('turn-1606..1621 replay — machine stays in DISCOVERY until a product is chosen (#5656)', () => {
  it('never advances to UPSELL / CHECKOUT / POST_CHECKOUT on plain discovery turns', async () => {
    // Reconnected web session, post-rotation: no product selected this session.
    const conv = { currentPitchHandle: null as string | null, lastQuoteUrl: null as string | null }
    let stage: Stage = 'DISCOVERY'

    const discoveryTurns = [
      'I want to give her an amazing orgasm', // 1610 — was ASK_UPSELL → UPSELL
      'the two of us', // 1614 — was OFF_TOPIC
      'both of us',
      'I want to make her feel incredible',
    ]

    for (const text of discoveryTurns) {
      const it = await classifyIntent({ stage }, text)
      stage = resolveEffectiveStage(stage, it, conv)
      expect(['UPSELL', 'CHECKOUT', 'POST_CHECKOUT']).not.toContain(stage)
      expect(stage).toBe('DISCOVERY')
    }
  })

  it('even with a stale handle leaking through, a discovery message keeps the machine in DISCOVERY', async () => {
    // Belt-and-suspenders: simulate the pre-fix state where a stale handle
    // survived. The classifier fix alone keeps the desire statement in DISCOVERY
    // because it is NAME_ITEM, which does not override the stage.
    const conv = { currentPitchHandle: 'prowler-prostate', lastQuoteUrl: null }
    const it = await classifyIntent({ stage: 'DISCOVERY' }, 'I want to give her an amazing orgasm')
    expect(resolveEffectiveStage('DISCOVERY', it, conv)).toBe('DISCOVERY')
  })

  it('still advances the legitimate forward path once a product is presented and committed', () => {
    // Product presented this session → currentPitchHandle set → COMMIT_PICK
    // legitimately advances PRESENTATION → UPSELL (the guard allows it).
    const conv = { currentPitchHandle: 'aurora-wand', lastQuoteUrl: null }
    expect(resolveEffectiveStage('PRESENTATION', intent('COMMIT_PICK'), conv)).toBe('UPSELL')
  })
})

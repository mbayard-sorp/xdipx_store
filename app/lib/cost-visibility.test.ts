/**
 * The estate's cost surface reported metered API spend and nothing else.
 *
 * `api_token_log.est_cost_usd` is zero for every Max-subscription row, which is
 * correct for a budget gate (charging a team for money that never moved
 * throttles it on a phantom) and wrong for the one number a spend-to-revenue
 * ratio needs. Measured 2026-09-04: $98.32 metered over 30 days against roughly
 * $2,400 of list-priced consumption in the same window.
 *
 * The risk in fixing that is over-correction. 87% of those tokens were on
 * models absent from the rate table, so 95% of the list-priced total came from
 * DEFAULT_RATE at Opus prices, including `claude-sonnet-5` at about $329 more
 * than a Sonnet would cost. A ceiling quoted as a measurement is how an audit
 * ends up asserting a number it cannot defend, so these assert that the ceiling
 * knows it is one.
 */
import { describe, expect, it } from 'vitest'

import { estimateCostUsd, isKnownModelRate, MAX_SUBSCRIPTION_SOURCES } from '~/lib/model-pricing.server'
import { renderMoneyBlock } from '~/lib/owner-digest.server'
import type { MoneyBlock } from '~/lib/owner-queue.server'

const money = (over: Partial<MoneyBlock> = {}): MoneyBlock => ({
  ordersLast7: 0, revenueLast7Usd: 0, profitLast30Usd: 19.62, goalUsd: 2000,
  estateSpendLast30Usd: 98.32, subscriptionRatedCeilingUsd: 2397.14,
  subscriptionRatedUnknownPct: 95, fixedMonthlyUsd: null, verdict: 'v',
  ...over,
})

describe('pricing a subscription-rated row', () => {
  it('is zero at its own source and non-zero when priced as metered', () => {
    // The whole mechanism in one assertion: the same tokens, two questions.
    const tokens = { model: 'claude-sonnet-4-6', inputTokens: 1_000_000, outputTokens: 100_000, cacheCreationTokens: 0, cacheReadTokens: 0 }
    for (const source of MAX_SUBSCRIPTION_SOURCES) {
      expect(estimateCostUsd({ ...tokens, source }), source).toBe(0)
    }
    expect(estimateCostUsd({ ...tokens, source: 'sync' })).toBeGreaterThan(0)
  })

  it('knows which models it can actually price', () => {
    expect(isKnownModelRate('claude-sonnet-4-6')).toBe(true)
    // The models the fleet actually runs on are absent, which is the reason the
    // ceiling needs a confidence figure rather than a footnote.
    expect(isKnownModelRate('claude-sonnet-5')).toBe(false)
    expect(isKnownModelRate('claude-opus-5')).toBe(false)
  })

  it('prices an unknown model at the premium tier, never below', () => {
    const args = { source: 'sync', inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }
    const known = estimateCostUsd({ ...args, model: 'claude-sonnet-4-6' })
    const unknown = estimateCostUsd({ ...args, model: 'claude-not-a-real-model' })
    // Over-counting tightens a gate; under-counting silently loosens one.
    expect(unknown).toBeGreaterThan(known)
  })
})

describe('the money block says what it does not know', () => {
  it('marks the subscription figure as a ceiling, not a total', () => {
    expect(renderMoneyBlock(money())).toContain('&le;')
  })

  it('warns when most of the ceiling is the unknown-model default', () => {
    expect(renderMoneyBlock(money({ subscriptionRatedUnknownPct: 95 })))
      .toContain('95% priced at the unknown-model default')
  })

  it('stays quiet when the rate table actually covers the spend', () => {
    // The caveat has to disappear once it stops being true, or it becomes
    // furniture the reader learns to skip.
    expect(renderMoneyBlock(money({ subscriptionRatedUnknownPct: 4 })))
      .not.toContain('unknown-model default')
  })

  it('says the denominator is unknown rather than printing $0.00 for hosting', () => {
    // Zero rows in fixed_monthly_costs means nobody typed the numbers in. It
    // does not mean Vercel, Neon and Sanity are free.
    const html = renderMoneyBlock(money({ fixedMonthlyUsd: null }))
    expect(html).toContain('not recorded')
    expect(html).not.toContain('Fixed monthly SaaS</td><td>$0.00')
  })

  it('renders a recorded floor once one exists', () => {
    expect(renderMoneyBlock(money({ fixedMonthlyUsd: 214.5 }))).toContain('$214.50')
  })

  it('distinguishes an unreadable ceiling from a zero one', () => {
    expect(renderMoneyBlock(money({ subscriptionRatedCeilingUsd: null }))).toContain('could not read')
  })

  it('labels the metered figure as metered, so the two are not confused', () => {
    expect(renderMoneyBlock(money())).toContain('metered API only')
  })
})

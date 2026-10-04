import { describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/db.server', () => ({ db: {} }))

import {
  AdValidationError, normaliseFeedbackInput, validateIdea, AGENT_SETTABLE_STATUSES, setIdeaStatus,
} from '~/lib/ad-ideas.server'
import { nextRenderPassLabel } from '~/lib/ad-passes'
import { ADS_RULE_DEFAULTS } from '~/lib/ad-settings.server'
import * as ideaReasons from '~/lib/ad-idea-feedback-reasons'
import * as creativeReasons from '~/lib/ad-creative-feedback-reasons'

vi.mock('~/lib/feed-processor.server', () => ({ getPipelineSetting: vi.fn(async () => null) }))

const good = {
  concept_slug: 'spec-sheet',
  lane: 'google',
  register_tier: '4-5',
  title: 'Water-based or aloe, side by side',
  products: ['naturals-h2o-intimate-lubricant-8-5-oz'],
  headlines: ['Water-Based or Aloe? Compared'],
  body: ['Two lubes, one table.'],
  destination_url: 'https://xdipx.com/products/naturals-h2o-intimate-lubricant-8-5-oz?utm_source=google&utm_content=idea-1',
  policy_check: 'Pass. Education register, no pleasure claim, Search text only.',
}

describe('validateIdea', () => {
  it('accepts a complete idea', () => {
    const v = validateIdea(good)
    expect(v.lane).toBe('google')
    expect(v.products).toEqual([{ handle: 'naturals-h2o-intimate-lubricant-8-5-oz' }])
  })

  it('requires a non-empty policy_check', () => {
    expect(() => validateIdea({ ...good, policy_check: '   ' })).toThrow(AdValidationError)
    const { policy_check: _drop, ...rest } = good
    expect(() => validateIdea(rest)).toThrow(/policy_check/)
  })

  it('rejects a lane outside the allowed set', () => {
    expect(() => validateIdea({ ...good, lane: 'tiktok' })).toThrow(/lane/)
  })

  it('rejects an unknown register tier', () => {
    expect(() => validateIdea({ ...good, register_tier: '8' })).toThrow(/register_tier/)
    expect(validateIdea({ ...good, register_tier: '10', lane: 'adult' }).registerTier).toBe('10')
  })

  it('requires utm_content on the destination url', () => {
    expect(() => validateIdea({ ...good, destination_url: 'https://xdipx.com/products/x?utm_source=google' })).toThrow(/utm_content/)
    expect(() => validateIdea({ ...good, destination_url: 'not a url' })).toThrow(/absolute URL/)
  })

  it('names the index of the failing idea', () => {
    expect(() => validateIdea({ ...good, title: '' }, 3)).toThrow(/ideas\[3\]\.title/)
  })
})

describe('feedback input', () => {
  it('keeps vocabulary order and drops duplicates', () => {
    const v = normaliseFeedbackInput('idea', { id: 4, verdict: 'up', reasons: ['lane-fit', 'on-brand', 'on-brand'], ratedBy: 'o@x.com' })
    expect(v.reasons).toEqual(['on-brand', 'lane-fit'])
  })

  it('rejects a reason from the other verdict or the other kind', () => {
    expect(() => normaliseFeedbackInput('idea', { id: 4, verdict: 'up', reasons: ['weak-hook'], ratedBy: 'o' })).toThrow(/Unknown reason/)
    expect(() => normaliseFeedbackInput('idea', { id: 4, verdict: 'down', reasons: ['product-drift'], ratedBy: 'o' })).toThrow(/Unknown reason/)
    expect(normaliseFeedbackInput('creative', { id: 4, verdict: 'down', reasons: ['product-drift'], ratedBy: 'o' }).reasons).toEqual(['product-drift'])
  })

  it('both vocabularies carry more-like-this (up) and other (down)', () => {
    for (const v of [ideaReasons, creativeReasons]) {
      expect(v.isReasonFor('up', 'more-like-this')).toBe(true)
      expect(v.isReasonFor('down', 'other')).toBe(true)
    }
  })
})

describe('idea status', () => {
  it('lets agents set only rendered or archived', async () => {
    expect([...AGENT_SETTABLE_STATUSES]).toEqual(['rendered', 'archived'])
    await expect(setIdeaStatus(1, 'hearted', 'agent')).rejects.toThrow(/Agents may only/)
    await expect(setIdeaStatus(1, 'rejected', 'agent')).rejects.toThrow(/Agents may only/)
  })
})

describe('render pass label', () => {
  it('names the next pass in UTC', () => {
    expect(nextRenderPassLabel(new Date('2026-10-03T10:00:00Z'))).toBe('14:30 UTC')
    expect(nextRenderPassLabel(new Date('2026-10-03T15:00:00Z'))).toBe('20:30 UTC')
    expect(nextRenderPassLabel(new Date('2026-10-03T21:00:00Z'))).toBe('tomorrow 14:30 UTC')
  })
})

describe('rule defaults', () => {
  it('match the research E.2 table', () => {
    expect(ADS_RULE_DEFAULTS.ads_rule_r1_be_multiple).toBe(2)
    expect(ADS_RULE_DEFAULTS.ads_rule_r1_min_hours).toBe(48)
    expect(ADS_RULE_DEFAULTS.ads_rule_r2_min_ctr_pct).toBe(0.5)
    expect(ADS_RULE_DEFAULTS.ads_rule_r5_budget_up_pct).toBe(20)
    expect(ADS_RULE_DEFAULTS.ads_rule_r6_budget_down_pct).toBe(30)
    for (const k of Object.keys(ADS_RULE_DEFAULTS)) expect(k.length).toBeLessThanOrEqual(50)
  })
})

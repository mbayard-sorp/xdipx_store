import { describe, it, expect } from 'vitest'
import { findLivedExperienceClaims, findLivedExperienceClaimsInWrites } from './batch-enrichment.server'
import type { ProductWrites } from './emma-orchestrator.server'

describe('findLivedExperienceClaims — voice gate (ticket #19117)', () => {
  it('catches the exact phrases found live on creature-cocks-leviathan-silicone-dildo', () => {
    expect(findLivedExperienceClaims('<p>Pro tip from my testing: start slow.</p>')).toContain('my-testing')
  })

  it('catches "I tested" and "I tried"', () => {
    expect(findLivedExperienceClaims('I tested this over a weekend.')).toContain('i-tested')
    expect(findLivedExperienceClaims("I've tested a few like it.")).toContain('i-tested')
    expect(findLivedExperienceClaims('I tried it last night.')).toContain('i-tried')
    expect(findLivedExperienceClaims("I've tried similar toys.")).toContain('i-tried')
  })

  it('does not flag catalog-knowledge voice', () => {
    expect(findLivedExperienceClaims('Known for its whisper-quiet motor and flexible neck.')).toEqual([])
    expect(findLivedExperienceClaims('Reviewers describe the texture as plush but firm.')).toEqual([])
    expect(findLivedExperienceClaims("I'd pair this with a water-based lube.")).toEqual([])
  })
})

describe('findLivedExperienceClaimsInWrites — scans every ProductWrites string field', () => {
  const base: ProductWrites = {
    productTypeDial: 'vibrator',
    tagline: 'Known for its whisper-quiet motor.',
    seoMetaDescription: 'Designed for clitoral stimulation with a flexible neck.',
    descriptionHtml: '<p>Known for its soft silicone finish.</p>',
    moodTags: [],
    audienceTags: [],
    mattersTags: [],
  }

  it('passes clean catalog-knowledge writes', () => {
    expect(findLivedExperienceClaimsInWrites(base)).toEqual([])
  })

  it('flags a violation buried in descriptionHtml', () => {
    const writes: ProductWrites = { ...base, descriptionHtml: '<p>Pro tip from my testing: start on the lowest setting.</p>' }
    expect(findLivedExperienceClaimsInWrites(writes)).toContain('my-testing')
  })

  it('flags a violation buried in a nested field (pairingWhy)', () => {
    const writes: ProductWrites = { ...base, pairingWhy: { 'gid://shopify/Product/1': 'I tried this combo and it works great.' } }
    expect(findLivedExperienceClaimsInWrites(writes)).toContain('i-tried')
  })
})

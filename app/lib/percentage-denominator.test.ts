import { describe, expect, it } from 'vitest'
import { analyzeDraft, findDenominators, findPercentages, type DraftInput } from '~/lib/percentage-denominator'

// Ticket #23463 (second occurrence of the #14798 brief/announcement-figure
// denominator class): the draft for can-a-vibrator-help-with-menopause-symptoms
// (content run 2144, 2026-11-21) paired "researchers recruited 66 women" with
// "92.9 percent experienced at least one symptom less frequently", and the FAQ
// paired them outright. 92.9 percent of 66 is 61.314, and no whole number of 66
// people rounds to 92.9 percent (61/66 is 92.4%, 62/66 is 93.9%), so the figure
// provably was not computed over the 66 enrolled.

function draftWithBody(text: string): DraftInput {
  return {
    body: [{ _type: 'block', style: 'normal', children: [{ text }] }],
  }
}

describe('findDenominators', () => {
  it('matches an integer directly adjacent to a population noun', () => {
    expect(findDenominators('Researchers recruited 66 women for the study.')).toEqual([
      expect.objectContaining({ n: 66, raw: '66 women' }),
    ])
  })

  it('matches through a tolerated connector word', () => {
    expect(findDenominators('A total of 61 participants completed the survey.')).toEqual([
      expect.objectContaining({ n: 61, raw: '61 participants' }),
    ])
  })

  it('does not read the integer part of a decimal percentage as a denominator', () => {
    expect(findDenominators('92.9 percent of women reported relief.')).toEqual([])
  })

  it('does not read a chained percentage-of-a-percentage number as a denominator', () => {
    // "61" is followed by "percent", not a population noun, so it is never a candidate N.
    expect(findDenominators('92.9 percent of the 61 percent of respondents who track symptoms.')).toEqual([])
  })
})

describe('findPercentages', () => {
  it('matches both the "%" and "percent" spellings', () => {
    expect(findPercentages('92.9% of women, or 92.9 percent of respondents.').map((p) => p.value)).toEqual([
      92.9, 92.9,
    ])
  })
})

describe('analyzeDraft — the content run 2144 real case (#23463)', () => {
  it('flags 92.9 percent paired with 66 women as denominator-incoherent', () => {
    const draft = draftWithBody(
      'A study of 66 women reported that 92.9 percent experienced at least one symptom less frequently.',
    )
    const report = analyzeDraft(draft)
    expect(report.overLimit).toBe(true)
    expect(report.hits).toHaveLength(1)
    expect(report.hits[0]).toMatchObject({
      impliedCount: 61,
    })
    expect(report.hits[0]!.impliedPercentage).toBeCloseTo(92.42, 1)
  })

  it('does not flag 92.4 percent paired with 66 women (61 of 66 is 92.42%, within rounding)', () => {
    const draft = draftWithBody(
      'A study of 66 women reported that 92.4 percent experienced at least one symptom less frequently.',
    )
    expect(analyzeDraft(draft)).toMatchObject({ hits: [], overLimit: false })
  })

  it('does not flag a percentage with no nearby population count', () => {
    const draft = draftWithBody('Researchers found that 92.9 percent of people say they feel relief.')
    expect(analyzeDraft(draft)).toMatchObject({ hits: [], overLimit: false })
  })

  it('does not flag a percentage-of-a-percentage', () => {
    const draft = draftWithBody(
      'Among respondents, 92.9 percent of the 61 percent who already track symptoms reported relief.',
    )
    expect(analyzeDraft(draft)).toMatchObject({ hits: [], overLimit: false })
  })

  it('reads across adjacent blocks within the default window', () => {
    const draft: DraftInput = {
      body: [
        { _type: 'block', style: 'normal', children: [{ text: 'Researchers recruited 66 women for the trial.' }] },
        {
          _type: 'block',
          style: 'normal',
          children: [{ text: 'Overall, 92.9 percent experienced at least one symptom less frequently.' }],
        },
      ],
    }
    const report = analyzeDraft(draft)
    expect(report.hits).toHaveLength(1)
    expect(report.hits[0]).toMatchObject({ impliedCount: 61 })
  })

  it('seoTitle and seoDescription are in scope, same as the other checkers (#10266)', () => {
    const draft: DraftInput = {
      seoTitle: 'Menopause and Vibrators: What 66 Women Found',
      seoDescription: '92.9 percent of them felt real relief fast.',
    }
    expect(analyzeDraft(draft).hits).toHaveLength(1)
  })
})

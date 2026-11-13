import { describe, expect, it } from 'vitest'
import { analyzeDraft, analyzeParagraphs, findCrossPostIngressConflicts } from './self-consistency'

function block(style: string, text: string) {
  return { _type: 'block', style, children: [{ _type: 'span', text }] }
}

describe('ingress codes: undefined-token', () => {
  it('flags a code instructed on but never defined anywhere in the document', () => {
    const report = analyzeParagraphs([
      {
        section: 'Care',
        text: 'Keep the IP67 model dry near the sink, but a quick rinse under a running tap is fine.',
      },
    ])
    const hit = report.findings.find(f => f.kind === 'undefined-token')
    expect(hit).toBeDefined()
    expect(hit?.token).toBe('IP67')
  })

  it('does not flag a code the document defines', () => {
    const report = analyzeParagraphs([
      {
        section: 'Care',
        text: 'An IPX4 rating means the toy only resists light splashes, nothing more.',
      },
    ])
    expect(report.findings.some(f => f.kind === 'undefined-token')).toBe(false)
  })
})

describe('ingress codes: conflicting-instruction (run 1239, defect #4 shape)', () => {
  // Run 1239: the Starlet 3 paragraph credited IPX7 with covering a shower
  // while the post's own IPX7 paragraph said immersion does not imply a jet
  // rating. Both sentences name the token explicitly here, which is the
  // reusable-token shape this checker is scoped to.
  it('flags the general rule disagreeing with the product-specific claim', () => {
    const report = analyzeParagraphs([
      {
        section: 'Water ratings',
        text: 'An IPX7 rating covers immersion, but immersion does not imply a jet rating.',
      },
      {
        section: 'Starlet 3',
        text: "The Starlet 3's IPX7 rating means you can use it right in the shower.",
      },
    ])
    const hit = report.findings.find(f => f.kind === 'conflicting-instruction')
    expect(hit).toBeDefined()
    expect(hit?.token).toBe('IPX7')
    expect(hit?.sites).toHaveLength(2)
    // Defined in both sentences ("covers" / "means"), so this is not also
    // flagged as undefined.
    expect(report.findings.some(f => f.kind === 'undefined-token')).toBe(false)
  })
})

describe('ingress codes: conflicting-instruction (run 1239, defect #1 shape)', () => {
  // Run 1239: the wash instruction said soap and warm water into every
  // crevice while the same post had just told an IPX4 reader not to put the
  // toy under a running tap. Represented here with the token named in both
  // sentences (the real post's wash instruction did not name the rating
  // directly, which is exactly why this checker's reusable-token design can't
  // catch that exact phrasing — see the module header).
  it('flags a later wash instruction contradicting the earlier restriction', () => {
    const report = analyzeParagraphs([
      {
        section: 'Water ratings',
        text: 'An IPX4 rating means the toy only resists light splashes, so never put it under a running tap.',
      },
      {
        section: 'Cleaning',
        text: 'When you clean an IPX4 toy, wash it with soap and warm water right under a running tap, working it into every crevice.',
      },
    ])
    const hit = report.findings.find(f => f.kind === 'conflicting-instruction')
    expect(hit).toBeDefined()
    expect(hit?.token).toBe('IPX4')
  })
})

describe('neighbour-water-instruction (run 2004 shape, ticket #21738)', () => {
  // Run 2004: repairing how-do-you-use-a-prostate-massager's IPX7 block
  // (no promise about a tap) was blocked by the accuracy gate on the
  // UNCHANGED neighbouring block ("Wash it... warm water"), a contradiction
  // check-self-consistency.ts's conflicting-instruction predicate cannot see
  // because the wash block names no ingress code at all.
  it('flags a forbidding ingress block next to an unscoped, unconditional wash instruction', () => {
    const report = analyzeParagraphs([
      {
        section: 'Water ratings',
        text: 'An IPX7 mark comes with no promise about a shower, so never run it under the tap.',
      },
      {
        section: 'Cleaning',
        text: 'Wash it every time after use, warm water and a plain unscented soap.',
      },
    ])
    const hit = report.findings.find(f => f.kind === 'neighbour-water-instruction')
    expect(hit).toBeDefined()
    expect(hit?.token).toBe('IPX7')
    expect(hit?.sites).toHaveLength(2)
  })

  it('flags an allowing ingress block next to an unscoped, unconditional "never submerge" instruction', () => {
    const report = analyzeParagraphs([
      {
        section: 'Water ratings',
        text: "This toy's IPX7 rating means you can use it right in the shower.",
      },
      {
        section: 'Care',
        text: 'Never submerge it in the sink; a damp cloth after use is all it needs.',
      },
    ])
    const hit = report.findings.find(f => f.kind === 'neighbour-water-instruction')
    expect(hit).toBeDefined()
    expect(hit?.token).toBe('IPX7')
  })

  it('does not flag when the neighbour block is outside the scan window', () => {
    const filler = { section: 'Filler', text: 'This paragraph has nothing to do with water at all.' }
    const report = analyzeParagraphs([
      {
        section: 'Water ratings',
        text: 'An IPX7 mark comes with no promise about a shower, so never run it under the tap.',
      },
      filler,
      filler,
      filler,
      { section: 'Cleaning', text: 'Wash it every time after use, warm water and a plain unscented soap.' },
    ])
    expect(report.findings.some(f => f.kind === 'neighbour-water-instruction')).toBe(false)
  })

  it('does not flag a neighbour instruction that names its own rating', () => {
    const report = analyzeParagraphs([
      {
        section: 'Water ratings',
        text: 'An IPX7 mark comes with no promise about a shower, so never run it under the tap.',
      },
      {
        section: 'Cleaning',
        text: 'This IPX7 toy can be washed under warm running water after every session.',
      },
    ])
    expect(report.findings.some(f => f.kind === 'neighbour-water-instruction')).toBe(false)
  })

  it('does not flag a neighbour instruction that defers to the manufacturer', () => {
    const report = analyzeParagraphs([
      {
        section: 'Water ratings',
        text: 'An IPX7 mark comes with no promise about a shower, so never run it under the tap.',
      },
      {
        section: 'Cleaning',
        text: "Check the manufacturer's care guide before washing it in warm water.",
      },
    ])
    expect(report.findings.some(f => f.kind === 'neighbour-water-instruction')).toBe(false)
  })

  it('does not flag two neighbouring blocks that agree in polarity', () => {
    const report = analyzeParagraphs([
      {
        section: 'Water ratings',
        text: 'An IPX7 mark comes with no promise about a shower, so never run it under the tap.',
      },
      {
        section: 'Cleaning',
        text: 'Never wash it under running water; a damp cloth is enough.',
      },
    ])
    expect(report.findings.some(f => f.kind === 'neighbour-water-instruction')).toBe(false)
  })

  it('does not flag an ingress block with no instruction, only a definition', () => {
    const report = analyzeParagraphs([
      { section: 'Water ratings', text: 'An IPX7 rating is granted by independent lab testing.' },
      { section: 'Cleaning', text: 'Wash it every time after use, warm water and a plain unscented soap.' },
    ])
    expect(report.findings.some(f => f.kind === 'neighbour-water-instruction')).toBe(false)
  })
})

describe('numbered enumerations: count-mismatch across sites (run 327 / run 626 shape)', () => {
  // Run 327: a body/FAQ enumeration split. Run 626: a fever-severity tier
  // change to the body red-flag list left the FAQ's copy of the same
  // enumeration unchanged. Both are represented here as the same shape this
  // checker can decide mechanically: the SAME named enumeration promised with
  // two different counts at two different sites.
  it('flags the body and the FAQ promising different counts for the same enumeration', () => {
    const report = analyzeParagraphs([
      {
        section: 'What to watch for',
        text: 'There are four red flags that mean stop and call a clinician.',
      },
      {
        section: 'FAQ',
        text: 'The three red flags to watch for are fever, spreading redness, and swelling.',
      },
    ])
    const hit = report.findings.find(f => f.kind === 'count-mismatch' && f.token === 'red flag')
    expect(hit).toBeDefined()
    expect(hit?.sites).toHaveLength(2)
  })

  it('does not flag two sites that agree on the count', () => {
    const report = analyzeParagraphs([
      { section: 'Body', text: 'There are three red flags that mean stop and call a clinician.' },
      { section: 'FAQ', text: 'The three red flags to watch for are fever, redness, and swelling.' },
    ])
    expect(report.findings.some(f => f.kind === 'count-mismatch' && f.token === 'red flag')).toBe(false)
  })
})

describe('numbered enumerations: count-mismatch inline (own list disagrees with its own number)', () => {
  it('flags a promise whose own inline list does not match the stated count', () => {
    const report = analyzeParagraphs([
      {
        section: 'Pre-flight',
        text: 'Run four checks before you submit: the hero loads, the FAQ renders, and the CTA resolves.',
      },
    ])
    const hit = report.findings.find(f => f.kind === 'count-mismatch' && f.token === 'check')
    expect(hit).toBeDefined()
    expect(hit?.message).toContain('4')
    expect(hit?.message).toContain('3')
  })

  it('does not flag a promise whose inline list matches the stated count', () => {
    const report = analyzeParagraphs([
      {
        section: 'Pre-flight',
        text: 'Run three checks before you submit: the hero loads, the FAQ renders, and the CTA resolves.',
      },
    ])
    expect(report.findings.some(f => f.kind === 'count-mismatch')).toBe(false)
  })
})

describe('criterion-phrase divergence (run 1475 shape)', () => {
  // Run 1475: the controls criterion existed at six sites. The accuracy
  // gate's cycle-2 pass caught "A worn device retires all three at once"
  // contradicting the Ferri paragraph's own admission that the page cannot
  // settle where the controls live. Represented here as the two-site shape
  // this checker is scoped to: a prescriptive-cue rule about a named
  // subject, stated with almost no shared wording at a second site.
  it('flags a criterion restated with no shared wording at a second site', () => {
    const report = analyzeParagraphs([
      {
        section: 'Picking one',
        text: 'For controls, you want everything built into the handle so your hands can always reach it.',
      },
      {
        section: 'Ferri paragraph',
        text: 'A worn device retires all three controls at once, and the page cannot settle where the controls live.',
      },
    ])
    const hit = report.findings.find(f => f.kind === 'criterion-divergence' && f.token === 'controls')
    expect(hit).toBeDefined()
    expect(hit?.sites).toHaveLength(2)
    expect(hit?.sites.some(s => s.section === 'Ferri paragraph')).toBe(true)
  })

  it('does not flag two sites that restate the same criterion in similar words', () => {
    const report = analyzeParagraphs([
      {
        section: 'Body',
        text: 'For controls, you want everything built into the handle so your hands can always reach it.',
      },
      {
        section: 'FAQ',
        text: 'Look for controls built into the handle, within reach of your hands.',
      },
    ])
    expect(report.findings.some(f => f.kind === 'criterion-divergence')).toBe(false)
  })

  it('does not flag a single mention of a subject with no second site', () => {
    const report = analyzeParagraphs([
      { section: 'Body', text: 'You want controls built into the handle.' },
    ])
    expect(report.findings.some(f => f.kind === 'criterion-divergence')).toBe(false)
  })
})

describe('findCrossPostIngressConflicts (run 1666 shape, ticket #18045)', () => {
  // Run 1666: a draft IPX7 shower permission directly contradicted the
  // published /notebook/what-is-a-gyroscope-sex-toy, and every in-document
  // checker stayed green because the contradiction is entirely cross-post.
  it('flags a draft instruction that disagrees with an already-published post', () => {
    const draftParagraphs = [
      {
        section: 'Care',
        text: "This toy's IPX7 rating means you can use it right in the shower.",
      },
    ]
    const priors = [
      {
        slug: 'what-is-a-gyroscope-sex-toy',
        paragraphs: [
          {
            section: 'Water ratings',
            text: 'IPX7 covers immersion only, so never run it under a shower or a direct tap.',
          },
        ],
      },
    ]

    const conflicts = findCrossPostIngressConflicts(draftParagraphs, priors)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.token).toBe('IPX7')
    expect(conflicts[0]?.priorSlug).toBe('what-is-a-gyroscope-sex-toy')
    expect(conflicts[0]?.draftPolarity).toBe('allow')
    expect(conflicts[0]?.priorPolarity).toBe('forbid')
  })

  it('does not flag a draft instruction that agrees with the published post', () => {
    // Same sentence on both sides, so whatever polarity this scans as, it
    // scans the same way on both sides and never conflicts with itself.
    const sentence = 'IPX7 covers immersion only, so never run it under a shower or a direct tap.'
    const draftParagraphs = [{ section: 'Care', text: sentence }]
    const priors = [
      {
        slug: 'what-is-a-gyroscope-sex-toy',
        paragraphs: [{ section: 'Water ratings', text: sentence }],
      },
    ]

    expect(findCrossPostIngressConflicts(draftParagraphs, priors)).toHaveLength(0)
  })

  it('does not flag a different code mentioned in the published post', () => {
    const draftParagraphs = [
      { section: 'Care', text: "This toy's IPX7 rating means you can use it right in the shower." },
    ]
    const priors = [
      {
        slug: 'other-post',
        paragraphs: [
          { section: 'Water ratings', text: 'Never run an IPX4 toy under a shower or a direct tap.' },
        ],
      },
    ]

    expect(findCrossPostIngressConflicts(draftParagraphs, priors)).toHaveLength(0)
  })
})

describe('negation cues: "out of" and "without" (run 1911 shape, ticket #20643)', () => {
  // The live house wording from how-do-you-use-a-sex-toy-safely: the negation
  // on "shower" sits in "keep it out of the", which the old NEGATION_RE never
  // matched, so this entire forbidding sentence read as ALLOW on both shower
  // and submerge and tripped a false cross-post conflict against any post
  // that correctly forbids the same actions.
  const houseSentence =
    'IPX4 means the toy withstands splashing water from any direction, wipe it down, ' +
    'keep it out of the shower, and never submerge it.'

  it('reads "keep it out of the shower" as forbidding direct spray, not allowing it', () => {
    const report = analyzeParagraphs([{ section: 'Care', text: houseSentence }])
    expect(report.findings.some(f => f.kind === 'conflicting-instruction')).toBe(false)
  })

  it('does not flag a cross-post conflict against a post that also forbids the shower', () => {
    const draftParagraphs = [{ section: 'Care', text: houseSentence }]
    const priors = [
      {
        slug: 'what-does-a-wand-vibrator-do',
        paragraphs: [
          { section: 'Water ratings', text: 'An IPX4 toy should never go in the shower or under a direct spray.' },
        ],
      },
    ]
    expect(findCrossPostIngressConflicts(draftParagraphs, priors)).toHaveLength(0)
  })

  it('still flags a genuine "without" forbid against a post that allows the same action', () => {
    const draftParagraphs = [
      { section: 'Care', text: 'IPX4 means you can rinse the toy without ever letting it submerge.' },
    ]
    const priors = [
      {
        slug: 'other-post',
        paragraphs: [
          { section: 'Water ratings', text: 'An IPX4 toy can be fully submerged for a quick clean.' },
        ],
      },
    ]
    const conflicts = findCrossPostIngressConflicts(draftParagraphs, priors)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.draftPolarity).toBe('forbid')
    expect(conflicts[0]?.priorPolarity).toBe('allow')
  })
})

describe('analyzeDraft — portable text structure, including the FAQ block', () => {
  it('counts a cross-site mismatch when one site lands only in the FAQ block', () => {
    const report = analyzeDraft({
      title: 'A calm guide to water ratings',
      excerpt: 'A plain, useful intro that states its answer first.',
      body: [
        block('h2', 'Reading the rating'),
        block('normal', 'There are four red flags that mean stop and call a clinician.'),
        block('h2', 'FAQ'),
        block('h2', 'Which symptoms mean I should stop?'),
        block('normal', 'The three red flags to watch for are fever, spreading redness, and swelling.'),
      ],
    })
    const hit = report.findings.find(f => f.kind === 'count-mismatch' && f.token === 'red flag')
    expect(hit).toBeDefined()
    expect(hit?.sites.some(s => s.section === 'Which symptoms mean I should stop?')).toBe(true)
  })

  it('ignores non-block nodes (embeds, images)', () => {
    const report = analyzeDraft({
      body: [
        { _type: 'blogProductEmbed', productHandle: 'magic-wand' },
        block('normal', 'An ordinary sentence with no ingress code or enumeration promise.'),
      ],
    })
    expect(report.findings).toHaveLength(0)
    expect(report.overLimit).toBe(false)
  })
})

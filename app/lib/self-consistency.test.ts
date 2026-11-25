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

  // Live false positive, ticket #22587: a jet-rating gloss introduced as an
  // apposition ("a jet rating, IPX5 or IPX6") rather than DEFINER_RE's verb
  // cues (means/is rated for/...), reproduced live on air-pulse-vs-
  // clitoral-suction's FAQ block.
  it('does not flag a code defined by an inline apposition rather than a verb cue', () => {
    const report = analyzeParagraphs([
      {
        section: 'Frequently asked questions',
        text: 'A shower is jetted water, so the toy that can go in with you is the one whose maker prints a jet rating, IPX5 or IPX6.',
      },
    ])
    expect(report.findings.some(f => f.kind === 'undefined-token')).toBe(false)
  })

  it('still flags a code with no gloss at all, even near an unrelated "rating" mention', () => {
    const report = analyzeParagraphs([
      {
        section: 'Reviews',
        text: 'Reviewers give this toy a great rating, and the IPX5 model handles a shower fine.',
      },
    ])
    const hit = report.findings.find(f => f.kind === 'undefined-token')
    expect(hit).toBeDefined()
    expect(hit?.token).toBe('IPX5')
  })

  // Ticket #24303: the mandated IPX56_JET_CODE_HOUSE_WORDING opens "IPX5 and
  // IPX6 are the jet codes", which matches no DEFINER_RE verb cue and no
  // apposed gloss, so every post that correctly installs the frozen wording
  // verbatim reds as undefined-token with no hand-added definer sentence.
  it('does not flag the frozen IPX5/IPX6 jet-code wording as undefined', () => {
    const report = analyzeParagraphs([
      {
        section: 'Frequently asked questions',
        text:
          'IPX5 and IPX6 are the jet codes. Each names its own nozzle test at a set flow, which is a ' +
          'pressurised spray rather than the free-falling stream out of your tap, so a toy carrying ' +
          'either is built to take a rinse. Both tests run on a new toy sealed the way its maker ' +
          'intended, with water at room temperature. Keep the charging port out of the stream, and ' +
          'keep hot water off anything with a motor in it.',
      },
    ])
    expect(report.findings.some(f => f.kind === 'undefined-token')).toBe(false)
  })

  it('still flags a lookalike "are the jet codes" sentence that is not the exact frozen wording', () => {
    const report = analyzeParagraphs([
      {
        section: 'Care',
        text: 'IPX5 and IPX6 are the jet codes you want, and this toy handles a direct spray fine.',
      },
    ])
    const hit = report.findings.find(f => f.kind === 'undefined-token')
    expect(hit).toBeDefined()
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

  // Live-corpus regression (#21947 bounce, how-do-you-choose-a-cordless-
  // wand-vibrator): WATER_CONTACT_RE's single first-match `exec` picked
  // "rinse" (correctly allow) and never saw "submerge nothing" later in the
  // same sentence (correctly forbid).
  it('scans every water-contact word in the neighbour sentence, not just the first', () => {
    const report = analyzeParagraphs([
      {
        section: 'Water ratings',
        text: "This toy's IPX7 rating means you can use it right in the shower.",
      },
      {
        section: 'Care',
        text: 'Wipe or rinse the head, keep the body out of standing water, and submerge nothing.',
      },
    ])
    const hit = report.findings.find(f => f.kind === 'neighbour-water-instruction')
    expect(hit).toBeDefined()
  })

  // Live-corpus regression (#21947 bounce, how-do-you-use-a-clitoral-
  // suction-toy): an FAQ heading like "Can you use one in the shower or the
  // bath?" is a question, not an instruction, but WATER_CONTACT_RE matched
  // it anyway and read it as an unconditional ALLOW.
  it('does not treat a question heading as an unconditional water-contact instruction', () => {
    const report = analyzeParagraphs([
      {
        section: 'FAQ',
        text: 'The shower needs its own rating, because IPX7 does not cover jets.',
      },
      {
        section: 'FAQ',
        text: 'Can you use one in the shower or the bath?',
      },
    ])
    expect(report.findings.some(f => f.kind === 'neighbour-water-instruction')).toBe(false)
  })

  // Live-corpus regression (#21947 bounce, egg-vibrator-vs-bullet-vibrator /
  // how-do-you-use-a-sex-toy-safely / do-you-need-a-sex-toy-cleaner): a
  // sentence that names a marketing term ONLY to say the term has no fixed
  // meaning is a vocabulary disclaimer, not a water-contact instruction.
  it('does not treat a marketing-term disclaimer as an unconditional water-contact instruction', () => {
    const report = analyzeParagraphs([
      {
        section: 'Water ratings',
        text: 'An IPX7 mark comes with no promise about a shower, so never run it under the tap.',
      },
      {
        section: 'Labels',
        text: 'Splashproof and shower-ready are marketing words with no fixed meaning.',
      },
    ])
    expect(report.findings.some(f => f.kind === 'neighbour-water-instruction')).toBe(false)
  })

  // Ticket #24303: the mandated IPX56_JET_CODE_HOUSE_WORDING's second
  // sentence ("...a toy carrying either is built to take a rinse") names no
  // rating of its own, so INGRESS_TEST_RE's "scoped by its own rating" skip
  // never catches it. Whichever block the emma-empathy-reviewer's requested
  // split lands it in, it still reads as an unconditional, unscoped
  // water-contact instruction and collides with a neighbouring IPX7 block's
  // forbid, a conflict that does not exist: the two sentences are the SAME
  // frozen, reviewed wording and name two different rating axes on purpose.
  it('does not flag the frozen jet-code wording split across a block boundary from a neighbouring rating block', () => {
    const report = analyzeParagraphs([
      {
        section: 'Frequently asked questions',
        text: 'An IPX7 mark comes with no promise about a shower, so never run it under the tap.',
      },
      {
        section: 'Frequently asked questions',
        text: 'IPX5 and IPX6 are the jet codes.',
      },
      {
        section: 'Frequently asked questions',
        text:
          'Each names its own nozzle test at a set flow, which is a pressurised spray rather than the ' +
          'free-falling stream out of your tap, so a toy carrying either is built to take a rinse.',
      },
    ])
    expect(report.findings.some(f => f.kind === 'neighbour-water-instruction')).toBe(false)
  })

  it('still flags a non-frozen unconditional water instruction next to that same jet-code block', () => {
    const report = analyzeParagraphs([
      {
        section: 'Frequently asked questions',
        text: 'An IPX7 mark comes with no promise about a shower, so never run it under the tap.',
      },
      {
        section: 'Frequently asked questions',
        text: 'IPX5 and IPX6 are the jet codes.',
      },
      {
        section: 'Cleaning',
        text: 'Go ahead and run it right under the shower whenever you like.',
      },
    ])
    const hit = report.findings.find(f => f.kind === 'neighbour-water-instruction')
    expect(hit).toBeDefined()
  })
})

describe('multi-code independence (#21947 bounce: what-makes-a-vibrator-body-safe)', () => {
  // A sentence naming TWO codes and explicitly saying they don't imply each
  // other can't be safely attributed as a single allow/forbid to either
  // code with this module's per-sentence model: "IPX7 for a basin and IPX5
  // or IPX6 for a running tap, and the two do not imply each other" was read
  // as an unscoped ALLOW of "running tap" for IPX7 too, when the sentence's
  // whole point is that IPX7 does NOT get running tap.
  it('does not extract a bucket instruction from a sentence declaring two codes independent', () => {
    const report = analyzeParagraphs([
      {
        section: 'Water ratings',
        text: 'IPX7 for a basin and IPX5 or IPX6 for a running tap, and the two do not imply each other, so read the code the toy actually carries.',
      },
      {
        section: 'FAQ',
        text: "This toy's IPX7 rating comes with no promise about a shower, so never run it under the tap.",
      },
    ])
    expect(report.findings.some(f => f.kind === 'conflicting-instruction')).toBe(false)
  })

  it('still extracts instructions from a single-code sentence with the same wording nearby', () => {
    const report = analyzeParagraphs([
      { section: 'Water ratings', text: 'An IPX7 rating covers immersion, so it does not imply each other rating.' },
      { section: 'FAQ', text: "This toy's IPX7 rating means you can use it right in the shower." },
    ])
    // Only one code is named here, so MULTI_CODE_INDEPENDENT_RE's guard
    // never applies and the sentence still contributes its submersion
    // instruction normally — this just proves the guard is keyed on the
    // 2+ distinct codes condition, not the phrase alone.
    expect(report.findings.some(f => f.kind === 'conflicting-instruction')).toBe(false)
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

  // Live false positive, ticket #22587, bus row #21540's other reported
  // false positive on what-makes-a-great-g-spot-rabbit-vibrator: two
  // completely unrelated enumerations (what makes reach work vs what keeps
  // a rabbit vibrator safe to own) both happened to use the generic noun
  // "things", which the cross-site check conflated into a false conflict.
  it('does not flag two unrelated enumerations that both use the generic noun "thing"', () => {
    const report = analyzeParagraphs([
      {
        section: 'Intro',
        text: 'Three things decide whether one reaches the G-spot at all: an upward curve firm enough to hold pressure against the front wall, an outer arm that flexes far enough to sit on your clitoris without dragging the tip off target, and a low rumbling motor in place of a high buzz.',
      },
      {
        section: 'How do you keep a rabbit vibrator body-safe and clean?',
        text: 'Two things keep a rabbit safe to own, and I would not let either one slide.',
      },
    ])
    expect(report.findings.some(f => f.kind === 'count-mismatch' && f.token === 'thing')).toBe(false)
  })

  it('still flags a named enumeration (not the generic "thing") with mismatched counts', () => {
    const report = analyzeParagraphs([
      { section: 'Body', text: 'There are four steps to clean it properly.' },
      { section: 'FAQ', text: 'The three steps are rinse, dry, and store it in its pouch.' },
    ])
    expect(report.findings.some(f => f.kind === 'count-mismatch' && f.token === 'step')).toBe(true)
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

describe('trailing negation (#21947 bounce: what-makes-a-great-g-spot-rabbit-vibrator)', () => {
  // The named reproduction: "shower" sits BEFORE its negation ("is not")
  // instead of after it, which the old look-behind-only polarityBefore
  // window could never see.
  const trailingNegationSentence =
    'Of the three here, only the Nova 2 prints a code at all, and We-Vibe prints IPX7, ' +
    'so the bath is settled for it and the shower is not.'

  it('reads "the shower is not" as forbidding direct spray, not allowing it', () => {
    const report = analyzeParagraphs([
      { section: 'Comparison table', text: trailingNegationSentence },
      { section: 'Water ratings', text: "The toy's IPX7 rating means you can use it right in the shower." },
    ])
    const hit = report.findings.find(f => f.kind === 'conflicting-instruction')
    expect(hit).toBeDefined()
    expect(hit?.sites.map(s => s.sentence)).toContain(trailingNegationSentence)
  })

  it('does not flag a conflict against a sentence that also forbids the shower', () => {
    const report = analyzeParagraphs([
      { section: 'Comparison table', text: trailingNegationSentence },
      {
        section: 'Water ratings',
        text: "The toy's IPX7 rating comes with no promise about a shower, so never run it under the tap.",
      },
    ])
    expect(report.findings.some(f => f.kind === 'conflicting-instruction')).toBe(false)
  })

  // Live-corpus regression (#21947 bounce, what-makes-a-vibrator-body-safe):
  // "IPX5 covers the shower AND DOES NOT COVER immersion" negates
  // "immersion" (the second clause's own object), not "shower" (the first
  // clause's object) — a wider trailing window matched the second clause's
  // negation onto the first clause's "shower" and misread a correct ALLOW
  // as a FORBID.
  it('does not let a coordinated clause\'s negation attach to an earlier, unrelated object', () => {
    const report = analyzeParagraphs([
      { section: 'Water ratings', text: 'IPX5 covers the shower and does not cover immersion.' },
      {
        section: 'FAQ',
        text: 'A full charge takes about ninety minutes and holds roughly two hours of use, the motor stays whisper quiet, and the IPX5 rating covers the shower and a rinse under the tap.',
      },
    ])
    expect(report.findings.some(f => f.kind === 'conflicting-instruction' && f.token === 'IPX5')).toBe(false)
  })

  // Live-corpus regression (#21947 bounce, what-makes-a-vibrator-body-safe):
  // "neither of them covers immersion" is a correlative negation with no
  // bare not/never/cannot for the look-behind window to catch.
  it('reads "neither...covers immersion" as forbidding submersion', () => {
    const report = analyzeParagraphs([
      {
        section: 'Water ratings',
        text: 'IPX5 and IPX6 mean water jets, which is what a shower and a running tap are, and neither of them covers immersion.',
      },
      { section: 'FAQ', text: 'IPX5 can be fully submerged in a basin for a quick clean.' },
    ])
    const hit = report.findings.find(f => f.kind === 'conflicting-instruction' && f.token === 'IPX5')
    expect(hit).toBeDefined()
  })
})

describe(
  'restriction phrasing with no negation word (#21947 bounce: how-do-couples-use-a-' +
    'prostate-massager-together / how-do-you-use-a-clitoral-suction-toy)',
  () => {
    // Neither phrase contains not/never/cannot/etc, so the pre-fix
    // polarityBefore-only window (and even a naive before-or-after negation
    // window) misread both as ALLOW, which collided with the frozen house
    // wording's now-correct `forbid` read and produced brand-new same-document
    // false positives on these two posts' own pages.
    it('reads "needs its own rating" as forbidding direct spray', () => {
      const report = analyzeParagraphs([
        { section: 'Water ratings', text: 'An IPX7 rating covers immersion, but a direct jet needs its own rating.' },
        {
          section: 'Water ratings',
          text: "The toy's IPX7 rating comes with no promise about a jet, so never aim a direct spray at it.",
        },
      ])
      expect(report.findings.some(f => f.kind === 'conflicting-instruction')).toBe(false)
    })

    it('reads "does not cover jets" as forbidding direct spray', () => {
      const report = analyzeParagraphs([
        { section: 'Water ratings', text: 'The IPX7 code does not cover jets, so stick to a still bath instead.' },
        {
          section: 'Water ratings',
          text: "The toy's IPX7 rating comes with no promise about a jet, so never aim a direct spray at it.",
        },
      ])
      expect(report.findings.some(f => f.kind === 'conflicting-instruction')).toBe(false)
    })

    it('still flags a genuine conflict between a restriction phrase and an unrelated allow', () => {
      const report = analyzeParagraphs([
        { section: 'Water ratings', text: 'An IPX7 rating covers immersion, but a direct jet needs its own rating.' },
        { section: 'FAQ', text: "The toy's IPX7 rating means you can use it right in the shower." },
      ])
      const hit = report.findings.find(f => f.kind === 'conflicting-instruction')
      expect(hit).toBeDefined()
      expect(hit?.token).toBe('IPX7')
    })
  },
)

describe('requirement-shaped restriction phrasing (#22827 live-corpus false positive)', () => {
  // The frozen house sentence from how-do-couples-use-a-prostate-massager-together
  // and how-do-you-use-a-clitoral-suction-toy: it lists IPX5 and IPX6 as each
  // plainly sufficient alone, but IPX7 only paired with IPX6 ("a dual IPX6 and
  // IPX7 mark"). This module has no per-token attribution, so it cannot grant
  // IPX5/IPX6 while leaving IPX7 unresolved — it drops the instruction
  // entirely for this bucket rather than guessing (same remedy as the
  // multi-code tests below). Pre-fix, a flat `forbid` collided with 15 other
  // posts' correct "IPX5/IPX6 mean water jets" definitions as 30 false
  // conflicting-instruction findings; a flat `allow` (tried and reverted)
  // traded those for 5 new false positives against posts correctly stating
  // IPX7 alone does not cover the shower.
  const houseSentence =
    'The shower needs a rating that covers jets, IPX5 or IPX6 or a dual IPX6 and IPX7 mark, ' +
    'or a written instruction from the maker that this toy can go under a shower.'

  it('attributes no direct-spray instruction to any code in the requirement sentence', () => {
    const report = analyzeParagraphs([{ section: 'Water ratings', text: houseSentence }])
    expect(report.findings.some(f => f.kind === 'undefined-token')).toBe(false)
  })

  it('does not read the requirement sentence as forbidding the codes it names as sufficient', () => {
    const report = analyzeParagraphs([
      { section: 'Water ratings', text: houseSentence },
      { section: 'Water ratings', text: 'IPX5 and IPX6 mean water jets, which is what a running tap is.' },
    ])
    expect(report.findings.some(f => f.kind === 'conflicting-instruction')).toBe(false)
  })

  it('does not flag a cross-post conflict against a post defining the same named codes', () => {
    const draftParagraphs = [{ section: 'Water ratings', text: houseSentence }]
    const priors = [
      {
        slug: 'what-makes-a-vibrator-body-safe',
        paragraphs: [{ section: 'Water ratings', text: 'IPX5 and IPX6 mean water jets, which is what a running tap is.' }],
      },
    ]
    expect(findCrossPostIngressConflicts(draftParagraphs, priors)).toHaveLength(0)
  })

  it('does not flag a cross-post conflict against a post correctly forbidding IPX7 alone', () => {
    // IPX7 is only named as part of the "dual IPX6 and IPX7" condition, so a
    // post correctly stating IPX7 alone does not cover the shower must not
    // collide with the requirement sentence either (the regression a flat
    // `allow` fix introduced).
    const draftParagraphs = [{ section: 'Water ratings', text: houseSentence }]
    const priors = [
      {
        slug: 'what-makes-a-vibrator-body-safe',
        paragraphs: [
          { section: 'Water ratings', text: 'IPX7 on its own gets you the basin, and the shower comes from Womanizer rather than from the code.' },
        ],
      },
    ]
    expect(findCrossPostIngressConflicts(draftParagraphs, priors)).toHaveLength(0)
  })
})

describe('multi-code "<CODE> certifies ... only" clauses (#22827 live-corpus false positive)', () => {
  // Live house sentence from what-makes-a-great-g-spot-rabbit-vibrator: IPX4's
  // own clause ("never goes under water") uses no word the submersion bucket
  // recognizes, so pre-fix the sentence's only submersion match was IPX7's
  // "immersion" (correctly `allow`), misattributed onto IPX4 too — reporting
  // IPX4 as ALLOWING submersion when the sentence says the opposite.
  const houseSentence =
    'IPX4 certifies protection against splashing only, so a toy carrying that code stays out of the ' +
    'shower and never goes under water, and IPX7 certifies immersion only, a metre for half an hour, ' +
    'which comes with no promise about a shower or a tap.'

  it('does not attribute IPX7s clause onto IPX4 in the same sentence', () => {
    const report = analyzeParagraphs([
      { section: 'Water ratings', text: houseSentence },
      { section: 'FAQ', text: 'Keep an IPX4 toy out of the shower and never submerge it.' },
    ])
    expect(report.findings.some(f => f.kind === 'conflicting-instruction' && f.token === 'IPX4')).toBe(false)
  })

  it('does not flag a cross-post conflict for IPX4 against a post that correctly forbids it', () => {
    const draftParagraphs = [{ section: 'Water ratings', text: houseSentence }]
    const priors = [
      { slug: 'other-post', paragraphs: [{ section: 'FAQ', text: 'Keep an IPX4 toy out of the shower and never submerge it.' }] },
    ]
    expect(findCrossPostIngressConflicts(draftParagraphs, priors)).toHaveLength(0)
  })

  it('still flags a genuine single-code restriction, unaffected by the multi-code unscopeable guard', () => {
    const report = analyzeParagraphs([
      { section: 'Water ratings', text: 'IPX7 covers immersion only, so never run it under a shower or a direct tap.' },
      { section: 'FAQ', text: "The toy's IPX7 rating means you can use it right in the shower." },
    ])
    const hit = report.findings.find(f => f.kind === 'conflicting-instruction')
    expect(hit).toBeDefined()
    expect(hit?.token).toBe('IPX7')
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

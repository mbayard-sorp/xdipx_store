// Product-fidelity check for generated on-skin social imagery (ticket
// #11487). Report-only: never blocks, but distinguishes "checked and it
// matched" from "checked and it drifted" from "could not check".
import { describe, expect, it, vi } from 'vitest'
import {
  FIDELITY_DIMENSIONS,
  LABEL_TOLERANT_FIDELITY_SYSTEM_PROMPT,
  PRODUCT_FIDELITY_SYSTEM_PROMPT,
  formatFidelityTags,
  hasFidelityDrift,
  isValidFidelityShape,
  runProductFidelityCheck,
  runProductFidelityCheckOnImages,
  type ProductFidelityDeps,
  type ProductFidelityVerdict,
} from './social-product-fidelity.server'

const CLEAN_RESPONSE = { silhouette: 'match', colour: 'match', finish: 'match', brandMark: 'match', notes: 'faithful to reference' } as const

// The ticket's own regression case: ROMP 2.0, asset 675 vs 97829B.jpg.
const ROMP_DRIFT_RESPONSE = {
  silhouette: 'drift',
  colour: 'match',
  finish: 'match',
  brandMark: 'drift',
  notes: 'Reference is a closed bud with a raised tubular collar; render is an open spiral of petals. The molded ROMP wordmark reads as garbled pseudo-text in the render.',
} as const

function deps(over: Partial<ProductFidelityDeps> = {}): ProductFidelityDeps {
  return {
    fetchImageBase64: vi.fn(async (url: string) => ({ data: `base64-of-${url}`, mediaType: 'image/jpeg' })),
    callVision: vi.fn(async () => CLEAN_RESPONSE),
    ...over,
  }
}

describe('FIDELITY_DIMENSIONS', () => {
  it('names the four dimensions the ticket asked for', () => {
    expect(FIDELITY_DIMENSIONS).toEqual(['silhouette', 'colour', 'finish', 'brandMark'])
  })
})

describe('PRODUCT_FIDELITY_SYSTEM_PROMPT', () => {
  it('judges the product only, not the person or scene', () => {
    expect(PRODUCT_FIDELITY_SYSTEM_PROMPT).toContain('not judging the person, pose, or scene')
  })

  it('licenses scale hyperbole but not shape drift', () => {
    expect(PRODUCT_FIDELITY_SYSTEM_PROMPT).toContain('Scale')
    expect(PRODUCT_FIDELITY_SYSTEM_PROMPT).toContain('is NOT part of this check')
  })

  it('names all four dimensions and the not-applicable brandMark case', () => {
    expect(PRODUCT_FIDELITY_SYSTEM_PROMPT).toContain('silhouette')
    expect(PRODUCT_FIDELITY_SYSTEM_PROMPT).toContain('colour')
    expect(PRODUCT_FIDELITY_SYSTEM_PROMPT).toContain('finish')
    expect(PRODUCT_FIDELITY_SYSTEM_PROMPT).toContain('brandMark')
    expect(PRODUCT_FIDELITY_SYSTEM_PROMPT).toContain('not-applicable')
  })
})

describe('isValidFidelityShape', () => {
  it('accepts a well-formed response', () => {
    expect(isValidFidelityShape(CLEAN_RESPONSE)).toBe(true)
  })

  it('accepts a not-applicable brandMark', () => {
    expect(isValidFidelityShape({ ...CLEAN_RESPONSE, brandMark: 'not-applicable' })).toBe(true)
  })

  it('rejects an invalid rating', () => {
    expect(isValidFidelityShape({ ...CLEAN_RESPONSE, silhouette: 'similar' })).toBe(false)
  })

  it('rejects not-applicable on a non-brandMark dimension', () => {
    expect(isValidFidelityShape({ ...CLEAN_RESPONSE, colour: 'not-applicable' })).toBe(false)
  })

  it('rejects a missing notes field', () => {
    const { notes: _notes, ...rest } = CLEAN_RESPONSE
    expect(isValidFidelityShape(rest)).toBe(false)
  })

  it('rejects null and non-objects', () => {
    expect(isValidFidelityShape(null)).toBe(false)
    expect(isValidFidelityShape('nope')).toBe(false)
  })
})

describe('hasFidelityDrift', () => {
  const base: ProductFidelityVerdict = {
    silhouette: 'match', colour: 'match', finish: 'match', brandMark: 'match',
    notes: '', checkedAt: '2026-09-25T00:00:00.000Z', checkCompleted: true,
  }

  it('is false when every dimension matches', () => {
    expect(hasFidelityDrift(base)).toBe(false)
  })

  it('is true when any dimension drifts', () => {
    expect(hasFidelityDrift({ ...base, silhouette: 'drift' })).toBe(true)
    expect(hasFidelityDrift({ ...base, brandMark: 'drift' })).toBe(true)
  })

  it('a not-applicable brandMark never counts as drift', () => {
    expect(hasFidelityDrift({ ...base, brandMark: 'not-applicable' })).toBe(false)
  })

  it('is false when the check never completed, even if a dimension somehow reads drift-shaped', () => {
    expect(hasFidelityDrift({ ...base, checkCompleted: false, silhouette: null })).toBe(false)
  })
})

describe('formatFidelityTags', () => {
  it('encodes one tag per dimension', () => {
    const verdict: ProductFidelityVerdict = {
      silhouette: 'drift', colour: 'match', finish: 'match', brandMark: 'drift',
      notes: '', checkedAt: '2026-09-25T00:00:00.000Z', checkCompleted: true,
    }
    expect(formatFidelityTags(verdict)).toEqual([
      'fidelity:silhouette=drift',
      'fidelity:colour=match',
      'fidelity:finish=match',
      'fidelity:brandMark=drift',
    ])
  })

  it('returns no tags when the check never completed', () => {
    const verdict: ProductFidelityVerdict = {
      silhouette: null, colour: null, finish: null, brandMark: null,
      notes: 'could not complete', checkedAt: '2026-09-25T00:00:00.000Z', checkCompleted: false,
    }
    expect(formatFidelityTags(verdict)).toEqual([])
  })
})

describe('runProductFidelityCheckOnImages', () => {
  it('reports a clean match', async () => {
    const verdict = await runProductFidelityCheckOnImages(
      { data: 'rendered', mediaType: 'image/jpeg' },
      { data: 'reference', mediaType: 'image/jpeg' },
      deps(),
    )
    expect(verdict.checkCompleted).toBe(true)
    expect(hasFidelityDrift(verdict)).toBe(false)
  })

  it('reports the ROMP 2.0 regression case (asset 675) as drift on silhouette and brandMark', async () => {
    const verdict = await runProductFidelityCheckOnImages(
      { data: 'rendered-675', mediaType: 'image/jpeg' },
      { data: 'reference-97829B', mediaType: 'image/jpeg' },
      deps({ callVision: vi.fn(async () => ROMP_DRIFT_RESPONSE) }),
    )
    expect(verdict.checkCompleted).toBe(true)
    expect(verdict.silhouette).toBe('drift')
    expect(verdict.brandMark).toBe('drift')
    expect(verdict.colour).toBe('match')
    expect(hasFidelityDrift(verdict)).toBe(true)
    expect(formatFidelityTags(verdict)).toContain('fidelity:silhouette=drift')
    expect(formatFidelityTags(verdict)).toContain('fidelity:brandMark=drift')
  })

  it('fails closed with checkCompleted:false when the model call throws', async () => {
    const verdict = await runProductFidelityCheckOnImages(
      { data: 'rendered', mediaType: 'image/jpeg' },
      { data: 'reference', mediaType: 'image/jpeg' },
      deps({ callVision: vi.fn(async () => { throw new Error('anthropic 529') }) }),
    )
    expect(verdict.checkCompleted).toBe(false)
    expect(verdict.silhouette).toBeNull()
    expect(hasFidelityDrift(verdict)).toBe(false)
    expect(verdict.notes).toContain('anthropic 529')
  })

  it('fails closed when the response does not match the expected shape', async () => {
    const verdict = await runProductFidelityCheckOnImages(
      { data: 'rendered', mediaType: 'image/jpeg' },
      { data: 'reference', mediaType: 'image/jpeg' },
      deps({ callVision: vi.fn(async () => ({ garbage: true })) }),
    )
    expect(verdict.checkCompleted).toBe(false)
    expect(verdict.notes).toContain('expected shape')
  })

  it('never throws, even when every dep throws', async () => {
    await expect(
      runProductFidelityCheckOnImages(
        { data: 'rendered', mediaType: 'image/jpeg' },
        { data: 'reference', mediaType: 'image/jpeg' },
        deps({ callVision: vi.fn(async () => { throw new Error('boom') }) }),
      ),
    ).resolves.toMatchObject({ checkCompleted: false })
  })
})

// Ticket #14309. Label-heavy SKUs (the printed text IS the product's
// identity) never satisfy the strict brandMark dimension, which the gate
// then treats as a hard rejection via hasFidelityDrift. The caller-selected
// label-tolerant mode drops that one dimension from judgment while leaving
// silhouette/colour/finish gated exactly as before.
describe('LABEL_TOLERANT_FIDELITY_SYSTEM_PROMPT', () => {
  it('still judges silhouette, colour, and finish', () => {
    expect(LABEL_TOLERANT_FIDELITY_SYSTEM_PROMPT).toContain('silhouette')
    expect(LABEL_TOLERANT_FIDELITY_SYSTEM_PROMPT).toContain('colour')
    expect(LABEL_TOLERANT_FIDELITY_SYSTEM_PROMPT).toContain('finish')
  })

  it('tells the model never to judge the brand mark', () => {
    expect(LABEL_TOLERANT_FIDELITY_SYSTEM_PROMPT).toContain('Do NOT judge the brand wordmark or logo at all')
    expect(LABEL_TOLERANT_FIDELITY_SYSTEM_PROMPT).toContain('Always answer "not-applicable"')
  })

  it('is a distinct prompt from the strict one', () => {
    expect(LABEL_TOLERANT_FIDELITY_SYSTEM_PROMPT).not.toBe(PRODUCT_FIDELITY_SYSTEM_PROMPT)
  })
})

describe('runProductFidelityCheckOnImages with labelTolerant', () => {
  it('passes the labelTolerant opt through to callVision', async () => {
    const callVision = vi.fn(async () => ({ ...CLEAN_RESPONSE, brandMark: 'not-applicable' as const }))
    const verdict = await runProductFidelityCheckOnImages(
      { data: 'rendered', mediaType: 'image/jpeg' },
      { data: 'reference', mediaType: 'image/jpeg' },
      deps({ callVision }),
      undefined,
      { labelTolerant: true },
    )
    expect(callVision).toHaveBeenCalledWith(
      { data: 'rendered', mediaType: 'image/jpeg' },
      { data: 'reference', mediaType: 'image/jpeg' },
      { labelTolerant: true },
    )
    expect(verdict.checkCompleted).toBe(true)
  })

  it('a garbled brandMark alone no longer drifts when the model honors not-applicable', async () => {
    // Same silhouette/colour/finish-clean shape the strict mode would also
    // pass, but brandMark now reads not-applicable instead of drift because
    // the label-tolerant prompt told the model never to judge it.
    const verdict = await runProductFidelityCheckOnImages(
      { data: 'rendered', mediaType: 'image/jpeg' },
      { data: 'reference', mediaType: 'image/jpeg' },
      deps({ callVision: vi.fn(async () => ({ ...CLEAN_RESPONSE, brandMark: 'not-applicable' as const })) }),
      undefined,
      { labelTolerant: true },
    )
    expect(hasFidelityDrift(verdict)).toBe(false)
  })

  it('a genuine silhouette drift still fails even in label-tolerant mode', async () => {
    const verdict = await runProductFidelityCheckOnImages(
      { data: 'rendered', mediaType: 'image/jpeg' },
      { data: 'reference', mediaType: 'image/jpeg' },
      deps({ callVision: vi.fn(async () => ({ ...ROMP_DRIFT_RESPONSE, brandMark: 'not-applicable' as const })) }),
      undefined,
      { labelTolerant: true },
    )
    expect(hasFidelityDrift(verdict)).toBe(true)
  })
})

describe('runProductFidelityCheck', () => {
  it('fetches both the rendered and the reference image before comparing', async () => {
    const fetchImageBase64 = vi.fn(async (url: string) => ({ data: `base64-of-${url}`, mediaType: 'image/jpeg' }))
    const callVision = vi.fn(async () => CLEAN_RESPONSE)
    const verdict = await runProductFidelityCheck(
      'https://cdn.shopify.com/files/rendered-675.jpg',
      'https://cdn.shopify.com/files/97829B.jpg',
      { fetchImageBase64, callVision },
    )
    expect(verdict.checkCompleted).toBe(true)
    expect(fetchImageBase64).toHaveBeenCalledWith('https://cdn.shopify.com/files/rendered-675.jpg')
    expect(fetchImageBase64).toHaveBeenCalledWith('https://cdn.shopify.com/files/97829B.jpg')
    expect(callVision).toHaveBeenCalledWith(
      { data: 'base64-of-https://cdn.shopify.com/files/rendered-675.jpg', mediaType: 'image/jpeg' },
      { data: 'base64-of-https://cdn.shopify.com/files/97829B.jpg', mediaType: 'image/jpeg' },
    )
  })

  it('fails closed when the rendered image cannot be fetched', async () => {
    const verdict = await runProductFidelityCheck(
      'https://cdn.shopify.com/files/missing.jpg',
      'https://cdn.shopify.com/files/97829B.jpg',
      deps({ fetchImageBase64: vi.fn(async () => { throw new Error('fetch failed: HTTP 404') }) }),
    )
    expect(verdict.checkCompleted).toBe(false)
    expect(verdict.notes).toContain('404')
  })
})

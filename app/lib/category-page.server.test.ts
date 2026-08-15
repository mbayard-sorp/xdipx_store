// Dial-honesty coverage for the category card projection (ticket #290).
//
// `projectCardDial` is the seam that lets category cards render a real
// sensation dial off the lean Product's `sensationDialV2` (parsed from the
// xdipx.sensation_dial_v2 metafield in nodeToProduct) without ever fabricating
// a reading. A product with no dial data must yield an empty array so the card
// renders no dial at all (design doctrine §6).
import { describe, expect, it } from 'vitest'
import { projectCardDial } from '~/lib/category-page.server'
import type { SensationDialV2 } from '~/types'

describe('projectCardDial', () => {
  it('returns [] when the product carries no dial (undefined)', () => {
    expect(projectCardDial(undefined)).toEqual([])
  })

  it('returns [] for an empty items array', () => {
    expect(projectCardDial({ items: [] } as unknown as SensationDialV2)).toEqual([])
  })

  it('maps label + value straight through when readings are present', () => {
    const dial = {
      items: [
        { label: 'Intensity', value: 4 },
        { label: 'Quietness', value: 2 },
      ],
    } as unknown as SensationDialV2
    expect(projectCardDial(dial)).toEqual([
      { label: 'Intensity', value: 4 },
      { label: 'Quietness', value: 2 },
    ])
  })

  it('drops zero readings rather than showing an empty bar', () => {
    const dial = {
      items: [
        { label: 'Intensity', value: 5 },
        { label: 'Softness', value: 0 },
      ],
    } as unknown as SensationDialV2
    expect(projectCardDial(dial)).toEqual([{ label: 'Intensity', value: 5 }])
  })

  it('clamps out-of-range values to 0-5 and rounds', () => {
    const dial = {
      items: [
        { label: 'High', value: 9 },
        { label: 'Rounded', value: 3.6 },
        { label: 'Negative', value: -2 },
      ],
    } as unknown as SensationDialV2
    // 9 -> 5, 3.6 -> 4, -2 -> 0 (dropped)
    expect(projectCardDial(dial)).toEqual([
      { label: 'High', value: 5 },
      { label: 'Rounded', value: 4 },
    ])
  })

  it('caps at three readings to match the card contract', () => {
    const dial = {
      items: [
        { label: 'A', value: 5 },
        { label: 'B', value: 4 },
        { label: 'C', value: 3 },
        { label: 'D', value: 2 },
      ],
    } as unknown as SensationDialV2
    expect(projectCardDial(dial)).toHaveLength(3)
    expect(projectCardDial(dial).map(d => d.label)).toEqual(['A', 'B', 'C'])
  })
})

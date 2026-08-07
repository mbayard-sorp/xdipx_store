import { describe, it, expect } from 'vitest'
import { resolveBandOrder, DEFAULT_BAND_ORDER } from './StorefrontHome'

// resolveBandOrder turns a published Sanity layout into the slot order the
// storefront homepage renders. Two invariants are enforced in the renderer, not
// just in playbook prose, so a bad layout publish cannot break the page:
//   - the hero always leads (LCP / H1 guarantee), and
//   - the anchorGrid bestseller wall cannot be removed by a layout edit unless a
//     live team rail has explicitly claimed its slot (replacesAnchor).

const band = (name: string, enabled = true) => ({ _type: 'homeBand', band: name, enabled })

describe('resolveBandOrder', () => {
  it('renders the shipped order when there is no layout', () => {
    expect(resolveBandOrder(null)).toEqual(DEFAULT_BAND_ORDER)
    expect(resolveBandOrder({ sections: [] })).toEqual(DEFAULT_BAND_ORDER)
    expect(DEFAULT_BAND_ORDER).toContain('anchorGrid')
  })

  it('keeps the anchor grid when a layout disables it and no rail replaced it', () => {
    // The exact failure the ticket targets: a layout publish that disables the
    // anchorGrid band with no live replacesAnchor rail must not delete the
    // bestseller wall.
    const layout = {
      sections: [band('hero'), band('anchorGrid', false), band('teamRails'), band('faq')],
    }
    const order = resolveBandOrder(layout, { anchorReplaced: false })
    expect(order).toContain('anchorGrid')
    // Put back in its shipped position, right after the hero.
    expect(order.indexOf('anchorGrid')).toBe(order.indexOf('hero') + 1)
  })

  it('keeps the anchor grid when a layout omits it entirely and no rail replaced it', () => {
    const layout = { sections: [band('hero'), band('teamRails'), band('faq')] }
    const order = resolveBandOrder(layout, { anchorReplaced: false })
    expect(order).toContain('anchorGrid')
    expect(order.indexOf('anchorGrid')).toBe(order.indexOf('hero') + 1)
  })

  it('honours disabling the anchor grid only when a live rail has replaced it', () => {
    const layout = {
      sections: [band('hero'), band('anchorGrid', false), band('teamRails'), band('faq')],
    }
    const order = resolveBandOrder(layout, { anchorReplaced: true })
    expect(order).not.toContain('anchorGrid')
    expect(order).toEqual(['hero', 'teamRails', 'faq'])
  })

  it('still forces the hero to lead even when a layout demotes it', () => {
    const layout = { sections: [band('teamRails'), band('anchorGrid'), band('hero')] }
    const order = resolveBandOrder(layout, { anchorReplaced: false })
    expect(order[0]).toBe('hero')
  })

  it('re-adds the anchor grid after a hero the layout also dropped', () => {
    // No hero and no anchorGrid in the layout: hero is forced to the front, then
    // the anchor guard inserts anchorGrid right after it.
    const layout = { sections: [band('teamRails'), band('faq')] }
    const order = resolveBandOrder(layout, { anchorReplaced: false })
    expect(order[0]).toBe('hero')
    expect(order[1]).toBe('anchorGrid')
  })

  it('defaults anchorReplaced to false when no opts are passed', () => {
    const layout = {
      sections: [band('hero'), band('anchorGrid', false), band('teamRails')],
    }
    expect(resolveBandOrder(layout)).toContain('anchorGrid')
  })
})

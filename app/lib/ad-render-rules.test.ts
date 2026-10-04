import { describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/db.server', () => ({ db: {} }))

import {
  AD_FORMATS, LANE_FORMATS, formatsForLane, getAdFormat, isTextOnlyLane, nativeSize, TEXT_FORMAT_ID,
} from '~/lib/ad-formats'
import {
  AdLaneCeilingError, aggregateGates, assertLaneCeiling, buildExportPayload, buildPlatePrompt, chooseLayout,
  conceptUsesPlate, emptyGates, fitSlogan, getConcept, normaliseSlogan, notRun, pickSlogan, planPlate,
  type GatesJson,
} from '~/lib/ad-render-rules'
import { destinationOkForMeta, policyGate, voiceGate } from '~/lib/ad-copy-gates.server'

describe('format matrix', () => {
  it('maps each lane to the sizes in the wires', () => {
    expect(LANE_FORMATS['meta']).toEqual(['1:1', '4:5', '1200x628'])
    expect(LANE_FORMATS['snap']).toEqual(['9:16'])
    expect(LANE_FORMATS['adult']).toEqual(['300x250', '728x90', '300x100', '900x250'])
    expect(LANE_FORMATS['newsletter']).toEqual(['1200x628', '600x600'])
    expect(LANE_FORMATS['owned']).toEqual(['1200x628', '1:1'])
  })

  it('has native sizes and fits every id in the varchar(8) column', () => {
    expect(nativeSize('4:5')).toEqual({ width: 1080, height: 1350 })
    expect(nativeSize('728x90')).toEqual({ width: 728, height: 90 })
    for (const f of AD_FORMATS) expect(f.id.length).toBeLessThanOrEqual(8)
    expect(getAdFormat('nope')).toBeNull()
  })

  it('gives Google and Microsoft text only, no image size', () => {
    expect(isTextOnlyLane('google')).toBe(true)
    expect(isTextOnlyLane('microsoft')).toBe(true)
    expect(isTextOnlyLane('meta')).toBe(false)
    expect(formatsForLane('google')).toEqual([])
    expect(LANE_FORMATS['google']).toEqual([TEXT_FORMAT_ID])
  })
})

describe('slogan rotation', () => {
  const headlines = ['Billing Reads XDIPX', 'Plain box. Plain statement.', 'Discreet by default']

  it('rotates by creative index', () => {
    const none = new Set<string>()
    expect(pickSlogan({ headlines, usedElsewhere: none, index: 0 })).toBe('Billing Reads XDIPX')
    expect(pickSlogan({ headlines, usedElsewhere: none, index: 1 })).toBe('Plain box. Plain statement.')
    expect(pickSlogan({ headlines, usedElsewhere: none, index: 3 })).toBe('Billing Reads XDIPX')
  })

  it('never reuses a slogan another idea used in the window, compared normalised', () => {
    const used = new Set([normaliseSlogan('billing reads xdipx!')])
    expect(pickSlogan({ headlines, usedElsewhere: used, index: 0 })).toBe('Plain box. Plain statement.')
    expect(pickSlogan({ headlines, usedElsewhere: used, index: 1 })).toBe('Discreet by default')
  })

  it('returns null when every headline is spent', () => {
    const used = new Set(headlines.map(normaliseSlogan))
    expect(pickSlogan({ headlines, usedElsewhere: used, index: 0 })).toBeNull()
  })

  it('prefers a headline that fits the format, else the shortest', () => {
    expect(pickSlogan({ headlines, usedElsewhere: new Set(), index: 0, maxChars: 20 })).toBe('Billing Reads XDIPX')
    expect(pickSlogan({ headlines: ['A very long headline indeed', 'Another long one here'], usedElsewhere: new Set(), index: 0, maxChars: 5 })).toBe('Another long one here')
  })
})

describe('lane ceiling', () => {
  it('throws when a meta render carries an on-skin axis', () => {
    expect(() => assertLaneCeiling('meta', { archetype: 'on-skin', onSkin: true, sceneAxes: { bodyZone: 'forearm' } })).toThrow(AdLaneCeilingError)
    expect(() => assertLaneCeiling('meta', { archetype: 'B', onSkin: false, sceneAxes: { bodyZone: 'hip-hollow' } })).toThrow(/object-first/)
    expect(() => assertLaneCeiling('meta', { archetype: 'B', onSkin: false, sceneAxes: { contactMode: 'resting' } })).toThrow(AdLaneCeilingError)
  })

  it('throws planning a body concept at meta, snap and newsletter', () => {
    for (const lane of ['meta', 'snap', 'newsletter']) {
      expect(() => planPlate({ lane, registerTier: '3-4', conceptSlug: 'body-map', ideaId: 1 })).toThrow(AdLaneCeilingError)
    }
  })

  it('lets adult and owned go on skin, with the stop list in the negatives', () => {
    const plan = planPlate({ lane: 'adult', registerTier: '9', conceptSlug: 'body-map', ideaId: 2 })
    expect(plan.onSkin).toBe(true)
    expect(plan.negatives.join(' ')).toMatch(/nipple/)
    expect(planPlate({ lane: 'owned', registerTier: '9', conceptSlug: 'second-spring', ideaId: 2 }).onSkin).toBe(true)
    // Second Spring is a hand only on a paid lane.
    expect(planPlate({ lane: 'meta', registerTier: '3-4', conceptSlug: 'second-spring', ideaId: 2 }).onSkin).toBe(false)
  })

  it('plans paid lanes as object-first archetype B on a soft ground', () => {
    const plan = planPlate({ lane: 'meta', registerTier: '3-4', conceptSlug: 'sculpture-hall', ideaId: 3 })
    expect(plan.archetype).toBe('B')
    expect(['coral-soft', 'plum-soft']).toContain(plan.ground)
    expect(plan.allowHand).toBe(false)
  })

  it('writes a text-free prompt that carries the standard negatives', () => {
    const plan = planPlate({ lane: 'meta', registerTier: '3-4', conceptSlug: 'sculpture-hall', ideaId: 3 })
    const prompt = buildPlatePrompt({ plan, conceptSlug: 'sculpture-hall', ideaId: 3, productTitle: 'LELO SONA 3', format: getAdFormat('1:1')! })
    expect(prompt).toMatch(/no letters/)
    expect(prompt).toMatch(/must contain no text/)
    expect(prompt).toMatch(/No body, no skin, no hands/)
    expect(prompt).not.toMatch(/paper/i)
  })
})

describe('layout and plate use', () => {
  it('uses a type card for typographic concepts and Statement Reads at register 3-4', () => {
    expect(conceptUsesPlate(getConcept('say-it-plain'), '6-7')).toBe(false)
    expect(conceptUsesPlate(getConcept('statement-reads-xdipx'), '3-4')).toBe(false)
    expect(conceptUsesPlate(getConcept('statement-reads-xdipx'), '6-7')).toBe(true)
    expect(chooseLayout(getConcept('sculpture-hall'), getAdFormat('728x90')!, true)).toBe('banner-strip')
    expect(chooseLayout(getConcept('spec-sheet'), getAdFormat('1200x628')!, true)).toBe('spec-diptych')
    expect(chooseLayout(getConcept('sculpture-hall'), getAdFormat('1:1')!, false)).toBe('type-card')
  })

  it('fits a slogan to the box and flags one that cannot fit', () => {
    const ok = fitSlogan({ text: 'Plug it in and forget the charger.', boxWidth: 900, boxHeight: 300, maxFont: 90, minFont: 30, maxLines: 3 })
    expect(ok.truncated).toBe(false)
    expect(ok.fontSize).toBeGreaterThanOrEqual(30)
    const bad = fitSlogan({ text: 'x '.repeat(80), boxWidth: 200, boxHeight: 40, maxFont: 30, minFont: 20, maxLines: 2 })
    expect(bad.truncated).toBe(true)
  })
})

describe('gate aggregation', () => {
  const clean: GatesJson = {
    vision: { state: 'pass', reason: '' }, product: { state: 'pass', reason: '' }, voice: { state: 'pass', reason: '' },
    policy: { state: 'pass', reason: '' }, text: { state: 'pass', reason: '' },
  }

  it('is a draft when nothing blocks', () => {
    expect(aggregateGates(clean)).toBe('draft')
    expect(aggregateGates({ ...clean, product: notRun('typographic'), voice: { state: 'revise', reason: 'x' } })).toBe('draft')
    expect(aggregateGates(emptyGates())).toBe('draft')
  })

  it('is blocked when any gate blocks', () => {
    for (const k of ['vision', 'product', 'voice', 'policy', 'text'] as const) {
      expect(aggregateGates({ ...clean, [k]: { state: 'block', reason: 'no' } })).toBe('blocked')
    }
  })
})

describe('export payload skeleton', () => {
  it('carries exactly lane, format, slogan, headlines and destination_url', () => {
    const p = buildExportPayload({ lane: 'meta', format: '4:5', slogan: 'Billing Reads XDIPX', headlines: ['a', 'b'], destinationUrl: 'https://xdipx.com/products/x?utm_content=i1' })
    expect(Object.keys(p).sort()).toEqual(['destination_url', 'format', 'headlines', 'lane', 'slogan'])
    expect(p.headlines).toEqual(['a', 'b'])
    expect(buildExportPayload({ lane: 'google', format: 'text', slogan: null, headlines: [], destinationUrl: null }).destination_url).toBeNull()
  })
})

describe('copy gates', () => {
  it('blocks dashes, sexy, urgency and invented proof', () => {
    expect(voiceGate({ lane: 'owned', strings: ['Plain box \u2014 plain statement'] }).state).toBe('block')
    expect(voiceGate({ lane: 'owned', strings: ['So sexy'] }).state).toBe('block')
    expect(voiceGate({ lane: 'meta', strings: ['Only 3 left, hurry'] }).state).toBe('block')
    expect(voiceGate({ lane: 'meta', strings: ['Loved by 2,000 customers'] }).state).toBe('block')
    expect(voiceGate({ lane: 'owned', strings: ['I tried it and loved it'] }).state).toBe('block')
    expect(voiceGate({ lane: 'meta', strings: ['Billing Reads XDIPX'] }).state).toBe('pass')
  })

  it('applies the meta rules: register, category word, pleasure claim, destination', () => {
    const base = {
      lane: 'meta', registerTier: '3-4', slogan: 'Billing Reads XDIPX', headlines: ['Billing Reads XDIPX'], body: [],
      destinationUrl: 'https://xdipx.com/products/naturals-h2o?utm_content=a', plan: { archetype: 'B' as const, onSkin: false, sceneAxes: null }, vision: null, format: '1:1',
    }
    expect(policyGate(base).state).toBe('pass')
    expect(policyGate({ ...base, registerTier: '6-7' }).state).toBe('block')
    expect(policyGate({ ...base, slogan: 'The best vibrator, plainly' }).state).toBe('block')
    expect(policyGate({ ...base, headlines: ['Get off tonight'] }).state).toBe('block')
    expect(policyGate({ ...base, destinationUrl: 'https://xdipx.com/' }).state).toBe('revise')
    expect(policyGate({ ...base, plan: { archetype: 'on-skin', onSkin: true, sceneAxes: { bodyZone: 'forearm' } } }).state).toBe('block')
    expect(destinationOkForMeta('https://curious.xdipx.com/lube')).toBe(true)
  })

  it('checks Search headline length and requires utm on adult', () => {
    const g = policyGate({ lane: 'google', registerTier: '4-5', slogan: null, headlines: ['This headline is way over thirty characters'], body: [], destinationUrl: null, plan: null, vision: null, format: 'text' })
    expect(g.state).toBe('revise')
    const a = policyGate({ lane: 'adult', registerTier: '9', slogan: 's', headlines: [], body: [], destinationUrl: 'https://xdipx.com/products/x', plan: null, vision: null, format: '728x90' })
    expect(a.state).toBe('block')
  })
})

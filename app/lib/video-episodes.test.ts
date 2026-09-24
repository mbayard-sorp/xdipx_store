/**
 * Pure validators for the episode ledger (ticket #5712). The placement
 * vocabulary IS the shoppers-not-owners enforcement, and the spoken-text
 * canonicalization IS the enqueue guard's comparison, so both are pinned here.
 */
import { describe, expect, it } from 'vitest'
import {
  PLACEMENT_ROLES,
  validatePlacements,
  spokenTextOf,
  scriptsSpeakIdentically,
  mapSpeakerToPresenter,
  validatePitch,
  readPitch,
  hasPitchInput,
  validateLineNote,
} from './video-episodes'
import type { VideoScriptJson } from '../../db/schema'

describe('validatePlacements', () => {
  it('accepts the four licensed roles', () => {
    const placements = PLACEMENT_ROLES.map(role => ({ handle: 'wand-x', role, mentionType: 'spec_cited' }))
    expect(validatePlacements(placements)).toHaveLength(4)
  })

  it('refuses an owned role by construction (shoppers, not owners)', () => {
    expect(() => validatePlacements([{ handle: 'wand-x', role: 'owned', mentionType: 'spec_cited' }]))
      .toThrow(/shoppers, not owners/)
  })

  it('refuses personal_experience as a mention type', () => {
    expect(() => validatePlacements([{ handle: 'wand-x', role: 'considered', mentionType: 'personal_experience' }]))
      .toThrow(/mentionType/)
  })

  it('allows an empty placement list (no product is a licensed choice)', () => {
    expect(validatePlacements(undefined)).toEqual([])
    expect(validatePlacements([])).toEqual([])
  })

  it('requires a handle', () => {
    expect(() => validatePlacements([{ role: 'considered', mentionType: 'price' }])).toThrow(/handle/)
  })
})

describe('spokenTextOf / scriptsSpeakIdentically', () => {
  const base: VideoScriptJson = {
    presenterLine: 'The spec sheet says whisper quiet.',
    captions: { instagram: 'caption one', tiktok: 'caption two' },
    hook: 'not spoken',
  } as VideoScriptJson

  it('is stable across caption key order', () => {
    const reordered = { ...base, captions: { tiktok: 'caption two', instagram: 'caption one' } } as VideoScriptJson
    expect(scriptsSpeakIdentically(base, reordered)).toBe(true)
  })

  it('catches a one-word change in the spoken line', () => {
    const drifted = { ...base, presenterLine: 'The spec sheet says whisper soft.' } as VideoScriptJson
    expect(scriptsSpeakIdentically(base, drifted)).toBe(false)
  })

  it('catches a caption edit', () => {
    const drifted = { ...base, captions: { instagram: 'caption one!', tiktok: 'caption two' } } as VideoScriptJson
    expect(scriptsSpeakIdentically(base, drifted)).toBe(false)
  })

  it('a move between fields never reads as identical', () => {
    const a = { presenterLine: 'same words' } as VideoScriptJson
    const b = { voiceover: 'same words' } as VideoScriptJson
    expect(scriptsSpeakIdentically(a, b)).toBe(false)
  })

  it('covers per-scene spoken lines (forward-compatible with per-scene dialogue)', () => {
    const a = { scenes: [{ slug: 's0', motionPrompt: 'm', durationSeconds: 5, spokenLine: 'hello there' }] } as unknown as VideoScriptJson
    const b = { scenes: [{ slug: 's0', motionPrompt: 'DIFFERENT PROMPT', durationSeconds: 10, spokenLine: 'hello there' }] } as unknown as VideoScriptJson
    const c = { scenes: [{ slug: 's0', motionPrompt: 'm', durationSeconds: 5, spokenLine: 'hello друг' }] } as unknown as VideoScriptJson
    // Non-spoken fields may differ (the producer owns render craft)...
    expect(scriptsSpeakIdentically(a, b)).toBe(true)
    // ...but the words may not.
    expect(scriptsSpeakIdentically(a, c)).toBe(false)
  })

  it('ignores unspoken fields entirely', () => {
    const a = { presenterLine: 'line', framePrompt: 'frame A' } as VideoScriptJson
    const b = { presenterLine: 'line', framePrompt: 'frame B' } as VideoScriptJson
    expect(scriptsSpeakIdentically(a, b)).toBe(true)
    expect(spokenTextOf(a)).toBe('presenterLine:line')
  })
})

describe('mapSpeakerToPresenter (ADR-014, ticket #6586)', () => {
  const cast = [
    { slug: 'maya', name: 'Maya' },
    { slug: 'diego-r', name: 'Diego' },
  ]

  it('maps a cast slug case-insensitively', () => {
    expect(mapSpeakerToPresenter('maya', cast)).toBe('friend:maya')
    expect(mapSpeakerToPresenter('Maya', cast)).toBe('friend:maya')
  })

  it('maps a display name to its slug', () => {
    expect(mapSpeakerToPresenter('Diego', cast)).toBe('friend:diego-r')
  })

  it('maps emma and none as themselves, case-insensitively', () => {
    expect(mapSpeakerToPresenter('Emma', cast)).toBe('emma')
    expect(mapSpeakerToPresenter('none', cast)).toBe('none')
  })

  it('treats an absent or blank speaker as none (non-speaking presence beats)', () => {
    expect(mapSpeakerToPresenter(undefined, cast)).toBe('none')
    expect(mapSpeakerToPresenter('  ', cast)).toBe('none')
  })

  it('throws rather than guess on an unresolved speaker — wrong identity/voice is a silent failure otherwise', () => {
    expect(() => mapSpeakerToPresenter('Some Rando', cast)).toThrow(/matches no approved cast member/)
  })
})

describe('validatePitch (plan Phase 2b)', () => {
  const full = {
    format: 'spec-roast',
    speaker: 'emma',
    listener: 'dani',
    fact: '11 pulsation settings, IPX7',
    factSource: 'spec',
    laugh: 'she names it after her ex',
    firstFrameConcept: 'two friends on a couch, the box between them',
    estCostUsd: 0.84,
    readAudioUrl: 'https://cdn.example.com/read.mp3',
    productHandle: 'womanizer-premium-2',
    alternate: true,
  }

  it('accepts a full flat pitch and trims it', () => {
    const p = validatePitch({ ...full, speaker: '  emma ' }, 'episodes[0]')
    expect(p).toMatchObject({ format: 'spec-roast', speaker: 'emma', factSource: 'spec', alternate: true, estCostUsd: 0.84 })
    expect(p.readAudioUrl).toBe('https://cdn.example.com/read.mp3')
  })

  it('accepts the same keys nested under pitch, flat keys winning', () => {
    const p = validatePitch({ pitch: full, format: 'ask-the-group' }, 'episodes[0]')
    expect(p.format).toBe('ask-the-group')
    expect(p.productHandle).toBe('womanizer-premium-2')
  })

  it('treats format as a free non-empty string, not a hand-copied enum', () => {
    expect(validatePitch({ ...full, format: 'any-new-format' }, 'e').format).toBe('any-new-format')
    expect(() => validatePitch({ ...full, format: '  ' }, 'e')).toThrow(/e\.format is required/)
  })

  it.each(['speaker', 'fact', 'laugh', 'firstFrameConcept', 'productHandle'])('requires %s', key => {
    expect(() => validatePitch({ ...full, [key]: undefined }, 'episodes[2]')).toThrow(new RegExp(`episodes\\[2\\]\\.${key} is required`))
  })

  it('restricts factSource to spec|material|reviews', () => {
    expect(() => validatePitch({ ...full, factSource: 'vibes' }, 'e')).toThrow(/factSource must be one of spec\|material\|reviews/)
  })

  it('requires a non-negative numeric estimate', () => {
    expect(() => validatePitch({ ...full, estCostUsd: '0.84' }, 'e')).toThrow(/estCostUsd/)
    expect(() => validatePitch({ ...full, estCostUsd: -1 }, 'e')).toThrow(/estCostUsd/)
  })

  it('accepts only an https read URL', () => {
    expect(() => validatePitch({ ...full, readAudioUrl: 'http://x.test/a.mp3' }, 'e')).toThrow(/https/)
    expect(() => validatePitch({ ...full, readAudioUrl: 'not a url' }, 'e')).toThrow(/valid URL/)
    const { readAudioUrl: _r, ...noRead } = full
    expect(validatePitch(noRead, 'e').readAudioUrl).toBeUndefined()
  })

  it('omits alternate and listener when not set', () => {
    const { alternate: _a, listener: _l, ...rest } = full
    const p = validatePitch(rest, 'e')
    expect('alternate' in p).toBe(false)
    expect('listener' in p).toBe(false)
  })

  it('hasPitchInput detects any single pitch key, so a partial pitch is refused rather than dropped', () => {
    expect(hasPitchInput({ logline: 'x' })).toBe(false)
    expect(hasPitchInput({ logline: 'x', laugh: 'y' })).toBe(true)
    expect(hasPitchInput({ pitch: {} })).toBe(true)
  })

  it('readPitch reads a stored pitch and tolerates rows without one', () => {
    expect(readPitch(null)).toBeNull()
    expect(readPitch({ presenterLine: 'x' })).toBeNull()
    const p = validatePitch(full, 'e')
    expect(readPitch({ pitch: p } as VideoScriptJson)?.productHandle).toBe('womanizer-premium-2')
  })

  it("carries the writers' production mode, defaulting to talking (owner ruling 2026-09-23)", () => {
    expect(validatePitch(full, 'e').mode).toBe('talking')
    expect(validatePitch({ ...full, mode: 'voiceover' }, 'e').mode).toBe('voiceover')
    expect(validatePitch({ pitch: { ...full, mode: 'voiceover' } }, 'e').mode).toBe('voiceover')
    expect(() => validatePitch({ ...full, mode: 'b-roll' }, 'e')).toThrow(/e\.mode must be one of talking\|voiceover/)
    // A pitch stored before the field existed reads as talking.
    const { mode: _m, ...legacy } = validatePitch(full, 'e')
    expect(readPitch({ pitch: legacy } as VideoScriptJson)?.mode).toBe('talking')
  })

  it('never counts as spoken text, so a pitch cannot trip the enqueue byte-identity guard', () => {
    const p = validatePitch(full, 'e')
    const a: VideoScriptJson = { presenterLine: 'same line' }
    const b = { presenterLine: 'same line', pitch: p } as VideoScriptJson
    expect(scriptsSpeakIdentically(a, b)).toBe(true)
  })
})

describe('validateLineNote (plan Phase 2b)', () => {
  it('accepts a scene line note, coercing a form-string index', () => {
    expect(validateLineNote({ field: 'scenes', lineIdx: '2', note: ' too long ' })).toEqual({ field: 'scenes', lineIdx: 2, note: 'too long' })
  })

  it('pins single-line fields to index 0', () => {
    expect(validateLineNote({ field: 'cta', lineIdx: 0, note: 'x' }).lineIdx).toBe(0)
    expect(() => validateLineNote({ field: 'presenterLine', lineIdx: 1, note: 'x' })).toThrow(/single line/)
  })

  it('refuses an unknown field, a bad index, or an empty note', () => {
    expect(() => validateLineNote({ field: 'logline', lineIdx: 0, note: 'x' })).toThrow(/field must be one of/)
    expect(() => validateLineNote({ field: 'beats', lineIdx: -1, note: 'x' })).toThrow(/lineIdx/)
    expect(() => validateLineNote({ field: 'beats', lineIdx: 1.5, note: 'x' })).toThrow(/lineIdx/)
    expect(() => validateLineNote({ field: 'beats', lineIdx: 0, note: '   ' })).toThrow(/note is required/)
  })
})

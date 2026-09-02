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

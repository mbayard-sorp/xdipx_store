/**
 * caption-timing is what turns ElevenLabs character alignment into the cues
 * the caption burn draws. The contracts under test: whitespace delimits words
 * with punctuation attached, [tone] tags are never spoken, offsets shift split
 * parts, and cue boundaries come from real word times.
 */

import { describe, expect, it } from 'vitest'
import { charAlignmentToWordTimings, groupWordTimingsIntoCues, type CharAlignment } from '~/lib/caption-timing'

/** Build an alignment where every character takes 0.1s. */
function align(text: string): CharAlignment {
  const characters = [...text]
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => i * 0.1),
    character_end_times_seconds: characters.map((_, i) => (i + 1) * 0.1),
  }
}

describe('charAlignmentToWordTimings', () => {
  it('splits on whitespace and keeps punctuation with its word', () => {
    const out = charAlignmentToWordTimings(align('Ten seconds, done.'))
    expect(out.map(w => w.word)).toEqual(['Ten', 'seconds,', 'done.'])
    expect(out[0]!.start).toBeCloseTo(0)
    expect(out[0]!.end).toBeCloseTo(0.3)
    expect(out[2]!.end).toBeCloseTo(1.8)
  })

  it('strips bracketed audio-tag tokens', () => {
    const out = charAlignmentToWordTimings(align('[warm] Hello there'))
    expect(out.map(w => w.word)).toEqual(['Hello', 'there'])
  })

  it('applies the part offset to every timing', () => {
    const out = charAlignmentToWordTimings(align('Go now'), 12.5)
    expect(out[0]!.start).toBeCloseTo(12.5)
    expect(out[1]!.end).toBeCloseTo(12.5 + 0.6)
  })

  it('returns [] on an empty alignment', () => {
    expect(charAlignmentToWordTimings({ characters: [], character_start_times_seconds: [], character_end_times_seconds: [] })).toEqual([])
  })
})

describe('groupWordTimingsIntoCues', () => {
  it('cue start/end come from the first/last word', () => {
    const timings = charAlignmentToWordTimings(align('one two three'))
    const [cue] = groupWordTimingsIntoCues(timings)
    expect(cue!.text).toBe('one two three')
    expect(cue!.start).toBeCloseTo(timings[0]!.start)
    expect(cue!.end).toBeCloseTo(timings[2]!.end)
  })

  it('respects maxChars', () => {
    const timings = charAlignmentToWordTimings(align('aaaa bbbb cccc dddd'))
    const cues = groupWordTimingsIntoCues(timings, 9)
    expect(cues.map(c => c.text)).toEqual(['aaaa bbbb', 'cccc dddd'])
    expect(cues[1]!.start).toBeGreaterThan(cues[0]!.start)
  })

  it('breaks at sentence-final punctuation', () => {
    const timings = charAlignmentToWordTimings(align('Done. Next thing'))
    const cues = groupWordTimingsIntoCues(timings)
    expect(cues.map(c => c.text)).toEqual(['Done.', 'Next thing'])
  })

  it('returns [] for no timings', () => {
    expect(groupWordTimingsIntoCues([])).toEqual([])
  })
})

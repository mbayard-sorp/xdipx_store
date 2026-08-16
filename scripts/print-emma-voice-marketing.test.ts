import { describe, it, expect } from 'vitest'
import { excerptLineCount, fullCharterLineCount, excerptIsSubsetOfFull } from './print-emma-voice-marketing'

/**
 * Regression guard for the routine's cheaper-mandatory-read fix
 * (docs/homepage-team/routine-daily-merchandise.md, "Turn-budget discipline").
 * The whole point of this script is that the daily merchandiser reads a
 * meaningfully smaller excerpt than the full charter on every cold-start run.
 * If someone "simplifies" the script back to printing the raw file, or swaps
 * in EMMA_VOICE_FULL instead of EMMA_VOICE_MARKETING, this catches it.
 */
describe('print-emma-voice-marketing', () => {
  it('prints a genuine excerpt of the full charter, not the whole file', () => {
    expect(excerptIsSubsetOfFull()).toBe(true)
  })

  it('the excerpt is meaningfully shorter than the full charter', () => {
    const excerpt = excerptLineCount()
    const full = fullCharterLineCount()
    expect(excerpt).toBeGreaterThan(0)
    expect(full).toBeGreaterThan(excerpt)
    // Guard the actual budget win, not just "shorter by one line".
    expect(excerpt).toBeLessThan(full * 0.6)
  })
})

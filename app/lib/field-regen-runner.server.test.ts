import { describe, it, expect } from 'vitest'
import { checkFieldForVoiceViolations } from './field-regen-runner.server'

describe('checkFieldForVoiceViolations — the field-regen write gate (#19980)', () => {
  it('passes clean copy', () => {
    expect(checkFieldForVoiceViolations('tagline', 'Known for its quiet motor and travel-friendly size.')).toBeNull()
  })

  it('rejects the Tantus P-spot full_story shape (#8102)', () => {
    const error = checkFieldForVoiceViolations(
      'full_story',
      'I love how substantial it feels in your hands. Trust me, less effort means more pleasure.',
    )
    expect(error).not.toBeNull()
    expect(error).toContain('full_story')
    expect(error).toContain('i-love-like-how-it-feels')
    expect(error).toContain('trust-me')
  })

  it('rejects an em-dash and the Emma-byline tagline shape (#11147)', () => {
    expect(checkFieldForVoiceViolations('tagline', 'Quiet motor — built for travel.')).toContain('em-dash')
    expect(checkFieldForVoiceViolations('tagline', '— Emma · keeping this close')).toContain('emma-byline')
  })
})

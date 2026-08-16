/**
 * app/lib/sms-v2/__tests__/voice-no-dtmf-promise.test.ts
 *
 * Ticket #1277 item 1. DTMF digits arrive over the Fly WS and are logged
 * then discarded (ivr/src/server.ts) — nothing routes a keypress into the
 * conversation. The v2 voice adapter used to speak "press 1 for X, press 2
 * for Y" hints and signal `prompts: { kind: 'gather-digits' }` regardless,
 * promising an interaction the call can't fulfil. This asserts the smaller
 * fix: stop promising the keypress rather than try to wire it up.
 */
import { describe, expect, it } from 'vitest'
import { pillOptionsToSsml } from '../adapters/voice.server'

describe('pillOptionsToSsml never promises a keypress (#1277)', () => {
  it('renders a single option with no "press" language', () => {
    expect(pillOptionsToSsml(['Add it'])).not.toMatch(/press/i)
    expect(pillOptionsToSsml(['Add it'])).toContain('Add it')
  })

  it('renders multiple options as a natural spoken list, not numbered presses', () => {
    const ssml = pillOptionsToSsml(['Add it', 'No thanks'])
    expect(ssml).not.toMatch(/press\s*\d/i)
    expect(ssml).not.toMatch(/\bpress\b/i)
    expect(ssml).toContain('Add it')
    expect(ssml).toContain('No thanks')
    expect(ssml).toMatch(/,\s*or\s*/i)
  })

  it('empty input renders nothing', () => {
    expect(pillOptionsToSsml([])).toBe('')
  })
})

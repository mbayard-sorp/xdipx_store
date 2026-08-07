/**
 * app/lib/sms-v2/__tests__/conversation-history-empty-turn.test.ts
 *
 * conv-audit C6: history must never lead with an assistant turn. A media-only
 * MMS (Body trimmed to '') or a voice-greeting row has an Emma reply but no
 * inbound text; without a synthesized user turn the window starts with role
 * 'assistant', which the Messages API rejects and which poisons every
 * subsequent turn with safeFallback.
 */
import { describe, it, expect } from 'vitest'
import { expandHistoryTurns } from '../conversation-history.server'

describe('expandHistoryTurns (conv-audit C6)', () => {
  it('synthesizes a user turn so a media-only first row does not lead with assistant', () => {
    const turns = expandHistoryTurns([
      { customerMsg: '', emmaMsg: 'Hey! Cute photo. What are you in the mood for?' },
      { customerMsg: 'something quiet', emmaMsg: 'The Aurora Wand is a great quiet pick.' },
    ])

    expect(turns[0]?.role).toBe('user')
    expect(turns[0]?.text).toBe('[no text]')
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    // The real follow-up turn is preserved intact.
    expect(turns[2]).toEqual({ role: 'user', text: 'something quiet' })
  })

  it('a media-only MMS followed by a normal text does not poison the window', () => {
    const turns = expandHistoryTurns([
      { customerMsg: 'quiet wand?', emmaMsg: 'Try the Aurora Wand.' },
      { customerMsg: '', emmaMsg: 'Got your photo — noted.' },
      { customerMsg: 'is it waterproof?', emmaMsg: 'Yes, fully submersible.' },
    ])

    // Never leads with assistant, and roles stay alternating.
    expect(turns[0]?.role).toBe('user')
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant'])
    expect(turns.at(-1)).toEqual({ role: 'assistant', text: 'Yes, fully submersible.' })
  })

  it('drops a fully-empty row (no inbound text, no reply)', () => {
    const turns = expandHistoryTurns([
      { customerMsg: '', emmaMsg: '' },
      { customerMsg: 'hi', emmaMsg: 'Hi there.' },
    ])
    expect(turns).toEqual([
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'Hi there.' },
    ])
  })

  it('strips SSML from voice replies and keeps a normal pair unchanged', () => {
    const turns = expandHistoryTurns([
      { customerMsg: 'hello', emmaMsg: '<speak>Hi <break time="200ms"/>there</speak>' },
    ])
    expect(turns).toEqual([
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'Hi there' },
    ])
  })

  it('defensively strips a leading assistant turn if one ever appears', () => {
    // A row with only an assistant reply and a null customerMsg still yields a
    // placeholder user turn, so this really can't happen — but the guard holds.
    const turns = expandHistoryTurns([{ customerMsg: null, emmaMsg: 'orphan reply' }])
    expect(turns[0]?.role).toBe('user')
  })
})

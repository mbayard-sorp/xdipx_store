/**
 * Ticket #15386: the voice-gate (app/lib/team-gates.server.ts) judges every
 * Instagram/TikTok caption against EMMA_VOICE_SOCIAL verbatim — whatever
 * text this module slices out of docs/emma-voice.md is the whole charter
 * the model sees, with no other source of rules. The deterministic Step 4b
 * sale gate already carved out `/notebook/<slug>` and `/new` URLs as
 * editorial, not a PDP/sale link (routine-social-daily.md Step 4c, owner
 * direction 2026-10-03), but that carve-out lived only in the playbook, not
 * in the charter text itself — so the voice-gate kept reading a bare
 * caption URL as "pointing at a PDP" and REVISEd it. This guards against the
 * charter text regressing back to silence on it, which is the actual
 * defect: no code change could have caught this, since the model was doing
 * exactly what the charter it was given said.
 */
import { describe, expect, it } from 'vitest'
import { EMMA_VOICE_SOCIAL } from './emma-voice.server'

describe('EMMA_VOICE_SOCIAL (#15386)', () => {
  it('carves out a plain /notebook/ or /new URL from the "never points at a PDP" rule', () => {
    expect(EMMA_VOICE_SOCIAL).toMatch(/\/notebook\/<slug>/)
    expect(EMMA_VOICE_SOCIAL).toMatch(/\/new/)
    expect(EMMA_VOICE_SOCIAL).toMatch(/not.{0,40}(a |the )?sale attempt/i)
  })

  it('still states the PDP link stays banned, so the carve-out cannot read as "any URL is fine"', () => {
    expect(EMMA_VOICE_SOCIAL).toMatch(/\/products\/.{0,60}BLOCK/)
  })
})

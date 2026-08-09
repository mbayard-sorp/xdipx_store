/**
 * expandVariantSet is the pure heart of the batch engine: the cartesian
 * expansion, the {{hook}} substitution contract, and the guarantee that the
 * base script is never mutated all live here.
 */

import { describe, expect, it } from 'vitest'
import { expandVariantSet } from '~/lib/video-variants'
import type { VideoScriptJson } from '../../db/schema'

const base: VideoScriptJson = {
  hook: 'original hook',
  presenterLine: 'Here is the thing. {{hook}} Really.',
  voiceover: 'VO: {{hook}}',
  motionPrompt: 'camera holds while she says {{hook}}',
  framePrompt: 'archetype C, no product',
  cta: 'Take a peek',
}

describe('expandVariantSet', () => {
  it('expands 3 hooks into 3 variants with axes recorded', () => {
    const out = expandVariantSet({ baseScriptJson: base, hooks: ['A', 'B', 'C'], durationSeconds: 5 })
    expect(out).toHaveLength(3)
    expect(out.map(v => v.axes)).toEqual([{ hook: 'A' }, { hook: 'B' }, { hook: 'C' }])
    expect(out.map(v => v.scriptJson.hook)).toEqual(['A', 'B', 'C'])
  })

  it('takes the cartesian product across hook and scene axes', () => {
    const out = expandVariantSet({
      baseScriptJson: base,
      hooks: ['A', 'B'],
      sceneSlugs: ['couch-cozy', 'vanity-bright'],
      durationSeconds: 5,
    })
    expect(out).toHaveLength(4)
    expect(out.map(v => v.axes)).toEqual([
      { hook: 'A', sceneSlug: 'couch-cozy' },
      { hook: 'A', sceneSlug: 'vanity-bright' },
      { hook: 'B', sceneSlug: 'couch-cozy' },
      { hook: 'B', sceneSlug: 'vanity-bright' },
    ])
    expect(out[0]!.scriptJson.sceneSlug).toBe('couch-cozy')
    expect(out[1]!.scriptJson.sceneSlug).toBe('vanity-bright')
  })

  it('substitutes the {{hook}} token in presenterLine, voiceover, and motionPrompt', () => {
    const [v] = expandVariantSet({ baseScriptJson: base, hooks: ['Ten seconds.'], durationSeconds: 5 })
    expect(v!.scriptJson.presenterLine).toBe('Here is the thing. Ten seconds. Really.')
    expect(v!.scriptJson.voiceover).toBe('VO: Ten seconds.')
    expect(v!.scriptJson['motionPrompt']).toBe('camera holds while she says Ten seconds.')
  })

  it('changes only the hook field when the base carries no token', () => {
    const plain: VideoScriptJson = { hook: 'x', voiceover: 'steady narration', framePrompt: 'B color-block' }
    const [v] = expandVariantSet({ baseScriptJson: plain, hooks: ['fresh'], durationSeconds: 10 })
    expect(v!.scriptJson.hook).toBe('fresh')
    expect(v!.scriptJson.voiceover).toBe('steady narration')
    expect(v!.scriptJson['framePrompt']).toBe('B color-block')
  })

  it('writes durationSeconds into every variant (and omits it for avatar sets passing 0)', () => {
    const timed = expandVariantSet({ baseScriptJson: base, hooks: ['A', 'B'], durationSeconds: 10 })
    expect(timed.every(v => v.scriptJson.durationSeconds === 10)).toBe(true)
    const avatar = expandVariantSet({ baseScriptJson: base, hooks: ['A'], durationSeconds: 0 })
    expect(avatar[0]!.scriptJson).not.toHaveProperty('durationSeconds')
  })

  it('carries the presenters axis through to presenter and axes', () => {
    const out = expandVariantSet({
      baseScriptJson: base,
      hooks: ['A'],
      presenters: ['emma', 'friend:mae'],
      durationSeconds: 5,
    })
    expect(out.map(v => v.presenter)).toEqual(['emma', 'friend:mae'])
    expect(out.map(v => v.axes.presenter)).toEqual(['emma', 'friend:mae'])
  })

  it('never mutates the base script', () => {
    const frozen = JSON.stringify(base)
    expandVariantSet({ baseScriptJson: base, hooks: ['A', 'B'], sceneSlugs: ['couch-cozy'], durationSeconds: 5 })
    expect(JSON.stringify(base)).toBe(frozen)
  })

  it('rejects an empty hooks list', () => {
    expect(() => expandVariantSet({ baseScriptJson: base, hooks: ['  '], durationSeconds: 5 })).toThrow(/hook/)
  })
})

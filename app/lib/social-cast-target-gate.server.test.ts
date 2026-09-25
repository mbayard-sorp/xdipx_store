import { describe, expect, it } from 'vitest'
import { checkCastTargetMatch, type BodyPresentation } from './social-cast-target-gate.server'

function roster(entries: Record<string, BodyPresentation | null>): Map<string, BodyPresentation | null> {
  return new Map(Object.entries(entries))
}

describe('checkCastTargetMatch', () => {
  it('always passes universal, regardless of cast', () => {
    expect(checkCastTargetMatch('universal', [], new Map()).pass).toBe(true)
    expect(checkCastTargetMatch('universal', ['marcus'], roster({ marcus: 'masculine' })).pass).toBe(true)
  })

  it('DONE WHEN: blocks a male-presenting solo cast member with a female-classified product', () => {
    const result = checkCastTargetMatch('female', ['marcus'], roster({ marcus: 'masculine' }))
    expect(result.pass).toBe(false)
    expect(result.reason).toMatch(/marcus/)
  })

  it('DONE WHEN: passes the same product in an other-held two-cast frame with a matching member', () => {
    const result = checkCastTargetMatch('female', ['marcus', 'maya'], roster({ marcus: 'masculine', maya: 'feminine' }))
    expect(result.pass).toBe(true)
  })

  it('passes a solo cast member whose presentation matches', () => {
    expect(checkCastTargetMatch('female', ['maya'], roster({ maya: 'feminine' })).pass).toBe(true)
    expect(checkCastTargetMatch('male', ['marcus'], roster({ marcus: 'masculine' })).pass).toBe(true)
  })

  it('blocks a two-cast frame where NEITHER member matches', () => {
    const result = checkCastTargetMatch('male', ['maya', 'sofia'], roster({ maya: 'feminine', sofia: 'feminine' }))
    expect(result.pass).toBe(false)
  })

  it('fails closed on a null (unclassified) product', () => {
    const result = checkCastTargetMatch(null, ['marcus'], roster({ marcus: 'masculine' }))
    expect(result.pass).toBe(false)
    expect(result.reason).toMatch(/no xdipx\.cast_target/)
  })

  it('fails closed when a non-universal product names no cast', () => {
    const result = checkCastTargetMatch('female', [], new Map())
    expect(result.pass).toBe(false)
  })

  it('fails closed on a cast member missing from the presentation map entirely', () => {
    const result = checkCastTargetMatch('female', ['newcomer'], new Map())
    expect(result.pass).toBe(false)
    expect(result.reason).toMatch(/no bodyPresentation on file/)
  })

  it('fails closed on a cast member with an explicitly recorded null presentation', () => {
    const result = checkCastTargetMatch('male', ['emma'], roster({ emma: null }))
    expect(result.pass).toBe(false)
  })
})

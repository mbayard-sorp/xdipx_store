import { describe, it, expect } from 'vitest'
import {
  decideMainCi,
  MAIN_CI_ABSENT_GRACE_MS,
  RED_CONCLUSIONS,
  NO_VERDICT_CONCLUSIONS,
  type MainCiFacts,
} from '~/lib/main-ci-watch.server'

const SHA = 'abc1234def5678901234567890abcdef12345678'
const OLD_SHA = '9999999999999999999999999999999999999999'

/** Reported-and-concluded is the common case; overrides carry the interesting bit. */
function facts(over: Partial<MainCiFacts> = {}): MainCiFacts {
  return {
    sha: SHA,
    conclusion: 'success',
    status: 'completed',
    runExists: true,
    ageMs: 0,
    alertedSha: null,
    ...over,
  }
}

describe('decideMainCi', () => {
  describe('green', () => {
    it('stays quiet on success', () => {
      const d = decideMainCi(facts())
      expect(d.action).toBe('quiet')
      expect(d.code).toBe('green')
    })

    it.each(['neutral', 'skipped'])('treats %s as benign rather than paging', (conclusion) => {
      expect(decideMainCi(facts({ conclusion })).action).toBe('quiet')
    })
  })

  describe('red', () => {
    it.each([...RED_CONCLUSIONS])('alerts on %s', (conclusion) => {
      const d = decideMainCi(facts({ conclusion }))
      expect(d.action).toBe('alert')
      expect(d.code).toBe('red')
      expect(d.reason).toContain(conclusion)
    })
  })

  describe('no verdict', () => {
    it.each([...NO_VERDICT_CONCLUSIONS])('separates %s from red, because no step ran', (conclusion) => {
      const d = decideMainCi(facts({ conclusion }))
      expect(d.action).toBe('alert')
      expect(d.code).toBe('no-verdict')
    })

    it('reports an unrecognised conclusion instead of guessing green or red', () => {
      const d = decideMainCi(facts({ conclusion: 'something_new_from_github' }))
      expect(d.action).toBe('alert')
      expect(d.code).toBe('no-verdict')
      expect(d.reason).toContain('something_new_from_github')
    })
  })

  describe('nothing reported yet', () => {
    it.each(['queued', 'in_progress'])('stays quiet while the run is %s', (status) => {
      const d = decideMainCi(facts({ conclusion: null, status }))
      expect(d.action).toBe('quiet')
      expect(d.code).toBe('pending')
    })

    it('stays quiet inside the grace window even with no run at all', () => {
      const d = decideMainCi(
        facts({ conclusion: null, status: null, runExists: false, ageMs: MAIN_CI_ABSENT_GRACE_MS - 1 }),
      )
      expect(d.action).toBe('quiet')
      expect(d.code).toBe('pending')
    })

    it('alerts once past the grace window when GitHub never created a run', () => {
      const d = decideMainCi(
        facts({ conclusion: null, status: null, runExists: false, ageMs: MAIN_CI_ABSENT_GRACE_MS + 1 }),
      )
      expect(d.action).toBe('alert')
      expect(d.code).toBe('missing')
      expect(d.reason).toContain('no workflow run exists')
    })

    it('alerts differently when runs exist but check never reported', () => {
      const d = decideMainCi(
        facts({ conclusion: null, status: null, runExists: true, ageMs: MAIN_CI_ABSENT_GRACE_MS + 1 }),
      )
      expect(d.action).toBe('alert')
      expect(d.code).toBe('missing')
      expect(d.reason).toContain('never reported')
    })

    it('a still-running check beats the grace window: status wins over silence', () => {
      const d = decideMainCi(
        facts({ conclusion: null, status: 'in_progress', runExists: true, ageMs: MAIN_CI_ABSENT_GRACE_MS * 10 }),
      )
      expect(d.action).toBe('quiet')
    })
  })

  describe('recovery', () => {
    it('recovers when a later commit goes green after an alert', () => {
      const d = decideMainCi(facts({ conclusion: 'success', alertedSha: OLD_SHA }))
      expect(d.action).toBe('recover')
      expect(d.code).toBe('recovered')
      expect(d.reason).toContain(OLD_SHA.slice(0, 8))
    })

    it('also recovers when the SAME commit goes green, which is what a re-run looks like', () => {
      const d = decideMainCi(facts({ conclusion: 'success', alertedSha: SHA }))
      expect(d.action).toBe('recover')
    })

    it('does not recover twice: a green with no outstanding alert is just quiet', () => {
      expect(decideMainCi(facts({ conclusion: 'success', alertedSha: null })).action).toBe('quiet')
    })

    it('does not recover while still red', () => {
      const d = decideMainCi(facts({ conclusion: 'failure', alertedSha: OLD_SHA }))
      expect(d.action).toBe('alert')
      expect(d.code).toBe('red')
    })
  })

  it('never returns an action outside the known set', () => {
    const cases: Array<Partial<MainCiFacts>> = [
      { conclusion: 'success' },
      { conclusion: 'failure' },
      { conclusion: 'cancelled' },
      { conclusion: null, status: 'queued' },
      { conclusion: null, status: null, runExists: false, ageMs: 10 ** 9 },
      { conclusion: 'success', alertedSha: OLD_SHA },
    ]
    for (const c of cases) {
      expect(['quiet', 'alert', 'recover']).toContain(decideMainCi(facts(c)).action)
    }
  })
})

import { describe, it, expect } from 'vitest'
import {
  decideMainCi,
  MAIN_CI_ABSENT_GRACE_MS,
  RED_CONCLUSIONS,
  NO_VERDICT_CONCLUSIONS,
  renderMainCiAlert,
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

  describe('probe safety', () => {
    // A probe passes alertedSha: null. These lock in that the decision layer
    // cannot then produce a `recover`, which is what would arm a spurious
    // "main is green again" email against a commit that was never main.
    it('cannot recover when alertedSha is null, even on a green commit', () => {
      expect(decideMainCi(facts({ conclusion: 'success', alertedSha: null })).action).toBe('quiet')
    })

    it('still reports a real red verdict with alertedSha null', () => {
      const d = decideMainCi(facts({ conclusion: 'failure', alertedSha: null }))
      expect(d.action).toBe('alert')
      expect(d.code).toBe('red')
    })

    it('no input with alertedSha null can produce recover', () => {
      const conclusions = ['success', 'neutral', 'skipped', 'failure', 'cancelled', 'stale', null]
      for (const conclusion of conclusions) {
        for (const status of ['completed', 'queued', 'in_progress', null]) {
          for (const ageMs of [0, MAIN_CI_ABSENT_GRACE_MS + 1]) {
            const d = decideMainCi(facts({ conclusion, status, ageMs, alertedSha: null }))
            expect(d.action).not.toBe('recover')
          }
        }
      }
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

describe('renderMainCiAlert', () => {
  const SHA_RED = '74984bb72170be68707a77979d9f951398403b35'
  const args = ['red', SHA_RED, 'check concluded failure', 'a commit subject\n\nand a body', null] as const

  it('marks a probe unmistakably', () => {
    expect(renderMainCiAlert(...args, true)).toContain('PROBE, not a real alert')
  })

  it('never marks a real alert as a probe', () => {
    expect(renderMainCiAlert(...args, false)).not.toContain('PROBE')
  })

  it('is byte-identical to the real alert once the banner is removed', () => {
    // The whole point of a probe is to show what production would send, so the
    // banner must be purely additive. If this ever fails, the probe stops being
    // evidence about the real thing.
    const probe = renderMainCiAlert(...args, true)
    const real = renderMainCiAlert(...args, false)
    expect(probe.replace(/<div style="background:#FFE6DD[\s\S]*?<\/div>/, '')).toBe(real)
  })

  it('uses only the first line of the commit message', () => {
    const html = renderMainCiAlert(...args, false)
    expect(html).toContain('a commit subject')
    expect(html).not.toContain('and a body')
  })

  it('escapes commit messages rather than interpolating markup', () => {
    const html = renderMainCiAlert('red', SHA_RED, 'r', '<img src=x onerror=alert(1)>', null, false)
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('omits the run link when there is no url', () => {
    expect(renderMainCiAlert(...args, false)).not.toContain('View the run')
  })
})

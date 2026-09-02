import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ESCALATION_CLASSES,
  ESCALATION_CLASS_NAMES,
  PAGING_CLASSES,
  escalationChannel,
  escalationLaneTeam,
  isEscalationClass,
  isPagingClass,
} from '~/lib/owner-escalation'

const REPO_ROOT = join(import.meta.dirname, '..', '..')

/**
 * Every real call site, found by grepping the tree rather than by keeping a
 * list here.
 *
 * A hand-maintained list would have exactly the failure mode this whole file
 * exists to fix: it drifts, nobody notices, and the rule quietly stops applying
 * to the newest call site. Deriving it from source means a new sender either
 * appears in these assertions or does not exist.
 */
function callSites(fn: 'sendOwnerEmail' | 'sendOwnerSms'): string[] {
  let out = ''
  try {
    out = execFileSync(
      'git',
      ['grep', '-n', '-E', `${fn}\\(`, '--', 'app', 'server', 'scripts'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
  } catch {
    // git grep exits 1 on no matches.
    return []
  }
  return out
    .split('\n')
    .filter(Boolean)
    // The definitions themselves, the type-only re-exports, and tests are not
    // call sites.
    .filter((l) => !l.startsWith('app/lib/owner-alerts.server.ts:'))
    .filter((l) => !l.includes('.test.ts'))
    .filter((l) => !/^\S+:\d+:\s*(import|export)\b/.test(l))
    // `deps.sendOwnerEmail` and injected fakes route through the same signature.
    .filter((l) => !/sendOwnerEmail,\s*$/.test(l))
}

describe('the escalation class registry', () => {
  it('lets exactly two classes reach a phone', () => {
    // Owner decision: email + SMS for the money path only. The number is not
    // sacred; what matters is that adding a third is a visible, reviewed edit
    // to this file rather than a call site quietly deciding it qualifies.
    const paging = ESCALATION_CLASS_NAMES.filter((n) => escalationChannel(n) === 'page')
    expect(paging.sort()).toEqual(['money-path-down', 'storefront-down'])
    expect([...PAGING_CLASSES].sort()).toEqual(paging.sort())
  })

  it('agrees between the PagingClass union and the channel data', () => {
    // Two sources of truth for "may this page?" — the type (which stops a bad
    // SMS at compile time) and the channel (which stops a bad suppression at
    // the sender). They must not drift.
    for (const name of ESCALATION_CLASS_NAMES) {
      expect(isPagingClass(name), name).toBe(escalationChannel(name) === 'page')
    }
  })

  it('gives every lane class a team to file at, and no other class one', () => {
    // Invariant 3: a breach files a ticket at the owning lane, never an email
    // to the owner. A `lane` class with no team has nowhere to file, which
    // would silently become "drop it".
    for (const name of ESCALATION_CLASS_NAMES) {
      const team = escalationLaneTeam(name)
      if (escalationChannel(name) === 'lane') expect(team, name).toBeTruthy()
      else expect(team, name).toBeNull()
    }
  })

  it('explains why every class sits in its channel', () => {
    for (const name of ESCALATION_CLASS_NAMES) {
      expect(ESCALATION_CLASSES[name].why.length, name).toBeGreaterThan(40)
    }
  })

  it('rejects an unknown class name', () => {
    expect(isEscalationClass('made-up')).toBe(false)
    expect(isPagingClass('daily-digest')).toBe(false)
  })
})

describe('every owner-alert call site declares a class', () => {
  it('finds the call sites at all', () => {
    // Guards the guard: if the grep silently stopped matching, every assertion
    // below would pass vacuously, which is the quietest way for this file to
    // stop doing its job.
    expect(callSites('sendOwnerEmail').length).toBeGreaterThan(10)
  })

  it('passes an `escalation` on every sendOwnerEmail call', () => {
    // The compiler already enforces this — the parameter is required. The test
    // exists because the compiler cannot say WHICH class, and a reader of this
    // list can: it is the one place the estate's whole interrupt surface is
    // visible at once.
    const missing = callSites('sendOwnerEmail')
      .filter((l) => /sendOwnerEmail\(/.test(l))
      // Multi-line calls carry the class on a later line, so read the file.
      .filter((line) => {
        const [file] = line.split(':')
        const src = readFileSync(join(REPO_ROOT, file!), 'utf8')
        return !src.includes('escalation:')
      })
    expect(missing).toEqual([])
  })

  it('never lets log-monitor reach the owner at all', () => {
    // This started as "never lets log-monitor reach a phone", when it held an
    // SMS hook while producing zero log-derived tickets in its lifetime. Stage
    // G3 deleted the classifier outright, and the first-detection email went
    // with it: the email was tied to opening a GitHub issue for a P0 group, and
    // the only remaining source of groups emits P1 by construction. So the
    // assertion widens from "no SMS" to "no owner channel of any kind", and the
    // `runtime-errors` class is gone with its last producer.
    //
    // The call, not the mention: the file carries comments explaining why these
    // are gone, and an assertion that cannot tell those apart is a tripwire for
    // its own documentation.
    const src = readFileSync(join(REPO_ROOT, 'app/lib/log-monitor.server.ts'), 'utf8')
    expect(src).not.toMatch(/\bsendOwnerSms\s*\(/)
    expect(src).not.toMatch(/\bsendOwnerEmail\s*\(/)
    expect(isEscalationClass('runtime-errors')).toBe(false)
  })

  it('only pages from the money path and the storefront', () => {
    const smsFiles = new Set(
      callSites('sendOwnerSms')
        .map((l) => l.split(':')[0]!)
        .filter((f) => !f.endsWith('owner-escalation.ts')),
    )
    expect([...smsFiles].sort()).toEqual([
      'app/lib/checkout-probe.server.ts',
      'app/lib/homepage-healthcheck.server.ts',
      'app/lib/purchase-watcher.server.ts',
    ])
  })
})

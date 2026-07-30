// Unit tests for the out-of-band merge sweep.
//
// The database here is PRODUCTION, so nothing in this file may reach it. Only
// the pure decision layer is exercised; the query and transition paths are
// integration surface, verified by watching the first live sweep instead.
import { describe, expect, it, vi } from 'vitest'

// Same discipline as team-tickets.test.ts: stub every module that would open a
// connection or reach GitHub, so importing the module under test is inert.
vi.mock('~/lib/db.server', () => ({ db: {} }))
vi.mock('~/lib/github.server', () => ({ getPullRequest: vi.fn() }))
vi.mock('~/lib/release-engine.server', () => ({ prNumberFromRef: vi.fn() }))
vi.mock('~/lib/team.server', () => ({ transitionSuggestion: vi.fn() }))

import {
  isMergedOutOfBand,
  SWEEP_MAX_TICKETS,
  SWEEP_MIN_AGE_MINUTES,
} from '~/lib/ticket-out-of-band-sweep.server'

describe('isMergedOutOfBand', () => {
  it('closes a ticket only when GitHub itself reports the PR merged', () => {
    expect(isMergedOutOfBand({ merged: true })).toBe(true)
    expect(isMergedOutOfBand({ merged: false })).toBe(false)
  })

  it('never infers a merge from a missing or malformed flag', () => {
    // The whole safety property of this sweep is that it cannot mark unmerged
    // work as shipped, so anything that is not a literal true stays closed.
    expect(isMergedOutOfBand({ merged: undefined as unknown as boolean })).toBe(false)
    expect(isMergedOutOfBand({ merged: null as unknown as boolean })).toBe(false)
    expect(isMergedOutOfBand({ merged: 'true' as unknown as boolean })).toBe(false)
    expect(isMergedOutOfBand({ merged: 1 as unknown as boolean })).toBe(false)
  })
})

describe('sweep bounds', () => {
  it('caps the tickets one sweep may touch', () => {
    // Bounds the GitHub calls a single cycle can make, which matters because
    // the token has already failed silently once.
    expect(SWEEP_MAX_TICKETS).toBeGreaterThan(0)
    expect(SWEEP_MAX_TICKETS).toBeLessThanOrEqual(10)
  })

  it('leaves the engine a grace period to merge normally first', () => {
    // Sweeping immediately would race the engine's own merge path and re-query
    // PRs that are about to be handled properly.
    expect(SWEEP_MIN_AGE_MINUTES).toBeGreaterThanOrEqual(30)
  })
})

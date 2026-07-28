// Unit tests for the pure dedupe-key construction used by every detector.
// The DB-writing half (fileDetectionTicket) is deliberately not exercised here:
// it writes to the production improvement bus, and its contract is "never
// throws", which is enforced by construction rather than by a test double.
import { describe, it, expect, vi } from 'vitest'

// The module under test imports the improvement bus and the Neon client at
// module scope. Stub both so importing it can never open a connection to the
// production database from a test run.
vi.mock('~/lib/team.server', () => ({ createSuggestion: vi.fn() }))
vi.mock('~/lib/db.server', () => ({ db: {} }))

import {
  MAX_DEDUPE_KEY_LENGTH,
  hashToken,
  makeDedupeKey,
  priorityFromSeverity,
} from './detection-tickets.server'

describe('priorityFromSeverity', () => {
  it('maps the detector severity labels onto ticket priorities', () => {
    expect(priorityFromSeverity('P0')).toBe(1)
    expect(priorityFromSeverity('P1')).toBe(2)
    expect(priorityFromSeverity('P2')).toBe(3)
    expect(priorityFromSeverity('P3')).toBe(4)
  })

  it('falls back to the default priority for anything unrecognised', () => {
    expect(priorityFromSeverity('urgent')).toBe(3)
    expect(priorityFromSeverity('')).toBe(3)
  })
})

describe('hashToken', () => {
  it('is deterministic, which is the whole requirement for dedupe', () => {
    expect(hashToken('FUNCTION_INVOCATION_FAILED on /api/cart')).toBe(
      hashToken('FUNCTION_INVOCATION_FAILED on /api/cart'),
    )
  })

  it('separates different signals', () => {
    expect(hashToken('TypeError in cart')).not.toBe(hashToken('TypeError in checkout'))
  })

  it('emits a key-safe token', () => {
    expect(hashToken('anything at all ♥')).toMatch(/^[a-z0-9]+$/)
  })
})

describe('makeDedupeKey', () => {
  it('builds the documented namespaced keys', () => {
    expect(makeDedupeKey('render', 'rails', '2026-07-27')).toBe('render:rails:2026-07-27')
    expect(makeDedupeKey('sameness', 'hero')).toBe('sameness:hero')
    expect(makeDedupeKey('probe', 'http', 'checkout-page')).toBe('probe:http:checkout-page')
    expect(makeDedupeKey('notebook', '/notebook/some-post')).toBe('notebook:/notebook/some-post')
  })

  it('lowercases and collapses unsafe characters', () => {
    expect(makeDedupeKey('LogMon', 'Cannot find module "x"')).toBe('logmon:cannot-find-module-x')
  })

  it('drops empty and nullish parts instead of emitting double separators', () => {
    expect(makeDedupeKey('render', null, 'hero', undefined, '')).toBe('render:hero')
  })

  it('never exceeds the varchar(64) column', () => {
    const key = makeDedupeKey('logmon', 'x'.repeat(200))
    expect(key.length).toBeLessThanOrEqual(MAX_DEDUPE_KEY_LENGTH)
  })

  it('keeps long keys that share a prefix distinct', () => {
    const a = makeDedupeKey('logmon', `${'y'.repeat(80)}-alpha`)
    const b = makeDedupeKey('logmon', `${'y'.repeat(80)}-beta`)
    expect(a).not.toBe(b)
    expect(a.length).toBeLessThanOrEqual(MAX_DEDUPE_KEY_LENGTH)
    expect(b.length).toBeLessThanOrEqual(MAX_DEDUPE_KEY_LENGTH)
  })

  it('is stable across calls so a recurring signal reuses one ticket', () => {
    expect(makeDedupeKey('logmon', hashToken('same error'))).toBe(
      makeDedupeKey('logmon', hashToken('same error')),
    )
  })
})

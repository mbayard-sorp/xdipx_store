// Ticket #11856: remoteVisionCallVision/visionDepsForEnv gained an optional
// `team` param so a caller other than the Notebook hero path (which always
// omits it, gating the remote route's fallback to 'content') can gate on its
// own team's budget/run-lock instead. Covers the plumbing directly; the
// content-default behavior is already covered by
// scripts/gen-notebook-art.test.ts and must stay unchanged.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyVisionPreflightFailure, remoteVisionCallVision, runVisionGatePreflight } from './vision-gate-buffer.server'

const CLEAN_VERDICT = {
  pass: true,
  checks: {
    limbCount: 'pass', handAnatomy: 'pass', faceBodyIntegrity: 'pass', extraOrMergedLimbs: 'pass',
    nippleOccluded: 'pass', genitaliaAbsent: 'pass', anusNotVisible: 'pass', adultUnambiguous: 'pass',
  },
  notes: 'clean',
  checkedAt: '2026-09-28T00:00:00.000Z',
  checkCompleted: true,
  legibleText: '',
  skinMarks: '',
  productPhysics: 'not_applicable',
  handDigitCounts: [],
  backAnatomyRead: '',
}

describe('remoteVisionCallVision team plumbing (ticket #11856)', () => {
  const realFetch = global.fetch

  afterEach(() => {
    vi.unstubAllEnvs()
    global.fetch = realFetch
  })

  it('omits team from the POST body when none is given, preserving the content default', async () => {
    vi.stubEnv('TEAM_TOKEN', 'test-team-token')
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string)
      expect(body.team).toBeUndefined()
      return new Response(JSON.stringify(CLEAN_VERDICT), { status: 200 })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const callVision = remoteVisionCallVision(1099)
    await callVision('abc', 'image/png')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('includes team and runId in the POST body when both are given', async () => {
    vi.stubEnv('TEAM_TOKEN', 'test-team-token')
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string)
      expect(body.team).toBe('homepage')
      expect(body.runId).toBe(1099)
      return new Response(JSON.stringify(CLEAN_VERDICT), { status: 200 })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const callVision = remoteVisionCallVision(1099, 'homepage')
    await callVision('abc', 'image/png')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// Ticket #12371. Content runs 818 and 1142 each discovered the hero vision
// gate's one Anthropic dependency could not complete a check only after
// spending a whole draft's worth of budget: once for a missing credential,
// once for an empty balance. classifyVisionPreflightFailure and
// runVisionGatePreflight let a routine catch either case cheaply and tell
// them apart, since the fix for each is different (an env var vs a top-up).
describe('classifyVisionPreflightFailure (ticket #12371)', () => {
  it('classifies a missing/invalid credential', () => {
    // Real message this module's own default callVision throws when
    // ANTHROPIC_API_KEY is unset (see gen-notebook-art.test.ts's identical
    // fixture for the auth-outage case).
    expect(classifyVisionPreflightFailure('Could not resolve authentication method. Expected either apiKey or authToken to be set.'))
      .toBe('no-credential')
    expect(classifyVisionPreflightFailure('vision-gate route could not complete the check: authentication_error: invalid x-api-key'))
      .toBe('no-credential')
  })

  it('classifies an empty account balance', () => {
    // Real Anthropic API error text for a zero/negative credit balance.
    expect(classifyVisionPreflightFailure('Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'))
      .toBe('no-credit')
  })

  it('classifies anything else as unknown, never guessing', () => {
    expect(classifyVisionPreflightFailure('Vision gate response did not match the expected verdict shape; failing closed.'))
      .toBe('unknown')
    expect(classifyVisionPreflightFailure('vision-gate route HTTP 500')).toBe('unknown')
  })

  it('classifies correctly through nested wrapper text, not just a bare message', () => {
    // getOneVerdict's incompleteVerdict wraps the underlying error as
    // "Vision gate check could not complete: <message>", and
    // remoteVisionCallVision can wrap that again; classification must see
    // through both layers rather than matching only an unwrapped string.
    const wrapped = 'Vision gate check could not complete: Could not resolve authentication method'
    expect(classifyVisionPreflightFailure(wrapped)).toBe('no-credential')
  })
})

describe('runVisionGatePreflight (ticket #12371)', () => {
  const realFetch = global.fetch

  afterEach(() => {
    vi.unstubAllEnvs()
    global.fetch = realFetch
  })

  it('reports ok:true when the remote check completes, regardless of the verdict', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('TEAM_TOKEN', 'test-team-token')
    global.fetch = vi.fn(async () => new Response(JSON.stringify(CLEAN_VERDICT), { status: 200 })) as unknown as typeof fetch

    const result = await runVisionGatePreflight()
    expect(result).toEqual({ ok: true })
  })

  it('reports a classified no-credential failure without throwing', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('TEAM_TOKEN', 'test-team-token')
    global.fetch = vi.fn(async () => { throw new Error('Could not resolve authentication method') }) as unknown as typeof fetch

    const result = await runVisionGatePreflight()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no-credential')
    expect(result.message).toContain('Could not resolve authentication method')
  })

  it('reports a classified no-credit failure without throwing', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('TEAM_TOKEN', 'test-team-token')
    global.fetch = vi.fn(async () => {
      throw new Error('Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.')
    }) as unknown as typeof fetch

    const result = await runVisionGatePreflight()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no-credit')
  })
})

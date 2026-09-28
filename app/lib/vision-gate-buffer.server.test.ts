// Ticket #11856: remoteVisionCallVision/visionDepsForEnv gained an optional
// `team` param so a caller other than the Notebook hero path (which always
// omits it, gating the remote route's fallback to 'content') can gate on its
// own team's budget/run-lock instead. Covers the plumbing directly; the
// content-default behavior is already covered by
// scripts/gen-notebook-art.test.ts and must stay unchanged.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { remoteVisionCallVision } from './vision-gate-buffer.server'

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

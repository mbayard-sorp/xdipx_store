// Ticket #13526 (split 1-of-3 off #13398): gateImageBuffer/gateProductFidelityBuffer
// already threaded `runId` through to the REMOTE fallback (visionDepsForEnv/
// fidelityDepsForEnv), but silently dropped it on the in-process call path —
// the branch taken whenever ANTHROPIC_API_KEY is present (owner/local/preview
// runs). This file isolates that one seam with its own mocks of the sibling
// gate modules, instead of adding them to vision-gate-buffer.server.test.ts,
// so the existing suite there (remote-path only, no @anthropic-ai/sdk mock)
// stays exactly as it was.
import { afterEach, describe, expect, it, vi } from 'vitest'

const { runVisionGateOnImageMock, runProductFidelityCheckOnImagesMock, defaultFetchImageBase64Mock } = vi.hoisted(() => ({
  runVisionGateOnImageMock: vi.fn(),
  runProductFidelityCheckOnImagesMock: vi.fn(),
  defaultFetchImageBase64Mock: vi.fn(),
}))
vi.mock('./social-vision-gate.server', () => ({
  runVisionGateOnImage: runVisionGateOnImageMock,
}))
vi.mock('./social-product-fidelity.server', () => ({
  runProductFidelityCheckOnImages: runProductFidelityCheckOnImagesMock,
  defaultFetchImageBase64: defaultFetchImageBase64Mock,
  hasFidelityDrift: () => false,
  failClosedVerdict: (notes: string) => ({
    silhouette: null, colour: null, finish: null, brandMark: null, notes, checkedAt: '2026-01-01T00:00:00.000Z', checkCompleted: false,
  }),
}))

import { gateImageBuffer, gateProductFidelityBuffer } from './vision-gate-buffer.server'

const CLEAN_VERDICT = {
  pass: true,
  checks: {
    limbCount: 'pass', handAnatomy: 'pass', faceBodyIntegrity: 'pass', extraOrMergedLimbs: 'pass',
    nippleOccluded: 'pass', genitaliaAbsent: 'pass', anusNotVisible: 'pass', adultUnambiguous: 'pass',
  },
  notes: 'clean',
  checkedAt: '2026-10-05T00:00:00.000Z',
  checkCompleted: true,
  legibleText: '',
  skinMarks: '',
  productPhysics: 'not_applicable',
  handDigitCounts: [],
  backAnatomyRead: '',
  frontWaistbandRead: '',
}

afterEach(() => {
  vi.unstubAllEnvs()
  runVisionGateOnImageMock.mockReset()
  runProductFidelityCheckOnImagesMock.mockReset()
  defaultFetchImageBase64Mock.mockReset()
})

describe('gateImageBuffer — in-process refId plumbing (#13526)', () => {
  it('passes runId (stringified) as refId when ANTHROPIC_API_KEY is present', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
    runVisionGateOnImageMock.mockResolvedValue(CLEAN_VERDICT)

    await gateImageBuffer(Buffer.from('fake-png-bytes'), undefined, 1234, 'content')

    expect(runVisionGateOnImageMock).toHaveBeenCalledTimes(1)
    const [, deps, refId] = runVisionGateOnImageMock.mock.calls[0]!
    expect(deps).toBeUndefined()
    expect(refId).toBe('1234')
  })

  it('passes refId as undefined when no runId is given', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
    runVisionGateOnImageMock.mockResolvedValue(CLEAN_VERDICT)

    await gateImageBuffer(Buffer.from('fake-png-bytes'))

    const [, , refId] = runVisionGateOnImageMock.mock.calls[0]!
    expect(refId).toBeUndefined()
  })
})

describe('gateProductFidelityBuffer — in-process refId plumbing (#13526)', () => {
  it('passes runId (stringified) as refId when ANTHROPIC_API_KEY is present', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
    defaultFetchImageBase64Mock.mockResolvedValue({ data: 'ref-b64', mediaType: 'image/jpeg' })
    runProductFidelityCheckOnImagesMock.mockResolvedValue({
      silhouette: 'match', colour: 'match', finish: 'match', brandMark: 'match',
      notes: 'faithful', checkedAt: '2026-10-05T00:00:00.000Z', checkCompleted: true,
    })

    await gateProductFidelityBuffer(Buffer.from('fake-png-bytes'), 'https://cdn.shopify.com/ref.jpg', undefined, 5678, 'content')

    expect(runProductFidelityCheckOnImagesMock).toHaveBeenCalledTimes(1)
    const [, , deps, refId] = runProductFidelityCheckOnImagesMock.mock.calls[0]!
    expect(deps).toBeUndefined()
    expect(refId).toBe('5678')
  })
})

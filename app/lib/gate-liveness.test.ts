import { describe, expect, it } from 'vitest'
import { evaluateGateLiveness } from '~/lib/gate-liveness'

// ticket #1302: run 176's voice gate went silent for 2h12m with no verdict and
// no error while a normal accuracy pass on identical text returned in 73s. These
// tests pin the stall/relaunch/exhausted decision table the routine now drives
// its liveness check with.

describe('evaluateGateLiveness', () => {
  it('reports live when the gate is well within the stall window', () => {
    expect(
      evaluateGateLiveness({
        launchedAt: '2026-08-04T17:17:00Z',
        lastActivityAt: '2026-08-04T17:20:00Z',
        now: '2026-08-04T17:25:00Z',
        attempt: 1,
      }),
    ).toEqual({ status: 'live' })
  })

  it('reports live right up to (but not at) the default 10-minute threshold', () => {
    expect(
      evaluateGateLiveness({
        launchedAt: '2026-08-04T17:17:00Z',
        lastActivityAt: '2026-08-04T17:17:44Z',
        now: '2026-08-04T17:27:43Z',
        attempt: 1,
      }),
    ).toEqual({ status: 'live' })
  })

  it('flags a first stall for relaunch, never as a verdict', () => {
    expect(
      evaluateGateLiveness({
        launchedAt: '2026-08-04T17:17:00Z',
        lastActivityAt: '2026-08-04T17:17:44Z',
        now: '2026-08-04T17:27:44Z',
        attempt: 1,
      }),
    ).toEqual({ status: 'stalled-relaunch' })
  })

  it('reflects the run-176 case: over two hours of silence stalls on the first attempt', () => {
    expect(
      evaluateGateLiveness({
        launchedAt: '2026-08-04T17:17:00Z',
        lastActivityAt: '2026-08-04T17:17:44Z',
        now: '2026-08-04T19:29:00Z',
        attempt: 1,
      }),
    ).toEqual({ status: 'stalled-relaunch' })
  })

  it('exhausts after the one permitted relaunch also stalls', () => {
    expect(
      evaluateGateLiveness({
        launchedAt: '2026-08-04T19:30:00Z',
        lastActivityAt: '2026-08-04T19:30:00Z',
        now: '2026-08-04T19:41:00Z',
        attempt: 2,
      }),
    ).toEqual({ status: 'stalled-exhausted' })
  })

  it('honors a custom stallMinutes override', () => {
    expect(
      evaluateGateLiveness({
        launchedAt: '2026-08-04T17:17:00Z',
        lastActivityAt: '2026-08-04T17:17:00Z',
        now: '2026-08-04T17:20:00Z',
        attempt: 1,
        stallMinutes: 2,
      }),
    ).toEqual({ status: 'stalled-relaunch' })
  })
})

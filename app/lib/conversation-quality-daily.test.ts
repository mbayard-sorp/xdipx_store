import { describe, it, expect } from 'vitest'
import { shapeChannelRow } from './conversation-quality-daily.server'

describe('shapeChannelRow', () => {
  it('coerces driver-returned strings to numbers', () => {
    // node-postgres returns bigint-shaped aggregate columns as strings.
    const row = shapeChannelRow({
      channel: 'sms',
      turns: '42',
      sessions: '17',
      fabrication_trips: '3',
      tool_budget_exhausted: '1',
      error_turns: '0',
      v2_fallback_count: '0',
      p50_latency_ms: '812',
      p95_latency_ms: '2104',
    })
    expect(row).toEqual({
      channel: 'sms',
      sessions: 17,
      turns: 42,
      fabricationTrips: 3,
      toolBudgetExhausted: 1,
      errorTurns: 0,
      v2FallbackCount: 0,
      p50LatencyMs: 812,
      p95LatencyMs: 2104,
    })
  })

  it('keeps latency percentiles null on an empty group rather than coercing to 0', () => {
    const row = shapeChannelRow({
      channel: 'voice',
      turns: '0',
      sessions: '0',
      fabrication_trips: '0',
      tool_budget_exhausted: '0',
      error_turns: '0',
      v2_fallback_count: '0',
      p50_latency_ms: null,
      p95_latency_ms: null,
    })
    expect(row.p50LatencyMs).toBeNull()
    expect(row.p95LatencyMs).toBeNull()
    // Counts still default to 0, not null, since count(*) FILTER never returns NULL.
    expect(row.turns).toBe(0)
  })

  it('rounds a fractional percentile_cont result rather than truncating', () => {
    const row = shapeChannelRow({ channel: 'web', p50_latency_ms: '811.6', p95_latency_ms: '2104.2' })
    expect(row.p50LatencyMs).toBe(812)
    expect(row.p95LatencyMs).toBe(2104)
  })

  it('never fabricates a positive count from garbage input', () => {
    const row = shapeChannelRow({ channel: 'web', turns: 'not-a-number' })
    expect(row.turns).toBe(0)
  })
})

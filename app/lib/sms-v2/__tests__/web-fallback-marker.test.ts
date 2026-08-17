/**
 * web-fallback-marker.test.ts
 *
 * Ticket #3915 (non-protected observability slice of #3518). Asserts that the
 * v2 -> v1 web fallback logs a distinguishable pipeline_version on the EXISTING
 * sms_turns column (no migration), so the silent-fallback rate is queryable.
 *
 * We mock ~/lib/db.server so no real database is touched and we can capture the
 * exact insert payload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  valuesSpy: vi.fn(),
  convId: 'conv-uuid-1' as string | null,
}))

vi.mock('~/lib/db.server', () => {
  const insertResult = () => {
    // Supports both `.values().returning()` (inbound) and `await .values()`
    // (outbound) — the outbound insert has no .returning().
    const p = Promise.resolve([{ id: 1 }])
    return Object.assign(p, { returning: () => Promise.resolve([{ id: 1 }]) })
  }
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(h.convId ? [{ conversationId: h.convId }] : []),
          }),
        }),
      }),
      insert: () => ({
        values: (v: unknown) => {
          h.valuesSpy(v)
          return insertResult()
        },
      }),
    },
  }
})

import { logWebFallbackTurn, logWebTurn } from '../web-turn-logger.server'

describe('v2 -> v1 web fallback marker (#3915)', () => {
  beforeEach(() => {
    h.valuesSpy.mockClear()
    h.convId = 'conv-uuid-1'
  })

  it('stamps pipeline_version = v1-web-fallback on the logged turn', async () => {
    await logWebFallbackTurn({
      sessionId: 'sess-abc',
      customerMsg: 'what do you recommend?',
      emmaMsg: "Here's a good place to start.",
      latencyMs: 42,
    })

    expect(h.valuesSpy).toHaveBeenCalled()
    const payloads = h.valuesSpy.mock.calls.map((c) => c[0] as Record<string, unknown>)
    // Every row this turn writes carries the fallback marker...
    expect(payloads.every((p) => p['pipelineVersion'] === 'v1-web-fallback')).toBe(true)
    // ...and it is a web turn, inbound + outbound (a reply was present).
    expect(payloads.some((p) => p['direction'] === 'inbound')).toBe(true)
    expect(payloads.some((p) => p['direction'] === 'outbound')).toBe(true)
    expect(payloads.every((p) => p['channel'] === 'web')).toBe(true)
  })

  it('leaves the normal web turn at v2-web (default unchanged)', async () => {
    await logWebTurn({
      sessionId: 'sess-abc',
      customerMsg: 'hi',
      emmaMsg: 'hey',
      latencyMs: 10,
      stageIn: 'DISCOVERY',
      stageOut: 'DISCOVERY',
      intent: 'RESEARCH',
      intentConfidence: 0.85,
    })
    const payloads = h.valuesSpy.mock.calls.map((c) => c[0] as Record<string, unknown>)
    expect(payloads.length).toBeGreaterThan(0)
    expect(payloads.every((p) => p['pipelineVersion'] === 'v2-web')).toBe(true)
  })

  it('is best-effort: no insert when the web_conversations row is missing', async () => {
    h.convId = null
    const id = await logWebFallbackTurn({
      sessionId: 'sess-none',
      customerMsg: 'hi',
      emmaMsg: 'hey',
      latencyMs: 10,
    })
    expect(id).toBeNull()
    expect(h.valuesSpy).not.toHaveBeenCalled()
  })
})

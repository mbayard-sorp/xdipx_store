import { describe, it, expect } from 'vitest'
import {
  runWithTurnDeadline,
  getTurnSignal,
  getTurnRemainingMs,
  isTurnAborted,
  DEFAULT_TURN_BUDGET_MS,
  SONNET_HOP_MIN_MS,
} from '../turn-deadline.server'

/** A stand-in for a slow LLM call that honors an AbortSignal. */
function slowLlmCall(ms: number, signal: AbortSignal | undefined, onResolve: () => void): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'))
    const t = setTimeout(() => {
      onResolve()
      resolve('llm reply')
    }, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    })
  })
}

describe('turn-deadline', () => {
  it('returns the result when the turn finishes inside the budget', async () => {
    const outcome = await runWithTurnDeadline(async () => {
      expect(getTurnSignal()).toBeInstanceOf(AbortSignal)
      expect(getTurnRemainingMs()).toBeGreaterThan(0)
      expect(getTurnRemainingMs()).toBeLessThanOrEqual(50)
      return 'done'
    }, 50)
    expect(outcome).toEqual({ timedOut: false, result: 'done' })
  })

  it('times out a slow turn inside the window and aborts the in-flight LLM call', async () => {
    let llmCompleted = false
    const budgetMs = 40
    const start = Date.now()

    const outcome = await runWithTurnDeadline(async () => {
      // A slow LLM call that would blow the window if not aborted.
      await slowLlmCall(500, getTurnSignal(), () => {
        llmCompleted = true
      })
      return 'reply'
    }, budgetMs)

    const elapsed = Date.now() - start
    // The caller gets control back inside the window, not after the 500ms call.
    expect(outcome.timedOut).toBe(true)
    expect(outcome.result).toBeUndefined()
    expect(elapsed).toBeLessThan(300)
    // The slow LLM call was aborted, so a best-effort reply is what ships.
    expect(llmCompleted).toBe(false)
  })

  it('propagates a genuine (non-timeout) rejection to the caller', async () => {
    await expect(
      runWithTurnDeadline(async () => {
        throw new Error('boom')
      }, 1000),
    ).rejects.toThrow('boom')
  })

  it('is a no-op outside a deadline scope', () => {
    expect(getTurnSignal()).toBeUndefined()
    expect(getTurnRemainingMs()).toBe(Infinity)
    expect(isTurnAborted()).toBe(false)
    // Infinity never trips the cooperative Sonnet-hop guard.
    expect(getTurnRemainingMs() < SONNET_HOP_MIN_MS).toBe(false)
  })

  it('exposes a sane default budget under Twilio’s ~15s webhook timeout', () => {
    expect(DEFAULT_TURN_BUDGET_MS).toBeLessThan(15_000)
    expect(DEFAULT_TURN_BUDGET_MS).toBeGreaterThan(0)
  })
})

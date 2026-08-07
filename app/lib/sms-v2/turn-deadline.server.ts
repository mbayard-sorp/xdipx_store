/**
 * app/lib/sms-v2/turn-deadline.server.ts
 *
 * Per-turn deadline budget for the SMS v2 pipeline (conv-audit C4b / M9).
 *
 * A single inbound turn can run a Haiku intent call, a Haiku slot call, and up
 * to three Sonnet tool hops, interleaved with Sanity/Shopify round-trips — with
 * no deadline anywhere. Twilio's inbound webhook times out around 15s, and
 * exceeding it is a carrier-visible failure plus an automatic retry (a second,
 * duplicate turn).
 *
 * This module carries a per-turn AbortSignal + deadline in an AsyncLocalStorage
 * so LLM call sites can honor it without threading a parameter through every
 * function in the pipeline. Two mechanisms use it:
 *
 *   1. Cooperative: before starting another expensive call (e.g. the next Sonnet
 *      tool hop) a call site checks `getTurnRemainingMs()` and bails to a
 *      best-effort reply when the budget is nearly spent.
 *   2. Hard stop: `runWithTurnDeadline` races the whole turn against the budget.
 *      On timeout it aborts the shared signal (so signal-aware `messages.create`
 *      calls stop in flight) and reports `timedOut`, so the processor can send a
 *      best-effort reply inside the window instead of letting the webhook hang.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Total per-turn budget. Well under Twilio's ~15s webhook timeout so the reply,
 * its TwiML serialization, and the return network hop all still land in the
 * window. Sized for one full turn (intent + slots + up to 3 Sonnet hops).
 */
export const DEFAULT_TURN_BUDGET_MS = 12_000

/**
 * Minimum budget required to start another Sonnet tool hop. A single hop can
 * take multiple seconds; starting one with less than this left risks blowing
 * the window, so the loop bails to safeFallback instead.
 */
export const SONNET_HOP_MIN_MS = 2_500

interface TurnDeadlineStore {
  signal: AbortSignal
  deadlineAt: number
}

const storage = new AsyncLocalStorage<TurnDeadlineStore>()

/** Sentinel resolved by the deadline timer; never a valid turn result. */
const TIMEOUT = Symbol('turn-timeout')

export interface TurnDeadlineOutcome<T> {
  timedOut: boolean
  result?: T
}

/**
 * Run `fn` under a per-turn deadline. Resolves as soon as `fn` resolves, or as
 * soon as the budget elapses — whichever comes first.
 *
 *   - `fn` resolves in time  → `{ timedOut: false, result }`.
 *   - budget elapses first   → abort the shared signal, `{ timedOut: true }`.
 *   - `fn` rejects in time    → this call rejects (a genuine error, not a
 *                               timeout — the caller's own catch handles it).
 *
 * The abandoned `fn` promise is swallowed so an abort-triggered late rejection
 * never surfaces as an unhandled rejection; nothing reads its value after a
 * timeout.
 */
export async function runWithTurnDeadline<T>(
  fn: () => Promise<T>,
  budgetMs: number = DEFAULT_TURN_BUDGET_MS,
): Promise<TurnDeadlineOutcome<T>> {
  const controller = new AbortController()
  const store: TurnDeadlineStore = {
    signal: controller.signal,
    deadlineAt: Date.now() + budgetMs,
  }

  const work = storage.run(store, fn)
  // Second, silent consumer: if the work rejects after we've already timed out
  // (e.g. its in-flight request aborts), don't let it become an unhandled
  // rejection. The race below still sees a same-tick rejection as a real error.
  work.catch(() => {})

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), budgetMs)
  })

  try {
    const winner = await Promise.race([work, timeout])
    if (winner === TIMEOUT) {
      controller.abort()
      return { timedOut: true }
    }
    return { timedOut: false, result: winner as T }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** The current turn's AbortSignal, or undefined outside a deadline scope. */
export function getTurnSignal(): AbortSignal | undefined {
  return storage.getStore()?.signal
}

/**
 * Milliseconds left in the current turn's budget, or Infinity outside a
 * deadline scope (so callers without a deadline never bail early).
 */
export function getTurnRemainingMs(): number {
  const store = storage.getStore()
  return store ? Math.max(0, store.deadlineAt - Date.now()) : Infinity
}

/** True once the current turn's deadline has aborted. */
export function isTurnAborted(): boolean {
  return storage.getStore()?.signal.aborted === true
}

import { kvGet, kvIncr, kvSet } from './kv.server'

// Per-session caps. A casual shopper sends 5–10 turns; 30 turns or 20k tokens
// covers any legitimate browsing pattern with margin and stops a runaway loop.
const SESSION_TURN_CAP = 30
const SESSION_TOKEN_CAP = 20_000
const SESSION_TTL_SECONDS = 60 * 60 * 6 // 6h rolling window

// Global wallet ceiling. Tuned for Haiku 4.5 ($1/MTok in, $5/MTok out) — 5M
// tokens at the typical 4:1 in:out mix is ~$10/day. Raise once we have real
// traffic data; it's the kill-switch, not the budget.
const DAILY_TOKEN_CEILING = 5_000_000

export type BudgetReservation =
  | { ok: true; turnsUsed: number; tokensUsed: number }
  | { ok: false; reason: 'turn_cap' | 'token_cap' }

const tokenKey = (sessionId: number | string) => `emma:budget:tok:${sessionId}`
const turnKey = (sessionId: number | string) => `emma:budget:turn:${sessionId}`
const dailyKey = (utcDate: string) => `emma:budget:global:${utcDate}`

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Reserve one turn for this session. Increments the turn counter (so two
 * concurrent requests can't both squeak in under the cap) and reads the
 * current token total. Caller records actual token usage after the LLM call.
 */
export async function reserveSessionBudget(sessionId: number | string): Promise<BudgetReservation> {
  // Dev bypass: local testing of the gate machine + explainers easily blows
  // through the 20k-token cap in 2-3 turns once the system prompt + gate
  // context block are accounted for. The cap is a production cost control,
  // not a correctness check.
  if (process.env['NODE_ENV'] !== 'production') {
    return { ok: true, turnsUsed: 0, tokensUsed: 0 }
  }
  try {
    const turnsUsed = await kvIncr(turnKey(sessionId))
    if (turnsUsed === 1) await kvSet(turnKey(sessionId), turnsUsed, SESSION_TTL_SECONDS)
    if (turnsUsed > SESSION_TURN_CAP) return { ok: false, reason: 'turn_cap' }

    const tokensUsed = (await kvGet<number>(tokenKey(sessionId))) ?? 0
    if (tokensUsed >= SESSION_TOKEN_CAP) return { ok: false, reason: 'token_cap' }
    return { ok: true, turnsUsed, tokensUsed }
  } catch {
    // Fail open — KV hiccups shouldn't take chat down. BotID + IP rate limit
    // are still in front of us.
    return { ok: true, turnsUsed: 0, tokensUsed: 0 }
  }
}

export async function recordSessionUsage(
  sessionId: number | string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  try {
    const total = inputTokens + outputTokens
    if (total <= 0) return
    await kvIncrBy(tokenKey(sessionId), total, SESSION_TTL_SECONDS)
  } catch {
    // best-effort accounting
  }
}

/** Returns false when today's global token budget is exhausted. */
export async function isWithinDailyCeiling(): Promise<boolean> {
  try {
    const used = (await kvGet<number>(dailyKey(todayUtc()))) ?? 0
    return used < DAILY_TOKEN_CEILING
  } catch {
    return true
  }
}

export async function recordDailyUsage(inputTokens: number, outputTokens: number): Promise<void> {
  try {
    const total = inputTokens + outputTokens
    if (total <= 0) return
    await kvIncrBy(dailyKey(todayUtc()), total, 60 * 60 * 36)
  } catch {
    // best-effort accounting
  }
}

// kv.server.ts only exposes incr-by-1; emulate incrby with get + set. Race-safe
// enough for accounting (we never block requests on this counter; it's purely
// for the ceiling read). Always pass `ttlSeconds` — kvSet without a TTL issues
// a plain Redis SET which strips any existing expiry, so the window has to be
// re-asserted on every write.
async function kvIncrBy(key: string, by: number, ttlSeconds: number): Promise<number> {
  const current = (await kvGet<number>(key)) ?? 0
  const next = current + by
  await kvSet(key, next, ttlSeconds)
  return next
}

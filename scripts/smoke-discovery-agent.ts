/**
 * scripts/smoke-discovery-agent.ts
 *
 * Phase 4 verification scaffolding for the Sonnet-driven DISCOVERY agent
 * (Emma v2.5). Exercises executeDiscoveryAgent() directly across 8 synthetic
 * conversations and reports per-scenario pass/fail plus aggregate cost
 * telemetry.
 *
 * STRATEGY: Direct, single-turn assertions per scenario (Strategy A).
 *   Each scenario uses a fresh randomUUID() conversationId. Multi-turn
 *   scenarios run each inbound message as a separate executeDiscoveryAgent
 *   call but DO NOT persist the agent's reply between turns — the
 *   conversation-history loader returns [] for the fresh id, so each turn
 *   sees only the current inbound message. This is enough to prove that:
 *     - the agent runs without crashing on each scenario shape
 *     - it obeys the channel-aware length / format rules per turn
 *     - it doesn't fabricate URLs (telemetry.fabricationCaught stays clean)
 *     - it pitches a productCard when the prompt clearly warrants one
 *   It does NOT prove multi-turn coherence — the second turn of "vague mood"
 *   has no memory of the first. Strategy B (real DB writes between turns)
 *   would prove that, but requires a live DATABASE_URL and risks polluting
 *   sms_turns with smoke rows. Phase 5 ships before we need that fidelity.
 *
 * ENV REQUIREMENTS
 *   ANTHROPIC_API_KEY  required — without it we exit 0 and skip the live runs
 *                      (we do not want CI / casual tsx runs to fail silently
 *                      and we do not want to spend the API budget by accident).
 *   DATABASE_URL       optional — the agent attempts to load conversation
 *                      history from sms_turns. With a fresh conversationId the
 *                      query returns 0 rows; if the env var is unset entirely
 *                      the loader logs a warning and returns []. Either way
 *                      the smoke runs.
 *
 * RUN
 *   set -a; source .env.local; set +a
 *   npx tsx scripts/smoke-discovery-agent.ts
 * or
 *   ANTHROPIC_API_KEY=sk-... npx tsx scripts/smoke-discovery-agent.ts
 *
 * EXIT CODE
 *   0 — every scenario passed (or ANTHROPIC_API_KEY unset, deliberate skip)
 *   1 — at least one scenario failed any of its assertions
 */
import './_load-env'

import { randomUUID } from 'node:crypto'
import { executeDiscoveryAgent } from '../app/lib/sms-v2/discovery-agent.server'
import type { EmmaContext, IntentResult, StageResponse } from '../app/lib/sms-v2/types.server'

// ─── Types ───────────────────────────────────────────────────────────────────

type Channel = 'sms' | 'voice' | 'web'

interface Scenario {
  /** Short identifier shown in the report. */
  name: string
  /** Channel the synthetic conversation runs on. */
  channel: Channel
  /** Sequence of inbound user messages, one per turn. */
  messages: string[]
  /** Optional customer block to attach to ctx (e.g. for the returning-customer test). */
  customer?: { firstName?: string; gid?: string }
  /** Per-scenario pass criteria evaluated against the FINAL turn's response. */
  finalCheck: (final: StageResponse, all: StageResponse[]) => { ok: boolean; reason: string }
}

interface ScenarioResult {
  name: string
  channel: Channel
  passed: boolean
  reason: string
  prose: string
  productCardHandle: string | undefined
  inputTokens: number
  outputTokens: number
  toolCallNames: string[]
  fabricationCaught: string | undefined
}

// ─── Context / intent helpers ────────────────────────────────────────────────

function makeCtx(opts: {
  channel: Channel
  phone?: string
  firstName?: string
  gid?: string
}): EmmaContext {
  const phone = opts.phone ?? '+15555550100'
  const ctx: EmmaContext = {
    conversation: {
      phone,
      conversationId: randomUUID(),
      stage: 'DISCOVERY',
      currentPitchHandle: null,
      currentUpsellHandle: null,
      lastQuoteUrl: null,
    },
    channel: opts.channel,
  }
  if (opts.firstName !== undefined || opts.gid !== undefined) {
    ctx.customer = {
      ...(opts.firstName !== undefined ? { firstName: opts.firstName } : {}),
      ...(opts.gid !== undefined ? { gid: opts.gid } : {}),
    }
  }
  return ctx
}

function makeIntent(): IntentResult {
  return { intent: 'OFF_TOPIC', confidence: 0.3, source: 'fallback' }
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

/** Final turn must either attach a productCard OR mention a real handle from a tool result. */
function checkPitchedOrHandleMentioned(final: StageResponse): { ok: boolean; reason: string } {
  const seg = final.segments[0]
  if (!seg) return { ok: false, reason: 'no segment in final turn' }
  if (seg.productCard) {
    return { ok: true, reason: `productCard attached: ${seg.productCard.handle}` }
  }
  // Look for any /products/<handle> mention in the prose that came from a tool call.
  const toolCalls = final.telemetry.toolCalls ?? []
  const sawSearch = toolCalls.some((tc) => tc.name === 'searchProducts')
  if (sawSearch && /\/products\/[a-z0-9-]+/i.test(seg.prose)) {
    return { ok: true, reason: 'prose references a /products/<handle> after a searchProducts call' }
  }
  return {
    ok: false,
    reason: `no productCard and no tool-backed product mention (toolCalls=${toolCalls.map((t) => t.name).join(',') || 'none'})`,
  }
}

function checkAsksOneNarrowingQuestion(final: StageResponse): { ok: boolean; reason: string } {
  const prose = final.segments[0]?.prose ?? ''
  if (!prose) return { ok: false, reason: 'empty prose' }
  // Must contain exactly one '?' — the discovery rule is "one question per turn".
  const questionCount = (prose.match(/\?/g) ?? []).length
  if (questionCount === 0) {
    return { ok: false, reason: 'no question mark — should ask ONE narrowing question' }
  }
  if (questionCount > 1) {
    return { ok: false, reason: `${questionCount} question marks — should ask exactly ONE` }
  }
  return { ok: true, reason: 'asks exactly one question' }
}

function checkMentionsName(name: string) {
  return (final: StageResponse): { ok: boolean; reason: string } => {
    const prose = final.segments[0]?.prose ?? ''
    if (!prose) return { ok: false, reason: 'empty prose' }
    if (prose.toLowerCase().includes(name.toLowerCase())) {
      return { ok: true, reason: `prose mentions "${name}"` }
    }
    return {
      ok: false,
      reason: `prose did not mention "${name}" — first 120 chars: "${prose.slice(0, 120)}"`,
    }
  }
}

function checkSoftBeatNoPitch(final: StageResponse): { ok: boolean; reason: string } {
  const seg = final.segments[0]
  if (!seg) return { ok: false, reason: 'no segment' }
  if (seg.productCard) {
    return { ok: false, reason: `pitched a product (${seg.productCard.handle}) on a vulnerability turn` }
  }
  // Should NOT have called searchProducts on this turn.
  const toolCalls = final.telemetry.toolCalls ?? []
  if (toolCalls.some((tc) => tc.name === 'searchProducts')) {
    return { ok: false, reason: 'called searchProducts on a vulnerability turn' }
  }
  // Should ask exactly one gentle question.
  const questionCount = (seg.prose.match(/\?/g) ?? []).length
  if (questionCount !== 1) {
    return {
      ok: false,
      reason: `expected exactly one gentle question, got ${questionCount} question marks`,
    }
  }
  return { ok: true, reason: 'no pitch, no search, exactly one gentle question' }
}

function checkExplainerOrAdviceThenBridge(final: StageResponse): { ok: boolean; reason: string } {
  const prose = final.segments[0]?.prose ?? ''
  if (!prose) return { ok: false, reason: 'empty prose' }
  const toolCalls = final.telemetry.toolCalls ?? []
  const calledExplainer = toolCalls.some((tc) => tc.name === 'getCategoryExplainer')
  // Either the agent called the explainer tool OR the prose itself directly answers
  // (mentions both water and silicone in some shape).
  const directlyAnswers =
    /water[- ]?based/i.test(prose) && /silicone/i.test(prose)
  if (!calledExplainer && !directlyAnswers) {
    return {
      ok: false,
      reason: `no getCategoryExplainer call and prose did not mention both water-based and silicone (toolCalls=${toolCalls.map((t) => t.name).join(',') || 'none'})`,
    }
  }
  // Should bridge to a follow-up question.
  if (!prose.includes('?')) {
    return { ok: false, reason: 'no follow-up question after the explainer / answer' }
  }
  return {
    ok: true,
    reason: calledExplainer
      ? 'called getCategoryExplainer and bridged to a question'
      : 'directly answered (mentions water-based + silicone) and bridged to a question',
  }
}

function checkAcknowledgesGiftAndNarrows(final: StageResponse): { ok: boolean; reason: string } {
  const prose = (final.segments[0]?.prose ?? '').toLowerCase()
  if (!prose) return { ok: false, reason: 'empty prose' }
  // Does it ask a narrowing question (one '?')?
  const questionCount = (prose.match(/\?/g) ?? []).length
  if (questionCount === 0) {
    return { ok: false, reason: 'no narrowing question on a gift turn' }
  }
  return { ok: true, reason: 'asked a narrowing question on a gift turn' }
}

const SCENARIOS: Scenario[] = [
  {
    name: '1. clear request',
    channel: 'sms',
    messages: ["I'm looking for a vibrator", 'something quiet under $80'],
    finalCheck: (final) => checkPitchedOrHandleMentioned(final),
  },
  {
    name: '2. vague mood',
    channel: 'web',
    messages: ["I don't really know what I want", 'something gentle and warming I guess'],
    // Looser: second turn either narrows further (asks ?) OR surfaces a product.
    finalCheck: (final) => {
      const pitched = checkPitchedOrHandleMentioned(final)
      if (pitched.ok) return pitched
      const narrows = checkAsksOneNarrowingQuestion(final)
      if (narrows.ok) {
        return { ok: true, reason: `narrowed further: ${narrows.reason}` }
      }
      return { ok: false, reason: `did not pitch and did not narrow: ${narrows.reason}` }
    },
  },
  {
    name: '3. returning customer',
    channel: 'sms',
    messages: ["hey, it's been a minute"],
    customer: { firstName: 'Sarah' },
    finalCheck: (final) => checkMentionsName('Sarah')(final),
  },
  {
    name: '4. first-timer',
    channel: 'sms',
    messages: ['this is my first time buying anything like this and I feel weird'],
    finalCheck: (final) => checkSoftBeatNoPitch(final),
  },
  {
    name: '5. gift shopping',
    channel: 'sms',
    messages: ["it's a gift for my friend's bachelorette"],
    finalCheck: (final) => checkAcknowledgesGiftAndNarrows(final),
  },
  {
    name: '6. advice request',
    channel: 'web',
    messages: ["what's the difference between water-based and silicone lube?"],
    finalCheck: (final) => checkExplainerOrAdviceThenBridge(final),
  },
  {
    name: '7. vulnerability disclosure',
    channel: 'sms',
    messages: ["I've never done this and I'm embarrassed"],
    finalCheck: (final) => checkSoftBeatNoPitch(final),
  },
  {
    name: '8. link permission (voice)',
    channel: 'voice',
    messages: ['I want a vibrator for my wife', 'yes please'],
    finalCheck: (final) => {
      const seg = final.segments[0]
      if (!seg) return { ok: false, reason: 'no segment' }
      if (!seg.productCard) {
        return {
          ok: false,
          reason: 'voice second turn produced no productCard — adapter would have nothing to text',
        }
      }
      if (!seg.productCard.handle) {
        return { ok: false, reason: 'productCard has no handle' }
      }
      return { ok: true, reason: `productCard attached with handle "${seg.productCard.handle}"` }
    },
  },
]

// ─── Runner ──────────────────────────────────────────────────────────────────

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const ctx = makeCtx({
    channel: scenario.channel,
    ...(scenario.customer?.firstName !== undefined ? { firstName: scenario.customer.firstName } : {}),
    ...(scenario.customer?.gid !== undefined ? { gid: scenario.customer.gid } : {}),
  })

  const allTurns: StageResponse[] = []
  for (const message of scenario.messages) {
    const intent = makeIntent()
    const res = await executeDiscoveryAgent(ctx, intent, message)
    allTurns.push(res)
  }

  const final = allTurns[allTurns.length - 1]
  if (!final) {
    return {
      name: scenario.name,
      channel: scenario.channel,
      passed: false,
      reason: 'no turns produced',
      prose: '',
      productCardHandle: undefined,
      inputTokens: 0,
      outputTokens: 0,
      toolCallNames: [],
      fabricationCaught: undefined,
    }
  }

  // Aggregate telemetry across all turns of this scenario.
  let inputTokens = 0
  let outputTokens = 0
  const toolCallNames: string[] = []
  let fabricationCaught: string | undefined
  for (const t of allTurns) {
    inputTokens += t.telemetry.inputTokens ?? 0
    outputTokens += t.telemetry.outputTokens ?? 0
    for (const tc of t.telemetry.toolCalls ?? []) toolCallNames.push(tc.name)
    if (t.telemetry.fabricationCaught) {
      fabricationCaught = fabricationCaught
        ? `${fabricationCaught};${t.telemetry.fabricationCaught}`
        : t.telemetry.fabricationCaught
    }
  }

  const prose = final.segments[0]?.prose ?? ''
  const productCardHandle = final.segments[0]?.productCard?.handle

  // Universal pass criteria: prose non-empty AND no fabrication caught.
  if (!prose || prose.length === 0) {
    return {
      name: scenario.name,
      channel: scenario.channel,
      passed: false,
      reason: 'final prose is empty',
      prose,
      ...(productCardHandle !== undefined ? { productCardHandle } : { productCardHandle: undefined }),
      inputTokens,
      outputTokens,
      toolCallNames,
      ...(fabricationCaught !== undefined ? { fabricationCaught } : { fabricationCaught: undefined }),
    }
  }
  if (fabricationCaught) {
    return {
      name: scenario.name,
      channel: scenario.channel,
      passed: false,
      reason: `fabrication caught: ${fabricationCaught}`,
      prose,
      ...(productCardHandle !== undefined ? { productCardHandle } : { productCardHandle: undefined }),
      inputTokens,
      outputTokens,
      toolCallNames,
      fabricationCaught,
    }
  }

  // Scenario-specific check.
  const specific = scenario.finalCheck(final, allTurns)
  return {
    name: scenario.name,
    channel: scenario.channel,
    passed: specific.ok,
    reason: specific.reason,
    prose,
    ...(productCardHandle !== undefined ? { productCardHandle } : { productCardHandle: undefined }),
    inputTokens,
    outputTokens,
    toolCallNames,
    ...(fabricationCaught !== undefined ? { fabricationCaught } : { fabricationCaught: undefined }),
  }
}

// ─── Reporting ───────────────────────────────────────────────────────────────

function printScenarioResult(r: ScenarioResult): void {
  const mark = r.passed ? 'PASS' : 'FAIL'
  console.log(`\n${mark}  ${r.name}  [channel=${r.channel}]`)
  console.log(`     reason:        ${r.reason}`)
  console.log(`     prose[0..160]: "${r.prose.slice(0, 160).replace(/\n/g, ' ')}"`)
  if (r.productCardHandle) {
    console.log(`     productCard:   ${r.productCardHandle}`)
  }
  console.log(
    `     tokens:        in=${r.inputTokens} out=${r.outputTokens}` +
      ` | toolCalls=${r.toolCallNames.length > 0 ? r.toolCallNames.join(',') : 'none'}` +
      (r.fabricationCaught ? ` | fabricationCaught=${r.fabricationCaught}` : ''),
  )
}

// ─── Cost projection ─────────────────────────────────────────────────────────

const SONNET_INPUT_USD_PER_1M = 3.0
const SONNET_OUTPUT_USD_PER_1M = 15.0
const COST_TARGET_PER_CONVO = 0.15

function dollarsForTurn(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * SONNET_INPUT_USD_PER_1M +
    (outputTokens / 1_000_000) * SONNET_OUTPUT_USD_PER_1M
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const apiKey = (process.env['ANTHROPIC_API_KEY'] ?? '').trim()
  if (!apiKey) {
    console.log('\nDISCOVERY agent smoke')
    console.log('=====================')
    console.log(
      '\nskipping live runs — set ANTHROPIC_API_KEY to actually exercise the agent.',
    )
    console.log(
      '(this script makes real Sonnet 4.6 calls and costs API budget; refusing to run silently)',
    )
    process.exit(0)
  }

  console.log('\nDISCOVERY agent smoke')
  console.log('=====================')
  console.log(`scenarios:    ${SCENARIOS.length}`)
  console.log(`strategy:     A (single-turn assertions, fresh conversationId per scenario)`)
  console.log(`model:        claude-sonnet-4-6`)

  const results: ScenarioResult[] = []
  for (const scenario of SCENARIOS) {
    try {
      const r = await runScenario(scenario)
      results.push(r)
      printScenarioResult(r)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`\nFAIL  ${scenario.name}  [channel=${scenario.channel}]`)
      console.log(`     reason: threw: ${msg}`)
      results.push({
        name: scenario.name,
        channel: scenario.channel,
        passed: false,
        reason: `threw: ${msg}`,
        prose: '',
        productCardHandle: undefined,
        inputTokens: 0,
        outputTokens: 0,
        toolCallNames: [],
        fabricationCaught: undefined,
      })
    }
  }

  // ── Aggregate report ──────────────────────────────────────────────────────
  const passed = results.filter((r) => r.passed).length
  const failed = results.length - passed
  const totalInputTokens = results.reduce((acc, r) => acc + r.inputTokens, 0)
  const totalOutputTokens = results.reduce((acc, r) => acc + r.outputTokens, 0)
  const totalCost = dollarsForTurn(totalInputTokens, totalOutputTokens)
  const avgCost = totalCost / Math.max(results.length, 1)

  console.log('\n─── Summary ─────────────────────────────────────────────────')
  console.log(`scenarios:        ${results.length}`)
  console.log(`passed:           ${passed}`)
  console.log(`failed:           ${failed}`)
  console.log(`total tokens:     in=${totalInputTokens} out=${totalOutputTokens}`)
  console.log(`total cost:       $${totalCost.toFixed(4)}`)
  console.log(`avg cost / convo: $${avgCost.toFixed(4)}`)
  if (avgCost > COST_TARGET_PER_CONVO) {
    console.log(
      `WARN: cost projection over target ($${avgCost.toFixed(4)} > $${COST_TARGET_PER_CONVO.toFixed(2)} per conversation)`,
    )
  }

  // Per-scenario cost breakdown.
  console.log('\nper-scenario:')
  for (const r of results) {
    const cost = dollarsForTurn(r.inputTokens, r.outputTokens)
    console.log(
      `  ${r.passed ? 'PASS' : 'FAIL'}  ${r.name.padEnd(34)} cost=$${cost.toFixed(4)}` +
        ` tokens=in${r.inputTokens}/out${r.outputTokens}`,
    )
  }

  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err: unknown) => {
  console.error('\n[smoke-discovery-agent] fatal:', err)
  process.exit(1)
})

/**
 * evals/runner.ts
 *
 * Eval harness runner for Emma conversation quality.
 *
 * For each fixture:
 *   1. Build the "agent input" by combining priorSummary, priorSlots,
 *      pitchedHandlesLog, and the fixture's user turn into a messages array.
 *   2. Call the Anthropic API with the v2 SMS system prompt (or an override).
 *   3. Send Emma's reply + fixture context to the Sonnet-as-judge.
 *   4. Collect per-dimension scores.
 *   5. Print a markdown table: fixture | dimension | v1 score | v2 score | winner.
 *
 * CLI:
 *   npx tsx evals/runner.ts
 *   npx tsx evals/runner.ts --system-prompt-override evals/v1-fly-prompt.txt
 *
 * Exit code 0 if all v2 scores >= 3. Exit code 1 if any v2 score < 3.
 *
 * The runner requires only ANTHROPIC_API_KEY. No DB, no Twilio, no Shopify.
 */

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { JUDGE_SYSTEM_PROMPT } from './judge/prompt.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvalFixture {
  id: string
  description: string
  channel: 'sms' | 'voice' | 'web'
  priorSummary: string | null
  priorSlots: Record<string, unknown>
  pitchedHandlesLog: string[]
  turns: Array<
    | { role: 'user'; text: string }
    | { role: 'expected_behavior'; tags: string[] }
  >
  evalDimensions: Array<'memory' | 'coherence' | 'no_derail' | 'voice_rules' | 'no_fabrication' | 'emma_voice'>
  regressionFor: string | null
}

type DimensionScores = Partial<Record<EvalFixture['evalDimensions'][number], number>>

interface FixtureResult {
  fixture: EvalFixture
  agentReply: string
  scores: DimensionScores
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(): { promptOverridePath: string | null; fixtureFilter: string | null } {
  const args = process.argv.slice(2)
  const overrideIdx = args.findIndex(
    (a) => a === '--system-prompt-override' || a === '--prompt-override',
  )
  const filterIdx = args.findIndex((a) => a === '--fixture')
  return {
    promptOverridePath: overrideIdx >= 0 ? (args[overrideIdx + 1] ?? null) : null,
    fixtureFilter: filterIdx >= 0 ? (args[filterIdx + 1] ?? null) : null,
  }
}

// ---------------------------------------------------------------------------
// Build the v2 SMS system prompt (stable portion only — no customer context)
// ---------------------------------------------------------------------------

const V2_SMS_SYSTEM_PROMPT = `EMMA — xdipx editorial concierge. You're talking with one customer at a time, in stride, like a friend who knows the catalog cold.

HARD RULES (these override anything that conflicts):
- Acknowledge what the customer JUST said before asking the next question or pivoting. Skipping the acknowledgement makes you sound like a form.
- Ask exactly ONE question per turn. Never stack questions. Never offer a checklist of options as a question.
- Never use "sex" as an adjective. Use "intimate", "pleasure", "wellness", or "satisfaction". "Sex" as a noun is fine when it makes the answer cleaner.
- No em-dashes anywhere. Use commas, periods, or hyphens in compound words.
- Never surface a countdown, "until midnight," or any timing pressure. Editorial pacing is part of the brand.
- Mood/feeling questions MUST include 2-3 concrete examples in parentheses ("something gentle and warming, something powerful and intense, or somewhere in between?"). Otherwise customers freeze and answer "I don't know."
- Never use "buy now," "checkout now," or any pushy CTA. Use "Take a peek," "Want to see it?", "I'll take it" — Emma voice.
- Never claim you've sent / created / texted / saved anything you haven't actually called a tool for. If you have no tool result for it, you didn't do it.
- Never paste cart URLs or checkout URLs. The only links you may share are PDP URLs that came back from a searchProducts or getProductDetails result THIS turn.

PITCHING (when you actually have a fit):
- One product per turn. Name it once with the title from the tool result (don't paraphrase the product name).
- Lead with insight, not specs — what makes THIS product the right call for THEIR situation, from someone who tests these.
- Include the PDP URL exactly as the tool returned it (https://xdipx.com/products/<handle>). Don't invent handles. Don't shorten URLs.
- Close on a fit-confirming question, never on a number. Price goes mid-reply.

CHANNEL: SMS (plain text — Twilio).
- No markdown, no **bold**, no [text](url) syntax, no bullet lists, no emoji spam (one emoji max if it lands).
- Aim 40-80 words. Two sentences max.
- PDP URL formatting (REQUIRED for iMessage preview to render the product image): when sharing a PDP URL, put it on its OWN LINE with the https:// prefix, ideally as the LAST line before any closing question. The URL must read https://xdipx.com/products/<handle> verbatim from the tool result. Don't bury it mid-sentence — iMessage only auto-previews URLs that aren't sandwiched between other text.
- Don't gate behind "want me to text the link?" — if you have a fit, share it now.
- This stage NEVER includes a checkout URL. Pitch and ask.
- Contractions. Friendly. Short.`

// ---------------------------------------------------------------------------
// Build agent input messages from fixture
// ---------------------------------------------------------------------------

function buildAgentMessages(
  fixture: EvalFixture,
): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = []

  // Inject prior context as a synthetic assistant message to simulate the
  // agent "knowing" what it already knows this turn. This is what the
  // <known_about_customer> block does in production — in evals we simulate it
  // as a prior assistant turn for simplicity.
  const contextParts: string[] = []
  if (fixture.priorSummary) {
    contextParts.push(`[Prior summary: ${fixture.priorSummary}]`)
  }
  if (Object.keys(fixture.priorSlots).length > 0) {
    const slots = Object.entries(fixture.priorSlots)
      .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : String(v)}`)
      .join(' | ')
    contextParts.push(`[Known slots: ${slots}]`)
  }
  if (fixture.pitchedHandlesLog.length > 0) {
    contextParts.push(`[Prior pitched products: ${fixture.pitchedHandlesLog.join(', ')}]`)
  }

  if (contextParts.length > 0) {
    messages.push({
      role: 'assistant',
      content: `I have context from our prior conversation: ${contextParts.join(' ')}`,
    })
  }

  // Add the user turns (skip expected_behavior entries)
  for (const turn of fixture.turns) {
    if (turn.role === 'user') {
      messages.push({ role: 'user', content: turn.text })
    }
  }

  return messages
}

// ---------------------------------------------------------------------------
// Call Emma with a given system prompt
// ---------------------------------------------------------------------------

async function callEmma(
  client: Anthropic,
  fixture: EvalFixture,
  systemPrompt: string,
): Promise<string> {
  const messages = buildAgentMessages(fixture)
  if (messages.length === 0) return ''

  try {
    const res = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 480,
      system: systemPrompt,
      messages,
    })
    const textBlock = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    return (textBlock?.text ?? '').trim()
  } catch (err) {
    console.error(`[runner] Emma call failed for fixture ${fixture.id}:`, err)
    return '[ERROR: Emma call failed]'
  }
}

// ---------------------------------------------------------------------------
// Judge scoring
// ---------------------------------------------------------------------------

async function judgeReply(
  client: Anthropic,
  fixture: EvalFixture,
  systemPromptLabel: string,
  agentReply: string,
): Promise<DimensionScores> {
  const expectedBehaviorTurn = fixture.turns.find((t) => t.role === 'expected_behavior') as
    | { role: 'expected_behavior'; tags: string[] }
    | undefined
  const expectedTags = expectedBehaviorTurn?.tags ?? []

  const judgeUserMessage = `FIXTURE:
id: ${fixture.id}
description: ${fixture.description}
channel: ${fixture.channel}
prior_summary: ${fixture.priorSummary ?? 'none'}
prior_slots: ${JSON.stringify(fixture.priorSlots)}
pitched_handles_log: ${JSON.stringify(fixture.pitchedHandlesLog)}
customer_message: "${fixture.turns.find((t) => t.role === 'user')?.text ?? ''}"
expected_behavior_tags: ${JSON.stringify(expectedTags)}
eval_dimensions: ${JSON.stringify(fixture.evalDimensions)}
system_prompt_label: ${systemPromptLabel}

EMMA'S REPLY:
${agentReply}

Score each evalDimension listed above. Return only JSON.`

  try {
    const res = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      system: JUDGE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: judgeUserMessage }],
    })
    const textBlock = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    const raw = (textBlock?.text ?? '').trim()
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart === -1 || jsonEnd === -1) return {}
    return JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as DimensionScores
  } catch (err) {
    console.error(`[runner] Judge call failed for fixture ${fixture.id}:`, err)
    return {}
  }
}

// ---------------------------------------------------------------------------
// Results formatting
// ---------------------------------------------------------------------------

function scoreEmoji(score: number | undefined): string {
  if (score === undefined) return '?'
  if (score >= 4) return `${score} OK`
  if (score === 3) return `${score} ~`
  return `${score} FAIL`
}

function printResults(results: FixtureResult[], label: string): void {
  console.log(`\n${'='.repeat(70)}`)
  console.log(`EVAL RESULTS — ${label}`)
  console.log('='.repeat(70))

  let hasFailure = false

  for (const r of results) {
    const dims = r.fixture.evalDimensions
    const scores = dims.map((d) => `${d}: ${scoreEmoji(r.scores[d])}`).join(' | ')
    const minScore = Math.min(...dims.map((d) => r.scores[d] ?? 5))
    const status = minScore < 3 ? 'BLOCK' : minScore === 3 ? 'REVISE' : 'PASS'
    if (status === 'BLOCK') hasFailure = true

    console.log(`\n[${status}] ${r.fixture.id}`)
    console.log(`  ${scores}`)
    if (minScore < 3) {
      console.log(`  AGENT REPLY: ${r.agentReply.slice(0, 120)}...`)
    }
  }

  const pass = results.filter((r) => {
    const min = Math.min(...r.fixture.evalDimensions.map((d) => r.scores[d] ?? 5))
    return min >= 4
  }).length
  const revise = results.filter((r) => {
    const min = Math.min(...r.fixture.evalDimensions.map((d) => r.scores[d] ?? 5))
    return min === 3
  }).length
  const block = results.filter((r) => {
    const min = Math.min(...r.fixture.evalDimensions.map((d) => r.scores[d] ?? 5))
    return min < 3
  }).length

  console.log(`\n${'─'.repeat(70)}`)
  console.log(`SUMMARY: PASS=${pass} | REVISE=${revise} | BLOCK=${block}`)
  console.log('='.repeat(70))

  if (hasFailure) {
    process.exitCode = 1
  }
}

// ---------------------------------------------------------------------------
// Gating fixture check (architect condition #3)
// ---------------------------------------------------------------------------

function checkGatingFixtures(results: FixtureResult[]): void {
  const gating = ['007-24h-rotation-bridge', '008-slot-injection-after-truncation']
  for (const id of gating) {
    const r = results.find((res) => res.fixture.id === id)
    if (!r) {
      console.warn(`[runner] WARNING: gating fixture ${id} not found in results`)
      continue
    }
    const memScore = r.scores['memory']
    if (memScore === undefined) {
      console.warn(`[runner] ${id}: 'memory' dimension not scored`)
    } else if (memScore < 4) {
      console.error(
        `[runner] GATE FAIL: ${id} scored memory=${memScore} (< 4). Phase gate does not pass.`,
      )
      process.exitCode = 1
    } else {
      console.log(`[runner] GATE PASS: ${id} memory=${memScore} (>= 4)`)
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const apiKey = (process.env['ANTHROPIC_API_KEY'] ?? '').trim()
  if (!apiKey) {
    console.error('[runner] ANTHROPIC_API_KEY is required.')
    process.exit(1)
  }

  const client = new Anthropic({ apiKey })
  const { promptOverridePath, fixtureFilter } = parseArgs()

  // Load fixtures
  const fixturesDir = join(import.meta.dirname ?? new URL('.', import.meta.url).pathname, 'fixtures')
  const fixtureFiles = readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.json'))
    .sort()

  let fixtures: EvalFixture[] = fixtureFiles.map((f) => {
    const raw = readFileSync(join(fixturesDir, f), 'utf-8')
    return JSON.parse(raw) as EvalFixture
  })

  if (fixtureFilter) {
    fixtures = fixtures.filter((f) => f.id.includes(fixtureFilter))
    console.log(`[runner] Filtered to ${fixtures.length} fixture(s) matching "${fixtureFilter}"`)
  }

  // Load the system prompt to use
  const promptLabel = promptOverridePath ? `v1-override (${promptOverridePath})` : 'v2-sms'
  const systemPrompt = promptOverridePath
    ? readFileSync(resolve(process.cwd(), promptOverridePath), 'utf-8')
    : V2_SMS_SYSTEM_PROMPT

  console.log(`[runner] Running ${fixtures.length} fixtures with system prompt: ${promptLabel}`)

  // Run each fixture
  const results: FixtureResult[] = []
  for (const fixture of fixtures) {
    process.stdout.write(`  ${fixture.id} ... `)
    const agentReply = await callEmma(client, fixture, systemPrompt)
    const scores = await judgeReply(client, fixture, promptLabel, agentReply)
    results.push({ fixture, agentReply, scores })
    const minScore = Math.min(...fixture.evalDimensions.map((d) => scores[d] ?? 5))
    const status = minScore < 3 ? 'BLOCK' : minScore === 3 ? 'REVISE' : 'PASS'
    console.log(status)
  }

  printResults(results, promptLabel)
  checkGatingFixtures(results)
}

main().catch((err) => {
  console.error('[runner] fatal:', err)
  process.exit(1)
})

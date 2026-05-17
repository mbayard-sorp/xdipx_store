/**
 * dispatch-matters-chunks.ts
 *
 * Step 5.5 of the v2 "What Matters" backfill — Claude pass over the ambiguous
 * tail. Reads matters-proposal-briefs.chunk-NN.json files, sends each chunk
 * to Sonnet via the Claude Agent SDK (Max-billed, zero Anthropic API spend),
 * parses the JSON response, writes matters-proposal-proposals.chunk-NN.json.
 *
 * Designed to be re-runnable: skips chunks that already have a non-empty
 * proposals file unless --force is passed. Dispatches sequentially by default
 * to stay friendly to Max quota; concurrency available via --concurrency=N.
 *
 * Usage:
 *   # Dry-run: print the prompt for one chunk, don't dispatch
 *   npx tsx scripts/dispatch-matters-chunks.ts --chunk=01 --dry-run
 *
 *   # Dispatch a single chunk
 *   npx tsx scripts/dispatch-matters-chunks.ts --chunk=01
 *
 *   # Dispatch every chunk file in cwd (sequential, idempotent)
 *   npx tsx scripts/dispatch-matters-chunks.ts --all
 *
 *   # Dispatch all and force re-dispatch of chunks that already have proposals
 *   npx tsx scripts/dispatch-matters-chunks.ts --all --force
 *
 *   # Dispatch all, 2 chunks in flight at once (tighter quota window)
 *   npx tsx scripts/dispatch-matters-chunks.ts --all --concurrency=2
 *
 * Requires `@anthropic-ai/claude-agent-sdk` installed — see app/lib/
 * llm-client.server.ts loadAgentSdk(). Inherits the Max subscription
 * credentials from the local Claude Code environment; no env vars needed.
 */

import './_load-env'
import fs from 'node:fs'
import path from 'node:path'
import { runSingleClaudeCallViaSdk } from '../app/lib/llm-client.server'
import { MATTERS_V2 } from '../app/types/discovery'

// ─── CLI args ─────────────────────────────────────────────────────────────────

const argOf = (flag: string): string | undefined => {
  const found = process.argv.find(a => a.startsWith(`${flag}=`))
  return found ? found.split('=')[1] : undefined
}

const CHUNK_ARG     = argOf('--chunk')
const ALL           = process.argv.includes('--all')
const DRY_RUN       = process.argv.includes('--dry-run')
const FORCE         = process.argv.includes('--force')
const CONCURRENCY   = Math.max(1, Number(argOf('--concurrency') ?? 1))
const INPUT_DIR     = path.resolve(argOf('--input-dir') ?? process.cwd())
const PROMPT_PREFIX = argOf('--briefs-prefix')    ?? 'matters-proposal-briefs'
const OUT_PREFIX    = argOf('--proposals-prefix') ?? 'matters-proposal-proposals'

if (!CHUNK_ARG && !ALL) {
  console.error('Usage: --chunk=NN OR --all (one is required)')
  process.exit(1)
}

// ─── Brief / proposal shapes ──────────────────────────────────────────────────

interface MattersProductBrief {
  shopifyProductId:  string
  handle:            string
  title:             string
  productType:       string | null
  vendor:            string
  tags:              string[]
  bodyExcerpt:       string
  nalpacDescription: string
  currentMatters:    string[]
  currentAudience:   string[]
  parsedMaterials:   string[]
  specBooleans: {
    waterproof:      boolean | null
    rechargeable:    boolean | null
    detachableParts: boolean | null
    nonElectric:     boolean | null
  }
  lengthIn: number | null
  deterministic: {
    finalMatters: string[]
    hits:         Array<{ id: string; addsTags: string[]; note: string }>
    needsClaude:  boolean
  }
}

interface ChunkFile {
  vocab:    string[]
  chunkMeta: { chunkNumber: number; totalChunks: number; productCount: number }
  briefs:   MattersProductBrief[]
}

interface MattersProposal {
  shopifyProductId: string
  mattersTags:      string[]
  rationale:        string
}

// ─── Prompt construction ──────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an editorial taxonomist for xdipx.com, an editorially-curated sexual-wellness storefront. Your job: classify products against the v2 "What Matters" chip vocabulary — a controlled 12-chip set used in the home-page discovery filter.

You will receive a JSON payload containing up to 75 products. For each product, return 0–4 tags from the canonical vocabulary that genuinely apply.

CANONICAL VOCABULARY (exact strings — sentence-case, hyphen vs space matters):

${MATTERS_V2.map(v => `  - ${v}`).join('\n')}

DEFINITIONS:

- Beginner-friendly — first-time-safe; entry-level; intro/starter products
- Whisper-quiet — explicitly silent or <30db; matters when discretion is critical
- Waterproof — fully submersible (shower/bath); IPX7+; NOT just splash-resistant
- Travel-ready — TSA-safe, locking case, or discreet plain packaging suited to travel
- Discreet — looks/sounds/packages unobtrusively; gift-discreet; roommate-discreet
- Hands-free — wearable, suction-cup, harness-compatible; user doesn't hold it
- Remote-controlled — partner/app/wireless control; not just on/off button
- Plus-size friendly — explicitly inclusive sizing, extended sizes, body-positive design
- Easy to clean — non-porous material AND (waterproof OR detachable OR no motor)
- Rechargeable — USB or magnetic charging; NOT battery-operated
- Soft-touch — silicone/TPE AND consumer description emphasizes softness
- Latex-free — silicone/TPE/glass/metal/ABS/ceramic — NOT rubber/latex blends

CLASSIFICATION RULES:

1. **Use the ORIGINAL NALPAC DESCRIPTION as the source of truth for specs.** It contains literal manufacturer claims (rechargeable, IPX7, 100% silicone, etc.). The current Shopify body is Emma-rewritten editorial copy and often softens or removes spec language.

2. **Respect the rule-pass output (deterministic.finalMatters).** When the rules already caught a tag, keep it. You are filling gaps the rules missed, not re-classifying from scratch.

3. **Conservative > aggressive.** A product without clear evidence for a tag should NOT get the tag. Empty mattersTags is a valid output. Better to leave a chip blank than to mislead a user filtering for it.

4. **NEVER invent vocabulary.** Every value in mattersTags MUST be one of the 12 strings above, character-for-character. Case-sensitive. No new chips.

5. **0–4 tags per product.** Cap at 4 — chip filters should narrow, not enumerate. If a product genuinely could fit 5+, pick the 4 strongest.

6. **For products with no relevant chips (e.g., lube, toy cleaner that doesn't fit any), return an empty array.** This is a valid, expected outcome.

OUTPUT FORMAT — JSON ONLY:

Return a JSON array (no markdown code fence, no preamble, no explanation outside the JSON):

\`\`\`
[
  {
    "shopifyProductId": "<id from input>",
    "mattersTags": ["Beginner-friendly", "Discreet"],
    "rationale": "<1-2 sentences explaining the classification, citing the specific spec/description signal you used>"
  },
  ...
]
\`\`\`

Return one entry per product in the input. Same order is fine. Use the shopifyProductId from each brief exactly as given.`

function buildUserPrompt(chunk: ChunkFile): string {
  return `Classify the following ${chunk.briefs.length} products. Return JSON array only.\n\n${JSON.stringify(chunk.briefs, null, 2)}`
}

// ─── JSON extraction ──────────────────────────────────────────────────────────

/** Strip optional ```json ... ``` fences. Be tolerant of leading prose. */
function extractJsonArray(text: string): unknown[] {
  let trimmed = text.trim()
  // Drop markdown fence if present
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch && fenceMatch[1]) trimmed = fenceMatch[1].trim()
  // Find the first '[' and last ']' as a fallback if there's surrounding prose
  const start = trimmed.indexOf('[')
  const end   = trimmed.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`no JSON array found in response (first 200 chars: ${trimmed.slice(0, 200)})`)
  }
  const jsonSlice = trimmed.slice(start, end + 1)
  const parsed = JSON.parse(jsonSlice)
  if (!Array.isArray(parsed)) throw new Error('parsed JSON is not an array')
  return parsed
}

// ─── Dispatch + validation ────────────────────────────────────────────────────

const VOCAB_SET = new Set<string>(MATTERS_V2)

async function dispatchChunk(chunkNumber: string): Promise<{ ok: boolean; products: number; errors: string[] }> {
  const briefPath = path.join(INPUT_DIR, `${PROMPT_PREFIX}.chunk-${chunkNumber}.json`)
  const outPath   = path.join(INPUT_DIR, `${OUT_PREFIX}.chunk-${chunkNumber}.json`)

  if (!fs.existsSync(briefPath)) {
    return { ok: false, products: 0, errors: [`brief file not found: ${briefPath}`] }
  }

  // Idempotency: skip if output already exists and is non-empty
  if (!FORCE && fs.existsSync(outPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outPath, 'utf-8'))
      if (Array.isArray(existing) && existing.length > 0) {
        console.log(`  chunk-${chunkNumber}: SKIP (output exists, ${existing.length} proposals — pass --force to redispatch)`)
        return { ok: true, products: existing.length, errors: [] }
      }
    } catch {
      // fall through and re-dispatch
    }
  }

  const chunk: ChunkFile = JSON.parse(fs.readFileSync(briefPath, 'utf-8'))
  const userPrompt = buildUserPrompt(chunk)

  if (DRY_RUN) {
    console.log(`\n──── DRY-RUN: chunk-${chunkNumber} (${chunk.briefs.length} products) ────`)
    console.log(`  briefPath: ${briefPath}`)
    console.log(`  outPath:   ${outPath}`)
    console.log(`  system prompt chars: ${SYSTEM_PROMPT.length}`)
    console.log(`  user prompt chars:   ${userPrompt.length}`)
    console.log(`  estimated input tokens: ~${Math.round((SYSTEM_PROMPT.length + userPrompt.length) / 4)}`)
    console.log(`  estimated output tokens: ~${chunk.briefs.length * 80}`)
    console.log(`\n  first brief preview:`)
    console.log(`    ${JSON.stringify(chunk.briefs[0]?.title)}  (${chunk.briefs[0]?.shopifyProductId})`)
    return { ok: true, products: chunk.briefs.length, errors: [] }
  }

  const t0 = Date.now()
  console.log(`  chunk-${chunkNumber}: dispatching ${chunk.briefs.length} products …`)

  let text: string
  let inputTokens = 0
  let outputTokens = 0
  try {
    const resp = await runSingleClaudeCallViaSdk({
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      // Cap generous enough for 75 products × ~80 output tokens + overhead.
      maxTokens: 12000,
    })
    text = resp.text
    inputTokens  = resp.inputTokens
    outputTokens = resp.outputTokens
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, products: chunk.briefs.length, errors: [`SDK call failed: ${msg}`] }
  }

  let parsed: unknown[]
  try {
    parsed = extractJsonArray(text)
  } catch (err) {
    // Persist the raw response for debugging
    const debugPath = path.join(INPUT_DIR, `${OUT_PREFIX}.chunk-${chunkNumber}.raw.txt`)
    fs.writeFileSync(debugPath, text)
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, products: chunk.briefs.length, errors: [`JSON parse failed: ${msg} (raw saved to ${debugPath})`] }
  }

  const errors: string[] = []
  const proposals: MattersProposal[] = []

  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') {
      errors.push('non-object proposal entry, skipping')
      continue
    }
    const p = raw as Partial<MattersProposal>
    if (typeof p.shopifyProductId !== 'string' || !p.shopifyProductId) {
      errors.push('missing shopifyProductId, skipping')
      continue
    }
    const tags = Array.isArray(p.mattersTags) ? p.mattersTags : []
    const valid: string[] = []
    for (const t of tags) {
      if (typeof t !== 'string') continue
      if (!VOCAB_SET.has(t)) {
        errors.push(`product ${p.shopifyProductId}: out-of-vocab tag "${t}" — dropped`)
        continue
      }
      if (!valid.includes(t)) valid.push(t)
    }
    if (valid.length > 4) {
      errors.push(`product ${p.shopifyProductId}: ${valid.length} tags, truncating to first 4`)
      valid.length = 4
    }
    proposals.push({
      shopifyProductId: p.shopifyProductId,
      mattersTags: valid,
      rationale: typeof p.rationale === 'string' ? p.rationale : '',
    })
  }

  // Write proposals file
  fs.writeFileSync(outPath, JSON.stringify(proposals, null, 2))
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`  chunk-${chunkNumber}: wrote ${proposals.length} proposals → ${path.basename(outPath)}  (${elapsedSec}s, in=${inputTokens}t out=${outputTokens}t)`)
  if (errors.length > 0) {
    console.log(`    errors: ${errors.length} (first 3): ${errors.slice(0, 3).join(' | ')}`)
  }
  return { ok: true, products: proposals.length, errors }
}

// ─── Concurrency runner ───────────────────────────────────────────────────────

async function runWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let i = 0
  async function worker(): Promise<void> {
    while (true) {
      const idx = i++
      if (idx >= items.length) return
      const item = items[idx] as T
      results[idx] = await fn(item)
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker)
  await Promise.all(workers)
  return results
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  let chunkNumbers: string[]

  if (ALL) {
    const re = new RegExp(`^${PROMPT_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.chunk-(\\d+)\\.json$`)
    const files = fs.readdirSync(INPUT_DIR).filter(f => re.test(f)).sort()
    chunkNumbers = files.map(f => {
      const m = f.match(re)
      return m?.[1] ?? ''
    }).filter(Boolean)
    if (chunkNumbers.length === 0) {
      console.error(`No chunk files found in ${INPUT_DIR} matching ${PROMPT_PREFIX}.chunk-NN.json`)
      process.exit(1)
    }
  } else {
    if (!CHUNK_ARG) {
      console.error('Pass --chunk=NN or --all')
      process.exit(1)
    }
    chunkNumbers = [CHUNK_ARG.padStart(2, '0')]
  }

  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'DISPATCH'}`)
  console.log(`Chunks: ${chunkNumbers.join(', ')}`)
  console.log(`Concurrency: ${CONCURRENCY}`)
  console.log(`Input dir: ${INPUT_DIR}`)
  console.log('')

  const t0 = Date.now()
  const results = await runWithConcurrency(chunkNumbers, CONCURRENCY, dispatchChunk)
  const elapsedMin = ((Date.now() - t0) / 60000).toFixed(1)

  const okCount      = results.filter(r => r.ok).length
  const failCount    = results.filter(r => !r.ok).length
  const productTotal = results.reduce((s, r) => s + r.products, 0)
  const errorTotal   = results.reduce((s, r) => s + r.errors.length, 0)

  console.log('')
  console.log(`────────────────────────────────────────────────────`)
  console.log(`  Dispatch ${DRY_RUN ? 'preview' : 'run'} complete (${elapsedMin} min)`)
  console.log(`────────────────────────────────────────────────────`)
  console.log(`  Chunks OK:      ${okCount}/${chunkNumbers.length}`)
  console.log(`  Chunks failed:  ${failCount}`)
  console.log(`  Products:       ${productTotal}`)
  console.log(`  Validation issues: ${errorTotal}`)
  if (failCount > 0) {
    console.log('')
    console.log('Failures:')
    results.forEach((r, idx) => {
      if (!r.ok) console.log(`  chunk-${chunkNumbers[idx]}: ${r.errors[0]}`)
    })
    process.exit(1)
  }
}

main().catch(e => { console.error(e); process.exit(1) })

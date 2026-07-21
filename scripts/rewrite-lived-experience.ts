/**
 * Surgical batch rewrite of lived-experience phrasing in enriched Emma copy.
 *
 * Reads a sweep-lived-experience.ts --json offender file, fetches the CURRENT
 * value of each offending field, and submits one Anthropic Batch request per
 * (product, field) asking for a minimal rewrite: strip only the Emma-is-AI
 * violations (charter: Emma has no lived experience) into catalog-knowledge
 * voice, preserving everything else. Results are regex-verified locally; any
 * result that still matches a lived-experience pattern is retried once in a
 * second batch round. Nothing is written to Shopify here; apply is a separate
 * script so rewrites can pass the emma-empathy-reviewer voice gate first.
 *
 * Usage:
 *   npx tsx scripts/rewrite-lived-experience.ts --offenders in.json --out rewrites.json
 */
import { readFileSync, writeFileSync } from 'node:fs'
import Anthropic from '@anthropic-ai/sdk'
import { adminGraphQL } from '~/lib/shopify.server'
import { buildEmmaSystemBlocks } from '~/lib/claude.server'
import { logApiTokens } from '~/lib/token-log.server'

const MODEL = 'claude-sonnet-4-6'

// Keep in sync with scripts/sweep-lived-experience.ts
const PATTERNS: RegExp[] = [
  /\bI['’]ve been (?:testing|using|wearing|living|keeping|carrying|reaching)\b/i,
  /\bI keep (?:mine|one|it|this)\b/i,
  /\bI own\b/i,
  /\bI (?:tried|tested)\b/i,
  /\bI use[d]? (?:it|this|mine|one)\b/i,
  /\bmy (?:nightstand|night stand|drawer|desk|shelf|bag|purse|bedside|routine|rotation|collection|partner)\b/i,
  /\bwhen I (?:use|used|wear|wore|tried|tested)\b/i,
  /\bI (?:reach|grab|go) for\b/i,
  /\bmine (?:has|is|does|lives|stays)\b/i,
  /\bI['’]ve (?:had|owned|worn|used|kept)\b/i,
  /\b(?:living|lives|sits|stays) (?:on|in|by) my\b/i,
  /\bI (?:was|am) (?:using|wearing|testing) \b/i,
]
const stillViolates = (s: string) => PATTERNS.some(re => re.test(s.replace(/<[^>]+>/g, ' ')))
const hasEmDash = (s: string) => /—|–/.test(s)

interface Hit { productId: number; handle: string; title: string; status: string; field: string }
interface WorkItem { productId: number; handle: string; title: string; field: string; current: string }
interface Rewrite { productId: number; handle: string; title: string; field: string; old: string; new: string }

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 ? process.argv[i + 1] : undefined
}
const offendersPath = arg('--offenders')
const outPath       = arg('--out')
if (!offendersPath || !outPath) {
  console.error('usage: npx tsx scripts/rewrite-lived-experience.ts --offenders in.json --out rewrites.json')
  process.exit(1)
}

const hits: Hit[] = JSON.parse(readFileSync(offendersPath, 'utf8'))
// Dedup to one work item per (product, field)
const wanted = new Map<string, Hit>()
for (const h of hits) wanted.set(`${h.productId}::${h.field}`, h)
console.log(`${hits.length} hits → ${wanted.size} (product, field) rewrite targets`)

// ── Fetch current values ────────────────────────────────────────────────────
const productIds = [...new Set(hits.map(h => h.productId))]
const FIELD_KEYS = ['tagline', 'full_story', 'seo_meta_description', 'emma_hero', 'pairing_why', 'feature_bullets']

const NODE_QUERY = `
  query Fetch($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        legacyResourceId
        handle
        title
        descriptionHtml
        metafields(namespace: "xdipx", first: 30) { nodes { key value } }
      }
    }
  }`

const items: WorkItem[] = []
for (let i = 0; i < productIds.length; i += 100) {
  const ids = productIds.slice(i, i + 100).map(id => `gid://shopify/Product/${id}`)
  const data = await adminGraphQL<{ nodes: Array<null | {
    legacyResourceId: string
    handle: string
    title: string
    descriptionHtml: string | null
    metafields: { nodes: { key: string; value: string }[] }
  }> }>(NODE_QUERY, { ids })
  for (const n of data.nodes) {
    if (!n) continue
    const pid = Number(n.legacyResourceId)
    const byField: Record<string, string | undefined> = { body_html: n.descriptionHtml ?? undefined }
    for (const m of n.metafields.nodes) if (FIELD_KEYS.includes(m.key)) byField[m.key] = m.value
    for (const [key, hit] of wanted) {
      if (!key.startsWith(`${pid}::`)) continue
      const field = hit.field
      const current = byField[field]
      if (current) items.push({ productId: pid, handle: n.handle, title: n.title, field, current })
      else console.warn(`skip ${pid} ${field}: no current value`)
    }
  }
  console.log(`…fetched ${Math.min(i + 100, productIds.length)}/${productIds.length} products`)
}
console.log(`${items.length} fields fetched for rewrite`)

// ── Prompt builder ──────────────────────────────────────────────────────────
function buildPrompt(item: WorkItem): string {
  const fieldDesc: Record<string, string> = {
    body_html:            'the PDP "Emma\'s take" (HTML with only <p>, <em>, <strong> tags)',
    tagline:              'the product tagline (one line, max 12 words)',
    full_story:           'the product full story (HTML)',
    seo_meta_description: 'the SEO meta description (plain text, 120-155 chars)',
    emma_hero:            'the Emma hero JSON (rewrite only the string values, keep the exact JSON shape and keys)',
    pairing_why:          'the pairing-why JSON object (rewrite only the blurb string values, keep the exact JSON shape and keys)',
    feature_bullets:      'the feature bullets JSON array (rewrite only the offending strings, keep the JSON shape)',
  }
  return `The following ${fieldDesc[item.field] ?? item.field} for the product "${item.title}" violates the Emma-is-AI rule in the voice charter: Emma is an AI guide with NO lived experience. She has never used, tested, worn, owned, or kept any product, and she has no nightstand, desk, drawer, shelf, travel bag, or partner.

Rewrite it MINIMALLY:
- Remove or replace every lived-experience claim ("I've been testing", "I keep mine", "I tried", "living on my nightstand", "my desk drawer", "I reach for", "my collection", "my routine", and anything similar). Replace with catalog-knowledge voice: what the product is known for, designed for, what the spec says, what reviewers describe. Emma can still be warm, first-person, and enthusiastic ("I'm a little obsessed", "the one I'd hand a friend") as long as she never claims to have used or owned it.
- Preserve EVERYTHING else: the format, structure, HTML tags or JSON shape, approximate length, product facts, and tone.
- Replace every em-dash ("—" or "–") with a period, comma, or parentheses. Hyphens in compound words are fine.
- Do not add new claims, stats, or product facts. Do not mention price or discounts.

Current text:
${item.current}

Return ONLY the rewritten text in the exact same format (same HTML tags or JSON shape). No markdown fences, no preamble, no explanation.`
}

// ── Batch submit + poll ─────────────────────────────────────────────────────
const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']?.trim() })
const systemBlocks = await buildEmmaSystemBlocks()
const systemParam = systemBlocks.map(b => ({
  type: 'text' as const,
  text: b.text,
  ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
}))

async function runRound(round: number, work: WorkItem[]): Promise<{ ok: Rewrite[]; failed: WorkItem[] }> {
  const requests = work.map((item, i) => ({
    custom_id: `r${round}_${i}`,
    params: {
      model: MODEL,
      max_tokens: item.field === 'tagline' ? 200 : 2000,
      system: systemParam,
      messages: [{ role: 'user' as const, content: buildPrompt(item) }],
    },
  }))
  // Submit in chunks — one huge create payload has hit transient TLS errors.
  const CHUNK = 150
  const batchIds: string[] = []
  for (let c = 0; c < requests.length; c += CHUNK) {
    const chunk = requests.slice(c, c + CHUNK)
    let lastErr: unknown
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const batch = await client.messages.batches.create({ requests: chunk })
        batchIds.push(batch.id)
        console.log(`[round ${round}] submitted batch ${batch.id} (${chunk.length} requests, ${c + chunk.length}/${requests.length})`)
        lastErr = null
        break
      } catch (err) {
        lastErr = err
        console.warn(`[round ${round}] submit attempt ${attempt} failed: ${err instanceof Error ? err.message : err}`)
        await new Promise(r => setTimeout(r, attempt * 5000))
      }
    }
    if (lastErr) throw lastErr
  }

  const t0 = Date.now()
  const pending = new Set(batchIds)
  while (pending.size) {
    if (Date.now() - t0 > 3 * 60 * 60 * 1000) throw new Error(`batches timed out after 3h`)
    await new Promise(r => setTimeout(r, 30_000))
    for (const id of [...pending]) {
      try {
        const b = await client.messages.batches.retrieve(id)
        if (b.processing_status === 'ended') pending.delete(id)
      } catch (err) {
        console.warn(`[round ${round}] retrieve ${id} failed, will retry: ${err instanceof Error ? err.message : err}`)
      }
    }
    console.log(`[round ${round}] ${batchIds.length - pending.size}/${batchIds.length} batches ended`)
  }

  const ok: Rewrite[] = []
  const failed: WorkItem[] = []
  let inTok = 0, outTok = 0, cacheC = 0, cacheR = 0

  const byId = new Map<string, Anthropic.Messages.Batches.MessageBatchIndividualResponse>()
  for (const id of batchIds) {
    const stream = await client.messages.batches.results(id)
    for await (const entry of stream) byId.set(entry.custom_id, entry)
  }

  for (let i = 0; i < work.length; i++) {
    const item = work[i]!
    const entry = byId.get(`r${round}_${i}`)
    if (!entry || entry.result.type !== 'succeeded') {
      console.warn(`[round ${round}] ${item.productId} ${item.field}: batch entry ${entry?.result.type ?? 'missing'}`)
      failed.push(item)
      continue
    }
    const msg = entry.result.message
    const u = msg.usage as { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
    inTok += u.input_tokens ?? 0; outTok += u.output_tokens ?? 0
    cacheC += u.cache_creation_input_tokens ?? 0; cacheR += u.cache_read_input_tokens ?? 0

    const block = msg.content[0]
    let text = block?.type === 'text' ? block.text.trim() : ''
    text = text.replace(/^```(?:html|json)?\n?/i, '').replace(/\n?```$/i, '').trim()
    const isJsonField = ['emma_hero', 'pairing_why', 'feature_bullets'].includes(item.field)
    let valid = !!text && !stillViolates(text) && !hasEmDash(text)
    if (valid && isJsonField) {
      try { JSON.parse(text) } catch { valid = false }
    }
    if (valid && item.field === 'body_html' && !/^<p[ >]/i.test(text)) valid = false
    if (valid) ok.push({ productId: item.productId, handle: item.handle, title: item.title, field: item.field, old: item.current, new: text })
    else failed.push(item)
  }

  await logApiTokens({
    feature: 'enrichment', model: MODEL, source: 'batch',
    inputTokens: inTok, outputTokens: outTok,
    cacheCreationTokens: cacheC, cacheReadTokens: cacheR,
    requestCount: requests.length, batchId: batchIds.join(','),
    caller: 'scripts/rewrite-lived-experience.ts',
  })
  console.log(`[round ${round}] ${ok.length} clean rewrites, ${failed.length} need retry`)
  return { ok, failed }
}

const round1 = await runRound(1, items)
let all = round1.ok
let remaining = round1.failed
if (remaining.length) {
  const round2 = await runRound(2, remaining)
  all = [...all, ...round2.ok]
  remaining = round2.failed
}

writeFileSync(outPath, JSON.stringify(all, null, 2))
console.log(`\nwrote ${all.length} rewrites to ${outPath}`)
if (remaining.length) {
  console.log(`${remaining.length} field(s) FAILED both rounds:`)
  for (const f of remaining) console.log(`  - ${f.productId} ${f.field} (${f.title})`)
}
process.exit(0)

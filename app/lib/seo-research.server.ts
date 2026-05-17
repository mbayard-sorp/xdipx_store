/**
 * SEO keyword research pipeline.
 *
 * Weekly cron flow:
 *   1. Build seed list from existing approved heads + product titles + cluster pillars.
 *   2. Fetch related terms + volume + difficulty from DataForSEO (optional —
 *      falls back to LLM-only seed expansion if creds aren't set).
 *   3. Dedupe against the bank.
 *   4. LLM clusterer (Haiku) tags each candidate: kind, intent, productTypeDials,
 *      mood/audience/matters tags, relevanceScore, suggested cluster, flag.
 *   5. Auto-promote: relevanceScore ≥ 0.85 AND !flagged AND volume ≥ 50 → approved.
 *      Everything else lands as `pending` for admin review.
 *   6. Batch-write to Sanity.
 */
import { createClient } from '@sanity/client'
import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'node:crypto'
import { getAskEmmaVocabulary } from '~/lib/ask-emma-vocab.server'

const projectId  = process.env['SANITY_PROJECT_ID']
const dataset    = process.env['SANITY_DATASET'] ?? 'production'
const apiVersion = '2024-10-01'
const MODEL_FAST = 'claude-haiku-4-5-20251001'
const RESEARCH_LIMIT = 80   // total seeds → keep the run cheap & predictable

const ANTHROPIC_KEY = process.env['ANTHROPIC_API_KEY']?.trim()

interface RawCandidate {
  term:          string
  volume?:       number
  difficulty?:   number
  cpc?:          number
  source:        string
}

interface ScoredCandidate extends RawCandidate {
  kind:               'head' | 'long-tail' | 'question' | 'branded'
  intent:             'informational' | 'transactional' | 'navigational' | 'commercial'
  productTypeDials:   string[]
  moodTags:           string[]
  audienceTags:       string[]
  mattersTags:        string[]
  relevanceScore:     number
  clusterSlug:        string | null
  proposedClusterTitle?: string
  flagged:            boolean
  flagReason?:        string
}

interface VocabSnapshot { mood: string[]; audience: string[]; matters: string[] }

function getWriteClient() {
  if (!projectId) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient({
    projectId,
    dataset,
    apiVersion,
    useCdn: false,
    token: process.env['SANITY_API_TOKEN'],
    perspective: 'raw',
  } as any)
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80)
}

function termToDocId(term: string): string {
  // Sanity doc IDs allow [a-zA-Z0-9_.-]. Hash long terms to keep IDs stable + safe.
  const slug = slugify(term)
  if (slug && slug.length <= 50) return `seoKeyword.${slug}`
  const h = createHash('sha1').update(term.toLowerCase()).digest('hex').slice(0, 16)
  return `seoKeyword.${h}`
}

// ─── DataForSEO (optional) ────────────────────────────────────────────────────

const DFS_LOGIN    = process.env['DATAFORSEO_LOGIN']
const DFS_PASSWORD = process.env['DATAFORSEO_PASSWORD']
/** Pre-computed base64 of `login:password` — alternative to login/password split. */
const DFS_AUTH_B64 = process.env['DATAFORSEO_AUTH']
const DFS_BASE     = 'https://api.dataforseo.com/v3'

function dfsAuthHeader(): string | null {
  // Prefer the pre-computed base64 if provided — saves a tiny bit of work and
  // matches the format DataForSEO shows on the dashboard "API Access" page.
  if (DFS_AUTH_B64) return `Basic ${DFS_AUTH_B64.trim()}`
  if (DFS_LOGIN && DFS_PASSWORD) {
    return 'Basic ' + Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64')
  }
  return null
}

interface DFSKeywordRow {
  keyword?: string
  search_volume?: number
  cpc?: number
  competition_index?: number
  keyword_difficulty?: number
}

/**
 * DataForSEO Labs — Related Keywords. Pulls related terms with volume + difficulty.
 * Returns [] when creds aren't set or the API errors so callers can fall through.
 */
async function dfsRelatedKeywords(seed: string): Promise<RawCandidate[]> {
  const auth = dfsAuthHeader()
  if (!auth) return []
  try {
    const res = await fetch(`${DFS_BASE}/dataforseo_labs/google/related_keywords/live`, {
      method: 'POST',
      headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
      body: JSON.stringify([{
        keyword:        seed,
        language_code:  'en',
        location_code:  2840, // United States
        depth:          2,
        limit:          40,
        include_serp_info: false,
      }]),
    })
    if (!res.ok) {
      console.warn(`[seo-research] DataForSEO related ${res.status} for "${seed}"`)
      return []
    }
    const json = await res.json() as { tasks?: { result?: { items?: { keyword_data?: DFSKeywordRow & { keyword_info?: DFSKeywordRow }; depth?: number }[] }[] }[] }
    const items = json.tasks?.[0]?.result?.[0]?.items ?? []
    const out: RawCandidate[] = []
    for (const it of items) {
      const kd = it.keyword_data
      const term = kd?.keyword?.trim()
      if (!term) continue
      const info = (kd?.keyword_info ?? kd) as DFSKeywordRow | undefined
      const r: RawCandidate = {
        term,
        source: `dataforseo:related:${seed}`,
      }
      if (info && typeof info.search_volume === 'number')      r.volume     = info.search_volume
      if (info && typeof info.cpc === 'number')                r.cpc        = info.cpc
      if (info && typeof info.keyword_difficulty === 'number') r.difficulty = info.keyword_difficulty
      out.push(r)
    }
    return out
  } catch (err) {
    console.error(`[seo-research] DataForSEO related error for "${seed}":`, err)
    return []
  }
}

// ─── LLM-only fallback expansion ─────────────────────────────────────────────

async function llmSeedExpansion(seed: string): Promise<RawCandidate[]> {
  if (!ANTHROPIC_KEY) return []
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY })
  try {
    const msg = await client.messages.create({
      model: MODEL_FAST,
      max_tokens: 800,
      system: `You expand SEO seed keywords for an editorially-curated sexual-wellness storefront. Return likely real search queries, including long-tail and question forms. Tasteful, never clinical, never sleazy.`,
      messages: [{
        role: 'user',
        content: `Seed: "${seed}"\n\nReturn 12 related queries as a JSON array of strings. Mix head terms, long-tail (4+ words), and "how/what/best" question forms. No volume — we only need the strings. JSON only.`,
      }],
    })
    const block = msg.content[0]
    if (block?.type !== 'text') return []
    const raw = block.text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    return arr
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 1)
      .map((t) => ({ term: t.trim(), source: `llm-expansion:${seed}` }))
  } catch (err) {
    console.error(`[seo-research] llmSeedExpansion error for "${seed}":`, err)
    return []
  }
}

// ─── Seed list assembly ──────────────────────────────────────────────────────

interface SeedSources {
  approvedHeads:  string[]
  pillarTerms:    string[]
  productTitles:  string[]
}

async function gatherSeeds(): Promise<SeedSources> {
  const client = getWriteClient()
  if (!client) return { approvedHeads: [], pillarTerms: [], productTitles: [] }
  try {
    const [approvedHeads, pillarTerms, productTitles] = await Promise.all([
      client.fetch<string[]>(
        `*[_type == "seoKeyword" && status == "approved" && kind == "head"][].term`,
      ).catch(() => [] as string[]),
      client.fetch<string[]>(
        `*[_type == "seoCluster" && status != "archived"][].pillarTerm`,
      ).catch(() => [] as string[]),
      client.fetch<string[]>(
        `*[_type == "productPage" && defined(title)] | order(_updatedAt desc)[0...50][].title`,
      ).catch(() => [] as string[]),
    ])
    return {
      approvedHeads:  (approvedHeads ?? []).filter(Boolean),
      pillarTerms:    (pillarTerms ?? []).filter(Boolean),
      productTitles:  (productTitles ?? []).filter(Boolean),
    }
  } catch (err) {
    console.error('[seo-research] gatherSeeds error:', err)
    return { approvedHeads: [], pillarTerms: [], productTitles: [] }
  }
}

async function fetchExistingTerms(): Promise<Set<string>> {
  const client = getWriteClient()
  if (!client) return new Set()
  try {
    const rows = await client.fetch<string[]>(`*[_type == "seoKeyword"][].term`)
    return new Set((rows ?? []).map((t) => t.toLowerCase()))
  } catch {
    return new Set()
  }
}

async function fetchVocabulary(): Promise<VocabSnapshot> {
  // The matters axis is anchored to MATTERS_V2 in code via getAskEmmaVocabulary —
  // SEO keyword research mints clusters against the canonical chip set, not the
  // Sanity singleton (which may still hold a stale v1 list for audit).
  try {
    return await getAskEmmaVocabulary()
  } catch {
    return { mood: [], audience: [], matters: [] }
  }
}

async function fetchClusterCatalog(): Promise<{ slug: string; pillarTerm: string; title: string }[]> {
  const client = getWriteClient()
  if (!client) return []
  try {
    return (
      (await client.fetch<{ slug: string; pillarTerm: string; title: string }[]>(
        `*[_type == "seoCluster" && status != "archived"]{ "slug": slug.current, pillarTerm, title }`,
      )) ?? []
    )
  } catch {
    return []
  }
}

// ─── LLM clusterer / tagger ──────────────────────────────────────────────────

interface ClustererInputItem { term: string; volume?: number; difficulty?: number }
interface ClustererOutputItem {
  term:               string
  kind:               ScoredCandidate['kind']
  intent:             ScoredCandidate['intent']
  productTypeDials:   string[]
  moodTags:           string[]
  audienceTags:       string[]
  mattersTags:        string[]
  relevanceScore:     number
  clusterSlug:        string | null
  proposedClusterTitle?: string
  flagged:            boolean
  flagReason?:        string
}

const CATALOG_SUMMARY = `xdipx.com is an editorially-curated sexual-wellness storefront. Categories include personal lubricants, intimate-massage devices (wand, vibrator, air-pulsation), wear, and accessories. Tasteful, never clinical, never sleazy. Audience is curious adults — first-time buyers and experienced users. Editorial voice (Emma) is playful, warm, and discreet.`

async function classifyBatch(
  batch: ClustererInputItem[],
  vocab: VocabSnapshot,
  clusters: { slug: string; pillarTerm: string }[],
): Promise<ClustererOutputItem[]> {
  if (!ANTHROPIC_KEY) {
    // No LLM available — return permissive defaults so the pipeline still ships data.
    return batch.map((b) => ({
      term:               b.term,
      kind:               b.term.split(/\s+/).length >= 4 ? 'long-tail' : 'head',
      intent:             'informational',
      productTypeDials:   [],
      moodTags:           [],
      audienceTags:       [],
      mattersTags:        [],
      relevanceScore:     0.5,
      clusterSlug:        null,
      flagged:            false,
    }))
  }
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY })
  const clustersList = clusters.map(c => `${c.slug} (${c.pillarTerm})`).join(', ')
  const sys = `You classify SEO keyword candidates for an editorially-curated sexual-wellness storefront. Use only the controlled vocabularies provided. Flag conservatively but accurately — only the three valid policy categories below, never adjacent worries.`
  const user = `Catalog: ${CATALOG_SUMMARY}

Existing clusters: ${clustersList || '(none yet — propose new ones with kebab-case slugs)'}
Mood vocabulary: ${vocab.mood.join(', ') || '(empty)'}
Audience vocabulary: ${vocab.audience.join(', ') || '(empty)'}
Matters vocabulary: ${vocab.matters.join(', ') || '(empty)'}
Product type dials (closed list): air-pulsation, vibrator, wand, lube, wear

CLUSTER ASSIGNMENT RULES (strict — prevents cluster proliferation):
- ALWAYS try to match an existing cluster first. Use clusterSlug from the list above.
- ONLY propose a new cluster when no existing cluster is even loosely related. Aim for 5+ keywords per cluster.
- Use proposedClusterTitle ONLY when clusterSlug is null AND you're confident the term opens a genuinely new topic.
- Single-keyword clusters are forbidden. If you can't find 4+ likely siblings for a proposed cluster, leave clusterSlug null with no proposal.

FLAGGING RULES (strict — only these three categories warrant flagged=true):
1. Off-brand COMPETITOR NAME — a real competing product/brand/retailer is named: KY, Womanizer, We-Vibe, Lelo, Magic Wand, Hitachi, Lovense, Whisper, Petal Pull, Velvet Noir, Lovehoney, Adam & Eve, Babeland, Fifty Shades, Target, Walmart, Amazon, CVS, etc. ALSO flag generic-sounding model names like "Wand 2" if they read as competitor SKUs.
2. Regulated MEDICAL/EFFICACY CLAIM — terms framing products as treating a condition: "for dryness", "for menopause", "doctor recommended", "therapeutic", "health benefits", "treats X", "cures X", "prescription". Frequency-of-use ("how often should you use X") and product-education ("what does X do") are NOT medical claims.
3. EXPLICITLY GRAPHIC term outside the tasteful catalog — explicit anatomical slang or fetish-specific terms the catalog doesn't carry.

DO NOT FLAG these (common false positives):
- Category descriptors: "best wand vibrator", "luxury prostate massager", "best vibrator brands for beginners", "body-safe silicone dildo brands". The word "brands" by itself is not a competitor name. xdipx WANTS to rank for these.
- Comparison-shaped terms ("X vs Y") UNLESS they actually name a competitor brand.
- DIY/curiosity questions ("how to make personal lubricant") — those users are still in-market.
- Functional questions ("how does X work", "what is X used for") — informational intent, not medical claims.
- Generic relationship/benefit language ("improve relationships") — that's marketing copy, not a health claim.
- Out-of-catalog product types (e.g. "thrusting stroker" if you don't carry strokers). Set status to rejected via low relevanceScore (< 0.3) — DO NOT flag.

For each candidate, return one JSON object with:
- term: string (echo exactly)
- kind: "head" | "long-tail" | "question" | "branded"
- intent: "informational" | "transactional" | "navigational" | "commercial"
- productTypeDials: array of closed-list values (empty if not specific)
- moodTags / audienceTags / mattersTags: arrays of slugs from the provided vocabulary (empty if none fit)
- relevanceScore: 0–1 (how well this fits the xdipx catalog and audience). Use < 0.3 for terms outside the catalog (e.g. wrong product category) — those will be filtered out without needing a flag.
- clusterSlug: existing slug from the list above, or null if a new cluster fits better
- proposedClusterTitle: short Title Case label IF clusterSlug is null AND you can name 4+ likely siblings
- flagged: true ONLY for the three valid categories above; false otherwise
- flagReason: one-line explanation when flagged=true, naming which of the three categories applies

Candidates:
${batch.map((b, i) => `${i + 1}. ${b.term}`).join('\n')}

Return a JSON array of objects. JSON only — no prose, no fences.`

  try {
    const msg = await client.messages.create({
      model:     MODEL_FAST,
      max_tokens: 4096,
      system:    sys,
      messages:  [{ role: 'user', content: user }],
    })
    const block = msg.content[0]
    if (block?.type !== 'text') return []
    const raw = block.text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    return arr.filter((x): x is ClustererOutputItem => !!x && typeof x === 'object' && typeof (x as { term?: unknown }).term === 'string')
  } catch (err) {
    console.error('[seo-research] classifyBatch error:', err)
    return []
  }
}

// ─── Sanity write helpers ────────────────────────────────────────────────────

async function ensureCluster(
  slug: string,
  pillarTerm: string,
  title: string,
): Promise<string | null> {
  const client = getWriteClient()
  if (!client) return null
  try {
    const id = `seoCluster.${slugify(slug)}`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await client.createIfNotExists({
      _id:        id,
      _type:      'seoCluster',
      slug:       { _type: 'slug', current: slugify(slug) },
      title,
      pillarTerm,
      status:     'active',
    } as any)
    return id
  } catch (err) {
    console.error(`[seo-research] ensureCluster failed for ${slug}:`, err)
    return null
  }
}

interface WriteSummary {
  attempted: number
  written:   number
  approved:  number
  pending:   number
  rejected:  number
  errors:    number
}

/**
 * Routing rules for newly-classified candidates:
 *   - relevanceScore < 0.30  → status='rejected' (out-of-vertical noise: bluetooth
 *     adapters, supplements, off-category brands the LLM expansion pulled in.
 *     These shouldn't pollute the triage queue. They land as rejected so they
 *     join the <avoid> list automatically and dedupe prevents re-fetching.)
 *   - relevanceScore ≥ 0.85 AND volume ≥ 50 AND !flagged → status='approved'
 *     (auto-promote: very high confidence, real volume, no policy issue)
 *   - everything else → status='pending' (admin/agent triage)
 */
const AUTO_REJECT_THRESHOLD  = 0.30
const AUTO_APPROVE_THRESHOLD = 0.85
const AUTO_APPROVE_MIN_VOLUME = 50

async function writeCandidates(items: ScoredCandidate[]): Promise<WriteSummary> {
  const client = getWriteClient()
  if (!client) return { attempted: 0, written: 0, approved: 0, pending: 0, rejected: 0, errors: 0 }

  const summary: WriteSummary = { attempted: items.length, written: 0, approved: 0, pending: 0, rejected: 0, errors: 0 }
  const now = new Date().toISOString()

  for (const it of items) {
    let status: 'approved' | 'pending' | 'rejected'
    if (it.relevanceScore < AUTO_REJECT_THRESHOLD) {
      status = 'rejected'
    } else if (
      !it.flagged &&
      it.relevanceScore >= AUTO_APPROVE_THRESHOLD &&
      (it.volume ?? 0) >= AUTO_APPROVE_MIN_VOLUME
    ) {
      status = 'approved'
    } else {
      status = 'pending'
    }

    let clusterRef: { _type: 'reference'; _ref: string } | undefined
    if (it.clusterSlug) {
      // Existing cluster — reference by deterministic id.
      clusterRef = { _type: 'reference', _ref: `seoCluster.${slugify(it.clusterSlug)}` }
    } else if (it.proposedClusterTitle) {
      const newSlug = slugify(it.proposedClusterTitle)
      const id = await ensureCluster(newSlug, it.term, it.proposedClusterTitle)
      if (id) clusterRef = { _type: 'reference', _ref: id }
    }

    const docId = termToDocId(it.term)
    const doc: Record<string, unknown> = {
      _id:               docId,
      _type:             'seoKeyword',
      term:              it.term,
      kind:              it.kind,
      intent:            it.intent,
      productTypeDials:  it.productTypeDials,
      moodTags:          it.moodTags,
      audienceTags:      it.audienceTags,
      mattersTags:       it.mattersTags,
      relevanceScore:    it.relevanceScore,
      status,
      flagged:           it.flagged,
      firstSeenAt:       now,
      lastResearchedAt:  now,
      sources:           [it.source],
    }
    if (typeof it.volume === 'number')     doc.volume     = it.volume
    if (typeof it.difficulty === 'number') doc.difficulty = it.difficulty
    if (typeof it.cpc === 'number')        doc.cpc        = it.cpc
    if (it.flagReason)                     doc.flagReason = it.flagReason
    if (clusterRef)                        doc.cluster    = clusterRef

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await client.createIfNotExists(doc as any)
      summary.written++
      if (status === 'approved') summary.approved++
      else if (status === 'rejected') summary.rejected++
      else summary.pending++
    } catch (err) {
      summary.errors++
      console.error(`[seo-research] write failed for "${it.term}":`, err)
    }
  }

  return summary
}

// ─── Top-level orchestrator ──────────────────────────────────────────────────

export interface KeywordResearchResult {
  seedsUsed:       number
  candidatesFound: number
  newCandidates:   number
  written:         number
  approved:        number
  pending:         number
  /** Auto-rejected (relevanceScore < 0.30) — out-of-vertical noise. */
  rejected:        number
  errors:          number
  source:          'dataforseo' | 'llm-only'
  durationMs:      number
}

export async function runKeywordResearch(opts?: {
  /** Override the default seed cap (RESEARCH_LIMIT=80). */
  maxSeeds?: number
  /** Manual seed override (admin trigger). */
  manualSeeds?: string[]
}): Promise<KeywordResearchResult> {
  const start = Date.now()
  const useDFS = !!dfsAuthHeader()
  console.log(`[seo-research] starting run · source=${useDFS ? 'dataforseo' : 'llm-only'}`)

  // 1. Seeds.
  const sources = await gatherSeeds()
  const baseSeeds = [
    ...(opts?.manualSeeds ?? []),
    ...sources.pillarTerms,
    ...sources.approvedHeads,
    ...sources.productTitles,
  ]
  const seeds = Array.from(new Set(baseSeeds.map((s) => s.trim()).filter(Boolean)))
    .slice(0, opts?.maxSeeds ?? RESEARCH_LIMIT)
  console.log(`[seo-research] seeds=${seeds.length}: ${seeds.slice(0, 5).join(', ')}${seeds.length > 5 ? '…' : ''}`)

  // 2. Fetch.
  const rawByTerm = new Map<string, RawCandidate>()
  for (let s = 0; s < seeds.length; s++) {
    const seed = seeds[s]!
    console.log(`[seo-research] expanding seed ${s + 1}/${seeds.length}: "${seed}"`)
    const fromDFS = useDFS ? await dfsRelatedKeywords(seed) : []
    const merged = fromDFS.length > 0 ? fromDFS : await llmSeedExpansion(seed)
    console.log(`[seo-research]   → ${merged.length} candidates from ${fromDFS.length > 0 ? 'dfs' : 'llm'}`)
    for (const c of merged) {
      const key = c.term.toLowerCase()
      const prev = rawByTerm.get(key)
      if (!prev) { rawByTerm.set(key, c); continue }
      const prevHasData = typeof prev.volume === 'number'
      const cHasData    = typeof c.volume === 'number'
      if (cHasData && !prevHasData) rawByTerm.set(key, c)
    }
  }
  console.log(`[seo-research] total unique candidates: ${rawByTerm.size}`)

  // 3. Dedupe against bank.
  const existing = await fetchExistingTerms()
  const fresh: RawCandidate[] = []
  for (const c of rawByTerm.values()) {
    if (!existing.has(c.term.toLowerCase())) fresh.push(c)
  }
  console.log(`[seo-research] new (after dedupe): ${fresh.length} (existing bank size: ${existing.size})`)

  // 4. Classify.
  const [vocab, clusters] = await Promise.all([fetchVocabulary(), fetchClusterCatalog()])
  console.log(`[seo-research] classifying ${fresh.length} candidates in batches of 12 (vocab: mood=${vocab.mood.length} audience=${vocab.audience.length} matters=${vocab.matters.length})`)
  const scored: ScoredCandidate[] = []
  for (let i = 0; i < fresh.length; i += 12) {
    const batch = fresh.slice(i, i + 12)
    const batchNum = Math.floor(i / 12) + 1
    const totalBatches = Math.ceil(fresh.length / 12)
    console.log(`[seo-research] classify batch ${batchNum}/${totalBatches} (${batch.length} items)`)
    const classified = await classifyBatch(
      batch.map((b) => {
        const out: ClustererInputItem = { term: b.term }
        if (typeof b.volume === 'number')     out.volume     = b.volume
        if (typeof b.difficulty === 'number') out.difficulty = b.difficulty
        return out
      }),
      vocab,
      clusters,
    )
    const byTerm = new Map(classified.map((c) => [c.term.toLowerCase(), c]))
    for (const raw of batch) {
      const c = byTerm.get(raw.term.toLowerCase())
      if (!c) continue
      const merged: ScoredCandidate = {
        term:               c.term,
        source:             raw.source,
        kind:               c.kind,
        intent:             c.intent,
        productTypeDials:   c.productTypeDials ?? [],
        moodTags:           c.moodTags ?? [],
        audienceTags:       c.audienceTags ?? [],
        mattersTags:        c.mattersTags ?? [],
        relevanceScore:     typeof c.relevanceScore === 'number' ? c.relevanceScore : 0.5,
        clusterSlug:        c.clusterSlug,
        flagged:            !!c.flagged,
      }
      if (typeof raw.volume === 'number')     merged.volume     = raw.volume
      if (typeof raw.difficulty === 'number') merged.difficulty = raw.difficulty
      if (typeof raw.cpc === 'number')        merged.cpc        = raw.cpc
      if (c.proposedClusterTitle)             merged.proposedClusterTitle = c.proposedClusterTitle
      if (c.flagReason)                       merged.flagReason = c.flagReason
      scored.push(merged)
    }
  }

  // 5. Write.
  console.log(`[seo-research] writing ${scored.length} scored candidates to Sanity`)
  const writeSummary = await writeCandidates(scored)
  console.log(`[seo-research] write complete: written=${writeSummary.written} approved=${writeSummary.approved} pending=${writeSummary.pending} rejected=${writeSummary.rejected} errors=${writeSummary.errors}`)

  return {
    seedsUsed:       seeds.length,
    candidatesFound: rawByTerm.size,
    newCandidates:   fresh.length,
    written:         writeSummary.written,
    approved:        writeSummary.approved,
    pending:         writeSummary.pending,
    rejected:        writeSummary.rejected,
    errors:          writeSummary.errors,
    source:          useDFS ? 'dataforseo' : 'llm-only',
    durationMs:      Date.now() - start,
  }
}

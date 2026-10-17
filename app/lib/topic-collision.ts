/**
 * Topic-collision check (ticket #14988), a sibling of fresh-language.ts for a
 * gap that one is structurally blind to: a draft whose SUBJECT MATTER already
 * fully belongs to a published post, in different words.
 *
 * `check-fresh-language.ts` flags a shared word-6-gram. That is the right
 * grain for a hardened PHRASE (ticket #3009's "Where does this need a
 * caveat?"), but it cannot see this corpus's other failure shape: two H2
 * headings on the same beginner-level sub-topic reliably reach for the same
 * core nouns ("dilators", "plugs", "numbing", "douching") while the
 * surrounding words differ enough that neither a 6-gram nor a literal
 * substring match ever fires — and most H2 headings here are 2-5 words, so a
 * near-identical heading usually cannot even reach the 6-word floor a 6-gram
 * requires. #14988 calls this "the same gap one level up that #7462
 * identified for the antithesis shape: the words differ while the structure
 * repeats."
 *
 * This module compares by NORMALIZED TOKEN SET overlap (Jaccard), not
 * contiguous n-grams, against three surfaces a repeat tends to show up on:
 *
 *   1. H2 headings (not h1/h3/h4 — H2 is the sub-topic unit this corpus
 *      actually repeats on; comparing a whole title against a single H2
 *      would conflate two different granularities on one threshold).
 *   2. The title itself, against prior titles (a reworded restatement of an
 *      already-covered question, the run-760 "what-helps-when-you-finish-
 *      faster-than-you-want" vs "what-counts-as-premature-ejaculation" shape
 *      — same underlying topic, zero shared subject vocabulary at the title
 *      level, so this signal alone will not catch every such case; see (3)).
 *   3. Embedded products (`blogProductEmbed.productHandle`): the run-760
 *      collision was identified "down to the same three candidate embeds"
 *      — when a draft and a prior post serving a genuinely different-looking
 *      title still converge on embedding the same handful of products, that
 *      is strong independent evidence they are answering the same reader
 *      question, and it needs no heading or title wording to agree at all.
 *
 * Deliberately NOT a semantic/embeddings match: that is a bigger, separate
 * design decision (provider, cost, threshold calibration) outside what a
 * single mechanical check should decide on its own. This catches the
 * mechanical, already-evidenced gap: short headings too similar to be
 * accidental, or the same products embedded twice.
 */

// ─── Text normalization (shared shape with fresh-language.ts's tokenizer) ──

/** A conservative English stopword list: enough to strip connective noise
 *  from a short heading/title without risking a real content word. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'for', 'to', 'of', 'in', 'on', 'at',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this',
  'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'how', 'why',
  'when', 'where', 'do', 'does', 'did', 'you', 'your', 'about', 'with', 'as',
])

export function normalizeTokenSet(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? []
  return new Set(words.filter(w => !STOPWORDS.has(w)))
}

/** Intersection-over-union. 0 when either set is empty. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const w of a) if (b.has(w)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

// ─── Portable Text extraction ──────────────────────────────────────────────

interface PtBlock {
  _type?: string
  style?: string
  children?: { text?: string }[]
  productHandle?: string
}

function blockText(block: PtBlock): string {
  return (block.children ?? []).map(c => c.text ?? '').join('')
}

/** H2-only, unlike fresh-language.ts's toTextUnits (h1-h4): H2 is the
 *  sub-topic unit this corpus repeats on, and widening to h3/h4 would compare
 *  across two different structural levels. */
export function extractH2Headings(body: unknown): string[] {
  const blocks = Array.isArray(body) ? (body as PtBlock[]) : []
  const out: string[] = []
  for (const block of blocks) {
    if (!block || block._type !== 'block' || block.style !== 'h2') continue
    const text = blockText(block).trim()
    if (text) out.push(text)
  }
  return out
}

/** Every `blogProductEmbed.productHandle` in the body, in document order,
 *  deduped. A block missing `productHandle` (malformed or still resolving)
 *  is skipped rather than counted as a handle of `''`. */
export function extractProductEmbeds(body: unknown): string[] {
  const blocks = Array.isArray(body) ? (body as PtBlock[]) : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const block of blocks) {
    if (!block || block._type !== 'blogProductEmbed') continue
    const handle = block.productHandle
    if (!handle || seen.has(handle)) continue
    seen.add(handle)
    out.push(handle)
  }
  return out
}

// ─── Structural headings ────────────────────────────────────────────────────

/**
 * Headings the content routine itself mandates to repeat, verbatim, on every
 * post that carries them — the H2-vs-H2 Jaccard check otherwise flags every
 * single post against itself on these, with no way to ever clear (ticket
 * #16008, four runs: 1438, 1456, 1475, 1494). fresh-language.ts's 6-gram
 * floor protects it from this for free (a 3-word heading can never reach a
 * 6-word shingle); Jaccard has no such floor, so this list is the explicit
 * equivalent. "Frequently asked questions" is mandatory on every post
 * (routine-content-daily.md's content quality bar); "Sources" is inserted
 * mechanically, verbatim, whenever the accuracy gate returns a citation
 * (Step 5). Both are format, not content: comparing them tells you nothing
 * about whether two posts share a topic.
 */
const STRUCTURAL_HEADINGS = new Set(['frequently asked questions', 'sources'])

function isStructuralHeading(heading: string): boolean {
  return STRUCTURAL_HEADINGS.has(heading.trim().toLowerCase())
}

// ─── Analysis ───────────────────────────────────────────────────────────────

export interface TopicCollisionCandidate {
  title?: string | null
  /** Portable Text array (blogPost.body) — an H2 outline is enough; full
   *  prose is not required for the heading/embed signals to fire. */
  body?: unknown
}

export interface PriorPostForCollision {
  slug?: string | null
  title?: string | null
  body?: unknown
}

export interface HeadingOverlapHit {
  draftHeading: string
  priorSlug: string
  priorHeading: string
  overlap: number
  sharedTokens: string[]
}

export interface TitleOverlapHit {
  priorSlug: string
  priorTitle: string
  overlap: number
  sharedTokens: string[]
}

export interface EmbedOverlapHit {
  priorSlug: string
  sharedHandles: string[]
  overlap: number
}

export interface TopicCollisionReport {
  headingHits: HeadingOverlapHit[]
  titleHits: TitleOverlapHit[]
  embedHits: EmbedOverlapHit[]
  collision: boolean
}

export interface TopicCollisionOptions {
  /** Jaccard floor for an H2-vs-H2 pair. Default 0.5: at least half the
   *  union of the two heading's content words must be shared. */
  headingThreshold?: number
  /** Jaccard floor for a title-vs-title pair. Higher than the heading floor
   *  by default: a title is read in full by the reader, so a coincidental
   *  partial match is less forgivable than for an internal sub-heading. */
  titleThreshold?: number
  /** Minimum number of shared embedded product handles to flag, OR a
   *  fraction of the draft's own embed count — whichever is reached first.
   *  Default 2 handles, matching "down to the same three candidate embeds"
   *  (run 760) with margin for a post that only embeds two. */
  minSharedEmbeds?: number
}

function sharedTokens(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = []
  for (const w of a) if (b.has(w)) out.push(w)
  return out.sort()
}

/**
 * Report every H2/title/embed surface the candidate shares with a prior post
 * above its threshold. Call with just a title (and no body / an outline-only
 * body) as soon as a topic is picked and an H2 skeleton is sketched —
 * (`routine-content-daily.md` Step 4) — rather than waiting for full prose,
 * so a collision is caught before the draft is written, not during it.
 */
export function analyzeTopicCollision(
  draft: TopicCollisionCandidate,
  priors: PriorPostForCollision[],
  opts: TopicCollisionOptions = {},
): TopicCollisionReport {
  const headingThreshold = opts.headingThreshold ?? 0.5
  const titleThreshold = opts.titleThreshold ?? 0.6
  const minSharedEmbeds = opts.minSharedEmbeds ?? 2

  const draftHeadings = extractH2Headings(draft.body).filter(h => !isStructuralHeading(h))
  const draftEmbeds = new Set(extractProductEmbeds(draft.body))
  const draftTitleTokens = draft.title ? normalizeTokenSet(draft.title) : new Set<string>()

  const headingHits: HeadingOverlapHit[] = []
  const titleHits: TitleOverlapHit[] = []
  const embedHits: EmbedOverlapHit[] = []

  priors.forEach((prior, i) => {
    const slug = prior.slug?.trim() || `prior-${i}`

    if (prior.title) {
      const priorTitleTokens = normalizeTokenSet(prior.title)
      const overlap = jaccard(draftTitleTokens, priorTitleTokens)
      if (overlap >= titleThreshold) {
        titleHits.push({
          priorSlug: slug,
          priorTitle: prior.title,
          overlap,
          sharedTokens: sharedTokens(draftTitleTokens, priorTitleTokens),
        })
      }
    }

    for (const priorHeading of extractH2Headings(prior.body)) {
      if (isStructuralHeading(priorHeading)) continue
      const priorHeadingTokens = normalizeTokenSet(priorHeading)
      for (const draftHeading of draftHeadings) {
        const overlap = jaccard(normalizeTokenSet(draftHeading), priorHeadingTokens)
        if (overlap >= headingThreshold) {
          headingHits.push({
            draftHeading,
            priorSlug: slug,
            priorHeading,
            overlap,
            sharedTokens: sharedTokens(normalizeTokenSet(draftHeading), priorHeadingTokens),
          })
        }
      }
    }

    const priorEmbeds = extractProductEmbeds(prior.body)
    const shared = priorEmbeds.filter(h => draftEmbeds.has(h))
    if (shared.length >= minSharedEmbeds) {
      embedHits.push({
        priorSlug: slug,
        sharedHandles: shared,
        overlap: shared.length / Math.max(draftEmbeds.size, priorEmbeds.length, 1),
      })
    }
  })

  return {
    headingHits,
    titleHits,
    embedHits,
    collision: headingHits.length > 0 || titleHits.length > 0 || embedHits.length > 0,
  }
}

/**
 * Content words of a slug or title, for deriving a GROQ `match` glob (the
 * CLI's "same category plus any whose slug shares the topic stem" retrieval
 * criterion). Exported so the CLI and its test can agree on the exact word
 * list without re-deriving it twice.
 */
export function topicStemWords(slugOrTitle: string): string[] {
  const words = slugOrTitle.toLowerCase().match(/[a-z0-9]+/g) ?? []
  return [...new Set(words.filter(w => w.length > 2 && !STOPWORDS.has(w)))]
}

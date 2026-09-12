/**
 * Server-side voice and publish gates for the social routine (ticket #6916).
 *
 * Context. `routine-social-daily.md` Steps 4a and 6.5 require every social
 * draft to clear `emma-empathy-reviewer` (voice) and, on Instagram/X,
 * `social-publish-gate` (publish) before it can be relayed to
 * `POST /api/team/social-post {op:'draft'|'gate'}`. Both gates were written
 * to be spawned as fresh Claude Code subagents with no visibility into the
 * drafting run's own reasoning. Runs 331 (2026-08-15), 623 and 624
 * (2026-09-01) all confirmed the scheduled cloud routine's execution context
 * has no Task/Agent subagent-invocation tool, so neither gate can ever be
 * spawned there — the drafting pipeline stood down to zero drafts on every
 * scheduled pass, correctly, per the fail-closed rule, but permanently.
 *
 * This module is the fix: both gates run here as their own model call,
 * server-side, reachable the same way the routine already reaches every
 * other `/api/team/*` route. The independence property both gate documents
 * insist on is preserved deliberately: this module never sees the drafting
 * run's own reasoning about why a draft is compliant, only the finished
 * caption/media the way a stranger would read them, exactly as
 * `.claude/agents/social-publish-gate.md`'s `<independence>` section
 * requires of the subagent it replaces.
 *
 * Scope, stated honestly. `runVoiceGateCheck` reviews one string against the
 * full charter core + the matching addendum, which is the whole of what
 * `emma-empathy-reviewer` does for a single social caption (its per-file /
 * per-string workflow and its blog/video/homepage-SEO scope are out of scope
 * here; this endpoint's contract is `{text, addendum}` -> one verdict).
 * `runPublishGateCheck` runs the FULL deterministic floor
 * (`runDeterministicPublishChecks`, unchanged and un-lowered) plus a vision
 * LLM pass judging the checks `social-publish-gate.md`'s `<checks>` section
 * lists that need real judgment: image/caption match, product proportion,
 * baked-in text, anatomy/age ambiguity, the withholding test, "does it read
 * as selling" (Instagram), and the charter's graphic-detail and vocabulary
 * fences. It does NOT replicate every input that agent reads (grid history
 * beyond the last handful of captions, the active campaign's visual scheme,
 * roster-rotation bookkeeping, `owner-feedback-unmet` clause-matching) — see
 * the doc-comment on `runPublishGateCheck` for the exact list. Those remain
 * real gaps versus the subagent this replaces, and are named rather than
 * quietly dropped so a future ticket can close them.
 */
import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from './db.server'
import { socialPosts } from '../../db/schema'
import { SONNET } from './models.server'
import { EMMA_VOICE_SOCIAL, EMMA_VOICE_LINKEDIN } from './emma-voice.server'
import { runDeterministicPublishChecks, type GatePlatform, type GateFinding } from './social-publish-gate.server'
import { getProductHandleById, getProductByHandle } from './shopify.server'
import { logApiTokens } from './token-log.server'
import { cached } from './kv.server'

const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']?.trim() })

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Load a repo doc by relative path the same way `emma-voice.server.ts` loads
 * the charter: `process.cwd()` first (Vercel's `includeFiles` bundle root),
 * then two `__dirname`-relative fallbacks for the Vite SSR build and local
 * `tsx` runs. See that file's header comment for why a plain `?raw` import
 * cannot be used here.
 */
function loadDoc(relPath: string): string {
  const candidates = [
    resolve(process.cwd(), relPath),
    resolve(__dirname, '../../', relPath),
    resolve(__dirname, '../', relPath),
  ]
  const path = candidates.find(p => existsSync(p))
  if (!path) {
    throw new Error(`team-gates.server: ${relPath} not found; tried ${candidates.join(', ')}`)
  }
  return readFileSync(path, 'utf-8')
}

/** Slice a doc between two exact heading lines (inclusive of neither), or '' if either is missing. */
function sliceBetweenHeadings(doc: string, startHeading: string, endHeading: string): string {
  const start = doc.indexOf(startHeading)
  const end = doc.indexOf(endHeading, start + startHeading.length)
  if (start === -1 || end === -1) return ''
  return doc.slice(start, end).trim()
}

const ADS_POLICY_DOC = loadDoc('docs/ads-policy.md')
/**
 * `docs/store-team/instagram-campaigns.md` §3.2a, the single operative imagery
 * ceiling for social (owner ruling 2026-08-16, explicit list 2026-08-22). The
 * gate judged frames without it for its first two weeks and BLOCKed a licensed
 * eyes-closed, head-back frame as "post-coital" on 2026-09-06 (row 183), one
 * of two zero-post days. Read fresh at module init like the ads policy.
 */
const INSTAGRAM_CAMPAIGNS_DOC = loadDoc('docs/store-team/instagram-campaigns.md')
export const IMAGERY_CEILING_EXCERPT = sliceBetweenHeadings(
  INSTAGRAM_CAMPAIGNS_DOC,
  '### 3.2a The ceiling',
  '### 3.2b The ceiling is a target for the set',
)
/** `docs/ads-policy.md` §Organic social + §Creative rules, read fresh at module init. */
const ADS_POLICY_SOCIAL_EXCERPT = [
  sliceBetweenHeadings(ADS_POLICY_DOC, '## Organic social', '## Meta Shops'),
  sliceBetweenHeadings(ADS_POLICY_DOC, '## Creative rules', '## The `policyCheck` protocol'),
].filter(Boolean).join('\n\n')

// ── Voice gate ───────────────────────────────────────────────────────────

export const VOICE_GATE_ADDENDA = ['social', 'linkedin'] as const
export type VoiceGateAddendum = (typeof VOICE_GATE_ADDENDA)[number]

export interface VoiceGateInput {
  text: string
  /** Defaults to 'social' (Instagram/TikTok/X), the routine's primary caller. */
  addendum?: VoiceGateAddendum | undefined
}

export interface VoiceGateOutput {
  verdict: 'PASS' | 'REVISE' | 'BLOCK'
  reviewer: 'voice-gate'
  notes: string
}

function charterFor(addendum: VoiceGateAddendum): string {
  return addendum === 'linkedin' ? EMMA_VOICE_LINKEDIN : EMMA_VOICE_SOCIAL
}

const VOICE_GATE_SYSTEM_PREFIX = `You are the independent voice gate for xdipx.com's social drafts, standing in
for emma-empathy-reviewer where no subagent can be spawned. You do not know why the drafter
believes this caption is compliant; judge it cold, as a stranger reading it for the first time.

Read the caption against the charter below. Return exactly one JSON object, no prose before or
after it, no markdown code fence:

{"verdict": "PASS" | "REVISE" | "BLOCK", "notes": "<one to three sentences: what you checked and what you found>"}

BLOCK for: an em-dash character, a closer that ends on a price or a number, two question marks in
one reply, a lived-experience claim ("I tried/tested/own/my favorite toy"), "sex"/"sexy" used as a
branding adjective, crude or porn-copy phrasing, "Buy now", any named house tic the charter bans,
or graphic narrated acts / arousal-state description where the charter's register caps below it.
REVISE for anything fixable that falls short of the charter's register or closes wrong but is not
a hard-rule violation. PASS only when the caption would clear every rule below on a strict reading.

Charter (core + addendum):
`

export async function runVoiceGateCheck(input: VoiceGateInput): Promise<VoiceGateOutput> {
  const text = input.text?.trim()
  if (!text) throw new Response('Bad Request: text required', { status: 400 })
  const addendum = input.addendum && VOICE_GATE_ADDENDA.includes(input.addendum) ? input.addendum : 'social'

  const system = `${VOICE_GATE_SYSTEM_PREFIX}${charterFor(addendum)}`
  const msg = await client.messages.create({
    model: SONNET,
    max_tokens: 512,
    system,
    messages: [{ role: 'user', content: `Caption to review:\n\n${text}` }],
  })
  void logTokens('voice-gate', msg.usage)
  const block = msg.content[0]
  if (block?.type !== 'text') throw new Error('runVoiceGateCheck: unexpected Claude response type')
  const parsed = parseVoiceGateModelOutput(block.text)
  return { verdict: parsed.verdict, reviewer: 'voice-gate', notes: parsed.notes }
}

/** Pure parse of the model's raw text into a verdict, so the contract is unit-testable directly. */
export function parseVoiceGateModelOutput(raw: string): { verdict: 'PASS' | 'REVISE' | 'BLOCK'; notes: string } {
  const json = extractJson(raw)
  const verdictRaw = typeof json['verdict'] === 'string' ? json['verdict'].toUpperCase() : ''
  if (verdictRaw !== 'PASS' && verdictRaw !== 'REVISE' && verdictRaw !== 'BLOCK') {
    // Fail closed: an unparseable or missing verdict is never treated as a PASS.
    return { verdict: 'BLOCK', notes: `voice-gate: could not parse a verdict from the model response: ${raw.slice(0, 300)}` }
  }
  const notes = typeof json['notes'] === 'string' && json['notes'].trim() ? json['notes'].trim() : '(no notes returned)'
  return { verdict: verdictRaw, notes }
}

// ── Publish gate ─────────────────────────────────────────────────────────

export interface PublishGateFinding {
  check: string
  verdict: 'pass' | 'revise' | 'block' | 'hold'
  note?: string
}

export interface PublishGateOutput {
  id: number
  gate: {
    verdict: 'PASS' | 'REVISE' | 'BLOCK' | 'HOLD'
    reviewer: 'publish-gate'
    notes: string
    featuresProduct: boolean
    productHandle?: string
    findings: PublishGateFinding[]
  }
}

/**
 * Content identity for the vision-judgment cache (ticket #8452). Hashes
 * exactly what the model is shown — platform, caption, media, alt text, and
 * the resolved product handle — so a hash match means the model would be
 * shown byte-identical input to the call that produced the cached verdict.
 * Deliberately excludes `recentCaptions`/precedents: those drift as new posts
 * go live between calls, and treating that drift as "the row changed" would
 * defeat the point (a row gated twice minutes apart, as in the incident this
 * closes, sees the same precedent set both times anyway).
 */
export function computePublishGateContentHash(input: {
  platform: GatePlatform
  tweetText: string
  mediaUrls: readonly string[] | null | undefined
  altText: string | null | undefined
  productHandle: string | null
}): string {
  const stable = JSON.stringify({
    platform: input.platform,
    tweetText: input.tweetText,
    mediaUrls: input.mediaUrls ?? [],
    altText: input.altText ?? null,
    productHandle: input.productHandle,
  })
  return createHash('sha256').update(stable).digest('hex')
}

/** The cached shape stored in `social_posts.last_publish_gate_check_json`. */
export interface PublishGateCacheEntry {
  contentHash: string
  checkedAt: string
  gate: {
    verdict: 'PASS' | 'REVISE' | 'BLOCK' | 'HOLD'
    notes: string
    findings: PublishGateFinding[]
  }
}

export const PUBLISH_GATE_SYSTEM = `You are the independent pre-publish gate for one xdipx.com social post, standing
in for social-publish-gate where no subagent can be spawned. You are adversarial by design: find
the reason this should not ship, not confirmation that it is fine. You do not know why the drafter
believes this post is compliant; judge the finished caption and images cold, as a stranger would.

Close calls split by class. A close call on a BLOCK-class check (a hard stop in the imagery
ceiling, age ambiguity, baked-in text, product identity or colour, the vocabulary fence, a
deterministic finding) fails closed: one post is never worth the account. A close call on a
REVISE-class quality check ("too tame", the interest floor, caption narrates its image) resolves
against the live precedents you are given: those captions PASSED this gate and stayed live, so a
caption at or above their register in a shape they share is not too tame, and if your reading
would also condemn the precedents, the reading is miscalibrated and that check passes. Name the
precedent you calibrated against whenever you REVISE on register.

You will be given the caption, the platform, whether the post already failed a mechanical
(deterministic) check, and the images. The mechanical result is a floor you may never lower: if it
already failed, your verdict must be BLOCK regardless of what you see, and your job is only to add
findings, not to overturn it.

Judge these, all BLOCK-class unless noted:
- Does each image actually show the product the caption claims, not a lookalike? Compare silhouette,
  proportion, cap type, and colour bands against the real packshot. A solid colour band, stripe, or
  cap colour with no glyphs on it is product identity, exactly what the packshot shows, not text.
  **When a real product packshot photo is supplied to you directly in this call (labeled as such,
  shown before the generated candidate images), ground this comparison in those exact pixels, never
  in memory or a guess at what the product typically looks like** — a vision call has no reliable
  memory of a specific SKU's exact shape, and judging from one produces a different, contradictory
  description of the same product on every call, which is not a real defect in the image. When no
  packshot is supplied for a product-tagged post (also noted explicitly, in the text turn), you
  cannot verify identity against a real photo this call; say so honestly rather than assuming a
  match, per the general rule below on what you cannot judge with confidence.
- Is the product's apparent size plausible against the hand/room in frame (not palm-sized rendered
  vase-sized or the reverse)?
- Any letter, digit, wordmark, logo mark, or garbled glyph run baked into the image? (BLOCK) A solid
  colour band, stripe, or cap colour with no glyphs on it is the product's own packaging, never
  baked-in text on its own, however bold or high-contrast the colour. This still applies when the
  glyphs are mirrored, backwards, upside-down, or otherwise reversed: a flipped orientation does not
  make it decorative or make it read as the product's real packaging, since the real product's own
  wordmark is never mirrored. Judge a mirrored or backwards wordmark exactly as you would a forwards
  one (BLOCK); do not wave it through as texture or pattern because it does not read as legible text
  at a glance. Worked example: a yellow band with no letters on the Pjur bottle is identity (PASS);
  the same band with garbled letters on it is text (BLOCK); the same band with a mirrored, backwards
  "AQUA" baked in is still text (BLOCK), not a decorative stripe.
- Hands, faces, bodies: anatomy that is wrong, uncanny, or ambiguous in age. Age ambiguity is judged
  on ambiguity itself, not intent, and is an automatic BLOCK.
- The withholding test: name what the frame makes a viewer want to see that it does not show. If the
  answer is a body part or an act, BLOCK. If it is "the person's next move" or "the rest of the
  room", that is fine.
- Genitalia or nipples visible or outlined (sheer included), hands on genitals over or under
  clothing, a depicted or discernible sex act, fluid on or near genitalia, product against
  genitalia: all BLOCK regardless of platform.
- Instagram only: does the post, taken as a whole, read as an offer/sale rather than an editorial
  piece (Meta's Restricted Goods standard)? BLOCK if yes. A sale attempt is what the policy below
  defines: a price, a discount, a promo code, or a shop CTA, or a caption that reads as an
  advertorial for named products taken whole. A cast member holding one in-stock product under an
  editorial caption with none of those is this account's standing product-forward shape (Today's
  Pick), not an offer; say which of the policy's four signals you saw before you BLOCK on this.
- Caption/alt text: explicit vocabulary, crude slang, emoji-anatomy, or algospeak/character
  substitution meant to evade a filter: BLOCK.
- Caption narrates its own image ("in the photo", "that is <name> holding", "pictured", "so you can
  see"): REVISE (the description belongs in alt text, not the caption).
- A caption that could run unchanged on a skincare account, with zero wanting, innuendo, or
  anticipation, on a post whose register should be 9 by implication: REVISE ("too tame"). On a
  product-free (no product in this post) caption, calibrate this call against the pinned
  product-free register precedents given below in the user turn (a fixed anchor set, not the
  general live-precedents list), and name which of those anchors you calibrated against.
  **Two distinct, equally licensed shapes clear this bar for product-free content, not one
  (ticket #8212).** The pinned "category" anchors build their charge through product-mechanics
  detail (air pulse vs vacuum, motor counts, lube chemistry) even though no specific SKU is
  tagged; the pinned "feeling-first" anchors build the identical 9-by-implication charge with
  zero product or mechanism at all, naming the feeling (curious, wanting, permission) as plain
  fact per docs/emma-voice.md's own worked exemplars (ticket #5862). A feeling-first caption is
  never too tame merely because it does not read like a category anchor — that is comparing two
  different, both-licensed shapes, not a register gap. Judge a feeling-first draft against the
  feeling-first anchors; judge a category draft against the category anchors; never require one
  shape to imitate the other's structure to pass.
- Anything you cannot judge with confidence from what you were given (no campaign scheme, no
  cast-rotation history) is not a reason to pass — say so honestly in notes. It is also not a
  reason to REVISE: a REVISE names a specific fix in the draft, never a gap in your own inputs.

Return exactly one JSON object, no prose before or after it, no markdown code fence. List every
finding and write your notes BEFORE deciding the verdict field: work through the checks first, let
notes state your reasoned conclusion, and only then write verdict to match that conclusion exactly.
Never decide verdict first and rationalize around it afterward, and never let verdict contradict the
harshest finding you listed or the conclusion your own notes reach.

{"findings": [{"check": "<short-slug>", "verdict": "pass|revise|block|hold", "note": "<detail>"}],
 "notes": "<what you looked at and what you found, at least two full sentences, ending with your reasoned conclusion>",
 "verdict": "PASS" | "REVISE" | "BLOCK" | "HOLD"}

HOLD is reserved for genuine account-risk judgment calls this instruction set does not cover —
never reach for it when BLOCK would do, and never to avoid a hard call.

The current platform policy (docs/ads-policy.md, read fresh at process start) follows. Where it and
the checks above disagree, the platform policy's live rules outrank a stale reading of this prompt:

${ADS_POLICY_SOCIAL_EXCERPT}

The imagery ceiling (docs/store-team/instagram-campaigns.md section 3.2a, the single operative
ceiling for social, read fresh at process start) follows. Everything it lists as licensed is
licensed at zero policy cost, including eyes closed, head back, parted lips, an open shirt,
aftermath and anticipation, and product against skin; everything it lists as a hard stop is a
BLOCK regardless of how good the frame is:

${IMAGERY_CEILING_EXCERPT}`

/** One publish-gate model call: request, token logging, max_tokens diagnostics, and parsing. */
async function callPublishGateModel(
  postId: number,
  content: Anthropic.ContentBlockParam[],
): Promise<ReturnType<typeof parsePublishGateModelOutput>> {
  const msg = await client.messages.create({
    model: SONNET,
    max_tokens: 2048,
    // Pinned at 0 (ticket #7896): the same caption against the same
    // precedent set must return the same verdict. Rows #182/#185 showed the
    // opposite at the SDK default temperature — identical input, three
    // calls, PASS then REVISE then REVISE, citing different precedents each
    // time. This is a judgment task with a fail-closed contract, not one
    // where call-to-call variety is a feature.
    temperature: 0,
    system: PUBLISH_GATE_SYSTEM,
    messages: [{ role: 'user', content }],
  })
  void logTokens('publish-gate', msg.usage)
  const block = msg.content[0]
  if (block?.type !== 'text') throw new Error('runPublishGateCheck: unexpected Claude response type')
  if (msg.stop_reason === 'max_tokens') {
    // #7148: a response cut off by the token cap fails JSON.parse and
    // fails closed to BLOCK by design (extractJson below), which then reads
    // exactly like a genuine adversarial finding unless this is logged
    // distinctly. 1024 was measured too tight for a full findings array plus
    // a multi-sentence notes field on an image-heavy post; raised to 2048 to
    // make this rarer, but log it whenever it still happens so a run of BLOCKs
    // caused by truncation is diagnosable instead of read as real findings.
    console.error(
      `[publish-gate] response for post ${postId} hit max_tokens ` +
        `(${msg.usage.output_tokens} output tokens); the JSON may be truncated ` +
        'and will fail-closed to BLOCK if so',
    )
  }
  return parsePublishGateModelOutput(block.text)
}

/**
 * Cheap internal-consistency check between the model's structured `verdict`
 * and its own findings array / notes conclusion (ticket #8060). Exported so
 * `runPublishGateCheck`'s retry decision is unit-testable directly, the same
 * way `parsePublishGateModelOutput` is.
 */
export function verdictConsistencyCheck(
  verdict: 'PASS' | 'REVISE' | 'BLOCK' | 'HOLD',
  findings: readonly PublishGateFinding[],
  notes: string,
): { consistent: boolean; reason?: string } {
  const impliedByFindings = findings.length
    ? findings.some(f => f.verdict === 'block')
      ? 'BLOCK'
      : findings.some(f => f.verdict === 'hold')
        ? 'HOLD'
        : findings.some(f => f.verdict === 'revise')
          ? 'REVISE'
          : 'PASS'
    : null
  if (impliedByFindings && impliedByFindings !== verdict) {
    return {
      consistent: false,
      reason: `structured verdict "${verdict}" disagrees with the findings array, which implies "${impliedByFindings}"`,
    }
  }
  const finalVerdictMatch = notes.match(/final verdict:?\s*["']?(pass|revise|block|hold)\b/i)
  const stated = finalVerdictMatch?.[1]?.toUpperCase()
  if (stated && stated !== verdict) {
    return {
      consistent: false,
      reason: `structured verdict "${verdict}" disagrees with the notes' own conclusion ("${finalVerdictMatch?.[0]}")`,
    }
  }
  return { consistent: true }
}

/**
 * Everything this function does NOT do, stated so the gap is visible rather
 * than silently assumed away versus the subagent it replaces: no read of the
 * active Instagram campaign's locked visual scheme or its rotation/thesis
 * history beyond the last ~10 captions passed for repetition; no
 * `owner-feedback-unmet` clause-by-clause check against a `reworkedFrom`
 * source row's feedback; no cast-roster rotation accounting
 * (`instagram-campaigns.md` §3.8); no live comparison against the actual
 * last 10-14 *live* posts' grid composition, only their captions. Each of
 * these is real judgment work the original agent definition documents and
 * this first cut does not attempt, rather than a silent regression.
 */
export async function runPublishGateCheck(postId: number): Promise<PublishGateOutput> {
  const [post] = await db
    .select({
      id: socialPosts.id,
      platform: socialPosts.platform,
      tweetText: socialPosts.tweetText,
      mediaUrls: socialPosts.mediaUrls,
      altText: socialPosts.altText,
      status: socialPosts.status,
      reviewStatus: socialPosts.reviewStatus,
      shopifyProductId: socialPosts.shopifyProductId,
      lastPublishGateCheckJson: socialPosts.lastPublishGateCheckJson,
    })
    .from(socialPosts)
    .where(eq(socialPosts.id, postId))
    .limit(1)

  if (!post) throw new Response(`Not Found: no social_posts row ${postId}`, { status: 404 })
  const platform = post.platform as GatePlatform
  if (platform !== 'instagram' && platform !== 'x') {
    throw new Response(
      `Bad Request: publish-gate only verdicts instagram/x drafts (row ${postId} is ${post.platform}); ` +
        'other platforms have no publisher and are owner-reviewed in /admin/socials.',
      { status: 409 },
    )
  }
  if (post.status === 'posted') {
    throw new Response(`Conflict: row ${postId} is already posted; re-verdicting a live post is not permitted.`, { status: 409 })
  }

  const featuresProduct = !!post.shopifyProductId
  let productHandle: string | null = null
  if (post.shopifyProductId) {
    try {
      productHandle = await getProductHandleById(post.shopifyProductId)
    } catch (err) {
      console.error(`[publish-gate] getProductHandleById failed for row ${postId} (treating handle as unresolved):`, err)
    }
  }

  const recentCaptions = await recentPostedCaptions(platform, 12)

  const deterministic = await runDeterministicPublishChecks({
    caption: post.tweetText,
    mediaUrls: post.mediaUrls ?? [],
    platform,
    productHandle,
    altText: post.altText,
    recentCaptions,
  })

  const deterministicFindings: PublishGateFinding[] = deterministic.findings.map(toStoredFinding)

  // The deterministic result is a floor that cannot be lowered. If it already
  // blocks, there is nothing a model call could add that would change the
  // outcome, so skip the spend and return the mechanical verdict directly.
  if (deterministic.blocked) {
    return {
      id: postId,
      gate: {
        verdict: 'BLOCK',
        reviewer: 'publish-gate',
        notes: `Deterministic check(s) blocked before any judgment pass ran: ${deterministic.findings.map(f => f.check).join(', ')}.`,
        featuresProduct,
        ...(productHandle ? { productHandle } : {}),
        findings: deterministicFindings,
      },
    }
  }

  const media = post.mediaUrls ?? []

  // Vision-judgment cache (ticket #8452). The deterministic floor above is
  // always re-run fresh (it is cheap and stock-sensitive), but the model
  // call below is neither: run 786 (2026-09-09) gated row 215 twice minutes
  // apart with byte-identical caption/media and got PASS then BLOCK, even
  // though the call is pinned at temperature 0 (#7896). A hash match here
  // means this call would show the model exactly the same input as the call
  // that produced the cached verdict, so the first verdict is treated as
  // final rather than re-rolled. A hash miss (any rework of caption, media,
  // alt text, or product) judges fresh exactly as before.
  const contentHash = computePublishGateContentHash({
    platform,
    tweetText: post.tweetText,
    mediaUrls: post.mediaUrls,
    altText: post.altText,
    productHandle,
  })
  const cached = post.lastPublishGateCheckJson
  if (cached && cached.contentHash === contentHash) {
    console.error(`[publish-gate] post ${postId}: serving cached verdict (unmodified since ${cached.checkedAt}), skipping model call`)
    return {
      id: postId,
      gate: {
        verdict: cached.gate.verdict,
        reviewer: 'publish-gate',
        notes: cached.gate.notes,
        featuresProduct,
        ...(productHandle ? { productHandle } : {}),
        findings: [...deterministicFindings, ...cached.gate.findings],
      },
    }
  }

  // Real product packshot for grounding (ticket #8823). Fetched after the
  // cache check above (a cache hit never needs it) so a cached re-check
  // costs nothing extra. `null` when the post features no product, or when
  // the fetch fails or the product has no images on Shopify — either way the
  // model has nothing real to compare against and must say so rather than
  // judging identity from its own memory of the SKU.
  const packshotUrl = await fetchPackshotUrl(productHandle)

  const content = buildPublishGateUserContent({
    platform,
    tweetText: post.tweetText,
    altText: post.altText,
    deterministicHeld: deterministic.held,
    recentCaptionsBlock: describePrecedents(recentCaptions),
    registerPrecedentsBlock: describeRegisterPrecedents(),
    featuresProduct,
    mediaUrls: media,
    packshotUrl,
  })

  let modelResult = await callPublishGateModel(postId, content)

  // #8060: a model can talk itself from an initial structured verdict to a
  // different conclusion in its own findings/notes without updating the
  // verdict field to match — self-contradictory, not merely ambiguous. The
  // original incident (row 207) had verdict:"BLOCK" against an all-pass
  // findings array and a notes narrative ending "Final verdict: PASS.",
  // which the parser correctly failed closed on, but that quietly spent the
  // day's last image-generation credit on a rejection the model's own
  // reasoning disagreed with. Detect that mismatch and retry once, naming
  // the contradiction, rather than trusting the first confused answer. A
  // blind identical retry would not help here: the call is pinned at
  // temperature 0 (#7896) specifically so the same input returns the same
  // verdict, so the retry must give the model new information (the
  // contradiction itself) to have any chance of a different, clean answer.
  const consistency = verdictConsistencyCheck(modelResult.verdict, modelResult.findings, modelResult.notes)
  if (!consistency.consistent) {
    console.error(`[publish-gate] post ${postId}: verdict/narrative mismatch on first pass (${consistency.reason}); retrying once`)
    const retryContent: Anthropic.ContentBlockParam[] = [
      ...content,
      {
        type: 'text',
        text:
          `Your previous response was internally inconsistent: ${consistency.reason}. Re-examine the ` +
          'same post from scratch and return one clean JSON object where the verdict field matches ' +
          "your own findings and notes exactly. Do not reference this correction in your notes.",
      },
    ]
    modelResult = await callPublishGateModel(postId, retryContent)
    const retryConsistency = verdictConsistencyCheck(modelResult.verdict, modelResult.findings, modelResult.notes)
    if (!retryConsistency.consistent) {
      console.error(
        `[publish-gate] post ${postId}: verdict/narrative mismatch persisted after retry (${retryConsistency.reason}); ` +
          'using the retry\'s structured verdict field as the fail-closed result',
      )
    }
  }

  // Persist the raw judgment (not the deterministic findings, which are
  // re-run fresh on every call and would go stale in the cache) so the next
  // call against this exact content is served from cache instead of judged
  // again. Best-effort: a write failure here means the next call re-judges
  // rather than losing the verdict this call already computed.
  const cacheEntry: PublishGateCacheEntry = {
    contentHash,
    checkedAt: new Date().toISOString(),
    gate: { verdict: modelResult.verdict, notes: modelResult.notes, findings: modelResult.findings },
  }
  try {
    await db.update(socialPosts).set({ lastPublishGateCheckJson: cacheEntry }).where(eq(socialPosts.id, postId))
  } catch (err) {
    console.error(`[publish-gate] post ${postId}: failed to persist verdict cache (ignored, next call will re-judge):`, err)
  }

  // Ticket #8854: log this call's product-identity judgment tagged by
  // productHandle, so a repeat self-contradiction (the same SKU described
  // two different ways across two separate calls, run 823's incident) is
  // machine-detectable by grepping `[publish-gate:product-identity]` for a
  // productHandle, not lost the moment the request returns.
  if (productHandle) {
    console.error(
      formatProductIdentityLogLine({
        postId,
        productHandle,
        packshotUrl,
        verdict: modelResult.verdict,
        findings: modelResult.findings,
        notes: modelResult.notes,
      }),
    )
  }

  return {
    id: postId,
    gate: {
      verdict: modelResult.verdict,
      reviewer: 'publish-gate',
      notes: modelResult.notes,
      featuresProduct,
      ...(productHandle ? { productHandle } : {}),
      findings: [...deterministicFindings, ...modelResult.findings],
    },
  }
}

/** Pure parse of the model's raw text into a verdict, so the contract is unit-testable directly. */
export function parsePublishGateModelOutput(
  raw: string,
): { verdict: 'PASS' | 'REVISE' | 'BLOCK' | 'HOLD'; notes: string; findings: PublishGateFinding[] } {
  const json = extractJson(raw)
  const verdictRaw = typeof json['verdict'] === 'string' ? json['verdict'].toUpperCase() : ''
  const verdict =
    verdictRaw === 'PASS' || verdictRaw === 'REVISE' || verdictRaw === 'BLOCK' || verdictRaw === 'HOLD'
      ? verdictRaw
      // Fail closed: an unparseable or missing verdict is never treated as a PASS.
      : 'BLOCK'
  const notes =
    typeof json['notes'] === 'string' && json['notes'].trim()
      ? json['notes'].trim()
      : verdict === 'BLOCK' && !(verdictRaw === 'PASS' || verdictRaw === 'REVISE' || verdictRaw === 'BLOCK' || verdictRaw === 'HOLD')
        ? `publish-gate: could not parse a verdict from the model response: ${raw.slice(0, 300)}`
        : '(no notes returned)'
  const findingsRaw = Array.isArray(json['findings']) ? (json['findings'] as unknown[]) : []
  const findings: PublishGateFinding[] = []
  for (const item of findingsRaw) {
    if (!item || typeof item !== 'object') continue
    const f = item as Record<string, unknown>
    const check = typeof f['check'] === 'string' ? f['check'].trim() : ''
    if (!check) continue
    const v = typeof f['verdict'] === 'string' ? f['verdict'].toLowerCase() : ''
    const fv: PublishGateFinding['verdict'] = v === 'block' ? 'block' : v === 'hold' ? 'hold' : v === 'revise' ? 'revise' : 'pass'
    const note = typeof f['note'] === 'string' ? f['note'].trim() : undefined
    findings.push(note ? { check, verdict: fv, note } : { check, verdict: fv })
  }
  return { verdict, notes, findings }
}

/**
 * The real Shopify packshot for the gated post's tagged product, so the
 * product-identity/colour judgment in `PUBLISH_GATE_SYSTEM` has an actual
 * photo to compare against instead of the model's own memory of the SKU
 * (ticket #8823). Incident: run 816 (2026-09-11) BLOCKed 5 consecutive
 * candidates across 3 real SKUs with mutually contradictory shape
 * descriptions of the identical product (one pjur Aqua call read
 * squat/wide/deodorant-stick, another tall/slender/pump-cap) — direct pixel
 * comparison against the live CDN packshots confirmed every candidate
 * actually matched. Nothing in the call before this fix ever sent the model
 * a real product photo to compare against; `PUBLISH_GATE_SYSTEM` told it to
 * "compare against the real packshot" while giving it no such image, so it
 * was necessarily judging from a hallucinated reference. Returns `null`
 * (never throws) when there is no tagged product, the Shopify fetch fails,
 * or the product has no images — every one of those means there is nothing
 * real to ground the check in, which the user-turn text must say plainly.
 *
 * Cached separately from `getProductByHandle`'s own 60s read cache, at a
 * TTL sized to a whole routine run rather than one page view (ticket
 * #8854): two gate calls for the same SKU minutes apart (the common case —
 * a run gates several candidates per product across a pass) must resolve to
 * byte-identical packshot pixels, or the model's product-identity judgment
 * is not comparable across calls even before its own vision variance is
 * considered. `images[0]` is already Shopify-position-stable, so this does
 * not change *which* image is chosen, only guarantees it cannot flip
 * mid-run on a cache expiry. A failed fetch is cached only briefly so a
 * transient outage does not pin "no packshot" for the run.
 */
const PACKSHOT_CACHE_TTL_SECONDS = 1800
const PACKSHOT_FETCH_FAILURE_TTL_SECONDS = 30

async function fetchPackshotUrl(productHandle: string | null): Promise<string | null> {
  if (!productHandle) return null
  return cached(
    `publish-gate:packshot:${productHandle}`,
    PACKSHOT_CACHE_TTL_SECONDS,
    async () => {
      try {
        const product = await getProductByHandle(productHandle)
        return product?.images?.[0]?.url ?? null
      } catch (err) {
        console.error(`[publish-gate] packshot fetch failed for product "${productHandle}" (treating as unavailable):`, err)
        return null
      }
    },
    PACKSHOT_FETCH_FAILURE_TTL_SECONDS,
  )
}

/**
 * Formats one call's product-identity judgment as a single grep-able log
 * line, tagged by `productHandle` (ticket #8854). Exported so the shape is
 * unit-testable without a network or model call; the caller logs it via
 * `console.error` so it lands in the same place every other publish-gate
 * diagnostic does.
 */
export function formatProductIdentityLogLine(input: {
  postId: number
  productHandle: string
  packshotUrl: string | null
  verdict: string
  findings: readonly PublishGateFinding[]
  notes: string
}): string {
  const findingsText = input.findings.length
    ? input.findings.map(f => `${f.check}:${f.verdict}${f.note ? ` (${f.note})` : ''}`).join(' | ')
    : '(no findings)'
  return (
    `[publish-gate:product-identity] postId=${input.postId} productHandle=${input.productHandle} ` +
    `packshotUrl=${input.packshotUrl ?? '(none)'} verdict=${input.verdict} findings=${findingsText} notes=${input.notes}`
  )
}

/**
 * Builds the publish-gate user turn: caption, precedents, the real packshot
 * (when one was fetched) labeled and placed BEFORE the generated candidates
 * so the model reads it as ground truth rather than another candidate to
 * judge, and the generated images themselves. Pure and exported so the
 * packshot-grounding fix (ticket #8823) is unit-testable without a live
 * Shopify call or model call: given a `packshotUrl` (or `null`), assert
 * exactly what gets sent.
 */
export function buildPublishGateUserContent(input: {
  platform: GatePlatform
  tweetText: string
  altText: string | null
  deterministicHeld: boolean
  recentCaptionsBlock: string
  registerPrecedentsBlock: string
  featuresProduct: boolean
  mediaUrls: readonly string[]
  packshotUrl: string | null
}): Anthropic.ContentBlockParam[] {
  const packshotNote = input.featuresProduct
    ? input.packshotUrl
      ? 'The REAL PRODUCT PACKSHOT follows immediately below, before any generated candidate images. ' +
        'Ground every product-identity, colour, and proportion judgment in those exact pixels, not in ' +
        'memory of what the product looks like.'
      : 'This post features a product, but no real packshot could be fetched for comparison this call. ' +
        'You cannot ground the product-identity/colour check in a real photo; say so explicitly in your ' +
        'notes rather than assuming the generated image matches.'
    : ''

  return [
    {
      type: 'text',
      text:
        `Platform: ${input.platform}\n` +
        `Deterministic check: clean (no mechanical findings)${input.deterministicHeld ? ', held pending owner review of a mechanical warn/hold' : ''}.\n` +
        `Caption (as it will publish):\n${input.tweetText}\n\n` +
        `Alt text: ${input.altText ?? '(none)'}\n\n` +
        `${input.recentCaptionsBlock}\n\n` +
        `${input.featuresProduct ? '' : `${input.registerPrecedentsBlock}\n\n`}` +
        `${packshotNote ? `${packshotNote}\n\n` : ''}` +
        `${input.mediaUrls.length} generated candidate image(s) follow${input.packshotUrl ? ' after the packshot' : ''}.`,
    },
    ...(input.packshotUrl
      ? [{ type: 'image', source: { type: 'url', url: input.packshotUrl } } satisfies Anthropic.ContentBlockParam]
      : []),
    ...input.mediaUrls.map((url): Anthropic.ContentBlockParam => ({ type: 'image', source: { type: 'url', url } })),
  ]
}

/**
 * The live precedents block of the user turn. Exported for the test that pins
 * the calibration contract: the captions are labeled as PASSED-and-live, so
 * the model reads them as calibration for REVISE-class register calls and as
 * repetition context, never as a licence for a BLOCK-class risk.
 */
export function describePrecedents(captions: readonly string[]): string {
  const head =
    'Live precedents on this platform (posted rows that PASSED this gate and stayed live, newest ' +
    'first). Calibration for REVISE-class register calls and context for the repetition check. ' +
    'Not a licence for any BLOCK-class risk.'
  return `${head}\n${captions.map(c => `- ${c}`).join('\n') || '(none yet)'}`
}

/**
 * A pinned, versioned register-calibration anchor for product-free (Slot A)
 * Instagram captions, ticket #7896.
 *
 * `describePrecedents` above draws from `recentPostedCaptions`, a live query
 * of the platform's last 12 *posted* rows regardless of type, which mixes
 * product-forward captions (naturally quieter; the product itself carries
 * some of the register) in with product-free ones. Two rows on 2026-09-05/06
 * (#182, #185) showed the model's register-too-tame call drifting on that
 * mixed set: the SAME unchanged caption text, gated three times back to
 * back with no new posts landing in between (so the live-precedent set was
 * byte-identical across calls), returned PASS then REVISE then REVISE,
 * citing a different pair of precedent posts each time. That is not the
 * precedent set moving, it is the model's own sampling choosing a different
 * subset of it to calibrate against on every call.
 *
 * The fix has two parts, both here and in `runPublishGateCheck`: (1) this
 * fixed, hand-picked set of already-live product-free posts is the anchor
 * for register calibration specifically, so the comparison set cannot vary
 * call to call the way a live top-12 query can as new rows post; (2)
 * `runPublishGateCheck` now calls the model at `temperature: 0` so the same
 * caption against the same anchor set returns the same verdict.
 *
 * Update this list only by adding a new id, never by rewriting or dropping
 * an existing one (a removed anchor is exactly the drift this exists to
 * prevent). Add a post once it has cleared this gate on a single call
 * with no REVISE and stayed live; do not add a post that itself needed a
 * rework to clear register.
 *
 * **Named "category" anchors, ticket #8212.** All four posts below carry no
 * tagged `shopifyProductId` (so `featuresProduct` reads false and this is the
 * set the gate reaches for), but every one builds its register through
 * product-mechanics detail: air-pulse-vs-vacuum, motor counts, IPX ratings,
 * lube chemistry. That is a real, licensed way to be product-free and still
 * charged, but it is not the only one. Row #182's own gate feedback (seven
 * consecutive register-too-tame REVISEs, 2026-09-05) named the failure mode
 * directly: a caption "modeled near-verbatim on the charter's own
 * product-free exemplar lines" — the plain feeling-naming pattern
 * `docs/emma-voice.md` documents under ticket #5862, with zero product
 * mechanics — was judged too tame for not resembling this category set. Row
 * #185's PASS feedback confirms the gate was in fact calibrating a
 * feeling-first caption against "#142/#193" specifically, i.e. against this
 * category set with no feeling-first anchor available at all. See
 * `FEELING_FIRST_REGISTER_ANCHORS` below for the missing second shape, added
 * to fix that gap; both sets are anchors for the *same* too-tame check, not
 * competing ones.
 */
export const PRODUCT_FREE_REGISTER_PRECEDENTS: readonly { id: number; text: string }[] = [
  {
    id: 142,
    text:
      "forget how it looks sitting on the shelf. the moment it switches on, it does something no vibrator can.\n\n" +
      'this runs on air pulse, not a buzzing motor: waves of air and pressure that seal over one spot instead of ' +
      'vibrating everywhere. six intensities and four patterns, so you set the pace instead of the toy setting it, ' +
      'and the whole thing vanishes into a cupped palm. the silicone glows in the dark, easy to find when the ' +
      'lights are low, and it is waterproof enough to bring into the shower. if you want to meet it, the link is ' +
      'in our bio.\n\n' +
      'one pairing note: keep it to a water-based glide, the sliquid organics is a clean glycerin-free pick, ' +
      'because silicone toys and silicone lube do not get along.\n\n' +
      'this is a slow-morning-with-the-door-open object, not just the last ten minutes before sleep. be honest ' +
      'with me: are you a run-through-all-six person, or a find-one-and-stay person?',
  },
  {
    id: 149,
    text:
      '"does this do suction or air pulse?" wrong question. everything we carry in air pulse works the same way: ' +
      'waves of pressure that seal around one spot and hold there, never a vacuum pulling in. break the seal and ' +
      "the feeling goes with it, no matter how high you turn the number. a real suction toy is a different animal, " +
      'a clitoral pump built to draw and hold a swell, sold as exactly that.\n\n' +
      'the toy that goes quiet after ten seconds was never underpowered. it lost its seal, that\'s all, and no ' +
      'setting fixes a seal.\n\n' +
      "the enhance stops making you choose. air pulse on one side, a separate vibration motor on the other, ten " +
      "levels each, layered however much of each you're chasing. start with one, let the other build in behind " +
      'it, and keep going until the two are doing more together than either ever did alone.\n\n' +
      'ipx7 means the shower and the bath are genuinely fair game, not a guess printed on the label. silicone ' +
      "body, so keep what's in the drawer water-based. h2o original earns its spot next to this one.\n\n" +
      "save this for the next listing that promises everything and gives you a shrug. ♥",
  },
  {
    id: 167,
    text:
      "Ok, we need to talk about rabbit vibrators for a second, because half of you are picturing the wrong " +
      "thing.\n\n" +
      "Rabbit is a shape. Dual stimulation is the job you actually want it doing: inside and outside, at once. A " +
      "classic rabbit's arms are molded at one fixed angle, and where you need contact is not the same as the " +
      "body next to you. That gap between what's molded in and what you actually need is the whole reason one " +
      "gets forgotten after a week, another gets reached for on the regular. Motor count was never the deciding " +
      "vote, fit was.\n\n" +
      "You want something that bends to find your angle instead of asking you to match its geometry. Keep " +
      "whatever you pair it with water-based, silicone doesn't play well with anything else, and the rest is the " +
      "difference between fine and checking the clock afterward, surprised by what it says.\n\n" +
      "Which have you actually tried, the classic shape or something that bends? Tell me below.",
  },
  {
    id: 193,
    text:
      "the lube aisle lies to you a little. every bottle promises \"ultra glide\" and none of them tell you the " +
      "one thing that actually decides everything else: what it's made of.\n\n" +
      'water-based soaks in fast, which sounds like a downside until you remember it means safe with every toy ' +
      'in the drawer and every condom in the nightstand, silicone included. the tradeoff is you reach for it ' +
      "again partway through, and that's not a flaw, that's just water doing what water does.\n\n" +
      'silicone-based lasts. it beads instead of soaking in, so one round covers the whole stretch, and it ' +
      'survives water, so the shower is fair game too. the tradeoff is real: it breaks down silicone toys over ' +
      'time, so keep it for skin-only nights or toys made from something else.\n\n' +
      "pjur's basic silicone glide is the second kind, built for the unhurried stretch where you do not want to " +
      'stop and reach for anything twice.\n\n' +
      'which is actually in your drawer right now, water or silicone? tell me, i am curious.',
  },
]

/**
 * The second, missing anchor shape for the register-too-tame check on
 * product-free content, ticket #8212. `PRODUCT_FREE_REGISTER_PRECEDENTS`
 * above is exclusively the "category" shape (product mechanics named, no SKU
 * tagged); this is the "feeling-first" shape, where the register comes from
 * naming a feeling (curious, wanting, permission) as plain fact, with zero
 * product or mechanism at all.
 *
 * These four lines are quoted verbatim from `docs/emma-voice.md`'s own
 * worked exemplars for exactly this pattern (ticket #5862, "Product-free
 * resource posts reach 9-by-implication on wanting, permission, and
 * curiosity, not on a product outcome"). They are charter-approved lines, not
 * posted rows, so the "cleared this gate on a single call, no rework" rule
 * on the category set above does not apply to them the same way — the
 * charter itself is the standing approval. Update this list only by adding a
 * new charter-cited line, never by rewriting or dropping an existing one.
 */
export const FEELING_FIRST_REGISTER_ANCHORS: readonly string[] = [
  'Curious is not behind. It just means you have not gotten there yet.',
  'Nobody is going to hand you permission. You get to just take it.',
  'The wanting does not need an explanation. It never did.',
  'You are allowed to want something and not know yet what it is.',
]

/**
 * The pinned register-calibration block for a product-free (`featuresProduct:
 * false`) post, ticket #7896, extended with the feeling-first shape in
 * ticket #8212. Distinct from `describePrecedents`: that block is a live,
 * platform-wide, newest-first query used for repetition context and general
 * REVISE calibration; this one is a fixed anchor set that never changes call
 * to call, used specifically to stop the register-too-tame check from
 * drifting on product-free content. Included in addition to, not instead of,
 * `describePrecedents`.
 */
export function describeRegisterPrecedents(): string {
  const head =
    'Pinned product-free (Slot A) register-calibration anchors (fixed set, does not change between ' +
    'calls or as new posts go live). These are the specific "clears register-too-tame" precedents for ' +
    'product-free content named in the calibration rule above: read the caption against whichever group ' +
    'matches its own shape, not against whichever posts happen to come to mind, so the same caption gets ' +
    'the same verdict on every call.\n\n' +
    'Group A, "category" (product mechanics named, no SKU tagged):'
  const groupA = PRODUCT_FREE_REGISTER_PRECEDENTS.map(p => `- (#${p.id}) ${p.text}`).join('\n')
  const groupBHead =
    '\n\nGroup B, "feeling-first" (zero product or mechanism; the register comes from naming the feeling ' +
    'itself as plain fact, per docs/emma-voice.md ticket #5862):'
  const groupB = FEELING_FIRST_REGISTER_ANCHORS.map(line => `- "${line}"`).join('\n')
  return `${head}\n${groupA}${groupBHead}\n${groupB}`
}

function toStoredFinding(f: GateFinding): PublishGateFinding {
  const verdict = f.severity === 'block' ? 'block' : f.severity === 'hold' ? 'hold' : 'revise'
  return { check: f.check, verdict, note: f.detail }
}

async function recentPostedCaptions(platform: GatePlatform, limit: number): Promise<string[]> {
  const { listSocialPosts } = await import('./team.server')
  const posted = await listSocialPosts('posted', 60)
  return posted
    .filter((p: { platform: string }) => p.platform === platform)
    .slice(0, limit)
    .map((p: { tweetText: string }) => p.tweetText)
}

/** Extract the first top-level JSON object from a model response, tolerating a ```json fence. */
function extractJson(raw: string): Record<string, unknown> {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : raw
  const start = candidate?.indexOf('{') ?? -1
  const end = candidate?.lastIndexOf('}') ?? -1
  if (!candidate || start === -1 || end === -1 || end < start) return {}
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function logTokens(feature: string, usage: Anthropic.Messages.Message['usage']): Promise<void> {
  const u = usage as typeof usage & { cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
  return logApiTokens({
    feature,
    model: SONNET,
    source: 'sync',
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    caller: 'team-gates.server',
  }).catch(err => console.error('[team-gates] token-log failed (ignored):', err))
}

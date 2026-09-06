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
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from './db.server'
import { socialPosts } from '../../db/schema'
import { SONNET } from './models.server'
import { EMMA_VOICE_SOCIAL, EMMA_VOICE_LINKEDIN } from './emma-voice.server'
import { runDeterministicPublishChecks, type GatePlatform, type GateFinding } from './social-publish-gate.server'
import { getProductHandleById } from './shopify.server'
import { logApiTokens } from './token-log.server'

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
- Does each image actually show the product the caption claims, not a lookalike?
- Is the product's apparent size plausible against the hand/room in frame (not palm-sized rendered
  vase-sized or the reverse)?
- Any word, letter, logo, watermark, or garbled wordmark baked into the image? (BLOCK)
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
  anticipation, on a post whose register should be 9 by implication: REVISE ("too tame").
- Anything you cannot judge with confidence from what you were given (no campaign scheme, no
  cast-rotation history) is not a reason to pass — say so honestly in notes. It is also not a
  reason to REVISE: a REVISE names a specific fix in the draft, never a gap in your own inputs.

Return exactly one JSON object, no prose before or after it, no markdown code fence:

{"verdict": "PASS" | "REVISE" | "BLOCK" | "HOLD",
 "notes": "<what you looked at and what you found, at least two full sentences>",
 "findings": [{"check": "<short-slug>", "verdict": "pass|revise|block|hold", "note": "<detail>"}]}

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
  const content: Anthropic.ContentBlockParam[] = [
    {
      type: 'text',
      text:
        `Platform: ${platform}\n` +
        `Deterministic check: clean (no mechanical findings)${deterministic.held ? ', held pending owner review of a mechanical warn/hold' : ''}.\n` +
        `Caption (as it will publish):\n${post.tweetText}\n\n` +
        `Alt text: ${post.altText ?? '(none)'}\n\n` +
        `${describePrecedents(recentCaptions)}\n\n` +
        `${media.length} image(s) follow.`,
    },
    ...media.map((url): Anthropic.ContentBlockParam => ({ type: 'image', source: { type: 'url', url } })),
  ]

  const msg = await client.messages.create({
    model: SONNET,
    max_tokens: 2048,
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
  const modelResult = parsePublishGateModelOutput(block.text)

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

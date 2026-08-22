/**
 * Admin-callable rework path for a social_posts row (owner direction 2026-08-22).
 *
 * Before this module, owner feedback on a live/drafted social post had no
 * immediate path back into the pipeline: the caption/image were only ever
 * touched by the next daily routine run, so a note like "the caption
 * describes the picture, fix it" sat unactioned for up to a day. These four
 * functions are the admin-triggered equivalents of what the routine does on
 * its own schedule, regenerate the image, redraft the caption, file the
 * result as a fresh reviewable row, and (once hard checks pass) let the owner
 * approve it by hand without waiting for the automated pre-publish gate agent
 * to run.
 *
 * `ownerApprovePost` is deliberately NOT a bypass of the deterministic checks
 * in `social-publish-gate.server.ts`, it runs them, the same as the
 * automated gate does on a PASS claim (`applyPublishGateVerdict`), and only
 * writes `approved` when nothing blocks. What it replaces is the *agent*
 * half of the gate (the judgment call), not the *mechanical* half. This is
 * the owner exercising the same authority his `/admin/socials` click always
 * had, see `decideManualPublish`'s header, done here so it can be reached
 * without a manual re-run of the gate agent first.
 */

import { eq } from 'drizzle-orm'
import { db } from './db.server'
import { socialPosts } from '../../db/schema'
import {
  runDeterministicPublishChecks,
  type GateFinding,
  type GatePlatform,
} from './social-publish-gate.server'
import { formatGateStamp, dbApproveRepo } from './social-publish-approve.server'
import { getProductsByIds, getProductHandleById } from './shopify.server'
import { generateAndUploadSocialImage, type SocialArchetype } from './social-media.server'
import { generateWithSystem } from './claude.server'
import { EMMA_VOICE_SOCIAL } from './emma-voice.server'
import { SONNET } from './models.server'

export type ReworkArchetype = 'scene' | 'cast' | 'metaphor' | 'macro' | 'plate'

type PostRow = typeof socialPosts.$inferSelect

async function loadPost(postId: number): Promise<PostRow | null> {
  const [row] = await db.select().from(socialPosts).where(eq(socialPosts.id, postId)).limit(1)
  return row ?? null
}

function gatePlatformOf(post: PostRow): GatePlatform {
  return post.platform === 'x' ? 'x' : 'instagram'
}

// ── Image regeneration ───────────────────────────────────────────────────────

/**
 * Assemble the regeneration prompt. Pure and exported so the composition rule
 * is unit-tested directly: imageBrief wins when present (it is the durable
 * "what does this image depict" record, migration 083); otherwise subject,
 * then the caption's first line, stand in. The owner's feedback and the
 * standing imagery rules are always appended, never replaced.
 */
export function buildImageRegenPrompt(input: {
  imageBrief?: string | null
  subject?: string | null
  captionFirstLine?: string | null
  productTitle?: string | null
  feedback: string
}): string {
  const base =
    input.imageBrief?.trim()
    || input.subject?.trim()
    || input.captionFirstLine?.trim()
    || 'a warm, editorial scene for the post'
  const productLine = input.productTitle?.trim() ? ` Featuring the real product: ${input.productTitle.trim()}.` : ''
  return [
    `${base}${base.endsWith('.') ? '' : '.'}${productLine}`,
    '',
    `Owner feedback (binding instruction): ${input.feedback.trim()}`,
    '',
    'Standing imagery rules:',
    '- Depict the subject of the post, never a literal illustration of its verb.',
    '- A cast member is in frame for product posts.',
    '- The product shown is the real product, never a model-invented lookalike.',
    '- Skin is licensed; nudity never.',
    '- No text anywhere in the image.',
    '- Warm light; coral-soft/plum-soft/paper ground.',
  ].join('\n')
}

export async function regenerateSocialImage(opts: {
  postId: number
  feedback: string
  archetype?: ReworkArchetype
  actor: string
}): Promise<{ ok: true; url: string; prompt: string; costUsd?: number } | { ok: false; error: string }> {
  try {
    const post = await loadPost(opts.postId)
    if (!post) return { ok: false, error: `No social post ${opts.postId}` }

    let productTitle: string | null = null
    let refImageUrl: string | undefined
    let handle = `post-${opts.postId}`
    if (post.shopifyProductId) {
      const [products, resolvedHandle] = await Promise.all([
        getProductsByIds([post.shopifyProductId]),
        getProductHandleById(post.shopifyProductId),
      ])
      const product = products[0]
      if (product) {
        productTitle = product.title
        refImageUrl = product.images[0]?.url
      }
      if (resolvedHandle) handle = resolvedHandle
    }

    const captionFirstLine = (post.editedText?.trim() || post.tweetText).split('\n')[0] ?? ''
    const prompt = buildImageRegenPrompt({
      imageBrief: post.imageBrief,
      subject: post.subject,
      captionFirstLine,
      productTitle,
      feedback: opts.feedback,
    })

    const archetype: SocialArchetype = opts.archetype ?? (post.shopifyProductId ? 'cast' : 'scene')
    const today = new Date().toISOString().slice(0, 10)

    const result = await generateAndUploadSocialImage({
      prompt,
      handle,
      archetype,
      mood: (post.subject?.trim() || 'owner-rework').slice(0, 40),
      date: today,
      caller: opts.actor,
      // Owner-triggered spend, billed for real: unlike the CLI's own
      // `logCost: false` calls through this same route, there is no other
      // writer of this spend row for an admin-triggered regeneration.
      logCost: true,
      imageSize: 'portrait_4_5',
      aspect: '4:5',
      ...(refImageUrl ? { refImageUrl } : {}),
    })

    if (!result.url) {
      return {
        ok: false,
        error: `Image generation produced nothing publishable (provider: ${result.provider}, model: ${result.model}). ` +
          'If a provider was billed, that spend is still logged; see api_token_log.',
      }
    }
    // Rehosted via uploadMoodImageToShopifyFiles under a `social-` prefix
    // (buildSocialAssetFilename), so isGeneratedSocialAsset() passes it at
    // publish time same as any routine-generated asset.
    return { ok: true, url: result.url, prompt }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ── Caption rework ───────────────────────────────────────────────────────────

/**
 * Charter core + social addendum (Instagram/TikTok/X), plus the rework-
 * specific constraints. Pure and exported so the composition is checkable
 * without a live Claude call.
 */
export function buildCaptionReworkSystemPrompt(): string {
  return `${EMMA_VOICE_SOCIAL}

You are redrafting one Instagram caption from owner feedback. Follow these rules on top of the charter above:
- Register 9 by implication, never by naming. Suggest, do not state.
- Vocabulary fence: no act naming, no orgasm/arousal words, no anatomy nouns, no emoji anatomy.
- No sale attempt: no price, no discount, no promo code, no shop CTA, no link.
- The caption never describes the picture it ships with. The accessibility description belongs in altText, not the caption.
- Arc: hook, then one real thing, then an aside, then an engagement close.
- Hashtags: 5-8, on their own line, separate from the caption body.
- The owner's feedback below is binding clause by clause. Where it conflicts with a stylistic preference elsewhere in this prompt, the owner's feedback wins; it never overrides a hard rule (vocabulary fence, no sale attempt, caption never describes the picture).

Respond with JSON only, no prose outside it, in this exact shape:
{"caption": "...", "altText": "...", "hashtags": ["...", "..."]}`
}

/**
 * The user turn: original caption, the owner's feedback, and the product
 * title when the post features one. `retryFindings`, when present, is
 * appended as the second-pass correction list (see `reworkCaption`).
 */
export function buildCaptionReworkUserContent(input: {
  originalCaption: string
  feedback: string
  productTitle?: string | null
  retryFindings?: string[]
}): string {
  const lines = [
    `Original caption:\n${input.originalCaption}`,
    '',
    `Owner feedback (binding clause by clause):\n${input.feedback.trim()}`,
  ]
  if (input.productTitle?.trim()) lines.push('', `Product: ${input.productTitle.trim()}`)
  if (input.retryFindings?.length) {
    lines.push(
      '',
      'The previous draft failed these deterministic checks. Fix every one of them in this pass:',
      ...input.retryFindings.map(f => `- ${f}`),
    )
  }
  return lines.join('\n')
}

/** Strip markdown fences and parse the model's JSON reply, defensively. */
export function parseCaptionReworkJson(
  raw: string,
): { caption: string; altText: string; hashtags: string[] } | null {
  const stripped = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Record<string, unknown>
  if (typeof p['caption'] !== 'string' || !p['caption'].trim()) return null
  if (typeof p['altText'] !== 'string' || !p['altText'].trim()) return null
  const hashtags = Array.isArray(p['hashtags'])
    ? (p['hashtags'] as unknown[]).filter((h): h is string => typeof h === 'string')
    : []
  return { caption: p['caption'], altText: p['altText'], hashtags }
}

export async function reworkCaption(opts: {
  postId: number
  feedback: string
  actor: string
}): Promise<
  | { ok: true; caption: string; altText: string; hashtags: string[] }
  | { ok: false; error: string }
> {
  try {
    const post = await loadPost(opts.postId)
    if (!post) return { ok: false, error: `No social post ${opts.postId}` }

    let productTitle: string | null = null
    if (post.shopifyProductId) {
      const products = await getProductsByIds([post.shopifyProductId])
      productTitle = products[0]?.title ?? null
    }
    const originalCaption = post.editedText?.trim() || post.tweetText
    const platform = gatePlatformOf(post)
    const [productHandle, recentCaptions] = await Promise.all([
      post.shopifyProductId ? getProductHandleById(post.shopifyProductId) : Promise.resolve(null),
      dbApproveRepo.recentCaptions(14, platform),
    ])

    const system = buildCaptionReworkSystemPrompt()
    let userContent = buildCaptionReworkUserContent({ originalCaption, feedback: opts.feedback, productTitle })
    let lastBlockFindings: GateFinding[] = []

    // One redraft attempt, then one retry carrying the findings (spec: "retry
    // once with the findings appended").
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await generateWithSystem({
        system,
        user: userContent,
        model: SONNET,
        maxTokens: 700,
        feature: 'social-caption-rework',
        caller: opts.actor,
      })
      const parsed = parseCaptionReworkJson(raw)
      if (!parsed) {
        return { ok: false, error: 'Model did not return the expected JSON {caption, altText, hashtags}' }
      }

      const gateResult = await runDeterministicPublishChecks({
        caption: parsed.caption,
        mediaUrls: post.mediaUrls ?? [],
        platform,
        productHandle,
        recentCaptions,
        altText: parsed.altText,
      })
      const blockFindings = gateResult.findings.filter(f => f.severity === 'block')
      if (blockFindings.length === 0) {
        return { ok: true, caption: parsed.caption, altText: parsed.altText, hashtags: parsed.hashtags }
      }
      lastBlockFindings = blockFindings
      userContent = buildCaptionReworkUserContent({
        originalCaption,
        feedback: opts.feedback,
        productTitle,
        retryFindings: blockFindings.map(f => `[${f.check}] ${f.detail}`),
      })
    }

    return {
      ok: false,
      error:
        `Deterministic checks still blocked the redraft after a retry: ` +
        lastBlockFindings.map(f => `[${f.check}] ${f.detail}`).join(' '),
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ── Filing the result ────────────────────────────────────────────────────────

export async function createOwnerReworkRow(opts: {
  fromPostId: number
  caption: string
  altText?: string | null
  mediaUrls: string[]
  imageBrief?: string | null
  subject?: string | null
  actor: string
  scheduledFor?: string | null
}): Promise<{ id: number }> {
  const source = await loadPost(opts.fromPostId)
  if (!source) throw new Error(`No social post ${opts.fromPostId} to rework from`)

  const [row] = await db
    .insert(socialPosts)
    .values({
      platform:      source.platform,
      postType:      source.postType,
      tweetText:     opts.caption,
      altText:       opts.altText ?? null,
      mediaUrls:     opts.mediaUrls,
      imageBrief:    opts.imageBrief ?? null,
      subject:       opts.subject ?? null,
      reworkedFrom:  opts.fromPostId,
      status:        'draft',
      reviewStatus:  'pending_review',
      createdBy:     opts.actor,
      scheduledFor:  opts.scheduledFor ?? null,
    })
    .returning({ id: socialPosts.id })
  return { id: row!.id }
}

// ── Owner approval ───────────────────────────────────────────────────────────

/**
 * Build the gate-stamp `feedback` value for an owner hand-approval.
 *
 * Pure and exported for testing. Written in the exact format
 * `formatGateStamp` produces (which `parseGateStamp`/`STAMP_RE`,
 * `decideManualPublish`, and `postApprovedDraft` all read), with reviewer
 * `owner-studio`. That recogniser turned out to already be reviewer-agnostic:
 * `STAMP_RE` captures the reviewer as `[^\]]+?` with no allowlist, and neither
 * `decideManualPublish` nor `postApprovedDraft` compares the reviewer string
 * against `'social-publish-gate'`, they only check `stamp.verdict === 'PASS'`
 * (see `manual-publish-gate.server.ts`). So no recogniser change was needed;
 * the test below locks that in rather than assuming it.
 */
export function buildOwnerApprovalStamp(
  input: { existingFeedback?: string | null; productHandle?: string | null },
  now: Date,
): string {
  const existing = input.existingFeedback?.trim()
  const notes = existing
    ? `Owner approved by hand after deterministic checks passed.\n\n${existing}`
    : 'Owner approved by hand after deterministic checks passed.'
  return formatGateStamp(
    { verdict: 'PASS', reviewer: 'owner-studio', notes, productHandle: input.productHandle ?? null },
    now,
  )
}

/**
 * The owner approving a post by hand after the hard (deterministic) checks
 * pass, without waiting for the `social-publish-gate` agent to run. This is
 * NOT a bypass: `runDeterministicPublishChecks` runs for real here, exactly
 * as `applyPublishGateVerdict` runs it before believing an agent's PASS. What
 * this function grants that a raw DB write would not is the same authority
 * the owner's `/admin/socials` approve click already had, see
 * `decideManualPublish`'s header comment, reachable here without a manual
 * gate re-run first.
 */
export async function ownerApprovePost(
  opts: { postId: number; actor: string },
): Promise<{ ok: true } | { ok: false; error: string; findings?: unknown[] }> {
  const post = await loadPost(opts.postId)
  if (!post) return { ok: false, error: `No social post ${opts.postId}` }

  const platform = gatePlatformOf(post)
  const productHandle = post.shopifyProductId ? await getProductHandleById(post.shopifyProductId) : null
  const recentCaptions = await dbApproveRepo.recentCaptions(14, platform)
  const caption = post.editedText?.trim() || post.tweetText

  const gateResult = await runDeterministicPublishChecks({
    caption,
    mediaUrls: post.mediaUrls ?? [],
    platform,
    productHandle,
    recentCaptions,
    altText: post.altText ?? null,
  })
  const blockFindings = gateResult.findings.filter(f => f.severity === 'block')
  if (blockFindings.length > 0) {
    return { ok: false, error: 'Deterministic checks blocked this post; not approved.', findings: blockFindings }
  }

  const now = new Date()
  const feedback = buildOwnerApprovalStamp({ existingFeedback: post.feedback, productHandle }, now)
  await db
    .update(socialPosts)
    .set({ reviewStatus: 'approved', reviewedBy: opts.actor, reviewedAt: now, feedback })
    .where(eq(socialPosts.id, opts.postId))
  return { ok: true }
}

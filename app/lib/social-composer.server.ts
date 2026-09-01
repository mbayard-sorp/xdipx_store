/**
 * Shared loader/action pieces for /admin/socials/compose/new and
 * /admin/socials/compose/:id (Phase 3, #4938). Both routes render the same
 * Composer; the id route loads a row, the new route starts blank (optionally
 * pre-filled with `?assets=1,2,3` from the Library's "New post").
 */
import { redirect } from 'react-router'
import { getApprovedCastMembers } from '~/lib/sanity.server'
import { getDealByShopifyId } from '~/lib/shopify.server'
import {
  createOwnerDraft,
  getLibraryAssetsByIds,
  loadComposerPost,
  parseOwnerDraft,
  updateOwnerDraft,
  type ComposerPost,
} from '~/lib/social-studio.server'
import { revertSocialPostToDraft, markSocialPostRemovalOwner } from '~/lib/social-publish-approve.server'
import { utcIsoToLaWallClock } from '~/lib/social-schedule-ui'
import type { CastOption } from '~/components/admin/social/CastPicker'
import type { PickedProduct } from '~/components/admin/social/ProductSearchField'
import type { ComposerInitial } from '~/components/admin/social/Composer'
import type { ComposerSlide } from '~/components/admin/social/composer-slides'

export async function composerRoster(): Promise<CastOption[]> {
  const members = await getApprovedCastMembers().catch(() => [])
  return members.map(m => ({ slug: m.slug, name: m.name, photoUrl: m.photoUrl, role: m.role }))
}

/** Resolve a stored Shopify product id back to what the picker shows. */
export async function resolvePickedProduct(shopifyProductId: string | null): Promise<PickedProduct | null> {
  if (!shopifyProductId) return null
  const numericId = shopifyProductId.replace('gid://shopify/Product/', '')
  const deal = await getDealByShopifyId(numericId).catch(() => null)
  if (!deal) return { id: shopifyProductId, handle: '', title: shopifyProductId, image: null }
  return { id: shopifyProductId, handle: deal.handle, title: deal.seoTitle, image: deal.images[0]?.url ?? null }
}

/** Slides pre-filled from `?assets=` (the Library's "New post" / "Add to draft"). */
export async function slidesFromAssetsParam(url: URL): Promise<ComposerSlide[]> {
  const ids = (url.searchParams.get('assets') ?? '')
    .split(',').map(s => Number(s)).filter(n => Number.isInteger(n) && n > 0).slice(0, 10)
  if (ids.length === 0) return []
  const rows = await getLibraryAssetsByIds(ids)
  const byId = new Map(rows.map(r => [r.id, r]))
  return ids.flatMap(id => {
    const a = byId.get(id)
    return a ? [{ key: `asset-${a.id}`, url: a.url, assetId: a.id, altText: '', aspect: a.aspect }] : []
  })
}

export function blankInitial(platform = 'instagram', slides: ComposerSlide[] = []): ComposerInitial {
  return {
    platform, caption: '', slides, product: null, castSlugs: [],
    scheduledDate: '', scheduledTime: '', feedback: '',
    imageBrief: null, subject: null,
    mediaKind: null, videoUrl: null, posterUrl: null,
    status: 'draft', reviewStatus: 'pending_review',
    gateStatus: null, gateCheckedAt: null, gateFindings: null, createdBy: null, updatedAt: null,
  }
}

export function initialFromPost(post: ComposerPost, product: PickedProduct | null, extraSlides: ComposerSlide[] = []): ComposerInitial {
  const { row } = post
  const wall = row.scheduledAt ? utcIsoToLaWallClock(row.scheduledAt) : null
  const slides: ComposerSlide[] = post.slides.map((s, i) => ({
    key: s.assetId ? `asset-${s.assetId}` : `url-${i}-${s.url}`,
    url: s.url, assetId: s.assetId, altText: s.altText, aspect: s.aspect,
  }))
  const seen = new Set(slides.map(s => s.url))
  for (const s of extraSlides) if (!seen.has(s.url)) slides.push(s)
  return {
    platform: row.platform,
    caption: row.editedText?.trim() || row.tweetText,
    slides: slides.slice(0, 10),
    product,
    castSlugs: row.castSlugs ?? [],
    scheduledDate: wall?.date ?? row.scheduledFor ?? '',
    scheduledTime: wall?.time ?? '',
    feedback: row.feedback ?? '',
    imageBrief: row.imageBrief ?? null,
    subject: row.subject ?? null,
    // Ticket #5715: stored media_kind wins; videoJobId/.mp4 inference covers
    // pre-086 rows. Video rows render the pipeline media read-only.
    mediaKind: (row.mediaKind === 'video' || (row.mediaKind == null && (row.videoJobId != null || !!row.mediaUrls?.[0]?.split('?')[0]?.endsWith('.mp4')))) ? 'video' : null,
    videoUrl: row.mediaUrls?.[0] ?? null,
    posterUrl: row.posterUrl ?? null,
    status: row.status,
    reviewStatus: row.reviewStatus,
    gateStatus: row.gateStatus ?? null,
    gateCheckedAt: row.gateCheckedAt ? new Date(row.gateCheckedAt).toISOString() : null,
    gateFindings: row.gateFindings ?? null,
    createdBy: row.createdBy ?? null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  }
}

export { loadComposerPost }

/**
 * The Composer's `save` and `revert-to-draft` intents. `id` null means create.
 * Returns a Response (redirect to the new row) or a plain result.
 */
export async function handleComposerIntent(form: FormData, id: number | null) {
  const intent = form.get('intent')
  if (intent === 'save') {
    const parsed = parseOwnerDraft(form)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    if (id == null) {
      const { id: newId } = await createOwnerDraft(parsed.input)
      throw redirect(`/admin/socials/compose/${newId}?saved=1`)
    }
    const r = await updateOwnerDraft(id, parsed.input)
    return r.ok ? { ok: true, id: r.id, intent: 'save' } : { ok: false, error: r.error }
  }
  if (intent === 'revert-to-draft') {
    if (id == null) return { ok: false, error: 'Nothing to revert yet' }
    const r = await revertSocialPostToDraft(id)
    return r.ok ? { ok: true, id, intent: 'revert-to-draft' } : { ok: false, error: r.error }
  }
  if (intent === 'mark-removal-owner') {
    if (id == null) return { ok: false, error: 'Nothing to mark yet' }
    const r = await markSocialPostRemovalOwner(id)
    return r.ok ? { ok: true, id, intent: 'mark-removal-owner' } : { ok: false, error: r.error }
  }
  return null
}

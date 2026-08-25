/**
 * The Social Studio Composer (Phase 3, #4938). Three columns on desktop
 * (caption, live mock plus slides, inspector), one column with a sticky
 * action bar on mobile. Save posts to the route action; the row always lands
 * at draft/pending_review and the gate looks again. One coral action: Save.
 */
import { useMemo, useReducer, useState } from 'react'
import { useFetcher, Link } from 'react-router'
import { PlatformMock, type MediaRef } from './PostPreviewCard'
import { SlideStrip } from './SlideStrip'
import { CastPicker, type CastOption } from './CastPicker'
import { ProductSearchField, type PickedProduct } from './ProductSearchField'
import { GateVerdictPanel } from './GateVerdictPanel'
import { LibraryPickerModal, libraryPickerUrl, type LibraryPickerData } from './LibraryPickerModal'
import { RegenerateModal } from './RegenerateModal'
import { StatusPill, studioStatusOf } from './StatusPill'
import { slidesReducer, serializeSlides, type ComposerSlide } from './composer-slides'
import { useStudioShortcuts } from './use-shortcuts'
import { LINKEDIN_CAPTION_MAX, PLATFORM_LABELS, platformCaptionLength, captionOverPlatformLimit } from './types'
import { X_CAPTION_MAX } from '~/lib/social-publish/x-limits'
import { laZoneAbbrev } from '~/lib/social-schedule-ui'
import { applyOwnerFeedback } from './apply-owner-feedback'
import { ClockIcon, UndoIcon } from './icons'
import type { StoredGateFinding } from '~/lib/social-gate-status'

export const COMPOSER_PLATFORMS = ['instagram', 'x', 'linkedin'] as const
export type ComposerPlatform = (typeof COMPOSER_PLATFORMS)[number]

export interface ComposerInitial {
  platform: string
  caption: string
  slides: ComposerSlide[]
  product: PickedProduct | null
  castSlugs: string[]
  scheduledDate: string
  scheduledTime: string
  feedback: string
  /** Ticket #5414: carried through so "Apply my feedback now" can file a
      reworked row that keeps the durable "what does this image depict"
      record, instead of dropping it. */
  imageBrief: string | null
  subject: string | null
  status: string
  reviewStatus: string
  gateStatus: string | null
  gateCheckedAt: string | null
  gateFindings: StoredGateFinding[] | null
  createdBy: string | null
  updatedAt: string | null
}

export interface ComposerProps {
  postId: number | null
  initial: ComposerInitial
  roster: CastOption[]
  /** Rendered below the form on the new-post screen (the legacy X quick post). */
  extra?: React.ReactNode
}

interface SaveResponse { ok: boolean; id?: number; error?: string; intent?: string }

const IG_SOFT_MAX = 2200

export function Composer({ postId, initial, roster, extra }: ComposerProps) {
  const save = useFetcher<SaveResponse>()
  const revert = useFetcher<SaveResponse>()
  const picker = useFetcher<LibraryPickerData>()

  const [platform, setPlatform] = useState<string>(initial.platform)
  // Ticket #5418(b): this used to be a per-platform record with a "N platform
  // variants" counter, but `submitSave` only ever sent the active platform's
  // text and the row stores one `tweetText` for its one `platform`. Writing
  // an Instagram caption, tabbing to X, writing that, then saving kept only
  // the X one, with nothing telling the owner that was about to happen.
  // Persisting real per-platform variants needs a schema change (a post row
  // has one platform), which is a protected-path migration this PR is not
  // taking on, so the affordance is removed instead: one caption, shared
  // across every platform tab, so there is nothing left to silently lose.
  const [caption, setCaption] = useState<string>(initial.caption)
  const [slides, dispatch] = useReducer(slidesReducer, initial.slides)
  const [product, setProduct] = useState<PickedProduct | null>(initial.product)
  const [castSlugs, setCastSlugs] = useState<string[]>(initial.castSlugs)
  const [scheduledDate, setScheduledDate] = useState(initial.scheduledDate)
  const [scheduledTime, setScheduledTime] = useState(initial.scheduledTime)
  const [feedback, setFeedback] = useState(initial.feedback)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [regen, setRegen] = useState<{ slide: ComposerSlide | null } | null>(null)
  // Ticket #5414: "Apply my feedback now" in the inspector, beside the gate
  // panel. Own state (not a fetcher) because it chains rework-caption,
  // optionally regenerate-image, then create-rework-row and needs to await
  // each step's JSON before firing the next.
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<{ ok: boolean; id?: number; error?: string } | null>(null)
  const [alsoRegenerateImage, setAlsoRegenerateImage] = useState(false)

  const captionLength = platformCaptionLength(platform, caption)
  const overLimit = captionOverPlatformLimit(platform, caption) || (platform === 'instagram' && caption.length > IG_SOFT_MAX)
  const limit = platform === 'x' ? X_CAPTION_MAX : platform === 'linkedin' ? LINKEDIN_CAPTION_MAX : IG_SOFT_MAX

  const media: MediaRef[] = useMemo(
    () => slides.map(s => ({ url: s.url, video: s.url.split('?')[0]?.endsWith('.mp4') ?? false, poster: null })),
    [slides],
  )

  const snapshot = JSON.stringify({ platform, caption, slides: serializeSlides(slides), product: product?.id ?? null, castSlugs, scheduledDate, scheduledTime, feedback })
  const initialSnapshot = JSON.stringify({
    platform: initial.platform, caption: initial.caption, slides: serializeSlides(initial.slides),
    product: initial.product?.id ?? null, castSlugs: initial.castSlugs,
    scheduledDate: initial.scheduledDate, scheduledTime: initial.scheduledTime, feedback: initial.feedback,
  })
  const dirty = snapshot !== initialSnapshot
  const saving = save.state !== 'idle'
  const saveError = save.data && !save.data.ok ? save.data.error : null
  const needsMedia = (platform === 'x' || platform === 'instagram') && slides.length === 0
  const canSave = !saving && caption.trim().length > 0 && !overLimit && !needsMedia

  function submitSave() {
    if (!canSave) return
    save.submit(
      {
        intent: 'save',
        platform,
        caption,
        slides: serializeSlides(slides),
        shopifyProductId: product?.id ?? '',
        productHandle: product?.handle ?? '',
        castSlugs: castSlugs.join(','),
        scheduledDate,
        scheduledTime,
        feedback,
      },
      { method: 'post' },
    )
  }

  // Ticket #5414: judges the saved row, same as GateVerdictPanel's "Run gate"
  // (dirty disables it, save the draft first) — the rework functions load the
  // post from the DB by id, not from what's in this form.
  const canApplyFeedback = postId != null && !dirty && !applying && feedback.trim().length > 0

  async function applyFeedbackNow() {
    if (postId == null || !feedback.trim()) return
    setApplying(true)
    setApplyResult(null)
    try {
      const result = await applyOwnerFeedback({
        postId,
        feedback: feedback.trim(),
        alsoRegenerateImage,
        mediaUrls: slides.map(s => s.url),
        imageBrief: initial.imageBrief,
        subject: initial.subject,
      })
      setApplyResult(result)
    } finally {
      setApplying(false)
    }
  }

  function openPicker() {
    picker.load(libraryPickerUrl(product?.handle ?? ''))
    setPickerOpen(true)
  }

  const shortcuts = useMemo(() => ({
    'mod+enter': (e: KeyboardEvent) => { e.preventDefault(); submitSave() },
    escape: () => { setPickerOpen(false); setRegen(null) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [snapshot, canSave])
  useStudioShortcuts(shortcuts)

  const studioStatus = studioStatusOf({
    status: initial.status, reviewStatus: initial.reviewStatus,
    scheduledFor: initial.scheduledDate || null,
  })
  const canRevert = postId != null && initial.status === 'draft' && (initial.reviewStatus === 'approved' || initial.reviewStatus === 'needs_changes')
  const zone = laZoneAbbrev(scheduledDate ? new Date(`${scheduledDate}T12:00:00`) : new Date())

  return (
    <div className="pb-24 lg:pb-0">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h2 className="font-display text-xl text-ink">{postId ? `Post #${postId}` : 'New post'}</h2>
        {postId && <StatusPill status={studioStatus} />}
        {postId && initial.createdBy && (
          <span className="font-mono text-[11px] text-ink-4">by {initial.createdBy}</span>
        )}
        {initial.updatedAt && (
          <span className="font-mono text-[11px] text-ink-4">updated {initial.updatedAt.slice(0, 16).replace('T', ' ')}Z</span>
        )}
        <span className="flex-1" />
        <Link to="/admin/socials/queue" className="text-sm text-ink-3 hover:text-ink min-h-11 inline-flex items-center">Back to queue</Link>
      </div>

      {initial.reviewStatus === 'approved' && initial.status === 'draft' && (
        <p className="mb-4 rounded-xl border border-plum/20 bg-plum-soft px-3 py-2 text-xs text-plum-2">
          This post is approved. Saving any edit returns it to pending and clears the gate verdict; the gate judges it again before it can ship.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px_340px]">
        {/* Column 1: caption */}
        <section aria-label="Caption" className="space-y-3 min-w-0">
          <div role="tablist" aria-label="Platform" className="flex gap-1 border-b border-line">
            {COMPOSER_PLATFORMS.map(p => (
              <button
                key={p}
                role="tab"
                type="button"
                aria-selected={platform === p}
                onClick={() => setPlatform(p)}
                className={`min-h-11 px-3 -mb-px border-b-2 text-sm font-medium ${platform === p ? 'border-coral text-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}
              >
                {PLATFORM_LABELS[p]}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="sr-only">Caption for {PLATFORM_LABELS[platform]}</span>
            <textarea
              value={caption}
              onChange={e => setCaption(e.target.value)}
              rows={platform === 'x' ? 6 : 12}
              placeholder={platform === 'x' ? 'Write the post. Links count 23 each.' : 'Write the caption.'}
              className="w-full rounded-xl border border-line bg-paper p-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-coral/30 resize-y"
            />
          </label>
          <div className="flex items-center justify-between">
            <span className={`font-mono text-xs tabular-nums ${overLimit ? 'text-red-700' : captionLength > limit * 0.9 ? 'text-amber-800' : 'text-ink-4'}`} title={platform === 'x' ? 'Links count as 23 characters each, the way X counts them' : undefined}>
              {captionLength}/{limit}
            </span>
            {/* Ticket #5418(b): switching platform tabs edits this same
                caption, it is not a saved variant per platform (the row has
                one platform), so nothing here implies otherwise. */}
            <span className="font-mono text-[11px] text-ink-4">saves as {PLATFORM_LABELS[platform]}</span>
          </div>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">Note for the team</span>
            <textarea
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              rows={2}
              placeholder="Optional. Kept separate from the gate verdict; the team reads it verbatim."
              className="mt-1 w-full rounded-xl border border-line bg-paper p-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-coral/30 resize-y"
            />
          </label>
          {extra}
        </section>

        {/* Column 2: mock + slides */}
        <section aria-label="Preview" className="space-y-4 min-w-0">
          <div className="rounded-2xl border border-line bg-paper-2 p-3 flex justify-center overflow-x-auto">
            <PlatformMock platform={platform} media={media} caption={caption} />
          </div>
          <SlideStrip
            slides={slides}
            dispatch={dispatch}
            onAddFromLibrary={openPicker}
            onRegenerate={slide => setRegen({ slide })}
          />
          <button
            type="button"
            onClick={() => setRegen({ slide: null })}
            className="text-xs text-ink-3 hover:text-ink underline-offset-2 hover:underline min-h-11"
          >
            Generate a new image from a prompt
          </button>
        </section>

        {/* Column 3: inspector */}
        <aside aria-label="Inspector" className="space-y-6 min-w-0 lg:border-l lg:border-line lg:pl-6">
          <ProductSearchField value={product} onChange={setProduct} />
          <CastPicker roster={roster} selected={castSlugs} onChange={setCastSlugs} />

          <fieldset>
            <legend className="text-xs font-semibold uppercase tracking-wide text-ink-3 mb-2">Schedule</legend>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={scheduledDate}
                onChange={e => setScheduledDate(e.target.value)}
                aria-label="Scheduled date"
                className="min-h-11 flex-1 min-w-0 rounded-xl border border-line bg-paper px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-coral/30"
              />
              <input
                type="time"
                value={scheduledTime}
                onChange={e => setScheduledTime(e.target.value)}
                aria-label="Scheduled time"
                disabled={!scheduledDate}
                className="min-h-11 w-28 rounded-xl border border-line bg-paper px-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-coral/30 disabled:opacity-50"
              />
              <span className="font-mono text-xs text-ink-3 inline-flex items-center gap-1" title="Los Angeles wall clock, stored as UTC">
                <ClockIcon size={12} /> {zone}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-ink-4">
              {scheduledDate
                ? scheduledTime
                  ? `Publishes at ${scheduledTime} ${zone} once approved and gate-passed.`
                  : 'Date only: the hourly tick picks it up that day once approved.'
                : 'No slot. Approved posts without a slot wait in the queue.'}
            </p>
          </fieldset>

          <GateVerdictPanel
            postId={postId}
            productHandle={product?.handle ?? null}
            gateStatus={initial.gateStatus}
            gateCheckedAt={initial.gateCheckedAt}
            gateFindings={initial.gateFindings}
            dirty={dirty}
          />

          {/* Ticket #5414: the instant path for the "Note for the team" box
              above, instead of waiting for the drafting routine's next
              14:00/22:00 UTC pass. Files a fresh pending_review row
              (reworkedFrom this one); never approves or publishes it. */}
          <section aria-label="Apply feedback now" className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Apply my feedback now</h3>
            <label className="inline-flex items-center gap-2 text-xs text-ink-3">
              <input
                type="checkbox"
                checked={alsoRegenerateImage}
                onChange={e => setAlsoRegenerateImage(e.target.checked)}
                disabled={applying}
                className="w-4 h-4 rounded border-line text-coral focus:ring-coral/30"
              />
              Also regenerate the image (bills the social team's image budget)
            </label>
            <button
              type="button"
              onClick={applyFeedbackNow}
              disabled={!canApplyFeedback}
              title={
                postId == null
                  ? 'Save the draft first'
                  : dirty
                    ? 'Save your edits first; the rework reads the saved row'
                    : !feedback.trim()
                      ? 'Write a note for the team above first'
                      : undefined
              }
              className="min-h-11 w-full px-4 rounded-full bg-plum-soft text-plum text-sm font-semibold hover:bg-plum-soft/70 disabled:opacity-50"
            >
              {applying ? 'Applying' : 'Apply my feedback now ♥'}
            </button>
            {postId == null && <p className="text-xs text-ink-3">Save the draft to rework it from your note.</p>}
            {dirty && postId != null && (
              <p className="text-xs text-amber-800">Unsaved edits. Save, then apply so it reworks what you see.</p>
            )}
            {applyResult?.ok === false && (
              <p className="text-xs text-red-700">{applyResult.error ?? 'Could not apply your feedback.'}</p>
            )}
            {applyResult?.ok && applyResult.id != null && (
              <p className="text-xs text-[#4F6150]">
                Applied. Reworked as{' '}
                <Link to={`/admin/socials/compose/${applyResult.id}`} className="font-semibold hover:underline">
                  #{applyResult.id}
                </Link>
                , waiting on you in the queue.
              </p>
            )}
          </section>
        </aside>
      </div>

      {/* Action bar: sticky bottom on mobile, inline on desktop */}
      <div className="fixed lg:static bottom-0 inset-x-0 z-20 lg:z-auto border-t lg:border-t-0 border-line bg-paper lg:bg-transparent px-4 py-3 lg:px-0 lg:pt-6 flex items-center gap-3">
        <div className="flex-1 min-w-0 text-xs">
          {saveError && <p className="text-red-700">{saveError}</p>}
          {!saveError && needsMedia && <p className="text-ink-3">{PLATFORM_LABELS[platform]} needs at least one image.</p>}
          {!saveError && !needsMedia && overLimit && <p className="text-red-700">Caption is over the {PLATFORM_LABELS[platform]} limit.</p>}
          {!saveError && !needsMedia && !overLimit && save.data?.ok && !dirty && <p className="text-[#4F6150]">Saved. Pending review; run the gate when ready.</p>}
          {!saveError && !needsMedia && !overLimit && dirty && <p className="text-ink-4 font-mono">unsaved</p>}
          {revert.data && !revert.data.ok && <p className="text-red-700">{revert.data.error}</p>}
        </div>
        {canRevert && (
          <revert.Form method="post">
            <input type="hidden" name="intent" value="revert-to-draft" />
            <button
              type="submit"
              disabled={revert.state !== 'idle'}
              className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-full border border-line bg-paper text-sm font-medium text-ink hover:border-ink-4 disabled:opacity-50"
              title="Back to pending review; clears the gate verdict"
            >
              <UndoIcon size={14} /> Revert to draft
            </button>
          </revert.Form>
        )}
        <button
          type="button"
          onClick={submitSave}
          disabled={!canSave}
          className="min-h-11 px-6 rounded-full bg-coral text-white text-sm font-semibold hover:bg-coral-2 disabled:opacity-50"
          title="Save (Cmd/Ctrl+Enter)"
        >
          {saving ? 'Saving' : postId ? 'Save changes' : 'Save draft'}
        </button>
      </div>

      {pickerOpen && (
        <LibraryPickerModal
          initialQuery={product?.handle ?? ''}
          data={picker.data}
          loading={picker.state !== 'idle'}
          onSearch={q => picker.load(libraryPickerUrl(q))}
          onClose={() => setPickerOpen(false)}
          onAdd={assets => {
            dispatch({
              type: 'add',
              slides: assets.map(a => ({ key: `asset-${a.id}`, url: a.url, assetId: a.id, altText: '', aspect: a.aspect })),
            })
            setPickerOpen(false)
          }}
        />
      )}

      {regen && (
        <RegenerateModal
          initialPrompt=""
          sourceUrl={regen.slide?.url ?? null}
          productHandle={product?.handle ?? null}
          productImageUrl={product?.image ?? null}
          roster={roster}
          defaultAspect={platform === 'x' ? '16:9' : '4:5'}
          onClose={() => setRegen(null)}
          onUse={picked => {
            const fresh: ComposerSlide = { key: picked.assetId ? `asset-${picked.assetId}` : `url-${picked.url}`, url: picked.url, assetId: picked.assetId, altText: regen.slide?.altText ?? '' }
            if (regen.slide) {
              const at = slides.findIndex(s => s.key === regen.slide!.key)
              dispatch({ type: 'remove', key: regen.slide.key })
              dispatch({ type: 'add', slides: [fresh] })
              if (at >= 0) dispatch({ type: 'move', key: fresh.key, to: at })
            } else {
              dispatch({ type: 'add', slides: [fresh] })
            }
            setRegen(null)
          }}
        />
      )}
    </div>
  )
}

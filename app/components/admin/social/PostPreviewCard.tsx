import { useState } from 'react'
import { useFetcher } from 'react-router'
import {
  PLATFORM_LABELS,
  LINKEDIN_CAPTION_MAX,
  isVideoPost,
  platformCaptionLength,
  captionOverPlatformLimit,
  type SocialPostRow,
} from './types'
import { X_CAPTION_MAX } from '~/lib/social-publish/x-limits'

/** Image or muted-preview video, same box either way. */
interface MediaRef { url: string; video: boolean; poster: string | null }

function MediaBox({ media, className }: { media: MediaRef; className: string }) {
  if (!media.video) return <img src={media.url} alt="" className={className} />
  return (
    <video
      src={media.url}
      poster={media.poster ?? undefined}
      controls
      playsInline
      muted
      preload="metadata"
      className={className}
    />
  )
}

/**
 * One draft in the review queue: a platform-native preview mock (X card /
 * Instagram square / TikTok 9:16) plus the owner's review controls — inline
 * caption editor, feedback box, and Approve / Request changes / Reject.
 * Feedback is sent back to the social team verbatim on its next run; caption
 * edits are saved as editedText and diffed by the team as silent feedback.
 */
export function PostPreviewCard({ post }: { post: SocialPostRow }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>()
  const [caption, setCaption] = useState(post.editedText ?? post.tweetText)
  const [feedback, setFeedback] = useState(post.feedback ?? '')
  const [feedbackError, setFeedbackError] = useState(false)

  const isSubmitting = fetcher.state !== 'idle'
  // Every slide, not just the first: a carousel draft is reviewed as the
  // carousel the publisher will ship, and a 3-slide post whose third slide is
  // wrong must be visible as wrong here (ticket #4908).
  const video = isVideoPost(post)
  const media: MediaRef[] = (post.mediaUrls ?? []).map(url => ({ url, video, poster: post.posterUrl ?? null }))
  const edited = caption.trim() !== post.tweetText.trim()

  // Counted the way the platform counts: on X every link costs a flat 23
  // characters, so a two-link caption is far shorter to X than `.length` says.
  const captionLength = platformCaptionLength(post.platform, caption)
  const overLimit = captionOverPlatformLimit(post.platform, caption)

  function submit(decision: 'approved' | 'needs_changes' | 'rejected') {
    if (decision === 'needs_changes' && !feedback.trim()) {
      setFeedbackError(true)
      return
    }
    setFeedbackError(false)
    fetcher.submit(
      {
        intent: 'review',
        postId: String(post.id),
        decision,
        feedback: feedback.trim(),
        editedText: edited ? caption.trim() : '',
      },
      { method: 'post' },
    )
  }

  if (fetcher.data?.ok) {
    const decided = (fetcher.formData?.get('decision') as string | null) ?? 'reviewed'
    return (
      <div className="rounded-2xl border border-line bg-paper-2 p-4 text-sm text-ink-3">
        {PLATFORM_LABELS[post.platform] ?? post.platform} draft #{post.id}:{' '}
        <span className="font-semibold text-ink">{decided.replace('_', ' ')}</span>
        {decided === 'needs_changes' && ' — the team will rework it next run.'}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-line bg-white p-4 md:p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <PlatformChip platform={post.platform} />
        <span className="text-xs text-ink-4 capitalize">{post.postType.replace('_', ' ')}</span>
        {post.scheduledFor && (
          <span className="text-xs text-ink-4">
            for {new Date(`${post.scheduledFor}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
        )}
        {post.reworkedFrom && (
          <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-plum-soft text-plum">
            Rework of #{post.reworkedFrom}
          </span>
        )}
        {post.reviewStatus === 'needs_changes' && (
          <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
            Changes requested
          </span>
        )}
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:gap-6">
        {/* Platform-native mock */}
        <div className="shrink-0">
          {post.platform === 'instagram' && <InstagramMock media={media} caption={caption} />}
          {(post.platform === 'tiktok' || post.platform === 'youtube') && <TikTokMock media={media} caption={caption} youtube={post.platform === 'youtube'} />}
          {(post.platform === 'x' || post.platform === 'facebook') && <XMock media={media} caption={caption} />}
          {post.platform === 'linkedin' && <LinkedInMock media={media} caption={caption} />}
        </div>

        {/* Review controls */}
        <div className="flex-1 min-w-0 space-y-3">
          <div>
            <label className="text-xs font-semibold text-ink-3 uppercase tracking-wide">Caption</label>
            <textarea
              value={caption}
              onChange={e => setCaption(e.target.value)}
              rows={post.platform === 'x' ? 4 : 6}
              className="mt-1 w-full rounded-xl border border-line p-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-coral/30 resize-y"
            />
            <div className="flex items-center justify-between mt-1">
              {post.platform === 'x' ? (
                <span
                  className={`text-xs font-medium ${overLimit ? 'text-red-500' : 'text-ink-4'}`}
                  title="Links count as 23 characters each, the way X counts them"
                >
                  {captionLength}/{X_CAPTION_MAX}
                </span>
              ) : post.platform === 'linkedin' ? (
                <span className={`text-xs font-medium ${overLimit ? 'text-red-500' : 'text-ink-4'}`}>
                  {captionLength}/{LINKEDIN_CAPTION_MAX}
                </span>
              ) : (
                <span className="text-xs text-ink-4">{captionLength} chars</span>
              )}
              {edited && <span className="text-xs text-plum font-medium">Edited — saved with your decision</span>}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-ink-3 uppercase tracking-wide">
              Feedback for the team
            </label>
            <textarea
              value={feedback}
              onChange={e => { setFeedback(e.target.value); if (e.target.value.trim()) setFeedbackError(false) }}
              rows={2}
              placeholder="Tell the team what to fix and why. They read this verbatim on their next run."
              className={`mt-1 w-full rounded-xl border p-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-coral/30 resize-y ${feedbackError ? 'border-red-400' : 'border-line'}`}
            />
            {feedbackError && (
              <p className="text-xs text-red-500 mt-1">Feedback is required when requesting changes.</p>
            )}
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => submit('approved')}
              disabled={isSubmitting || overLimit}
              className="px-4 py-2 bg-coral text-white rounded-full text-sm font-semibold hover:bg-coral-2 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Saving…' : 'Approve'}
            </button>
            <button
              onClick={() => submit('needs_changes')}
              disabled={isSubmitting}
              className="px-4 py-2 bg-paper-2 text-ink rounded-full text-sm font-medium border border-line hover:border-amber-400 hover:text-amber-700 transition-colors disabled:opacity-50"
            >
              Request changes
            </button>
            <button
              onClick={() => submit('rejected')}
              disabled={isSubmitting}
              className="px-4 py-2 bg-paper-2 text-ink-3 rounded-full text-sm font-medium border border-line hover:border-red-300 hover:text-red-600 transition-colors disabled:opacity-50"
            >
              Reject
            </button>
          </div>
          {fetcher.data?.ok === false && (
            <p className="text-xs text-red-500">{fetcher.data.error ?? 'Something went wrong.'}</p>
          )}
        </div>
      </div>
    </div>
  )
}

export function PlatformChip({ platform }: { platform: string }) {
  const styles: Record<string, string> = {
    x: 'bg-ink text-white',
    instagram: 'bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-500 text-white',
    tiktok: 'bg-ink text-white',
    facebook: 'bg-blue-600 text-white',
    linkedin: 'bg-[#0A66C2] text-white',
  }
  return (
    <span className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide ${styles[platform] ?? 'bg-paper-3 text-ink-3'}`}>
      {PLATFORM_LABELS[platform] ?? platform}
    </span>
  )
}

function MissingMedia({ label }: { label: string }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1 border-2 border-dashed border-line rounded-lg bg-paper-2 p-3 text-center">
      <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
        No asset yet
      </span>
      <span className="text-xs text-ink-4">{label}</span>
    </div>
  )
}

function InstagramMock({ media, caption }: { media: MediaRef[]; caption: string }) {
  const [active, setActive] = useState(0)
  const current = media[Math.min(active, Math.max(media.length - 1, 0))] ?? null
  return (
    <div className="w-[240px] rounded-xl border border-line overflow-hidden bg-white">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="w-6 h-6 rounded-full bg-coral-soft flex items-center justify-center text-[10px] font-bold text-coral">x</span>
        <span className="text-xs font-semibold text-ink">xdipx</span>
      </div>
      <div className={`relative ${current?.video ? 'aspect-[9/16] bg-paper-3' : 'aspect-square bg-paper-3'}`}>
        {current ? (
          <MediaBox media={current} className="w-full h-full object-cover" />
        ) : (
          <MissingMedia label="Square 1:1 image needed" />
        )}
        {media.length > 1 && (
          <span className="absolute top-2 right-2 rounded-full bg-ink/70 px-2 py-0.5 font-mono text-[10px] text-white">
            {active + 1}/{media.length}
          </span>
        )}
      </div>
      {media.length > 1 && <SlideStrip media={media} active={active} onSelect={setActive} />}
      <p className="px-3 py-2 text-xs text-ink leading-snug">
        <span className="font-semibold">xdipx</span>{' '}
        {caption.length > 125 ? `${caption.slice(0, 125)}… ` : caption}
        {caption.length > 125 && <span className="text-ink-4">more</span>}
      </p>
    </div>
  )
}

function TikTokMock({ media: mediaList, caption, youtube }: { media: MediaRef[]; caption: string; youtube?: boolean }) {
  const media = mediaList[0] ?? null
  return (
    <div className="w-[180px]">
      {youtube && (
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-4">YouTube Short</p>
      )}
      <div className="relative aspect-[9/16] rounded-xl overflow-hidden border border-line bg-ink">
        {media ? (
          <MediaBox media={media} className="w-full h-full object-cover" />
        ) : (
          <MissingMedia label="9:16 vertical asset needed" />
        )}
        {media && !media.video && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 pt-8">
            <p className="text-[10px] font-semibold text-white">@xdipx</p>
            <p className="text-[10px] text-white/90 leading-snug">
              {caption.length > 90 ? `${caption.slice(0, 90)}…` : caption}
            </p>
          </div>
        )}
      </div>
      {media?.video && (
        <p className="mt-1 text-[10px] text-ink-4 leading-snug">
          {caption.length > 90 ? `${caption.slice(0, 90)}…` : caption}
        </p>
      )}
      {!media && (
        <p className="mt-1 text-[10px] text-ink-4 leading-snug">
          {caption.length > 90 ? `${caption.slice(0, 90)}…` : caption}
        </p>
      )}
      {mediaList.length > 1 && (
        <p className="mt-1 font-mono text-[10px] text-ink-4">+{mediaList.length - 1} more slide{mediaList.length > 2 ? 's' : ''} (first shown)</p>
      )}
    </div>
  )
}

function LinkedInMock({ media: mediaList, caption }: { media: MediaRef[]; caption: string }) {
  const media = mediaList[0] ?? null
  // LinkedIn's feed truncates around 210 chars behind "…see more".
  const truncated = caption.length > 210
  return (
    <div className="w-[280px] rounded-xl border border-line bg-white p-3">
      <div className="flex items-center gap-2">
        <span className="w-9 h-9 rounded bg-[#0A66C2] flex items-center justify-center text-xs font-bold text-white">x</span>
        <div className="leading-tight">
          <p className="text-xs font-bold text-ink">xdipx</p>
          <p className="text-[10px] text-ink-4">Sexual wellness retail · Company page</p>
        </div>
      </div>
      <p className="mt-2 text-sm text-ink whitespace-pre-wrap break-words leading-snug">
        {truncated ? `${caption.slice(0, 210)}` : caption}
        {truncated && <span className="text-ink-4"> …see more</span>}
      </p>
      {media && (
        <div className="mt-2 rounded-lg overflow-hidden border border-line">
          <MediaBox media={media} className={media.video ? 'w-full max-h-[280px] object-cover' : 'w-full max-h-[160px] object-cover'} />
        </div>
      )}
    </div>
  )
}

function XMock({ media, caption }: { media: MediaRef[]; caption: string }) {
  // X shows up to four images in a grid; anything past four is dropped by the
  // publisher, so it is shown here as dropped rather than hidden.
  const shown = media.slice(0, 4)
  const dropped = media.length - shown.length
  return (
    <div className="w-[260px] rounded-xl border border-line bg-white p-3">
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-full bg-ink flex items-center justify-center text-xs font-bold text-white">x</span>
        <div className="leading-tight">
          <p className="text-xs font-bold text-ink">xdipx</p>
          <p className="text-[10px] text-ink-4">@xdipx</p>
        </div>
      </div>
      <p className="mt-2 text-sm text-ink whitespace-pre-wrap break-words leading-snug">{caption}</p>
      {shown.length === 1 && shown[0] && (
        <div className="mt-2 rounded-lg overflow-hidden border border-line">
          <MediaBox media={shown[0]} className={shown[0].video ? 'w-full max-h-[280px] object-cover' : 'w-full max-h-[160px] object-cover'} />
        </div>
      )}
      {shown.length > 1 && (
        <div className={`mt-2 grid gap-0.5 rounded-lg overflow-hidden border border-line ${shown.length === 2 ? 'grid-cols-2' : 'grid-cols-2 grid-rows-2'}`}>
          {shown.map((m, i) => (
            <div key={m.url + i} className={`aspect-square ${shown.length === 3 && i === 0 ? 'row-span-2 aspect-auto' : ''}`}>
              <MediaBox media={m} className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}
      {dropped > 0 && (
        <p className="mt-1 font-mono text-[10px] text-red-500">+{dropped} more than X allows; the publisher posts the first 4.</p>
      )}
    </div>
  )
}

/** Thumbnail strip under a carousel mock. Keyboard: arrow keys move the selection. */
function SlideStrip({ media, active, onSelect }: { media: MediaRef[]; active: number; onSelect: (i: number) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Slides"
      className="flex gap-1 overflow-x-auto px-2 py-1.5 bg-paper-2"
      onKeyDown={e => {
        if (e.key === 'ArrowRight') { e.preventDefault(); onSelect(Math.min(active + 1, media.length - 1)) }
        if (e.key === 'ArrowLeft') { e.preventDefault(); onSelect(Math.max(active - 1, 0)) }
      }}
    >
      {media.map((m, i) => (
        <button
          key={m.url + i}
          type="button"
          role="tab"
          aria-selected={i === active}
          aria-label={`Slide ${i + 1} of ${media.length}`}
          onClick={() => onSelect(i)}
          className={`relative h-11 w-11 shrink-0 overflow-hidden rounded-md border-2 ${i === active ? 'border-coral' : 'border-transparent'}`}
        >
          {m.video
            ? <img src={m.poster ?? undefined} alt="" className="h-full w-full object-cover bg-ink" />
            : <img src={m.url} alt="" className="h-full w-full object-cover" />}
          <span className="absolute bottom-0 right-0 rounded-tl bg-ink/70 px-1 font-mono text-[9px] text-white">{i + 1}</span>
        </button>
      ))}
    </div>
  )
}

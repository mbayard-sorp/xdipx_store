import { useState } from 'react'
import { useFetcher } from 'react-router'
import { StarRating }   from './StarRating'
import { MediaUploader } from './MediaUploader'

interface ReviewFormProps {
  productId?: string | undefined
  inviteToken?: string | undefined
  reviewerName?: string | undefined
  productTitle?: string | undefined
  isVerifiedPurchase?: boolean | undefined
}

interface FieldErrors {
  rating?: string
  reviewerName?: string
  reviewerEmail?: string
  body?: string
  general?: string
}

export function ReviewForm({
  productId,
  inviteToken,
  reviewerName: prefillName = '',
  productTitle,
  isVerifiedPurchase,
}: ReviewFormProps) {
  const fetcher = useFetcher<{ ok: boolean; errors?: FieldErrors }>()
  const [rating, setRating] = useState(0)
  const [mediaFiles, setMediaFiles] = useState<File[]>([])

  const isSubmitting = fetcher.state !== 'idle'
  const errors = fetcher.data?.errors

  // Show success state
  if (fetcher.data?.ok) {
    return (
      <div className="text-center py-12">
        <div
          className="text-6xl mb-4 animate-bounce inline-block"
          aria-hidden="true"
          style={{ color: '#7C8F78' }}
        >
          ♥
        </div>
        <h2
          className="text-2xl font-bold text-ink mb-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Thank you!
        </h2>
        <p className="text-ink/60">
          Your review has been submitted and is pending approval.
        </p>
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const formData = new FormData(form)

    // Append rating (it's controlled, not a native input)
    formData.set('rating', String(rating))

    // Append media files
    mediaFiles.forEach((file, i) => {
      formData.append(`media_${i}`, file)
    })

    fetcher.submit(formData, {
      method: 'post',
      action: '/api/reviews',
      encType: 'multipart/form-data',
    })
  }

  return (
    <div className="max-w-lg mx-auto">
      {productTitle && (
        <p className="text-sm text-ink/50 mb-1" style={{ fontFamily: 'var(--font-display)' }}>
          Reviewing
        </p>
      )}
      {productTitle && (
        <h1
          className="text-xl font-bold text-ink mb-6"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {productTitle}
        </h1>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Hidden fields */}
        {productId    && <input type="hidden" name="shopifyProductId" value={productId} />}
        {inviteToken  && <input type="hidden" name="inviteToken"      value={inviteToken} />}
        {isVerifiedPurchase && <input type="hidden" name="isVerifiedPurchase" value="true" />}

        {/* Honeypot */}
        <input
          type="text"
          name="website"
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          autoComplete="off"
        />

        {/* Star rating */}
        <div>
          <label className="block text-sm font-semibold text-ink mb-2" style={{ fontFamily: 'var(--font-display)' }}>
            Your rating <span className="text-coral">*</span>
          </label>
          <StarRating value={rating} onChange={setRating} size="lg" />
          {errors?.rating && (
            <p className="text-xs text-red-500 mt-1">{errors.rating}</p>
          )}
        </div>

        {/* Reviewer name */}
        <div>
          <label htmlFor="reviewerName" className="block text-sm font-semibold text-ink mb-1.5" style={{ fontFamily: 'var(--font-display)' }}>
            Your name <span className="text-coral">*</span>
          </label>
          <input
            id="reviewerName"
            name="reviewerName"
            type="text"
            required
            defaultValue={prefillName}
            placeholder="Jane D."
            className="w-full border border-cream-2 rounded-xl px-4 py-2.5 text-sm text-ink focus:outline-none focus:border-sage transition-colors"
          />
          {errors?.reviewerName && (
            <p className="text-xs text-red-500 mt-1">{errors.reviewerName}</p>
          )}
        </div>

        {/* Email */}
        <div>
          <label htmlFor="reviewerEmail" className="block text-sm font-semibold text-ink mb-1.5" style={{ fontFamily: 'var(--font-display)' }}>
            Email <span className="text-coral">*</span>
            <span className="text-ink/40 font-normal ml-1">(not published)</span>
          </label>
          <input
            id="reviewerEmail"
            name="reviewerEmail"
            type="email"
            required
            placeholder="you@example.com"
            className="w-full border border-cream-2 rounded-xl px-4 py-2.5 text-sm text-ink focus:outline-none focus:border-sage transition-colors"
          />
          {errors?.reviewerEmail && (
            <p className="text-xs text-red-500 mt-1">{errors.reviewerEmail}</p>
          )}
        </div>

        {/* Title */}
        <div>
          <label htmlFor="title" className="block text-sm font-semibold text-ink mb-1.5" style={{ fontFamily: 'var(--font-display)' }}>
            Review title
          </label>
          <input
            id="title"
            name="title"
            type="text"
            placeholder="One great sentence..."
            maxLength={150}
            className="w-full border border-cream-2 rounded-xl px-4 py-2.5 text-sm text-ink focus:outline-none focus:border-sage transition-colors"
          />
        </div>

        {/* Body */}
        <div>
          <label htmlFor="body" className="block text-sm font-semibold text-ink mb-1.5" style={{ fontFamily: 'var(--font-display)' }}>
            Your review
          </label>
          <textarea
            id="body"
            name="body"
            rows={5}
            placeholder="Tell us what you thought — the good, the great, and anything you'd change..."
            className="w-full border border-cream-2 rounded-xl px-4 py-2.5 text-sm text-ink focus:outline-none focus:border-sage transition-colors resize-none"
          />
          {errors?.body && (
            <p className="text-xs text-red-500 mt-1">{errors.body}</p>
          )}
        </div>

        {/* Media */}
        <div>
          <label className="block text-sm font-semibold text-ink mb-1.5" style={{ fontFamily: 'var(--font-display)' }}>
            Add photos or video
          </label>
          <MediaUploader onChange={setMediaFiles} maxFiles={5} maxMb={10} />
        </div>

        {errors?.general && (
          <p className="text-sm text-red-500">{errors.general}</p>
        )}

        <button
          type="submit"
          disabled={isSubmitting || rating === 0}
          className="w-full py-3.5 rounded-full font-bold bg-coral text-white hover:opacity-90 hover:scale-[1.01] shadow-md shadow-coral/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {isSubmitting ? 'Submitting...' : 'Submit Review ♥'}
        </button>

        <p className="text-xs text-ink/40 text-center">
          Reviews are moderated and may take 24 hours to appear.
        </p>
      </form>
    </div>
  )
}

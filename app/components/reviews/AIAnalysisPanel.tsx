import type { Review } from '~/types/reviews'

interface AIAnalysisPanelProps {
  review: Review
}

const SENTIMENT_STYLES: Record<string, string> = {
  positive: 'bg-green-50  text-green-700',
  neutral:  'bg-amber-50  text-amber-700',
  negative: 'bg-red-50    text-red-700',
}

export function AIAnalysisPanel({ review }: AIAnalysisPanelProps) {
  if (!review.aiSentiment && review.aiSpamScore == null && !review.aiSummary) {
    return (
      <div className="bg-brand-mist rounded-xl p-4 text-sm text-brand-charcoal/50 italic">
        AI analysis not yet run for this review.
      </div>
    )
  }

  const spamPct = review.aiSpamScore != null ? Math.round(review.aiSpamScore * 100) : null

  return (
    <div className="bg-brand-mist rounded-xl p-4 space-y-3">
      <p
        className="text-xs font-semibold text-brand-charcoal/50 uppercase tracking-widest"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        AI Analysis
      </p>

      {/* Sentiment badge */}
      {review.aiSentiment && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-brand-charcoal/50">Sentiment</span>
          <span className={[
            'text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize',
            SENTIMENT_STYLES[review.aiSentiment] ?? 'bg-brand-mist text-brand-charcoal',
          ].join(' ')}>
            {review.aiSentiment}
          </span>
        </div>
      )}

      {/* Spam score */}
      {spamPct != null && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-brand-charcoal/50">Spam score</span>
            <span className={[
              'text-xs font-semibold',
              spamPct >= 75 ? 'text-red-600' : spamPct >= 40 ? 'text-amber-600' : 'text-green-600',
            ].join(' ')}>
              {spamPct}%
            </span>
          </div>
          <div className="h-1.5 bg-white rounded-full overflow-hidden">
            <div
              className={[
                'h-full rounded-full transition-all',
                spamPct >= 75 ? 'bg-red-500' : spamPct >= 40 ? 'bg-amber-400' : 'bg-green-500',
              ].join(' ')}
              style={{ width: `${spamPct}%` }}
            />
          </div>
        </div>
      )}

      {/* AI summary */}
      {review.aiSummary && (
        <p className="text-xs text-brand-charcoal/70 italic leading-relaxed">
          "{review.aiSummary}"
        </p>
      )}
    </div>
  )
}

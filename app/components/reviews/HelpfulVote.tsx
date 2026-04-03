import { useFetcher } from 'react-router'

interface HelpfulVoteProps {
  reviewId: string
  helpfulYes: number
  helpfulNo: number
}

export function HelpfulVote({ reviewId, helpfulYes, helpfulNo }: HelpfulVoteProps) {
  const fetcher = useFetcher<{ helpfulYes: number; helpfulNo: number }>()

  // Optimistic UI
  const optimisticYes = fetcher.formData?.get('vote') === 'yes' ? helpfulYes + 1 : helpfulYes
  const optimisticNo  = fetcher.formData?.get('vote') === 'no'  ? helpfulNo  + 1 : helpfulNo
  const displayYes    = fetcher.data?.helpfulYes ?? optimisticYes
  const displayNo     = fetcher.data?.helpfulNo  ?? optimisticNo

  const voted = fetcher.formData != null

  return (
    <div className="flex items-center gap-3 mt-3">
      <span className="text-xs text-brand-charcoal/40">Helpful?</span>
      <fetcher.Form method="post" action={`/api/reviews/${reviewId}/helpful`} className="flex gap-2">
        <button
          name="vote"
          value="yes"
          type="submit"
          disabled={voted}
          className="inline-flex items-center gap-1 text-xs text-brand-charcoal/60 hover:text-brand-purple transition-colors disabled:opacity-50"
          aria-label="Mark review as helpful"
        >
          <span aria-hidden="true">👍</span>
          {displayYes > 0 && <span>{displayYes}</span>}
        </button>
        <button
          name="vote"
          value="no"
          type="submit"
          disabled={voted}
          className="inline-flex items-center gap-1 text-xs text-brand-charcoal/60 hover:text-brand-coral transition-colors disabled:opacity-50"
          aria-label="Mark review as not helpful"
        >
          <span aria-hidden="true">👎</span>
          {displayNo > 0 && <span>{displayNo}</span>}
        </button>
      </fetcher.Form>
    </div>
  )
}

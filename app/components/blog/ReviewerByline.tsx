import type { HealthReviewer } from '~/types/cms'
import { SanityImage } from '~/components/common/SanityImage'

/**
 * E-E-A-T human-reviewer byline (ticket #12096). Renders nothing unless
 * `extras.reviewer` resolves to an `active` healthReviewer -- a value here
 * means a named real person with real credentials actually reviewed this
 * specific post; see docs/store-team/health-review-workflow.md for how that
 * gets set. Never render a fabricated or inactive reviewer.
 */
export function ReviewerByline({ reviewer }: { reviewer?: HealthReviewer | null | undefined }) {
  if (!reviewer || reviewer.active === false) return null

  return (
    <div className="mt-4 flex items-start gap-3 border-t border-line pt-4">
      {reviewer.photoUrl && (
        <SanityImage
          src={reviewer.photoUrl}
          alt={reviewer.name}
          width={40}
          height={40}
          className="w-10 h-10 rounded-full object-cover flex-shrink-0"
        />
      )}
      <div className="min-w-0">
        <p className="text-sm text-ink-2">
          <span className="font-medium text-ink">Reviewed by {reviewer.name}</span>
          {reviewer.credentials && <span className="text-ink-3">, {reviewer.credentials}</span>}
        </p>
        {reviewer.bio && <p className="text-sm text-ink-3 mt-0.5 leading-[1.5]">{reviewer.bio}</p>}
      </div>
    </div>
  )
}

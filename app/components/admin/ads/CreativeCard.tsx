/**
 * Creative card (wires 5.1): media flush at the top at its real aspect, slogan,
 * concept and lane, product, gate chips, export state, id footer and the
 * shared rating control with the creative vocabulary.
 */
import { AssetFeedbackControls } from '~/components/admin/social/AssetFeedback'
import { FEEDBACK_REASONS, NOTE_MAX } from '~/lib/ad-creative-feedback-reasons'
import type { CreativeListItem } from '~/lib/ad-creative-types'
import { AdStatusPill, type AdStatus } from './AdStatusPill'
import { CreativeMedia, type ImgPriority } from './CreativeMedia'
import { ExportState } from './ExportState'
import { GateChips } from './GateChips'
import { LaneBadge } from './LaneBadge'

function conceptName(slug: string): string {
  return slug.replace(/[-_]+/g, ' ')
}

function pillStatus(item: CreativeListItem): AdStatus | null {
  if (item.status === 'blocked') return 'blocked'
  if (item.status === 'failed') return 'failed'
  if (item.status === 'rendering') return 'rendering'
  if (item.status === 'draft' && !item.assetUrl && item.format !== 'text') return 'queued'
  if (item.status === 'pushed') return 'exported'
  return null
}

export function CreativeCard({
  item,
  action,
  priority,
  spendEnabled = false,
  onRatingSheetChange,
}: {
  item: CreativeListItem
  /** Admin route that handles intent=feedback, render-creative and the export intents. */
  action: string
  priority: ImgPriority
  /** ads_spend_enabled, so the Meta push control can render when (and only when) it is on. */
  spendEnabled?: boolean
  onRatingSheetChange?: (id: number, open: boolean) => void
}) {
  const pill = pillStatus(item)
  const product = item.products[0]
  const filename = `xdipx-export-${item.id}`
  return (
    <article aria-label={item.slogan ?? `Creative ${item.id}`} className="overflow-hidden rounded-2xl border border-line bg-paper md:hover:border-line-2">
      <CreativeMedia item={item} priority={priority} />
      <div className="px-4 pb-3 pt-3">
        {item.slogan && <p className="line-clamp-2 text-sm font-medium text-ink">&ldquo;{item.slogan}&rdquo;</p>}
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="kicker min-w-0 truncate">{item.conceptSlug ? conceptName(item.conceptSlug) : 'creative'}</p>
          <div className="flex shrink-0 items-center gap-1.5">
            {pill && <AdStatusPill status={pill} />}
            <LaneBadge lane={item.lane} registerTier={item.registerTier} />
          </div>
        </div>
        {product && (
          <p className="mt-1 text-xs text-ink-3">
            <a href={`/products/${product.handle}`} target="_blank" rel="noreferrer" className="underline-offset-2 hover:text-ink hover:underline">
              {product.title ?? product.handle}
            </a>
          </p>
        )}
        {item.renderNote && item.status !== 'blocked' && <p className="mt-1 break-words text-xs text-ink-3">{item.renderNote}</p>}
        <GateChips gates={item.gates} queuedNote={item.status === 'rendering' ? 'Rendering. Gates run when it finishes.' : null} />
        <ExportState state={item.export} creativeId={item.id} action={action} filename={filename} spendEnabled={spendEnabled} />
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2">
        <p className="font-mono text-[11px] text-ink-4">
          #{item.id}{item.ideaId != null ? ` · idea #${item.ideaId}` : ''}
        </p>
        <AssetFeedbackControls
          assetId={item.id}
          initial={item.feedback ? { verdict: item.feedback.verdict, reasons: item.feedback.reasons, note: item.feedback.note } : null}
          action={action}
          size="md"
          reasons={FEEDBACK_REASONS}
          noteMax={NOTE_MAX}
          subjectField="creativeId"
          subjectLabel="creative"
          clearIntent="clear-feedback"
          onOpenChange={open => onRatingSheetChange?.(item.id, open)}
        />
      </div>
    </article>
  )
}

/**
 * Idea card (wires 4.1). No image: ideas have none until rendered. Expands in
 * place (auto height) to show every headline, body line, audience, the
 * destination URL and the full policy check. The rating control is the shared
 * AssetFeedbackControls with the idea vocabulary, size md.
 */
import { useState } from 'react'
import { Link } from 'react-router'
import { AssetFeedbackControls } from '~/components/admin/social/AssetFeedback'
import { FEEDBACK_REASONS, NOTE_MAX } from '~/lib/ad-idea-feedback-reasons'
import type { IdeaListItem } from '~/lib/ad-idea-types'
import { AdStatusPill, adStatusOfIdea } from './AdStatusPill'
import { LaneBadge } from './LaneBadge'
import { RenderNowButton } from './RenderNowButton'

/** Client-safe view of an idea, the serialisable shape the loader sends. */
export type IdeaCardData = IdeaListItem

function conceptName(slug: string): string {
  return slug.replace(/[-_]+/g, ' ')
}

function money(cents: unknown): string | null {
  return typeof cents === 'number' && Number.isFinite(cents) ? `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}` : null
}

/** Break-even line in mono. Accepts cpa_cents or cpa (dollars), and roas. */
export function breakEvenLine(be: Record<string, unknown> | null): string | null {
  if (!be) return null
  const cpaCents = typeof be['cpa_cents'] === 'number' ? (be['cpa_cents'] as number)
    : typeof be['cpa'] === 'number' ? Math.round((be['cpa'] as number) * 100) : null
  const roas = typeof be['roas'] === 'number' ? (be['roas'] as number) : null
  const parts: string[] = []
  const cpa = money(cpaCents)
  if (cpa) parts.push(`BE CPA ${cpa}`)
  if (roas != null) parts.push(`BE ROAS ${roas.toFixed(1)}x`)
  return parts.length ? parts.join(' · ') : null
}

function policyVerdict(text: string): 'pass' | 'revise' | 'block' {
  const t = text.trim().toLowerCase()
  if (t.startsWith('block')) return 'block'
  if (t.startsWith('revise')) return 'revise'
  return 'pass'
}

export function IdeaCard({
  idea,
  action,
  nextPassLabel,
  onRatingSheetChange,
}: {
  idea: IdeaCardData
  /** Admin route that handles intent=feedback. */
  action: string
  nextPassLabel: string
  onRatingSheetChange?: (ideaId: number, open: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const be = breakEvenLine(idea.breakEven)
  const verdict = policyVerdict(idea.policyCheck)
  const firstHeadline = idea.headlines[0]
  const status = adStatusOfIdea(idea.status)
  const edge = verdict === 'block'
    ? 'shadow-[inset_2px_0_0_theme(colors.red.500)]'
    : verdict === 'revise'
      ? 'shadow-[inset_2px_0_0_theme(colors.amber.500)]'
      : ''

  return (
    <article
      aria-label={idea.title}
      className={`rounded-2xl border border-line bg-paper p-4 lg:p-5 md:hover:border-line-2 lg:grid lg:grid-cols-[minmax(0,1fr)_200px] lg:gap-4 ${edge} ${idea.status === 'rejected' ? 'opacity-70' : ''}`}
    >
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-3">
          <p className="kicker truncate">{conceptName(idea.conceptSlug)}</p>
          <div className="shrink-0 lg:hidden">
            <LaneBadge lane={idea.lane} registerTier={idea.registerTier} />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          aria-expanded={expanded}
          className="mt-2 block w-full min-h-11 text-left touch-manipulation"
        >
          <h3 className={`font-display text-lg leading-snug text-ink ${expanded ? '' : 'line-clamp-2'}`}>{idea.title}</h3>
          {firstHeadline && (
            <p className={`mt-1 text-sm text-ink-2 ${expanded ? '' : 'line-clamp-3'}`}>&ldquo;{firstHeadline}&rdquo;</p>
          )}
          <span className="sr-only">{expanded ? 'Collapse details' : 'Expand details'}</span>
        </button>

        {idea.products.length > 0 && (
          <p className="mt-1 text-xs text-ink-3">
            {idea.products.map((p, i) => (
              <span key={p.handle}>
                {i > 0 && ' · '}
                <a href={`/products/${p.handle}`} target="_blank" rel="noreferrer" className="hover:text-ink underline-offset-2 hover:underline">
                  {p.title ?? p.handle}
                </a>
              </span>
            ))}
          </p>
        )}

        {expanded && (
          <div className="mt-3 space-y-3 border-t border-line pt-3 text-sm text-ink-2">
            {idea.oneLiner && <p>{idea.oneLiner}</p>}
            {idea.headlines.length > 1 && (
              <div>
                <p className="kicker mb-1">Headlines</p>
                <ul className="space-y-0.5">
                  {idea.headlines.map(h => <li key={h}>&ldquo;{h}&rdquo;</li>)}
                </ul>
              </div>
            )}
            {idea.body.length > 0 && (
              <div>
                <p className="kicker mb-1">Body</p>
                <ul className="space-y-0.5">
                  {idea.body.map(b => <li key={b}>{b}</li>)}
                </ul>
              </div>
            )}
            {idea.audience && (
              <div>
                <p className="kicker mb-1">Audience</p>
                <p className="font-mono text-[11px] text-ink-3 break-words">
                  {Object.entries(idea.audience).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ')}
                </p>
              </div>
            )}
            {idea.destinationUrl && (
              <div>
                <p className="kicker mb-1">Destination</p>
                <p className="font-mono text-[11px] text-ink-3 break-all">{idea.destinationUrl}</p>
              </div>
            )}
            <div>
              <p className="kicker mb-1">Policy check</p>
              <p className="text-ink-2">{idea.policyCheck}</p>
              {idea.lane === 'adult' && (
                <p className="mt-1 text-xs text-amber-800">Register 10 is pending codify. Held at 9 until the owner says codify.</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 lg:mt-0 lg:flex lg:flex-col lg:items-end lg:text-right lg:gap-2">
        <div className="hidden lg:block">
          <LaneBadge lane={idea.lane} registerTier={idea.registerTier} />
        </div>
        <p className="font-mono text-[11px] tabular-nums text-ink-3">
          {be ?? <span className="text-amber-800">BE not computed</span>}
        </p>
        <p className="mt-0.5 lg:mt-0 font-mono text-[11px] text-ink-3">
          {verdict === 'pass' ? 'policy pass' : (
            <span className={verdict === 'block' ? 'text-red-800' : 'text-amber-800'}>policy {verdict}</span>
          )}
        </p>

        <div className="mt-3 lg:mt-auto flex items-center justify-between gap-2 border-t border-line pt-3 lg:w-full lg:border-0 lg:pt-0 lg:flex-col lg:items-end">
          <p className="font-mono text-[11px] text-ink-4">
            #{idea.id}{idea.runId != null ? ` · run ${idea.runId}` : ''}
          </p>
          <div className="flex items-center gap-2">
            {idea.status !== 'proposed' && <AdStatusPill status={status} />}
            <AssetFeedbackControls
              assetId={idea.id}
              initial={idea.feedback ? { verdict: idea.feedback.verdict, reasons: idea.feedback.reasons, note: idea.feedback.note } : null}
              action={action}
              size="md"
              reasons={FEEDBACK_REASONS}
              noteMax={NOTE_MAX}
              subjectField="ideaId"
              subjectLabel="idea"
              clearIntent="clear-feedback"
              onOpenChange={open => onRatingSheetChange?.(idea.id, open)}
            />
          </div>
        </div>

        {idea.status === 'hearted' && (
          <>
            <p className="mt-2 text-xs text-ink-3 lg:text-right">Queued for the next render pass, {nextPassLabel}.</p>
            <RenderNowButton ideaId={idea.id} action={action} />
          </>
        )}
        {idea.status === 'rendered' && (
          <Link
            to={`/admin/ad-studio/creatives?idea=${idea.id}`}
            className="mt-2 inline-flex min-h-11 items-center text-xs font-medium text-ink underline-offset-2 hover:underline"
          >
            {idea.creativeCount} {idea.creativeCount === 1 ? 'creative' : 'creatives'} &rarr;
          </Link>
        )}
        {idea.status === 'rejected' && idea.feedback && idea.feedback.reasons.length > 0 && (
          <p className="mt-2 text-xs text-ink-3 lg:text-right">
            {idea.feedback.reasons.map(r => FEEDBACK_REASONS.down.find(x => x.value === r)?.label ?? r).join(', ')}
          </p>
        )}
      </div>
    </article>
  )
}

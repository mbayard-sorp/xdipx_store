/**
 * Builds the team-bus suggestion the sanity-publish webhook files when a
 * blogPost goes live (ticket #3735).
 *
 * The Notebook-to-social handoff has two independent paths that both land
 * here: the content run's prose handoff (routine-content-daily.md Step 6
 * item 4) and the event-driven webhook backstop in
 * app/routes/api.webhooks.sanity-publish.tsx. The shared dedupe key
 * (`notebook-promo:<slug>`) means either path can fire first and the second
 * is absorbed by the bus's partial-unique index, so a post produces exactly
 * one social campaign ticket however it was published.
 *
 * Pure module, no imports: the webhook route and the test both consume it.
 */

export const NOTEBOOK_PROMO_DEDUPE_PREFIX = 'notebook-promo:'

export interface NotebookPromoInput {
  slug: string
  /** Post title when known; the suggestion degrades gracefully without it. */
  title?: string | null | undefined
  /** Category name when known (e.g. "Real Talk"). */
  category?: string | null | undefined
}

export interface NotebookPromoSuggestion {
  team: 'social'
  /**
   * The routine's mailbox query filters on strict targetTeam equality
   * (team.server.ts listSuggestions), so a row filed without it is invisible
   * to the consumer even though `team` says social.
   */
  targetTeam: 'social'
  kind: 'campaign'
  category: string
  suggestion: string
  dedupeKey: string
}

export function notebookPromoDedupeKey(slug: string): string {
  return `${NOTEBOOK_PROMO_DEDUPE_PREFIX}${slug}`
}

/**
 * The shape mirrors ticket #3649, which is what the social routine's Step 7b
 * already knows how to read: title, URL, and category, plus the ask.
 */
export function buildNotebookPromoSuggestion(input: NotebookPromoInput): NotebookPromoSuggestion {
  const url = `https://xdipx.com/notebook/${input.slug}`
  const title = input.title?.trim() || input.slug
  const category = input.category?.trim() || 'uncategorized'
  return {
    team: 'social',
    targetTeam: 'social',
    kind: 'campaign',
    category: 'social-automation',
    dedupeKey: notebookPromoDedupeKey(input.slug),
    suggestion:
      `New Notebook post published: "${title}" (${url}). Category: ${category}. ` +
      `Draft the cross-platform promo per routine-social-daily.md: one post per ` +
      `enabled platform pointing readers at the piece, voice-gated as always. ` +
      `Filed by the sanity-publish webhook as the event-driven backstop for the ` +
      `content-run handoff; if the content run already filed this slug, the shared ` +
      `dedupe key made the two filings one row.`,
  }
}

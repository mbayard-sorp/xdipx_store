/**
 * The one-emphasized-word headline treatment (docs/design-doctrine.md §2).
 *
 * Extracted from StorefrontHome (ticket #12340) so the CMS-rendered rails in
 * `app/components/cms/` can use the identical treatment. They cannot import it
 * from StorefrontHome: StorefrontHome -> ContentBlockRenderer -> ProductCarousel
 * would close an import cycle. StorefrontHome re-exports both symbols, so every
 * existing call site and `storefront-band-order.test.ts` are unchanged.
 */

/** Split a heading around the first occurrence of an emphasis word/phrase.
    Returns null when the emphasis is absent from the heading, so callers can
    render the heading plain instead of appending a stray, unspaced <em> to
    the end. Uses indexOf/slice (not split) so a heading containing the
    emphasis word more than once is never truncated -- only the first
    occurrence is wrapped, and everything after it (including any repeat)
    survives in `after`. */
export function emphasisParts(text: string, emphasis: string): { before: string; match: string; after: string } | null {
  const idx = text.indexOf(emphasis)
  if (idx === -1) return null
  return { before: text.slice(0, idx), match: emphasis, after: text.slice(idx + emphasis.length) }
}

/** Render a heading with a given word/phrase italicized in the plum emphasis
    style, matching the editorial headline treatment across the page. When
    `emphasis` is omitted, falls back to italicizing the last word. When
    `emphasis` is provided but not actually present in `text`, renders the
    heading plain -- no <em> is appended, so a mismatched Sanity emphasis
    field can never garble the published heading.

    `onDark` switches the emphasis word to `.em-on-dark` (the lighter plum that
    clears the doctrine contrast floor on ink/scrimmed grounds); pass it whenever
    the heading sits on a dark or photo-scrimmed surface. Base `.em` plum only
    clears ~2.48:1 there, under the large-display 3:1 floor. */
export function EmphasizedHeading({ text, emphasis, onDark = false }: { text: string; emphasis?: string | undefined; onDark?: boolean }) {
  const emClass = onDark ? 'em em-on-dark' : 'em'
  const trimmed = text.trim()
  if (emphasis) {
    const parts = emphasisParts(trimmed, emphasis)
    if (!parts) return <>{trimmed}</>
    return <>{parts.before}<em className={emClass}>{parts.match}</em>{parts.after}</>
  }
  const trailing = trimmed.match(/[.?!]$/)?.[0] ?? ''
  const core = trailing ? trimmed.slice(0, -1) : trimmed
  const words = core.split(' ')
  if (words.length < 2) return <>{trimmed}</>
  const last = words.pop() as string
  return <>{words.join(' ')} <em className={emClass}>{last}</em>{trailing}</>
}

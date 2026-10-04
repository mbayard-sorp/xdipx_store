/**
 * Isomorphic copy helpers for the bridge page (Ad Studio v2 PR-D). No server
 * imports, so the route component and its `meta` export can use them.
 */

/**
 * Split a headline on its single `*emphasis*` marker. A second marker is
 * ignored (rendered as plain text) so one stray asterisk never breaks the line.
 * Em and en dashes are stripped to a comma-space, the same belt-and-braces the
 * voice charter applies to every customer-facing string.
 */
export function splitHeadline(raw: string): { before: string; em: string; after: string } {
  const clean = raw.replace(/\s*[\u2014\u2013]\s*/g, ', ')
  const m = /\*([^*]+)\*/.exec(clean)
  if (!m) return { before: clean.replace(/\*/g, ''), em: '', after: '' }
  return {
    before: clean.slice(0, m.index),
    em: m[1]!,
    after: clean.slice(m.index + m[0].length).replace(/\*/g, ''),
  }
}

/** Plain-text headline for the title tag: markers removed. */
export function plainHeadline(raw: string): string {
  const { before, em, after } = splitHeadline(raw)
  return `${before}${em}${after}`.trim()
}

/**
 * Static deeplink to Google's source-preferences tool (developers.google.com/
 * search/docs/appearance/preferred-sources). Deliberately not the interactive
 * `publisher.js` button — that adds a third-party script/CSP change site-wide
 * for a feature whose payoff is scoped to citable editorial content, i.e. the
 * Notebook. Keep this component Notebook-only.
 */
export function PreferredSourceLink({ className }: { className?: string }) {
  return (
    <a
      href="https://www.google.com/preferences/source?q=xdipx.com"
      target="_blank"
      rel="noopener noreferrer"
      className={className ?? 'kicker hover:text-coral transition-colors'}
    >
      Add xdipx as a preferred source on Google →
    </a>
  )
}

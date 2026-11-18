import type { BreadcrumbCrumb } from '~/lib/breadcrumbs.server'

/**
 * Helpers for the PDP sold-out branch's single onward link (Routine B run
 * 2093, backlog item 9a).
 *
 * Plain module, no `.server` suffix: these are pure functions the PDP
 * component calls during render, and the only thing they borrow from
 * `breadcrumbs.server` is a TYPE, which is erased at build time. Keeping them
 * here rather than inline in the route is what makes them testable without
 * importing a route module that pulls in Sanity and Shopify clients.
 */

/**
 * Title-case a breadcrumb label for use inside a sentence or an accessible
 * name.
 *
 * Shopify menu labels arrive in whatever case the menu was typed in, and the
 * breadcrumb trail styles them uppercase, so the raw value is often
 * "VIBRATORS". Shouting is wrong in prose and wrong in a screen-reader label
 * (emma-empathy-reviewer, run 2093). A label that already carries mixed case
 * is editorial and is trusted exactly as typed.
 */
export function titleCaseCrumbLabel(label: string): string {
  if (label !== label.toUpperCase()) return label
  return label
    .toLowerCase()
    .replace(/(^|[\s/&-])([a-z])/g, (_m, lead: string, ch: string) => lead + ch.toUpperCase())
}

/**
 * The product's own shelf: the most specific breadcrumb that is neither the
 * product itself nor the "Home" root, and that still carries a link.
 *
 * Returns undefined when the trail offers nothing more specific than Home, so
 * the caller suppresses its link rather than pointing a "more like this"
 * affordance at the homepage. Suppressing beats rendering a bad noun
 * (emma-empathy-reviewer, run 2093): the label lands in customer-facing prose,
 * so an unusable crumb drops the whole affordance instead of degrading into a
 * vague one. This is the same direction the playbook's content-field rule
 * requires, degrade toward the requirement rather than away from it.
 */
export function productShelfCrumb(
  crumbs: ReadonlyArray<BreadcrumbCrumb>,
): { label: string; href: string } | undefined {
  // length - 2 skips the product's own crumb; i >= 1 skips the Home root.
  for (let i = crumbs.length - 2; i >= 1; i--) {
    const c = crumbs[i]
    const label = c?.label?.trim()
    if (c?.href && label) return { label: titleCaseCrumbLabel(label), href: c.href }
  }
  return undefined
}

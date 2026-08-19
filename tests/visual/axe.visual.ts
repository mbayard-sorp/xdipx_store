/**
 * Axe accessibility sweep riding the visual harness (design-elevation p3-axe:
 * zero serious/critical violations on the storefront's stable surfaces).
 *
 * Runs against the same prepared pages as the snapshots (age gate passed,
 * reveals settled) so it audits the real past-the-gate storefront, not the
 * AgeGatePanel. Only `serious` and `critical` fail the test; the full
 * violation list is attached to the report either way.
 *
 * The `color-contrast` known-issue carve-out (baselined 2026-08-16) was
 * retired in ticket #3789 (2026-08-19): every serious/critical node on these
 * four routes was fixed at the source (darkened `--color-coral`, `--color-
 * ink-4`, `--color-sage` tokens plus a handful of raw-opacity text colors
 * swapped for solid ink-3/white-50 tokens). Zero serious/critical is now the
 * real, unconditional bar — do not reintroduce a KNOWN_ISSUES exemption
 * without re-litigating this decision.
 */

import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { openSettled } from './helpers'

const ROUTES = ['/', '/discover', '/faq', '/about']

for (const path of ROUTES) {
  test(`axe sweep ${path}`, async ({ page }, testInfo) => {
    await openSettled(page, path)
    const results = await new AxeBuilder({ page }).analyze()

    await testInfo.attach(`axe-${path.replace(/\W+/g, '_')}.json`, {
      body: JSON.stringify(results.violations, null, 2),
      contentType: 'application/json',
    })

    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    )
    expect(
      serious.map((v) => `${v.impact}: ${v.id} (${v.nodes.length} node(s)) — ${v.help}`),
    ).toEqual([])
  })
}

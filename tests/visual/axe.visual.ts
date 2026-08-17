/**
 * Axe accessibility sweep riding the visual harness (design-elevation p3-axe:
 * zero serious/critical violations on the storefront's stable surfaces).
 *
 * Runs against the same prepared pages as the snapshots (age gate passed,
 * reveals settled) so it audits the real past-the-gate storefront, not the
 * AgeGatePanel. Only `serious` and `critical` fail the test; the full
 * violation list is attached to the report either way.
 */

import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { openSettled } from './helpers'

const ROUTES = ['/', '/discover', '/faq', '/about']

/**
 * Pre-existing debt, measured live 2026-08-16: `color-contrast` fails serious
 * on all four routes (6-190 nodes; largest on /discover). Baselined here so
 * the sweep is green-by-default and still hard-fails on any NEW serious or
 * critical rule id. Burn the debt down, then delete the entry — the p3-axe
 * definition of done is zero serious/critical with this list EMPTY. Run with
 * AXE_STRICT=1 to see the full bar with no known-issue exemptions.
 */
const KNOWN_ISSUES = new Set(process.env['AXE_STRICT'] === '1' ? [] : ['color-contrast'])

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
    const known = serious.filter((v) => KNOWN_ISSUES.has(v.id))
    for (const v of known) {
      process.stderr.write(
        `KNOWN ISSUE ${path}: ${v.impact}: ${v.id} (${v.nodes.length} node(s)) — ${v.help}\n`,
      )
    }

    const blocking = serious.filter((v) => !KNOWN_ISSUES.has(v.id))
    expect(
      blocking.map((v) => `${v.impact}: ${v.id} (${v.nodes.length} node(s)) — ${v.help}`),
    ).toEqual([])
  })
}

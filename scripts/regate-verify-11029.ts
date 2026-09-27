/**
 * scripts/regate-verify-11029.ts
 *
 * Ticket #11029, DONE WHEN items (1)-(3). Re-gates the four named library
 * assets (688, 689, 690, 691) against the strengthened vision gate
 * (`app/lib/social-vision-gate.server.ts`, enumerated hand-digit-count and
 * back-anatomy-read checks) and prints a pass/fail table so a human — or a
 * future run with the credential this one lacked — can confirm the fix
 * against the real production images:
 *
 *   688 -> expect handAnatomy: 'fail'       (six-digit hand, DONE WHEN 1)
 *   690 -> expect faceBodyIntegrity: 'fail' (pubic-hair-like back read, DONE WHEN 2)
 *   689, 691 -> expect both still 'pass'    (clean siblings, DONE WHEN 3)
 *
 * Needs ANTHROPIC_API_KEY (same credential `social-vision-gate.server.ts`
 * already calls in production) and DATABASE_URL. Neither the code fix nor
 * its unit tests (app/lib/social-vision-gate.server.test.ts, all mocked, no
 * network) depend on this script running — it exists only to close the
 * three DONE WHEN items above that require a live model read of the actual
 * production pixels, which this session could not do: `ANTHROPIC_API_KEY`
 * is absent here (confirmed directly, not from memory — see the PR body),
 * the same gap `scripts/audit-vision-verdicts.ts` already documented for
 * ticket #11468.
 *
 * Read-only by default: prints the comparison and never touches the
 * database. `--write` additionally records the fresh verdict onto each
 * asset via the same `regateAsset` production path already uses.
 *
 * Usage:
 *   npx tsx scripts/regate-verify-11029.ts [--write]
 */

import './_load-env'
import { db } from '../app/lib/db.server'
import { socialMediaAssets } from '../db/schema'
import { inArray } from 'drizzle-orm'
import { runVisionGate, recordVisionVerdict } from '../app/lib/social-vision-gate.server'

const ASSET_IDS = [688, 689, 690, 691]
const EXPECT: Record<number, { handAnatomy?: 'pass' | 'fail'; faceBodyIntegrity?: 'pass' | 'fail' }> = {
  688: { handAnatomy: 'fail' },
  690: { faceBodyIntegrity: 'fail' },
  689: { handAnatomy: 'pass', faceBodyIntegrity: 'pass' },
  691: { handAnatomy: 'pass', faceBodyIntegrity: 'pass' },
}
const WRITE = process.argv.includes('--write')

async function main() {
  const rows = await db
    .select({ id: socialMediaAssets.id, url: socialMediaAssets.url, productHandle: socialMediaAssets.productHandle })
    .from(socialMediaAssets)
    .where(inArray(socialMediaAssets.id, ASSET_IDS))

  console.log(`[regate-verify-11029] re-gating ${rows.length} asset(s) against the strengthened gate`)

  let allExpected = true
  for (const row of rows) {
    const verdict = await runVisionGate(row.url)
    const expected = EXPECT[row.id] ?? {}
    const mismatches = (Object.keys(expected) as Array<'handAnatomy' | 'faceBodyIntegrity'>)
      .filter((k) => verdict.checks?.[k] !== expected[k])

    if (mismatches.length > 0) allExpected = false
    console.log(JSON.stringify({
      id: row.id,
      productHandle: row.productHandle,
      checkCompleted: verdict.checkCompleted,
      handAnatomy: verdict.checks?.handAnatomy ?? null,
      faceBodyIntegrity: verdict.checks?.faceBodyIntegrity ?? null,
      handDigitCounts: verdict.handDigitCounts,
      backAnatomyRead: verdict.backAnatomyRead,
      notes: verdict.notes,
      expected,
      matchesExpectation: mismatches.length === 0,
    }, null, 2))

    if (WRITE) await recordVisionVerdict(row.id, verdict)
  }

  console.log(`[regate-verify-11029] ${allExpected ? 'ALL asset(s) matched their DONE WHEN expectation' : 'one or more assets did NOT match — see mismatches above'}`)
  process.exit(allExpected ? 0 : 1)
}

main().catch((err) => {
  console.error('[regate-verify-11029] fatal:', err)
  process.exit(1)
})

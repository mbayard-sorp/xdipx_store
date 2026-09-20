/**
 * Rolling-window mix report for posted Instagram frames. READ-ONLY.
 *
 * This script exists because `app/lib/social-mix-report.server.ts` (ticket
 * #10271, merged as `ab2298a`) shipped complete and unmounted: `computeSocialMixReport`,
 * `getSocialMixReport` and `formatSocialMixReportLines` had no caller anywhere
 * outside their own unit test. No route rendered them, no routine step invoked
 * them, no doc referenced them.
 *
 * That is the same failure the module's own header describes. It was written
 * because the 1-ceiling-frame-in-21 regression went unseen for three weeks,
 * since "seeing it required an ad-hoc SQL query" — and without a caller it
 * still required an ad-hoc query, just in TypeScript instead of SQL. Ticket
 * #10110 died the same way one day earlier: half-detected the regression, sat
 * at `approved`, unapplied, specifically because nothing read it.
 *
 * The social routine runs as a Claude cloud session with a shell, not as a
 * web request, so a CLI entry point is the mount that routine can actually
 * reach. `docs/store-team/routine-social-daily.md` Step 7 item 5 calls it.
 *
 * NOT A GATE, and it must never become one. The report produces aggregate
 * lines, never a per-frame verdict, and it must not be wired into
 * `social-publish-gate.server.ts` or any BLOCK/REVISE/HOLD path. The publish
 * gate already owns per-frame judgment; this report's whole job is the thing
 * the gate structurally cannot do, which is notice that the last ten frames
 * were all quiet. Approving each of those one at a time costs the gate
 * nothing and costs the feed everything.
 *
 * Exit code is always 0, including on a BREACH. A breach is a finding for the
 * run summary to report and act on, not a failed command, and a non-zero exit
 * would turn an editorial signal into a broken build.
 *
 * Usage:
 *   npx tsx scripts/report-social-mix.ts          # human-readable lines
 *   npx tsx scripts/report-social-mix.ts --json   # machine-readable JSON
 */
import 'dotenv/config'
import { getSocialMixReport, formatSocialMixReportLines } from '../app/lib/social-mix-report.server'

const asJson = process.argv.includes('--json')

async function main() {
  const report = await getSocialMixReport()

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log(`Social mix report — ${report.sampleSize} posted Instagram rows read`)
  if (report.sampleSize === 0) {
    console.log('No rows available. Every line reads UNKNOWN; report this as UNKNOWN, never as "in band".')
  }
  console.log('')
  for (const line of formatSocialMixReportLines(report)) console.log(line)
  console.log('')

  // An UNKNOWN line is not a passing line. `bodyZone`/`contactMode`/`cropScale`
  // (migration 099) and `sceneLocation` (093) are null on every row drafted
  // before the callers started sending them, so those windows read UNKNOWN
  // until enough new rows accumulate. Say so rather than letting a run read a
  // silent report as a clean one — that reading is how the regression this
  // module exists to catch survived three weeks.
  const unknown = Object.values(report.lines).filter(l => l.status === 'unknown').length
  if (report.anyBreach) {
    console.log('BREACH present. Name each breached line in the run summary and say what today\'s slate does about it.')
  } else if (unknown > 0) {
    console.log(`No breach detected, but ${unknown} line(s) read UNKNOWN. Report that count; an UNKNOWN line is not a clean one.`)
  } else {
    console.log('All lines in band.')
  }
}

main().catch(err => {
  console.error('[report-social-mix] failed:', err)
  process.exit(1)
})

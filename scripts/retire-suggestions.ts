/**
 * Retire (dismiss) already-approved improvement-bus suggestions by id.
 *
 * The dashboard's Approve/Dismiss only acts on `proposed` rows, so approved
 * rows that later ship by other means, get superseded, or turn out not to be
 * the agent-editor's to apply have no prune path from the UI until the "Retire"
 * button (this same transition) deploys. This is the CLI equivalent for a
 * one-off cleanup, and a safety valve if a bad row ever needs pulling fast.
 *
 * Reversible: flips status approved -> dismissed (no delete), guarded on
 * status='approved' so it is idempotent and cannot touch pr_open/applied rows.
 * To restore one, set its status back to 'approved'.
 *
 * Loads .env automatically (so `tsx scripts/retire-suggestions.ts <ids>` just
 * works against the .env DB, which is prod). dotenv does NOT override an
 * already-set DATABASE_URL, so you can still target another DB explicitly:
 *   DATABASE_URL=postgres://... tsx scripts/retire-suggestions.ts 4 10 11 13 42
 */
import { config } from 'dotenv'
import { neon } from '@neondatabase/serverless'

config({ quiet: true })

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL']
  if (!url) {
    console.error('DATABASE_URL is required.')
    process.exit(1)
  }
  const ids = process.argv.slice(2).map(Number).filter(n => Number.isInteger(n) && n > 0)
  if (ids.length === 0) {
    console.error('Usage: tsx scripts/retire-suggestions.ts <id> [<id> ...]')
    process.exit(1)
  }

  const sql = neon(url)
  let dismissed = 0
  for (const id of ids) {
    const res = await sql`
      UPDATE homepage_team_suggestions
      SET status='dismissed', decided_at=NOW()
      WHERE id=${id} AND status='approved'
      RETURNING id, kind, team`
    const r = (res as Array<{ kind: string; team: string }>)[0]
    if (r) {
      dismissed++
      console.log(`dismissed #${id} [${r.kind}/${r.team}]`)
    } else {
      console.log(`skipped   #${id} (not in 'approved', no change)`)
    }
  }

  const [{ n }] = (await sql`
    SELECT count(*)::int n FROM homepage_team_suggestions
    WHERE status='approved' AND kind IN ('instructions','agent-def','config')`) as Array<{ n: number }>
  console.log(`\nRetired ${dismissed}/${ids.length}. PR-eligible rows still approved: ${n}.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

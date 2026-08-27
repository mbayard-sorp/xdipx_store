/**
 * ONE-TIME MANUAL BACKFILL. Do not wire into any cron/routine.
 *
 * Context: until `createOwnerReworkRow` retired its source
 * (app/lib/social-admin-rework.server.ts), every rework minted a child row and
 * left the parent exactly where it was. The child got approved and published;
 * the parent stayed in the Social Studio queue forever. So a caption already
 * live on Instagram still read as work waiting on the owner, and a rework
 * chain (#73 -> #105 -> #112) put one idea in the Review/Approved tabs three
 * times over.
 *
 * This closes the rows that predate that fix. It applies exactly the same rule
 * the code now applies going forward, `shouldRetireReworkSource` and
 * `supersededFeedback` are imported rather than restated, so there is one
 * definition of "superseded" and this cannot drift from it.
 *
 * A row is retired when it is still a live queue row (status 'draft' at
 * pending_review | needs_changes | approved) AND something already points at
 * it via `reworked_from`. Posted, deleted, failed and already-rejected rows
 * are never touched, so no history is rewritten and nothing that is live on a
 * platform is altered.
 *
 * Idempotent, safe to re-run: a retired row is `rejected`, which the predicate
 * excludes, so a second run finds nothing.
 *
 * Usage:
 *   Dry-run (default): npx tsx scripts/backfill-superseded-rework-sources.ts
 *   Apply:             npx tsx scripts/backfill-superseded-rework-sources.ts --apply
 */
// MUST be first — populates process.env before any downstream module reads it.
import './_load-env'
import { eq } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { socialPosts } from '../db/schema'
import {
  shouldRetireReworkSource,
  supersededFeedback,
} from '../app/lib/social-admin-rework.server'

const APPLY = process.argv.includes('--apply')

async function main() {
  const rows = await db.select().from(socialPosts)

  // newest child per parent — the one the retirement note names.
  const newestChild = new Map<number, number>()
  const childrenOf = new Map<number, number[]>()
  for (const r of rows) {
    if (r.reworkedFrom == null) continue
    const seen = newestChild.get(r.reworkedFrom)
    if (seen == null || r.id > seen) newestChild.set(r.reworkedFrom, r.id)
    childrenOf.set(r.reworkedFrom, [...(childrenOf.get(r.reworkedFrom) ?? []), r.id])
  }
  const byId = new Map(rows.map(r => [r.id, r]))

  /**
   * Does anything downstream of this row still carry the idea — a descendant
   * that is live, or still alive in the queue?
   *
   * Normally yes, and retiring the parent just removes a duplicate. When the
   * answer is no, the whole chain died (a gate BLOCK, typically) and retiring
   * the parent takes the idea out of the queue entirely. That is the same end
   * state the code now produces going forward, so the rule does not bend for
   * it, but it is worth seeing rather than discovering later.
   */
  function hasLivingDescendant(id: number, seen = new Set<number>()): boolean {
    for (const childId of childrenOf.get(id) ?? []) {
      if (seen.has(childId)) continue
      seen.add(childId)
      const child = byId.get(childId)
      if (!child) continue
      if (child.status === 'posted') return true
      if (child.status === 'draft' && child.reviewStatus !== 'rejected') return true
      if (hasLivingDescendant(childId, seen)) return true
    }
    return false
  }

  const targets = rows
    .filter(r => newestChild.has(r.id) && shouldRetireReworkSource(r))
    .sort((a, b) => a.id - b.id)

  if (targets.length === 0) {
    console.log('Nothing to retire. Every superseded rework source is already closed out.')
    return
  }

  const now = new Date()
  const orphans: number[] = []
  console.log(`${APPLY ? 'Retiring' : 'Would retire'} ${targets.length} superseded rework source(s):\n`)
  for (const r of targets) {
    const childId = newestChild.get(r.id)!
    const slot = r.scheduledAt?.toISOString().slice(0, 16).replace('T', ' ') ?? r.scheduledFor ?? '-'
    const orphaned = !hasLivingDescendant(r.id)
    if (orphaned) orphans.push(r.id)
    console.log(
      `  #${String(r.id).padEnd(4)} ${r.platform.padEnd(10)} ${r.reviewStatus.padEnd(15)} ` +
      `slot ${String(slot).padEnd(17)} -> superseded by #${childId}` +
      (orphaned ? '   [whole chain is dead — clone the child to revive the idea]' : ''),
    )
    if (!APPLY) continue
    await db.update(socialPosts)
      .set({
        reviewStatus: 'rejected',
        feedback:     supersededFeedback(childId, r.feedback, now),
        reviewedBy:   'backfill-superseded',
        reviewedAt:   now,
        scheduledAt:  null,
        scheduledFor: null,
        updatedAt:    now,
      })
      .where(eq(socialPosts.id, r.id))
  }

  console.log(
    APPLY
      ? `\nDone. ${targets.length} row(s) moved to History; the live children are untouched.`
      : '\nDry run. Re-run with --apply to write.',
  )
  if (orphans.length > 0) {
    console.log(
      `\nHeads up: ${orphans.map(id => '#' + id).join(', ')} had no living descendant. ` +
      `Nothing carries those ideas any more; clone the rejected child from History to bring one back.`,
    )
  }
}

main().catch(err => { console.error(err); process.exit(1) })

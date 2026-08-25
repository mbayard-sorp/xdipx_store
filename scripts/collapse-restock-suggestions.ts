/**
 * Ticket #5430: collapse the 46 pre-existing per-crossing restock suggestion
 * rows (dedupeKey `restock:<handle>`, all still `status=approved`, zero
 * applied — `process` has no automated executor) into the new one-row-per-day
 * digest shape, or dismiss them outright.
 *
 * This is a ONE-OFF migration script for the backlog the old filer already
 * created. It does NOT run in any cron or webhook path, and this session does
 * not run it against production — the owner runs it.
 *
 * Two modes:
 *
 *   --mode=collapse (default)  Groups the open rows by the UTC day they were
 *     created, and for each day either opens or extends a
 *     `restock-digest:<day>` row (same shape `restock-digest.server.ts`
 *     writes going forward) with one line per row (handle + title; deal score
 *     is not re-fetched for backfilled rows and prints "n/a" — the point is
 *     preserving the handle/title signal, not a live score). Every collapsed
 *     row is then dismissed with a note pointing at the digest row that
 *     absorbed it.
 *
 *   --mode=dismiss  Just dismisses every open `restock:*` row with a note
 *     explaining why, no digest row created. Use this if the backlog is
 *     considered too stale to be worth a post.
 *
 * DRY-RUN BY DEFAULT. Pass --apply to write.
 *
 * Usage:
 *   npx tsx scripts/collapse-restock-suggestions.ts                      # dry run, collapse plan
 *   npx tsx scripts/collapse-restock-suggestions.ts --apply              # collapse for real
 *   npx tsx scripts/collapse-restock-suggestions.ts --mode=dismiss --apply
 */
import './_load-env'
import { and, eq, like, sql } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { homepageTeamSuggestions } from '../db/schema'
import {
  createSuggestionDetailed,
  addSuggestionNote,
  retireSuggestion,
} from '../app/lib/team.server'
import { restockDigestDedupeKey, buildRestockDigestHeader } from '../app/lib/restock-digest.server'

const APPLY = process.argv.includes('--apply')
const modeArg = process.argv.find(a => a.startsWith('--mode='))
const MODE = (modeArg ? modeArg.slice('--mode='.length) : 'collapse') as 'collapse' | 'dismiss'

if (MODE !== 'collapse' && MODE !== 'dismiss') {
  console.error(`Unknown --mode '${MODE}', expected collapse|dismiss`)
  process.exit(1)
}

// Matches the old per-crossing filing in server/webhooks.ts (pre-#5430):
//   Back in stock after a genuine sell-out: "<title>" (handle: <handle>). ...
const OLD_ROW_RE = /Back in stock after a genuine sell-out:\s*"([^"]+)"\s*\(handle:\s*([a-z0-9-]+)\)/i

interface OldRow {
  id: number
  handle: string
  title: string
  day: string // UTC YYYY-MM-DD, from createdAt
}

async function loadOpenRestockRows(): Promise<OldRow[]> {
  const rows = await db
    .select({
      id:        homepageTeamSuggestions.id,
      suggestion: homepageTeamSuggestions.suggestion,
      createdAt: homepageTeamSuggestions.createdAt,
      dedupeKey: homepageTeamSuggestions.dedupeKey,
    })
    .from(homepageTeamSuggestions)
    .where(and(
      like(homepageTeamSuggestions.dedupeKey, 'restock:%'),
      sql`${homepageTeamSuggestions.status} NOT IN ('applied', 'dismissed')`,
    ))

  const out: OldRow[] = []
  for (const r of rows) {
    const m = OLD_ROW_RE.exec(r.suggestion ?? '')
    if (!m) {
      console.warn(`[collapse-restock] row #${r.id}: suggestion text did not match the expected old-filer shape, skipping (handle it manually)`)
      continue
    }
    out.push({
      id:     r.id,
      title:  m[1]!,
      handle: m[2]!,
      day:    r.createdAt.toISOString().slice(0, 10),
    })
  }
  return out
}

async function collapseDayGroup(day: string, rows: OldRow[]): Promise<number | null> {
  const dedupeKey = restockDigestDedupeKey(day)
  const lines = rows.map(r => `- ${r.title} (handle: ${r.handle}, deal score: n/a [backfilled]) at (unknown time) UTC`)

  if (!APPLY) {
    console.log(`[dry-run] would file/extend digest row '${dedupeKey}' with ${lines.length} line(s):`)
    for (const l of lines) console.log(`    ${l}`)
    return null
  }

  const result = await createSuggestionDetailed({
    team:        'social',
    kind:        'process',
    category:    'social-automation',
    dedupeKey,
    dedupeScope: 'daily',
    suggestion:  buildRestockDigestHeader(day) + lines.join('\n'),
  })

  if (!result.deduped) {
    console.log(`[collapse-restock] opened new digest row #${result.id} for ${day} with ${lines.length} backfilled line(s)`)
    return result.id
  }
  if (result.id === 0) {
    console.warn(`[collapse-restock] dedupe collision for '${dedupeKey}' but no live row found; skipping this day's group`)
    return null
  }
  await db
    .update(homepageTeamSuggestions)
    .set({
      suggestion: sql`${homepageTeamSuggestions.suggestion} || ${'\n' + lines.join('\n')}`,
      updatedAt:  new Date(),
    })
    .where(eq(homepageTeamSuggestions.id, result.id))
  console.log(`[collapse-restock] appended ${lines.length} backfilled line(s) to existing digest row #${result.id} for ${day}`)
  return result.id
}

async function main(): Promise<void> {
  const openRows = await loadOpenRestockRows()
  if (openRows.length === 0) {
    console.log('[collapse-restock] no open restock:* rows found. Nothing to do.')
    return
  }
  console.log(`[collapse-restock] found ${openRows.length} open restock:* row(s), mode=${MODE}, apply=${APPLY}`)

  if (MODE === 'dismiss') {
    for (const row of openRows) {
      const note = `dismissed by scripts/collapse-restock-suggestions.ts --mode=dismiss (ticket #5430): ` +
        `per-crossing restock filing is retired in favor of the daily digest, and this backlog was judged too stale to post`
      if (!APPLY) {
        console.log(`[dry-run] would dismiss row #${row.id} (${row.handle}): ${note}`)
        continue
      }
      await addSuggestionNote(row.id, note)
      await retireSuggestion(row.id)
      console.log(`[collapse-restock] dismissed row #${row.id} (${row.handle})`)
    }
    return
  }

  // mode=collapse
  const byDay = new Map<string, OldRow[]>()
  for (const row of openRows) {
    const list = byDay.get(row.day) ?? []
    list.push(row)
    byDay.set(row.day, list)
  }

  for (const [day, rows] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const digestId = await collapseDayGroup(day, rows)
    for (const row of rows) {
      const note = digestId
        ? `collapsed into digest row #${digestId} (restock-digest:${day}), ticket #5430`
        : `would be collapsed into a restock-digest:${day} row, ticket #5430 (dry run)`
      if (!APPLY) {
        console.log(`[dry-run] would dismiss row #${row.id} (${row.handle}): ${note}`)
        continue
      }
      if (digestId == null) continue // collapseDayGroup already warned; leave the row alone
      await addSuggestionNote(row.id, note)
      await retireSuggestion(row.id)
      console.log(`[collapse-restock] dismissed row #${row.id} (${row.handle}) -> digest #${digestId}`)
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[collapse-restock] failed:', err)
    process.exit(1)
  })

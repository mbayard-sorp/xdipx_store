/**
 * Ticket #5590: collapse the pre-existing duplicate `inv-oos-sustained` OOS
 * rows that split into a colon form and a hyphen form.
 *
 * Root cause (already fixed going forward): the OOS detector emits its key with
 * `makeDedupeKey('inv-oos-sustained', sku)`, which joins parts with a colon
 * (`inv-oos-sustained:21453`). PR #896 (canonicalize dedupe keys) then began
 * normalizing every stored key on the write path, and `canonicalDedupeKey`
 * collapses `:` and `-` to the same hyphen form (`inv-oos-sustained-21453`).
 * Rows filed BEFORE #896 were stored raw (colon); rows filed AFTER are stored
 * canonical (hyphen). The unique index compares stored strings, so the colon
 * straggler and the hyphen row are seen as different and both stay open.
 *
 *   evidence: SKU 21453 = rows 5188 (`:`, 2026-08-24) and 5561 (`-`, 2026-08-26)
 *
 * This is a ONE-OFF backlog cleanup, not a detector change. Every NEW OOS row
 * already canonicalizes to the hyphen form and dedupes correctly, so the
 * detector needs no edit (and changing `makeDedupeKey`'s separator would
 * re-split every OTHER detector's stored history the same way). All that is
 * left is collapsing the colon-era stragglers that predate #896.
 *
 * What it does: groups every open `inv-oos-sustained*` row by its CANONICAL
 * key, and for each SKU keeps one survivor and dismisses the rest.
 *   - survivor = the row already storing the canonical (hyphen) key; if a SKU
 *     has only colon rows, the newest is kept and its key is rewritten to
 *     canonical so future detector runs dedupe onto it instead of re-filing.
 *   - every other row in the group is dismissed with a note naming the survivor.
 * A SKU with a single open row is left untouched, except that a lone colon row
 * is rekeyed to canonical (so it never spawns a hyphen twin later).
 *
 * DRY-RUN BY DEFAULT. Pass --apply to write. This session does not run --apply
 * against production; the owner does (same posture as
 * scripts/collapse-restock-suggestions.ts).
 *
 * Usage:
 *   npx tsx scripts/collapse-oos-sustained-duplicates.ts            # dry run, prints the plan
 *   npx tsx scripts/collapse-oos-sustained-duplicates.ts --apply    # collapse for real
 */
import './_load-env'
import { and, eq, like, sql } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { homepageTeamSuggestions } from '../db/schema'
import { addSuggestionNote, retireSuggestion } from '../app/lib/team.server'
import { canonicalDedupeKey } from '../app/lib/dedupe-key'

const APPLY = process.argv.includes('--apply')

/** The prefix the OOS detector namespaces its keys under, canonical form. */
export const OOS_CANONICAL_PREFIX = 'inv-oos-sustained-'

/** Statuses that still occupy the dedupe index / the owner's open queue. */
export const OPEN_STATUSES = ['proposed', 'approved', 'in_progress', 'pr_open', 'blocked'] as const

export interface OosRow {
  id: number
  dedupeKey: string
  status: string
  createdAt: Date
}

export interface CollapsePlan {
  /** The canonical key every row in the group shares. */
  canonicalKey: string
  /** The row kept open. */
  survivorId: number
  /** The survivor's stored key before this run. */
  survivorKey: string
  /** True when the survivor's stored key is not canonical and must be rewritten. */
  rekeySurvivor: boolean
  /** Rows to dismiss (the colon-era duplicates). */
  retire: Array<{ id: number; key: string }>
}

/**
 * Pure planner: given the open `inv-oos-sustained*` rows, decide which SKU
 * keeps which row and which duplicates are dismissed. No DB, so it is unit
 * tested directly.
 *
 * Survivor preference: the row whose stored key is ALREADY canonical (there can
 * be at most one, since the unique index forbids two open rows sharing a stored
 * key). Absent one, the newest row wins and is flagged for rekeying.
 */
export function planCollapse(rows: readonly OosRow[]): CollapsePlan[] {
  const open = rows.filter(r => (OPEN_STATUSES as readonly string[]).includes(r.status))
  const groups = new Map<string, OosRow[]>()
  for (const r of open) {
    const canonical = canonicalDedupeKey(r.dedupeKey)
    if (!canonical.startsWith(OOS_CANONICAL_PREFIX)) continue
    const list = groups.get(canonical) ?? []
    list.push(r)
    groups.set(canonical, list)
  }

  const plans: CollapsePlan[] = []
  for (const [canonicalKey, list] of groups) {
    const canonicalRow = list.find(r => r.dedupeKey === canonicalKey)
    const survivor =
      canonicalRow ??
      [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]!
    const retire = list
      .filter(r => r.id !== survivor.id)
      .map(r => ({ id: r.id, key: r.dedupeKey }))
    const rekeySurvivor = survivor.dedupeKey !== canonicalKey
    // Nothing to do for a lone, already-canonical row.
    if (retire.length === 0 && !rekeySurvivor) continue
    plans.push({
      canonicalKey,
      survivorId: survivor.id,
      survivorKey: survivor.dedupeKey,
      rekeySurvivor,
      retire,
    })
  }
  // Deterministic order (by canonical key) so a dry run reads the same twice.
  return plans.sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey))
}

async function loadOpenOosRows(): Promise<OosRow[]> {
  const rows = await db
    .select({
      id:        homepageTeamSuggestions.id,
      dedupeKey: homepageTeamSuggestions.dedupeKey,
      status:    homepageTeamSuggestions.status,
      createdAt: homepageTeamSuggestions.createdAt,
    })
    .from(homepageTeamSuggestions)
    .where(and(
      like(homepageTeamSuggestions.dedupeKey, 'inv-oos-sustained%'),
      sql`${homepageTeamSuggestions.status} NOT IN ('applied', 'dismissed', 'verified')`,
    ))
  return rows
    .filter((r): r is OosRow => typeof r.dedupeKey === 'string' && r.dedupeKey.length > 0)
}

async function main(): Promise<number> {
  const rows = await loadOpenOosRows()
  const plans = planCollapse(rows)
  const dupPlans = plans.filter(p => p.retire.length > 0)
  const rekeyOnly = plans.filter(p => p.retire.length === 0 && p.rekeySurvivor)

  console.log(
    `[collapse-oos] ${rows.length} open inv-oos-sustained row(s); ` +
    `${dupPlans.length} SKU(s) with duplicates, ${rekeyOnly.length} lone colon row(s) to rekey. apply=${APPLY}`,
  )
  if (plans.length === 0) {
    console.log('[collapse-oos] nothing to collapse. (Going-forward dedup is handled by #896 canonicalization.)')
    return 0
  }

  for (const p of plans) {
    if (p.rekeySurvivor) {
      if (!APPLY) {
        console.log(`[dry-run] would rekey survivor #${p.survivorId} '${p.survivorKey}' -> '${p.canonicalKey}'`)
      } else {
        await db
          .update(homepageTeamSuggestions)
          .set({ dedupeKey: p.canonicalKey, updatedAt: new Date() })
          .where(eq(homepageTeamSuggestions.id, p.survivorId))
        console.log(`[collapse-oos] rekeyed survivor #${p.survivorId} '${p.survivorKey}' -> '${p.canonicalKey}'`)
      }
    }
    for (const r of p.retire) {
      const note =
        `collapsed into #${p.survivorId} (${p.canonicalKey}) by ` +
        `scripts/collapse-oos-sustained-duplicates.ts, ticket #5590: colon/hyphen dedupeKey split from PR #896`
      if (!APPLY) {
        console.log(`[dry-run] would dismiss #${r.id} '${r.key}' -> survivor #${p.survivorId}`)
        continue
      }
      await addSuggestionNote(r.id, note)
      await retireSuggestion(r.id)
      console.log(`[collapse-oos] dismissed #${r.id} '${r.key}' -> survivor #${p.survivorId}`)
    }
  }
  return 0
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().then(
    code => process.exit(code),
    err => { console.error('[collapse-oos] failed:', err); process.exit(1) },
  )
}

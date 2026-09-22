/**
 * Owner-scoped media-asset adjudications (migration 100, ticket #10503).
 *
 * The publish gate's subjective findings (age-read, exposure-read) come from
 * a fresh vision-model judgment on every call — there is no stored rule it
 * consults. So a false-positive the owner has already ruled on for one
 * specific asset keeps re-BLOCKing every later post that reuses it. Concrete
 * case, 2026-09-20: the femmefunn campervan asset (rows 155/156) was BLOCKed
 * on age-ambiguity and nipple/areola outline risk, the owner ruled both
 * false-positives, and a fresh row reusing the same asset had nothing to
 * prevent the same BLOCK.
 *
 * This module is the storage + read/write seam. `runPublishGateCheck`
 * (`app/lib/team-gates.server.ts`) is the actual gate implementation for
 * every automated call — the scheduled routine's sandbox has no
 * Task/Agent tool, so `social-publish-gate`'s own subagent file
 * (`.claude/agents/social-publish-gate.md`) is never spawned there; this
 * server-side model call stands in for it (see that module's header
 * comment). `runPublishGateCheck` reads `getAssetAdjudication` for each of a
 * post's media urls, in-process, and grounds the model with the owner's
 * ruling via `describeAssetAdjudications`, the same pattern already used for
 * cross-post asset-reuse precedent (`describeAssetReusePrecedent`, ticket
 * #8976).
 *
 * OWNER-WRITE ONLY. `setAssetAdjudication`/`clearAssetAdjudication` are
 * called only from `admin.socials.library.$assetId.tsx` behind
 * `requireAdmin` — never from a team-token route, or the gate becomes
 * self-clearing (an agent could BLOCK-and-immediately-clear its own
 * finding). `getAssetAdjudication` is a plain read with no such risk.
 *
 * Never consulted by the deterministic FACT checks
 * (`runDeterministicPublishChecks` in social-publish-gate.server.ts: stock,
 * media provenance, caption ceiling, vocabulary), which run unconditionally
 * regardless of any adjudication on file.
 */
import { eq } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { socialAssetAdjudications } from '../../db/schema'
import { stripUrlQuery } from '~/lib/social-asset-library.server'

export type AssetAdjudicationRow = typeof socialAssetAdjudications.$inferSelect

/** The adjudication on file for this asset url, or null when there is none. */
export async function getAssetAdjudication(url: string): Promise<AssetAdjudicationRow | null> {
  const bare = stripUrlQuery(url)
  if (!bare) return null
  const [row] = await db
    .select()
    .from(socialAssetAdjudications)
    .where(eq(socialAssetAdjudications.assetUrl, bare))
    .limit(1)
  return row ?? null
}

export interface SetAssetAdjudicationInput {
  url: string
  /** Short finding labels/snippets being cleared, e.g. 'age-ambiguity'. Not empty. */
  overriddenFindings: string[]
  note?: string | null
  adjudicatedBy: string
}

/** Owner-only upsert, keyed by the asset's bare url (one row per asset). */
export async function setAssetAdjudication(input: SetAssetAdjudicationInput): Promise<AssetAdjudicationRow> {
  const bare = stripUrlQuery(input.url)
  if (!bare) throw new Error('setAssetAdjudication: url is required')
  const findings = input.overriddenFindings.map(f => f.trim()).filter(Boolean)
  if (findings.length === 0) throw new Error('setAssetAdjudication: overriddenFindings must name at least one finding')
  const now = new Date()
  const [row] = await db
    .insert(socialAssetAdjudications)
    .values({
      assetUrl: bare,
      overriddenFindings: findings,
      note: input.note ?? null,
      adjudicatedBy: input.adjudicatedBy,
    })
    .onConflictDoUpdate({
      target: socialAssetAdjudications.assetUrl,
      set: {
        overriddenFindings: findings,
        note: input.note ?? null,
        adjudicatedBy: input.adjudicatedBy,
        updatedAt: now,
      },
    })
    .returning()
  if (!row) throw new Error('setAssetAdjudication: insert returned no row')
  return row
}

/** Owner-only delete. Returns true when a row existed and was removed. */
export async function clearAssetAdjudication(url: string): Promise<boolean> {
  const bare = stripUrlQuery(url)
  if (!bare) return false
  const deleted = await db
    .delete(socialAssetAdjudications)
    .where(eq(socialAssetAdjudications.assetUrl, bare))
    .returning({ id: socialAssetAdjudications.id })
  return deleted.length > 0
}

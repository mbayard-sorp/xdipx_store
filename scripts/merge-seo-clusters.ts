/**
 * Consolidate near-duplicate seoCluster docs from an owner-approved merge map.
 *
 * The April 2026 research run minted 339 clusters (91 singletons, many
 * near-duplicates). The seo-curator routine proposes a merge map as a
 * suggestion; once approved, this script executes it deterministically via
 * `applySeoClusterMergeMap` (app/lib/seo-cluster-merge.server.ts):
 *
 *   1. Repoint every seoKeyword.cluster._ref from each absorbed cluster to
 *      its canonical cluster (batches of 100).
 *   2. Rewrite any relatedClusters references the same way.
 *   3. Verify zero remaining references, then set the absorbed cluster
 *      status='archived'. Never delete: archived docs keep any stale refs
 *      resolvable, and ensureCluster's createIfNotExists blocks the same
 *      duplicate slug from being re-minted by a future research run.
 *   4. Optionally retitle the canonical cluster (newTitle).
 *
 * Idempotent: re-running a partially applied map is safe.
 *
 * Merge map JSON shape:
 *   [{ "canonical": "wand-vibrators", "absorb": ["wand-selection-guides", ...], "newTitle": "Wand Vibrators" }, ...]
 *   (slugs, as in seoCluster.slug.current)
 *
 * Run (dry-run):  npx tsx scripts/merge-seo-clusters.ts --map merge-map.json
 * Apply:          npx tsx scripts/merge-seo-clusters.ts --map merge-map.json --apply
 *
 * Ticket #17788: a cloud agent session may not have execution rights for
 * this script at all (even dry-run); in that case call
 * `POST /api/team/seo-cluster-merge` instead, which runs the same logic
 * server-side behind team-token auth.
 *
 * After applying, the seo-kw KV cache version in app/lib/seo-keywords.server.ts
 * should already be bumped (done in the same PR that added this script);
 * keyword contexts rebuilt from the consolidated bank on next request.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { applySeoClusterMergeMap, isSeoClusterMergeMap, type SeoClusterMergeEntry } from '~/lib/seo-cluster-merge.server'

const APPLY = process.argv.includes('--apply')

const mapFlagIdx = process.argv.indexOf('--map')
const mapPath = mapFlagIdx >= 0 ? process.argv[mapFlagIdx + 1] : undefined
if (!mapPath) {
  console.error('Usage: npx tsx scripts/merge-seo-clusters.ts --map merge-map.json [--apply]')
  process.exit(1)
}
if (!process.env['SANITY_PROJECT_ID'] || !process.env['SANITY_API_TOKEN']) {
  console.error('Missing SANITY_PROJECT_ID or SANITY_API_TOKEN')
  process.exit(1)
}

const mergeMap: SeoClusterMergeEntry[] = JSON.parse(readFileSync(mapPath, 'utf8'))
if (!isSeoClusterMergeMap(mergeMap)) {
  console.error('Merge map must be an array of { canonical, absorb[], newTitle? }')
  process.exit(1)
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (will write)' : 'dry run'} · map: ${mapPath} (${mergeMap.length} entries)\n`)

  const result = await applySeoClusterMergeMap(mergeMap, { apply: APPLY })

  for (const entry of result.entries) {
    if (!entry.canonicalFound) {
      console.error(`  !! canonical "${entry.canonical}" not found, skipping entry`)
      continue
    }
    if (entry.retitledTo) {
      console.log(`  ${entry.canonical}: retitle -> "${entry.retitledTo}"`)
    }
    for (const a of entry.absorbed) {
      if (!a.found) { console.error(`  !! absorb "${a.slug}" not found, skipping`); continue }
      if (a.isCanonicalItself) { console.error(`  !! "${a.slug}" is the canonical itself, skipping`); continue }
      if (a.alreadyArchived) { console.log(`  ${a.slug}: already archived, skipping`); continue }

      console.log(`  ${a.slug} -> ${entry.canonical}: ${a.keywordRefsRepointed} keyword refs, ${a.relatedClustersHoldersRepointed} relatedClusters holders`)
      if (a.error) console.error(`  !! ${a.slug}: ${a.error}`)
    }
  }

  console.log(APPLY
    ? `\nDone. Repointed ${result.totals.keywordRefsRepointed} keyword refs, archived ${result.totals.clustersArchived} clusters.`
    : '\nDry run only. Re-run with --apply to write.')
}

main().catch(err => { console.error(err); process.exit(1) })

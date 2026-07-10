/**
 * Consolidate near-duplicate seoCluster docs from an owner-approved merge map.
 *
 * The April 2026 research run minted 339 clusters (91 singletons, many
 * near-duplicates). The seo-curator routine proposes a merge map as a
 * suggestion; once approved, this script executes it deterministically:
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
 * After applying, the seo-kw KV cache version in app/lib/seo-keywords.server.ts
 * should already be bumped (done in the same PR that added this script);
 * keyword contexts rebuilt from the consolidated bank on next request.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { createClient } from '@sanity/client'

const SANITY_PROJECT_ID = process.env['SANITY_PROJECT_ID']
const SANITY_DATASET    = process.env['SANITY_DATASET'] ?? 'production'
const SANITY_TOKEN      = process.env['SANITY_API_TOKEN']
const APPLY             = process.argv.includes('--apply')

const mapFlagIdx = process.argv.indexOf('--map')
const mapPath = mapFlagIdx >= 0 ? process.argv[mapFlagIdx + 1] : undefined
if (!mapPath) {
  console.error('Usage: npx tsx scripts/merge-seo-clusters.ts --map merge-map.json [--apply]')
  process.exit(1)
}
if (!SANITY_PROJECT_ID || !SANITY_TOKEN) {
  console.error('Missing SANITY_PROJECT_ID or SANITY_API_TOKEN')
  process.exit(1)
}

interface MergeEntry { canonical: string; absorb: string[]; newTitle?: string }

const mergeMap = JSON.parse(readFileSync(mapPath, 'utf8')) as MergeEntry[]
if (!Array.isArray(mergeMap) || mergeMap.some(e => !e.canonical || !Array.isArray(e.absorb))) {
  console.error('Merge map must be an array of { canonical, absorb[], newTitle? }')
  process.exit(1)
}

const sanity = createClient({
  projectId:  SANITY_PROJECT_ID,
  dataset:    SANITY_DATASET,
  apiVersion: '2024-10-01',
  token:      SANITY_TOKEN,
  useCdn:     false,
  perspective: 'raw',
})

interface ClusterDoc { _id: string; slug: string; title: string; status: string }

async function clusterBySlug(slug: string): Promise<ClusterDoc | null> {
  return sanity.fetch<ClusterDoc | null>(
    `*[_type == "seoCluster" && slug.current == $slug][0]{ _id, "slug": slug.current, title, status }`,
    { slug },
  )
}

async function repointReferences(fromId: string, toId: string): Promise<number> {
  let total = 0
  for (;;) {
    const ids = await sanity.fetch<string[]>(
      `*[_type == "seoKeyword" && cluster._ref == $fromId][0...100]._id`,
      { fromId },
    )
    if (ids.length === 0) break
    if (!APPLY) return await sanity.fetch<number>(
      `count(*[_type == "seoKeyword" && cluster._ref == $fromId])`, { fromId },
    )
    let tx = sanity.transaction()
    for (const id of ids) {
      tx = tx.patch(id, p => p.set({ cluster: { _type: 'reference', _ref: toId } }))
    }
    await tx.commit()
    total += ids.length
  }
  return total
}

async function repointRelatedClusters(fromId: string, toId: string): Promise<number> {
  const holders = await sanity.fetch<{ _id: string; related: { _key: string; _ref: string }[] }[]>(
    `*[_type == "seoCluster" && $fromId in relatedClusters[]._ref]{ _id, "related": relatedClusters[]{ _key, _ref } }`,
    { fromId },
  )
  if (!APPLY) return holders.length
  for (const h of holders) {
    const next = h.related
      .map(r => (r._ref === fromId ? { ...r, _ref: toId } : r))
      // Drop duplicates if the canonical was already related.
      .filter((r, i, arr) => arr.findIndex(x => x._ref === r._ref) === i)
      .map(r => ({ _key: r._key, _type: 'reference' as const, _ref: r._ref }))
    await sanity.patch(h._id).set({ relatedClusters: next }).commit()
  }
  return holders.length
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (will write)' : 'dry run'} · map: ${mapPath} (${mergeMap.length} entries)\n`)
  let archived = 0
  let repointed = 0

  for (const entry of mergeMap) {
    const canonical = await clusterBySlug(entry.canonical)
    if (!canonical) {
      console.error(`  !! canonical "${entry.canonical}" not found, skipping entry`)
      continue
    }
    if (entry.newTitle && entry.newTitle !== canonical.title) {
      console.log(`  ${entry.canonical}: retitle "${canonical.title}" -> "${entry.newTitle}"`)
      if (APPLY) await sanity.patch(canonical._id).set({ title: entry.newTitle }).commit()
    }

    for (const slug of entry.absorb) {
      const absorbee = await clusterBySlug(slug)
      if (!absorbee) { console.error(`  !! absorb "${slug}" not found, skipping`); continue }
      if (absorbee._id === canonical._id) { console.error(`  !! "${slug}" is the canonical itself, skipping`); continue }
      if (absorbee.status === 'archived') { console.log(`  ${slug}: already archived, skipping`); continue }

      const kw = await repointReferences(absorbee._id, canonical._id)
      const rel = await repointRelatedClusters(absorbee._id, canonical._id)
      console.log(`  ${slug} -> ${entry.canonical}: ${kw} keyword refs, ${rel} relatedClusters holders`)
      repointed += kw

      if (APPLY) {
        const remaining = await sanity.fetch<number>(
          `count(*[_type == "seoKeyword" && cluster._ref == $id])`, { id: absorbee._id },
        )
        if (remaining > 0) {
          console.error(`  !! ${slug}: ${remaining} refs remain after repoint, NOT archiving`)
          continue
        }
        await sanity.patch(absorbee._id).set({ status: 'archived' }).commit()
        archived++
      }
    }
  }

  console.log(APPLY
    ? `\nDone. Repointed ${repointed} keyword refs, archived ${archived} clusters.`
    : '\nDry run only. Re-run with --apply to write.')
}

main().catch(err => { console.error(err); process.exit(1) })

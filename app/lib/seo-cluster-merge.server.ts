/**
 * Deterministic executor for an owner-approved SEO cluster merge map (the
 * same operation `scripts/merge-seo-clusters.ts` performs from a local CLI).
 *
 * Ticket #17788: a cloud agent session's permission classifier can deny
 * direct execution of that script — even in dry-run — because it writes to a
 * shared resource class. This module is the server-side, team-token-gated
 * path so a routine (seo-curator) or its caller can run an approved merge
 * map without needing direct script-execution rights, the same shape as
 * `approveAndImport` for the import-candidate queue. `scripts/merge-seo-clusters.ts`
 * now calls into this module too, so the merge logic has one implementation.
 *
 * Mirrors the three steps the script documents:
 *   1. Repoint every seoKeyword.cluster._ref from each absorbed cluster to
 *      its canonical cluster (batches of 100).
 *   2. Rewrite any relatedClusters references the same way.
 *   3. Verify zero remaining references, then set the absorbed cluster
 *      status='archived'. Never delete.
 * Idempotent: re-running a partially applied map is safe.
 */
import { getClient } from '~/lib/sanity.server'

export interface SeoClusterMergeEntry {
  canonical: string
  absorb: string[]
  newTitle?: string
}

export interface SeoClusterAbsorbResult {
  slug: string
  found: boolean
  isCanonicalItself: boolean
  alreadyArchived: boolean
  keywordRefsRepointed: number
  relatedClustersHoldersRepointed: number
  archived: boolean
  remainingRefsAfterRepoint?: number
  error?: string
}

export interface SeoClusterEntryResult {
  canonical: string
  canonicalFound: boolean
  retitledTo?: string
  absorbed: SeoClusterAbsorbResult[]
}

export interface SeoClusterMergeResult {
  applied: boolean
  entries: SeoClusterEntryResult[]
  totals: { keywordRefsRepointed: number; clustersArchived: number }
}

/** Narrows unknown input to the merge-map shape the script's JSON file uses. */
export function isSeoClusterMergeMap(value: unknown): value is SeoClusterMergeEntry[] {
  if (!Array.isArray(value)) return false
  return value.every(
    e =>
      !!e &&
      typeof e === 'object' &&
      typeof (e as Record<string, unknown>)['canonical'] === 'string' &&
      Array.isArray((e as Record<string, unknown>)['absorb']) &&
      (e as { absorb: unknown[] }).absorb.every(s => typeof s === 'string'),
  )
}

interface ClusterDoc {
  _id: string
  slug: string
  title: string
  status: string
}

// Structural subset of the Sanity client this module needs — lets tests pass
// a bare `{ fetch, patch, transaction }` stub instead of a real client.
interface SanityWriteClient {
  fetch<T>(query: string, params?: Record<string, unknown>): Promise<T>
  patch(id: string): {
    set(data: Record<string, unknown>): { commit(): Promise<unknown> }
  }
  transaction(): {
    patch(id: string, builder: (p: { set(data: Record<string, unknown>): unknown }) => unknown): unknown
    commit(): Promise<unknown>
  }
}

async function clusterBySlug(client: SanityWriteClient, slug: string): Promise<ClusterDoc | null> {
  return client.fetch<ClusterDoc | null>(
    `*[_type == "seoCluster" && slug.current == $slug][0]{ _id, "slug": slug.current, title, status }`,
    { slug },
  )
}

async function repointReferences(client: SanityWriteClient, fromId: string, toId: string, apply: boolean): Promise<number> {
  let total = 0
  for (;;) {
    const ids = await client.fetch<string[]>(
      `*[_type == "seoKeyword" && cluster._ref == $fromId][0...100]._id`,
      { fromId },
    )
    if (ids.length === 0) break
    if (!apply) {
      return await client.fetch<number>(`count(*[_type == "seoKeyword" && cluster._ref == $fromId])`, { fromId })
    }
    let tx = client.transaction()
    for (const id of ids) {
      tx = tx.patch(id, p => p.set({ cluster: { _type: 'reference', _ref: toId } })) as typeof tx
    }
    await tx.commit()
    total += ids.length
  }
  return total
}

async function repointRelatedClusters(client: SanityWriteClient, fromId: string, toId: string, apply: boolean): Promise<number> {
  const holders = await client.fetch<{ _id: string; related: { _key: string; _ref: string }[] }[]>(
    `*[_type == "seoCluster" && $fromId in relatedClusters[]._ref]{ _id, "related": relatedClusters[]{ _key, _ref } }`,
    { fromId },
  )
  if (!apply) return holders.length
  for (const holder of holders) {
    const next = holder.related
      .map(r => (r._ref === fromId ? { ...r, _ref: toId } : r))
      // Drop duplicates if the canonical was already related.
      .filter((r, i, arr) => arr.findIndex(x => x._ref === r._ref) === i)
      .map(r => ({ _key: r._key, _type: 'reference' as const, _ref: r._ref }))
    await client.patch(holder._id).set({ relatedClusters: next }).commit()
  }
  return holders.length
}

/**
 * Execute (or dry-run) an approved merge map. Throws only when Sanity is
 * unconfigured; per-entry problems (canonical not found, absorb slug not
 * found, already archived) are reported in the returned result instead of
 * thrown, so one bad entry in a batch never hides the others' outcomes.
 */
export async function applySeoClusterMergeMap(
  mergeMap: SeoClusterMergeEntry[],
  opts: { apply: boolean } = { apply: false },
): Promise<SeoClusterMergeResult> {
  const apply = opts.apply
  const client = getClient(true, false, 'raw') as unknown as SanityWriteClient | null
  if (!client) throw new Error('Sanity not configured — SANITY_API_TOKEN or SANITY_PROJECT_ID missing')

  const entries: SeoClusterEntryResult[] = []
  let keywordRefsRepointed = 0
  let clustersArchived = 0

  for (const entry of mergeMap) {
    const canonical = await clusterBySlug(client, entry.canonical)
    if (!canonical) {
      entries.push({ canonical: entry.canonical, canonicalFound: false, absorbed: [] })
      continue
    }

    const entryResult: SeoClusterEntryResult = { canonical: entry.canonical, canonicalFound: true, absorbed: [] }
    if (entry.newTitle && entry.newTitle !== canonical.title) {
      entryResult.retitledTo = entry.newTitle
      if (apply) await client.patch(canonical._id).set({ title: entry.newTitle }).commit()
    }

    for (const slug of entry.absorb) {
      const absorbee = await clusterBySlug(client, slug)
      if (!absorbee) {
        entryResult.absorbed.push({
          slug, found: false, isCanonicalItself: false, alreadyArchived: false,
          keywordRefsRepointed: 0, relatedClustersHoldersRepointed: 0, archived: false,
          error: 'absorb slug not found',
        })
        continue
      }
      if (absorbee._id === canonical._id) {
        entryResult.absorbed.push({
          slug, found: true, isCanonicalItself: true, alreadyArchived: false,
          keywordRefsRepointed: 0, relatedClustersHoldersRepointed: 0, archived: false,
          error: 'absorb slug is the canonical itself',
        })
        continue
      }
      if (absorbee.status === 'archived') {
        entryResult.absorbed.push({
          slug, found: true, isCanonicalItself: false, alreadyArchived: true,
          keywordRefsRepointed: 0, relatedClustersHoldersRepointed: 0, archived: false,
        })
        continue
      }

      const kw = await repointReferences(client, absorbee._id, canonical._id, apply)
      const rel = await repointRelatedClusters(client, absorbee._id, canonical._id, apply)
      keywordRefsRepointed += kw

      const absorbResult: SeoClusterAbsorbResult = {
        slug, found: true, isCanonicalItself: false, alreadyArchived: false,
        keywordRefsRepointed: kw, relatedClustersHoldersRepointed: rel, archived: false,
      }

      if (apply) {
        const remaining = await client.fetch<number>(
          `count(*[_type == "seoKeyword" && cluster._ref == $id])`, { id: absorbee._id },
        )
        if (remaining > 0) {
          absorbResult.remainingRefsAfterRepoint = remaining
          absorbResult.error = `${remaining} refs remain after repoint; not archived`
        } else {
          await client.patch(absorbee._id).set({ status: 'archived' }).commit()
          absorbResult.archived = true
          clustersArchived++
        }
      }

      entryResult.absorbed.push(absorbResult)
    }

    entries.push(entryResult)
  }

  return { applied: apply, entries, totals: { keywordRefsRepointed, clustersArchived } }
}

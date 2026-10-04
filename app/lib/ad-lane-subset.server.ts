/**
 * Curated paid-lane product subsets (Ad Studio v2 PR-D, ads-policy M5).
 *
 * The subset is Sanity content (`adLaneProductSubset`, one document per lane,
 * id `adLaneProductSubset.<lane>`), never code, so the owner and the ads team
 * can change it without a deploy. The PDP asks `isInLane(handle, 'meta')` to
 * decide whether to render the health and body-literacy block.
 *
 * A Sanity or KV failure reads as "not in the lane": the block simply does not
 * render, which is the safe direction for a page that is not an ad destination.
 */

import { cached } from '~/lib/kv.server'
import { getClient } from '~/lib/sanity.server'
import type { AdLane } from '~/lib/ad-bridge.server'

export interface LaneEntry {
  productHandle: string
  displayTitle: string
  positionZeroOk: boolean
}

interface RawEntry {
  productHandle?: string | null
  displayTitle?: string | null
  positionZeroOk?: boolean | null
}

export function normalizeLaneEntries(raw: RawEntry[] | null | undefined): LaneEntry[] {
  const seen = new Set<string>()
  const out: LaneEntry[] = []
  for (const e of raw ?? []) {
    const handle = e?.productHandle?.trim()
    const title = e?.displayTitle?.trim()
    if (!handle || !title || seen.has(handle)) continue
    seen.add(handle)
    out.push({ productHandle: handle, displayTitle: title, positionZeroOk: e.positionZeroOk === true })
  }
  return out
}

export async function getLaneSubset(lane: AdLane, preview = false): Promise<LaneEntry[]> {
  const run = async (): Promise<LaneEntry[]> => {
    try {
      const client = getClient(false, preview)
      if (!client) return []
      const raw = await client.fetch<RawEntry[] | null>(
        `*[_type == "adLaneProductSubset" && lane == $lane] | order(_updatedAt desc)[0].entries[]{
          productHandle, displayTitle, positionZeroOk
        }`,
        { lane },
      )
      return normalizeLaneEntries(raw)
    } catch (err) {
      console.error('[ad-lane-subset] getLaneSubset error:', err)
      return []
    }
  }
  if (preview) return run()
  // Empty results expire fast so a just-published subset shows within seconds.
  return cached(`sanity:ad-lane-subset:${lane}`, 300, run, 20)
}

export async function isInLane(handle: string, lane: AdLane, preview = false): Promise<boolean> {
  const entries = await getLaneSubset(lane, preview)
  return entries.some(e => e.productHandle === handle)
}

// Tool-use toolkit Emma uses to reason over the Shopify catalog and propose rails.
// All read tools are pure wrappers around shopify.server.ts helpers — no writes
// happen here. Writes are accumulated in `propose_*` tools and flushed by the
// orchestrator after the loop ends.

import {
  getProductsByTag,
  getCollectionProducts,
  getProductsByHandles,
} from '~/lib/shopify.server'
import type { Product, Deal } from '~/types'

// ─── Trimmed projection for token economy ────────────────────────────────────

export interface CatalogCandidate {
  handle: string
  title: string
  brand?: string
  category?: string
  price: number
  audienceTags?: string[]
  moodTags?: string[]
  mattersTags?: string[]
  tags?: string[]
}

function toCandidate(p: Product): CatalogCandidate {
  const candidate: CatalogCandidate = {
    handle: p.handle,
    title: p.title,
    price: p.price,
    tags: p.tags?.slice(0, 12),
  }
  if (p.brand)        candidate.brand        = p.brand
  if (p.category)     candidate.category     = p.category
  if (p.audienceTags) candidate.audienceTags = p.audienceTags
  if (p.moodTags)     candidate.moodTags     = p.moodTags
  if (p.mattersTags)  candidate.mattersTags  = p.mattersTags
  return candidate
}

// ─── Accumulators (mutable per-generation state) ─────────────────────────────

export interface RailProposal {
  target: 'homepage' | 'pdp'
  heading: string
  eyebrow?: string
  emmaAside?: string
  productHandles: string[]
  rationale: string
  layout?: 'carousel' | 'grid' | 'grid-3'
  bgStyle?: 'white' | 'cream' | 'mist' | 'charcoal' | 'purple'
  ctaLabel?: string
  ctaLink?: string
}

export interface PairingWhyProposal {
  accessoryProductId: string
  blurb: string
}

export interface RailGenState {
  rails: RailProposal[]
  pairingWhy: PairingWhyProposal[]
  excludeHandles: Set<string>  // primary deal + partner — never recommend self
}

export function createRailGenState(excludeHandles: string[] = []): RailGenState {
  return {
    rails: [],
    pairingWhy: [],
    excludeHandles: new Set(excludeHandles),
  }
}

// ─── Pre-filter — narrow the catalog before exposing tools ───────────────────

/**
 * Build a candidate pool for the deal. Tries (in order):
 *   1. Shopify tags `audience-*` / `mood-*` (only present if the sync writes them)
 *   2. The deal's `category` tag (e.g. tag:for-her, tag:couples) — these DO exist
 *   3. Vault products (`tag:deal-status-archived`) — broad evergreen pool
 * Always returns something non-empty unless the catalog is truly empty.
 * Capped at ~60 products.
 */
export async function buildCandidatePool(deal: Deal, partner?: Deal): Promise<CatalogCandidate[]> {
  const audiences = [...new Set([...(deal.audienceTags ?? []), ...(partner?.audienceTags ?? [])])]
  const moods     = [...new Set([...(deal.moodTags ?? []),     ...(partner?.moodTags ?? [])])]
  // Phase 2 — category is now string[]; flatten the deal + partner arrays
  // into a unique set of audience tags for shopify-tag bucket queries.
  const categories = [...new Set([
    ...(deal.category ?? []),
    ...(partner?.category ?? []),
  ])]

  const buckets = await Promise.all([
    ...audiences.slice(0, 3).map(t => getProductsByTag(`audience-${t}`, 10).catch(() => [])),
    ...moods.slice(0, 3).map(t => getProductsByTag(`mood-${t}`, 10).catch(() => [])),
    ...categories.map(c => getProductsByTag(c, 15).catch(() => [])),
  ])

  const seen = new Set<string>([deal.handle, partner?.handle].filter(Boolean) as string[])
  const pool: CatalogCandidate[] = []
  for (const bucket of buckets) {
    for (const p of bucket) {
      if (seen.has(p.handle)) continue
      seen.add(p.handle)
      pool.push(toCandidate(p))
      if (pool.length >= 60) return pool
    }
  }

  // Fallback: vault products. Vault is the largest known-good pool of products
  // we've already curated past — perfect cross-sell candidates.
  if (pool.length < 8) {
    const vault = await getProductsByTag('deal-status-archived', 40).catch(() => [])
    for (const p of vault) {
      if (seen.has(p.handle)) continue
      seen.add(p.handle)
      pool.push(toCandidate(p))
      if (pool.length >= 60) break
    }
  }

  return pool
}

// ─── Tool definitions (Anthropic tool-use format) ────────────────────────────

export const RAIL_TOOLS = [
  {
    name: 'list_candidate_pool',
    description:
      "Returns the pre-filtered catalog candidate pool for this deal — products that overlap with the deal's audience and mood tags. Start here. Each candidate has handle, title, brand, category, price, and tag facets.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'query_products_by_tag',
    description:
      "Fetch products by Shopify tag. Use this if the candidate pool doesn't have what you need. Examples: 'audience-couples', 'mood-slow-burn', 'best-sellers', 'for-her'.",
    input_schema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Shopify tag string (without the tag: prefix)' },
        limit: { type: 'number', description: 'Max products to return (1–20)', default: 10 },
      },
      required: ['tag'],
    },
  },
  {
    name: 'query_products_by_collection',
    description:
      "Fetch products from a Shopify collection by handle. Useful for thematic groupings. Examples: 'lubes', 'wearables', 'best-sellers', 'editor-picks'.",
    input_schema: {
      type: 'object',
      properties: {
        handle: { type: 'string', description: 'Shopify collection handle' },
        limit: { type: 'number', description: 'Max products to return (1–20)', default: 10 },
      },
      required: ['handle'],
    },
  },
  {
    name: 'inspect_products',
    description:
      'Fetch full details for specific product handles to verify before adding to a rail. Returns the same trimmed shape as the candidate pool.',
    input_schema: {
      type: 'object',
      properties: {
        handles: { type: 'array', items: { type: 'string' }, description: '1–8 product handles' },
      },
      required: ['handles'],
    },
  },
  {
    name: 'propose_rail',
    description:
      'Propose one rail. Call this 2–3 times total (typically 2 PDP rails + 1 homepage rail). Each rail must have 4–8 products, an Emma-voice aside, and a one-sentence rationale.',
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['homepage', 'pdp'], description: 'Where this rail appears' },
        heading: { type: 'string', description: 'Rail heading shown to shoppers' },
        eyebrow: { type: 'string', description: 'Small caps label above the heading' },
        emmaAside: { type: 'string', description: "Emma's first-person aside above the heading" },
        productHandles: {
          type: 'array',
          items: { type: 'string' },
          description: '4–8 Shopify product handles in display order',
        },
        rationale: { type: 'string', description: 'One sentence explaining why these products belong together' },
        ctaLabel: { type: 'string', description: 'Optional CTA label (default "See all →")' },
        ctaLink: { type: 'string', description: 'Optional CTA link (e.g. /collections/...)' },
      },
      required: ['target', 'heading', 'productHandles', 'rationale'],
    },
  },
  {
    name: 'propose_pairing_why',
    description:
      "Propose Emma-voice copy explaining why a specific accessory pairs with the primary deal. Call once per accessory in the deal's accessory_product_ids list.",
    input_schema: {
      type: 'object',
      properties: {
        accessoryProductId: { type: 'string', description: 'The accessory product GID' },
        blurb: { type: 'string', description: 'One short sentence in Emma voice (≤120 chars)' },
      },
      required: ['accessoryProductId', 'blurb'],
    },
  },
] as const

// ─── Tool dispatch — executes a tool call and returns its result ─────────────

export async function executeRailTool(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: any,
  state: RailGenState,
  pool: CatalogCandidate[],
): Promise<unknown> {
  switch (name) {
    case 'list_candidate_pool':
      return { count: pool.length, products: pool }

    case 'query_products_by_tag': {
      const limit = Math.min(Math.max(Number(input?.limit ?? 10), 1), 20)
      const products = await getProductsByTag(String(input?.tag ?? ''), limit)
      return {
        products: products
          .filter(p => !state.excludeHandles.has(p.handle))
          .map(toCandidate),
      }
    }

    case 'query_products_by_collection': {
      const limit = Math.min(Math.max(Number(input?.limit ?? 10), 1), 20)
      const products = await getCollectionProducts(String(input?.handle ?? ''), limit)
      return {
        products: products
          .filter(p => !state.excludeHandles.has(p.handle))
          .map(toCandidate),
      }
    }

    case 'inspect_products': {
      const handles = (Array.isArray(input?.handles) ? input.handles : []).map(String).slice(0, 8)
      const products = await getProductsByHandles(handles)
      return { products: products.map(toCandidate) }
    }

    case 'propose_rail': {
      const target = input?.target === 'pdp' ? 'pdp' : 'homepage'
      const handles = (Array.isArray(input?.productHandles) ? input.productHandles : [])
        .map(String)
        .filter((h: string) => !state.excludeHandles.has(h))
      if (handles.length < 2) {
        return { ok: false, error: 'A rail needs at least 2 product handles after self-exclusion.' }
      }
      const proposal: RailProposal = {
        target,
        heading: String(input?.heading ?? '').trim(),
        productHandles: handles.slice(0, 8),
        rationale: String(input?.rationale ?? '').trim(),
      }
      if (input?.eyebrow)   proposal.eyebrow   = String(input.eyebrow).trim()
      if (input?.emmaAside) proposal.emmaAside = String(input.emmaAside).trim()
      if (input?.ctaLabel)  proposal.ctaLabel  = String(input.ctaLabel).trim()
      if (input?.ctaLink)   proposal.ctaLink   = String(input.ctaLink).trim()
      state.rails.push(proposal)
      return { ok: true, railIndex: state.rails.length - 1, target, handleCount: handles.length }
    }

    case 'propose_pairing_why': {
      const accessoryProductId = String(input?.accessoryProductId ?? '').trim()
      const blurb = String(input?.blurb ?? '').trim()
      if (!accessoryProductId || !blurb) {
        return { ok: false, error: 'accessoryProductId and blurb are both required.' }
      }
      state.pairingWhy.push({ accessoryProductId, blurb })
      return { ok: true, count: state.pairingWhy.length }
    }

    default:
      return { ok: false, error: `Unknown tool: ${name}` }
  }
}

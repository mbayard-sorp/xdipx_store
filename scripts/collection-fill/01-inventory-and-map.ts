/**
 * Phase 1 — Collection inventory + cluster→handle mapping
 *
 * Outputs:
 *  .cache/collection-inventory.json  — all published collections with metadata
 *  .cache/cluster-handle-map.json    — handle→cluster mapping with confidence
 *
 * Run: npx tsx scripts/collection-fill/01-inventory-and-map.ts
 */
import 'dotenv/config'
import { writeFileSync } from 'fs'
import { resolve } from 'path'

// ─── Types ──────────────────────────────────────────────────────────────────

interface ShopifyCollection {
  handle: string
  title: string
  description: string
}

interface InventoryEntry {
  handle: string
  title: string
  description: string
  productsCount: number | null
  hasExistingDoc: boolean
  collectionType: 'category' | 'brand' | 'theme'
  topProducts: string[]
}

interface ClusterEntry {
  slug: string
  pillarTerm: string
}

interface MappingEntry {
  handle: string
  title: string
  clusterSlug: string | null
  pillarTerm: string | null
  confidence: number
  needsKeywordPass: boolean
  approvedKeywords: string[]
}

// ─── Approved keywords (pulled from Sanity — clusterRef all null) ────────────

// These are ALL 30 approved keywords, grouped by likely collection topic
const APPROVED_KEYWORDS: { term: string; handles: string[] }[] = [
  // Lubes / lubricants
  { term: 'lubricant for women',                      handles: ['lubes', 'lubricants', 'personal-lubricants', 'lube'] },
  { term: 'water based lube',                         handles: ['lubes', 'lubricants', 'personal-lubricants', 'lube', 'water-based-lube'] },
  { term: 'oil based lubricant',                      handles: ['lubes', 'lubricants', 'personal-lubricants', 'lube', 'oil-based-lubricant'] },
  { term: 'best couples lube',                        handles: ['lubes', 'lubricants', 'personal-lubricants', 'lube', 'couples-lube'] },
  { term: 'best lube for sensitive ph',               handles: ['lubes', 'lubricants', 'personal-lubricants', 'lube'] },
  { term: 'best lubricant for intimacy',              handles: ['lubes', 'lubricants', 'personal-lubricants', 'lube'] },
  { term: 'best lubricant for over 60s',              handles: ['lubes', 'lubricants', 'personal-lubricants', 'lube'] },
  { term: 'best lubricant for sensitive skin',        handles: ['lubes', 'lubricants', 'personal-lubricants', 'lube'] },
  { term: 'best water based lubricant for condoms',   handles: ['lubes', 'lubricants', 'personal-lubricants', 'lube', 'water-based-lube'] },
  { term: 'how to make personal lubricant with glycerin', handles: ['lubes', 'lubricants', 'personal-lubricants', 'lube'] },
  { term: 'lubricant for sensitive skin women',       handles: ['lubes', 'lubricants', 'personal-lubricants', 'lube'] },
  { term: 'lubricant for women over 50',              handles: ['lubes', 'lubricants', 'personal-lubricants', 'lube'] },
  { term: 'lubricant for women water based',          handles: ['lubes', 'lubricants', 'personal-lubricants', 'lube', 'water-based-lube'] },
  { term: 'water-based lubricant for sensitive skin', handles: ['lubes', 'lubricants', 'personal-lubricants', 'lube', 'water-based-lube'] },
  // Wands
  { term: 'therapeutic wand vibrator',                handles: ['wands', 'wand-massagers', 'wand-vibrators', 'massage-wands'] },
  { term: 'wand 2 purple vibrator',                   handles: ['wands', 'wand-massagers', 'wand-vibrators', 'massage-wands'] },
  // Prostate
  { term: 'how often should you use a prostate massager', handles: ['prostate', 'prostate-massagers', 'prostate-toys'] },
  { term: 'luxury prostate massager brands',          handles: ['prostate', 'prostate-massagers', 'prostate-toys'] },
  { term: 'what does a prostate massager do',         handles: ['prostate', 'prostate-massagers', 'prostate-toys'] },
  // Breast covers / tape
  { term: 'adhesive breast covers for support',       handles: ['breast-covers', 'breast-tape', 'nipple-covers', 'body-tape'] },
  { term: 'best tape for full breast support',        handles: ['breast-covers', 'breast-tape', 'nipple-covers', 'body-tape'] },
  { term: 'comfortable breast support stickers',      handles: ['breast-covers', 'breast-tape', 'nipple-covers', 'body-tape'] },
  { term: 'how to use breast support tape',           handles: ['breast-covers', 'breast-tape', 'nipple-covers', 'body-tape'] },
  { term: 'reusable breast covers with support',      handles: ['breast-covers', 'breast-tape', 'nipple-covers', 'body-tape'] },
  { term: 'what is breast support tape',              handles: ['breast-covers', 'breast-tape', 'nipple-covers', 'body-tape'] },
  // Beginners
  { term: 'best vibrator brands for beginners',       handles: ['beginners', 'vibrators-for-beginners', 'first-timers', 'first-time'] },
  // Dildos
  { term: 'body-safe silicone dildo brands',          handles: ['dildos', 'silicone-dildos', 'strap-ons'] },
  // G-spot
  { term: 'G-spot vibrator that actually works',      handles: ['g-spot', 'g-spot-vibrators', 'rabbit-vibrators', 'internal-vibrators'] },
  // Wearable vibrators / vibrating panties
  { term: 'whisper vibrating panty reviews',          handles: ['wearable-vibrators', 'vibrating-panties', 'panty-vibes', 'remote-wear'] },
  // Bondage / restraints
  { term: 'comfortable under the bed restraint system', handles: ['bondage', 'restraints', 'under-bed-restraints', 'bondage-kits'] },
]

// ─── Cluster list (all 339 from Sanity) ──────────────────────────────────────
// We only need a representative subset for matching — using all 339 here
// but the matching algorithm de-dupes on pillarTerm tokens so many clusters
// that target the same collection will converge on the same handles.

const CLUSTERS: ClusterEntry[] = [
  { slug: 'pleasure-styles', pillarTerm: 'G-spot stimulation vibrator' },
  { slug: 'internal-g-spot-focused', pillarTerm: 'G-spot vibrator rabbit' },
  { slug: 'trusted-pleasure', pillarTerm: 'G-spot vibrator that works' },
  { slug: 'value-picks', pillarTerm: 'affordable clitoral suction toy' },
  { slug: 'value-proposition', pillarTerm: 'affordable luxury vibrators' },
  { slug: 'budget-friendly', pillarTerm: 'affordable mini wand vibrator' },
  { slug: 'air-pulsation-devices', pillarTerm: 'air clitoral stimulator' },
  { slug: 'connected-app-enabled', pillarTerm: 'app controlled vibrator couples' },
  { slug: 'clitoral-stimulation', pillarTerm: 'best clitoral stimulation vibrators' },
  { slug: 'air-pulsation-discovery', pillarTerm: 'best clitoral suction toys' },
  { slug: 'suction-air-pulsation-vibrators', pillarTerm: 'best clitoral suction vibrators' },
  { slug: 'couples-partnered-play', pillarTerm: 'best couples vibrator 2024' },
  { slug: 'affordable-couples-play', pillarTerm: 'best couples vibrator under $100' },
  { slug: 'getting-started-first-time-buyers', pillarTerm: 'best couples vibrators for beginners' },
  { slug: 'for-sensitive-skin', pillarTerm: 'best hybrid lube for sensitive skin' },
  { slug: 'shared-pleasure-partnership', pillarTerm: 'best lubricant for couples' },
  { slug: 'lube-for-mature-adults', pillarTerm: 'best lubricant for over 60s' },
  { slug: 'luxury-vibrators', pillarTerm: 'best luxury vibrator for women' },
  { slug: 'luxury-wand-vibrators', pillarTerm: 'best luxury wand vibrator' },
  { slug: 'mini-wand-vibrator', pillarTerm: 'best mini wand vibrator' },
  { slug: 'nipple-covers-pasties', pillarTerm: 'best nipple covers for sensitive skin' },
  { slug: 'shop-by-audience', pillarTerm: 'best prostate stimulation toys for men' },
  { slug: 'discreet-quiet', pillarTerm: 'best quiet mini wand' },
  { slug: 'discreet-wearables', pillarTerm: 'best quiet vibrating panties for discreet wear' },
  { slug: 'budget-conscious-shoppers', pillarTerm: 'best rabbit vibrator under $100' },
  { slug: 'rechargeable-vibrators', pillarTerm: 'best rechargeable intimate vibrator black' },
  { slug: 'lay-on-vibrators', pillarTerm: 'best rechargeable lay-on vibrators' },
  { slug: 'couples-shared-pleasure', pillarTerm: 'best red vibrators for couples' },
  { slug: 'prostate-pleasure', pillarTerm: 'best waterproof prostate toy' },
  { slug: 'body-safe-materials', pillarTerm: 'body safe silicone vibrators' },
  { slug: 'vibrator-guides-for-first-timers', pillarTerm: 'best vibrator for beginners' },
  { slug: 'vibrator-types', pillarTerm: 'best vibrator for internal stimulation' },
  { slug: 'first-time-buyer-friendly', pillarTerm: 'best vibrators for beginners' },
  { slug: 'use-cases-lifestyles', pillarTerm: 'best vibrators for travel' },
  { slug: 'budget-friendly-vibrators', pillarTerm: 'best vibrators under $100' },
  { slug: 'lube-for-couples', pillarTerm: 'best water based lubricant for couples' },
  { slug: 'everyday-lubes', pillarTerm: 'best water based lubricant for daily use' },
  { slug: 'bondage-restraint-basics', pillarTerm: 'best black ball gag for couples' },
  { slug: 'dual-stimulation-vibrators', pillarTerm: 'best dual function vibrators' },
  { slug: 'coupled-play', pillarTerm: 'best couples vibrator under $100' },
  { slug: 'clitoral-vibrator-guides', pillarTerm: 'best clitoral vibrator for sensitivity' },
  { slug: 'couples-play-travel', pillarTerm: 'best couples vibrator for travel' },
  { slug: 'remote-long-distance-play', pillarTerm: 'best couples vibrator with remote control' },
  { slug: 'anatomy-specific-pleasure', pillarTerm: 'best vulva thrusting toy' },
  { slug: 'lube-selection-performance', pillarTerm: 'best lubricant for extended sessions' },
  { slug: 'lube-for-every-scenario', pillarTerm: 'best lubricant for extended wear comfort' },
  { slug: 'lube-wellness', pillarTerm: 'best lubricant for ph balance' },
  { slug: 'lube-by-body-need', pillarTerm: 'best ph balanced lube for women' },
  { slug: 'luxury-wellness-discovery', pillarTerm: 'best luxury intimate wellness products' },
  { slug: 'luxury-wands', pillarTerm: 'best luxury wand vibrator' },
  { slug: 'wand-massagers-styles', pillarTerm: 'best purple wand massager' },
  { slug: 'discreet-travel-friendly', pillarTerm: 'best quiet vibrators for travel' },
  { slug: 'curation-value', pillarTerm: 'best rabbit vibrators under 100' },
  { slug: 'hosiery-thigh-highs', pillarTerm: 'best red thigh high hosiery' },
  { slug: 'lubricant-types-textures', pillarTerm: 'best silicone-based slow lubricant' },
  { slug: 'compact-portable', pillarTerm: 'best small vibrators for travel' },
  { slug: 'silicone-materials', pillarTerm: 'best soft silicone vibrators' },
  { slug: 'suction-thrusting-discovery', pillarTerm: 'best suction thruster vibrator' },
  { slug: 'superlative-outcome-driven', pillarTerm: 'best suction toy for pleasure' },
  { slug: 'internal-exploration', pillarTerm: 'best textured vibrators for internal stimulation' },
  { slug: 'wear-comfort', pillarTerm: 'best thigh highs for sensitive skin' },
  { slug: 'couples-partnered-pleasure', pillarTerm: 'best vibrating ring for couples' },
  { slug: 'explore-by-sensation-function', pillarTerm: 'best G-spot vibrators' },
  { slug: 'occasion-wear', pillarTerm: 'best bodysuits for date night' },
  { slug: 'wands', pillarTerm: 'wand vibrator' },
  { slug: 'wand-vibrators', pillarTerm: 'wand vibrator' },
  { slug: 'prostate-internal-pleasure', pillarTerm: 'couples prostate massage toy' },
  { slug: 'strap-on-harness-systems', pillarTerm: 'curved strap on dildo' },
  { slug: 'bodysuits-wear', pillarTerm: 'cut out mesh bodysuit' },
  { slug: 'fantasy-play', pillarTerm: 'dragon shaped adult toy' },
  { slug: 'vibrator-guides-education', pillarTerm: 'how to use a bullet vibrator' },
  { slug: 'wand-use-technique', pillarTerm: 'how to use a wand massager' },
  { slug: 'restraint-systems', pillarTerm: 'under the bed restraint system' },
  { slug: 'under-bed-restraint-systems', pillarTerm: 'under the bed restraint system' },
  { slug: 'body-tape-support', pillarTerm: 'full breast support tape' },
  { slug: 'discreet-wearable-vibrators', pillarTerm: 'how to use vibrating panties discreetly' },
  { slug: 'wearable-vibrators', pillarTerm: 'ultra silent vibrating panties' },
  { slug: 'thrusting-egg-vibrators', pillarTerm: 'vulva thrusting vibrating egg' },
  { slug: 'egg-vibrators', pillarTerm: 'vulva egg vibrator' },
  { slug: 'hosiery-thigh-high', pillarTerm: 'red thigh high stockings' },
  { slug: 'collars-accessories', pillarTerm: 'velvet noir collar with clamps' },
  { slug: 'bodysuits-cut-outs', pillarTerm: 'sexy cut out bodysuits' },
  { slug: 'fantasy-novelty', pillarTerm: 'volcanic dragon dildo' },
  { slug: 'couples-games-accessories', pillarTerm: 'couples card game for intimacy' },
  { slug: 'long-distance-connection', pillarTerm: 'long distance relationship gifts' },
]

// ─── Utilities ────────────────────────────────────────────────────────────────

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[$\-_]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2 && !['and', 'for', 'the', 'with', 'best', 'toy', 'toys'].includes(t))
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  const intersection = [...a].filter(x => b.has(x)).length
  const union = new Set([...a, ...b]).size
  return intersection / union
}

// ─── Shopify Storefront API ───────────────────────────────────────────────────

const STOREFRONT_ENDPOINT = `https://${process.env['SHOPIFY_STORE_DOMAIN']}/api/2024-10/graphql.json`

async function storefrontQuery<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(STOREFRONT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': process.env['SHOPIFY_STOREFRONT_ACCESS_TOKEN']!,
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Shopify Storefront ${res.status}: ${await res.text()}`)
  const { data, errors } = await res.json() as { data: T; errors?: { message: string }[] }
  if (errors?.length) throw new Error(errors.map(e => e.message).join(', '))
  return data
}

async function fetchAllCollections(): Promise<ShopifyCollection[]> {
  const all: ShopifyCollection[] = []
  let cursor: string | null = null

  for (let page = 0; page < 4; page++) {
    console.log(`  Shopify page ${page + 1}${cursor ? ` (after ${cursor.slice(0, 12)}…)` : ''}`)
    const data = await storefrontQuery<{
      collections: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        edges: Array<{ node: {
          handle: string
          title: string
          description: string
          products: { edges: { node: { title: string } }[]; pageInfo: { hasNextPage: boolean } }
        } }>
      }
    }>(`
      query InventoryCollections($first: Int!, $after: String) {
        collections(first: $first, after: $after, sortKey: TITLE) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              handle
              title
              description
              products(first: 5) {
                pageInfo { hasNextPage }
                edges { node { title } }
              }
            }
          }
        }
      }
    `, { first: 100, after: cursor })

    for (const edge of data.collections.edges) {
      const n = edge.node
      // Only include collections that actually have products
      const hasProducts = n.products.edges.length > 0 || n.products.pageInfo.hasNextPage
      if (!hasProducts) continue
      all.push({
        handle: n.handle,
        title: n.title,
        description: n.description ?? '',
      })
    }

    if (!data.collections.pageInfo.hasNextPage) break
    cursor = data.collections.pageInfo.endCursor
    if (!cursor) break
  }

  return all
}

// ─── Main ──────────────────────────────────────────────────────────────────

const EXISTING_DOCS = new Set(['couples', 'for-her', 'for-him'])

// Infer collection type from handle
function inferCollectionType(handle: string): 'category' | 'brand' | 'theme' {
  const BRAND_TOKENS = ['lelo', 'we-vibe', 'wevibe', 'fun-factory', 'njoy', 'satisfyer', 'lovense',
    'je-joue', 'svakom', 'blush', 'tantus', 'vedo', 'femme', 'fuze', 'aneros', 'lovelife',
    'forplay', 'shots', 'nalpac', 'xgen', 'pipedream', 'doc-johnson', 'sportsheets', 'liberator',
    'maia', 'evolved', 'nasstoys', 'topco', 'california-exotic', 'bswish', 'natural-contours',
    'jimmyjane', 'zini', 'leaf', 'picobong', 'lovebuds', 'plusone', 'dame', 'maude', 'unbound']
  const THEME_TOKENS = ['first-time', 'first-timer', 'couples-night', 'date-night', 'long-distance',
    'gift', 'gifting', 'starter', 'beginners', 'travel', 'anniversary', 'bachelorette', 'honeymoon',
    'self-care', 'wellness', 'new-to', 'intro', 'romantic']

  const h = handle.toLowerCase()
  if (BRAND_TOKENS.some(b => h.includes(b))) return 'brand'
  if (THEME_TOKENS.some(t => h.includes(t))) return 'theme'
  return 'category'
}

// Match approved keywords to a handle
function findApprovedKeywords(handle: string): string[] {
  const matched: string[] = []
  for (const kw of APPROVED_KEYWORDS) {
    if (kw.handles.some(h => h === handle || handle.includes(h) || h.includes(handle))) {
      matched.push(kw.term)
    }
  }
  return matched
}

// Find best cluster match using Jaccard on pillarTerm tokens + handle tokens
function findBestCluster(handle: string, title: string): { cluster: ClusterEntry | null; confidence: number } {
  const handleTokens = tokenize(handle + ' ' + title)
  let best: ClusterEntry | null = null
  let bestScore = 0

  for (const cluster of CLUSTERS) {
    const clusterTokens = tokenize(cluster.pillarTerm)
    const score = jaccard(handleTokens, clusterTokens)
    if (score > bestScore) {
      bestScore = score
      best = cluster
    }
  }

  return { cluster: best, confidence: Math.round(bestScore * 100) / 100 }
}

// ─── Run ────────────────────────────────────────────────────────────────────

console.log('Phase 1 — Collection inventory + cluster→handle mapping\n')
console.log('Fetching all published collections from Shopify...')
const shopifyCollections = await fetchAllCollections()
console.log(`  Found ${shopifyCollections.length} collections with products.\n`)

const inventory: InventoryEntry[] = []
const mapping: MappingEntry[] = []

const lowConfidence: MappingEntry[] = []
const mediumConfidence: MappingEntry[] = []
const highConfidence: MappingEntry[] = []

for (const col of shopifyCollections) {
  const approvedKeywords = findApprovedKeywords(col.handle)
  const { cluster, confidence } = findBestCluster(col.handle, col.title)
  const hasApprovedKeywords = approvedKeywords.length > 0
  const needsKeywordPass = !hasApprovedKeywords

  const entry: InventoryEntry = {
    handle: col.handle,
    title: col.title,
    description: col.description.slice(0, 200),
    productsCount: null,
    hasExistingDoc: EXISTING_DOCS.has(col.handle),
    collectionType: inferCollectionType(col.handle),
    topProducts: [],
  }

  const mapEntry: MappingEntry = {
    handle: col.handle,
    title: col.title,
    clusterSlug: confidence >= 0.15 ? (cluster?.slug ?? null) : null,
    pillarTerm: confidence >= 0.15 ? (cluster?.pillarTerm ?? null) : null,
    confidence,
    needsKeywordPass,
    approvedKeywords,
  }

  inventory.push(entry)
  mapping.push(mapEntry)

  if (confidence >= 0.5) highConfidence.push(mapEntry)
  else if (confidence >= 0.25) mediumConfidence.push(mapEntry)
  else lowConfidence.push(mapEntry)
}

// Write output files
const CACHE = resolve(process.cwd(), '.cache')
writeFileSync(`${CACHE}/collection-inventory.json`, JSON.stringify(inventory, null, 2))
writeFileSync(`${CACHE}/cluster-handle-map.json`,   JSON.stringify(mapping,   null, 2))

// ─── Summary ────────────────────────────────────────────────────────────────
const targeted        = mapping.filter(m => !m.needsKeywordPass)
const needsPass       = mapping.filter(m => m.needsKeywordPass)
const withCluster     = mapping.filter(m => m.clusterSlug !== null)
const noCluster       = mapping.filter(m => m.clusterSlug === null)

console.log('═══ INVENTORY SUMMARY ════════════════════════════════════\n')
console.log(`Total collections:         ${mapping.length}`)
console.log(`  → targeted (keywords):   ${targeted.length}`)
console.log(`  → needs keyword pass:    ${needsPass.length}`)
console.log(`  → cluster match ≥0.15:  ${withCluster.length}`)
console.log(`  → no cluster match:      ${noCluster.length}`)
console.log(`  → high confidence ≥0.5:  ${highConfidence.length}`)
console.log(`  → medium 0.25–0.5:       ${mediumConfidence.length}`)
console.log(`  → low <0.25:             ${lowConfidence.length}`)
console.log()

console.log('─── TARGETED collections (have approved keyword coverage) ─')
if (targeted.length === 0) {
  console.log('  (none — all will be needsKeywordPass: true)')
} else {
  for (const m of targeted) {
    console.log(`  ${m.handle.padEnd(40)} keywords: ${m.approvedKeywords.slice(0, 2).join(', ')}`)
  }
}
console.log()

console.log('─── MEDIUM confidence cluster matches (spot-check) ────────')
for (const m of mediumConfidence.slice(0, 15)) {
  console.log(`  ${m.handle.padEnd(35)} → ${m.pillarTerm?.slice(0, 45).padEnd(45)} [${m.confidence}]`)
}
if (mediumConfidence.length > 15) console.log(`  … and ${mediumConfidence.length - 15} more`)
console.log()

console.log('─── LOW confidence (no good cluster match) ─────────────────')
for (const m of lowConfidence.slice(0, 15)) {
  console.log(`  ${m.handle.padEnd(35)} → ${(m.pillarTerm ?? 'no match').slice(0, 45).padEnd(45)} [${m.confidence}]`)
}
if (lowConfidence.length > 15) console.log(`  … and ${lowConfidence.length - 15} more`)
console.log()

console.log(`Output written to .cache/collection-inventory.json and .cache/cluster-handle-map.json`)
console.log('\nREADY FOR USER APPROVAL — review cluster-handle-map.json before proceeding to Phase 2.')

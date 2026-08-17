/**
 * rails-fingerprint.ts — merchandising slot fingerprint verifier (ticket #3531,
 * extends the rails-only gate from PR #652 / ticket #2080).
 *
 * The definition-of-done gate for homepage merchandising freshness. It reads
 * the currently-published state of the three slots the daily merchandiser owns
 * (rails, panel deck, hero pin) from Sanity and prints a per-slot fingerprint,
 * so Routine A can catch its own no-op before the healthcheck files a
 * `sameness:*` ticket.
 *
 * Why a verifier and not a write-path guard: the merchandiser writes DIRECTLY
 * to Sanity (via the Sanity MCP / content CLI), never through this repo's rail
 * helpers, so no code sits in the write path to intercept a stale republish.
 * Verifying the published OUTCOME is the only enforcement a code change can
 * offer.
 *
 * Intended use in the routine:
 *   BASELINE_MERCH=$(npx tsx scripts/rails-fingerprint.ts)   # Step 2c, before touching anything
 *   ...do the merchandising run...
 *   npx tsx scripts/rails-fingerprint.ts --baseline "$BASELINE_MERCH" --assert-changed rails
 *
 * Modes:
 *   (default / capture)          print current per-slot fingerprints as one JSON line
 *   --baseline <json|string>     compare current vs baseline. A JSON baseline
 *                                (from capture mode) compares all three slots; a
 *                                legacy plain-string baseline (pre-#3531 capture:
 *                                rail headings joined with |) compares rails only.
 *   --assert-changed [slots]     with --baseline: comma list of slots that MUST
 *                                have changed (default "rails"). Exits 1 listing
 *                                every byte-identical must-change slot. The deck
 *                                runs a 7-day floor (mission brief), so include
 *                                "deck" only on its scheduled refresh day.
 *
 * Slot fingerprints (all read from published Sanity docs):
 *   rails — wired emmaCuratedRailRef keys + headings + resolved handle lists
 *           (first 4 rendered), so swapping products inside a rail counts as a
 *           change even when the heading stays.
 *   deck  — singleton.panelDeck _updatedAt + every tile label>destination.
 *   hero  — singleton.emmaHeroStorefront featuredProductHandle + the merged
 *           hero headline.
 *   couples — the active playTogetherBanner's image ref + heading/body copy +
 *           resolved handle list (sameness:couples #3228).
 *
 * Exit codes:
 *   0 — printed the fingerprints, or every must-change slot changed
 *   1 — at least one must-change slot is byte-identical to the baseline (or empty)
 *   2 — missing Sanity config, bad flags, or the read failed
 */

import 'dotenv/config'
import { createClient } from '@sanity/client'
import {
  MERCH_SLOTS,
  type MerchSlot,
  type MerchSlotFingerprints,
  couplesSlotFingerprint,
  deckSlotFingerprint,
  evaluateMerchFreshness,
  evaluateRailsFreshness,
  heroSlotFingerprint,
  parseMustChangeSlots,
  railsSlateFingerprint,
  railsSlotFingerprint,
} from '../app/lib/rails-freshness'
import { normalizeProductHandles, type ProductHandleEntry } from '../app/lib/product-handles'

const projectId = process.env['SANITY_PROJECT_ID']
const dataset = process.env['SANITY_DATASET'] ?? 'production'
const token =
  process.env['SANITY_API_TOKEN'] ?? process.env['SANITY_WRITE_TOKEN'] ?? process.env['SANITY_TOKEN']

if (!projectId || !token) {
  process.stderr.write(
    'ERROR: SANITY_PROJECT_ID and a Sanity token (SANITY_API_TOKEN / SANITY_WRITE_TOKEN / SANITY_TOKEN) ' +
      'are required. Run scripts/setup-worktree.sh first.\n',
  )
  process.exit(2)
}

const argv = process.argv.slice(2)
function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  const v = argv[i + 1]
  return v && !v.startsWith('--') ? v : undefined
}
function hasFlag(name: string): boolean {
  return argv.includes(`--${name}`)
}

interface RailRow {
  key?: string | null
  heading?: string | null
  status?: string | null
  active?: boolean | null
  target?: string | null
  productHandles?: ProductHandleEntry[] | null
}

interface DeckRaw {
  _updatedAt?: string | null
  rows?: Array<{
    items?: Array<{
      label?: string | null
      link?: {
        kind?: string | null
        collectionHandle?: string | null
        route?: string | null
        articleSlug?: string | null
      } | null
    } | null> | null
  } | null> | null
}

interface HeroRaw {
  settings?: { headline?: string | null } | null
  cta?: { featuredProductHandle?: string | null } | null
}

interface CouplesRaw {
  imageRef?: string | null
  heading?: string | null
  body?: string | null
  active?: boolean | null
  productHandles?: ProductHandleEntry[] | null
}

interface SlotReads {
  fingerprints: MerchSlotFingerprints
  /** Legacy headings-joined rails string, for pre-#3531 plain-string baselines. */
  railsLegacy: string
  railCount: number
}

/**
 * One round-trip: the wired rails (dereferenced, kept if they would actually
 * render — live, active, homepage-targeted, approximating
 * buildHomeContentBlocks), the raw panel deck, and the merged hero singletons.
 */
async function readPublishedSlots(): Promise<SlotReads> {
  const client = createClient({ projectId, dataset, apiVersion: '2024-10-01', useCdn: false, token })
  const raw = await client.fetch<{
    rails: RailRow[] | null
    deck: DeckRaw | null
    hero: HeroRaw | null
    couples: CouplesRaw | null
  }>(`{
    "rails": *[_id == "singleton.homepage"][0].sections[_type == "emmaCuratedRailRef"]{
      "key": _key,
      "heading": @->heading,
      "status": @->status,
      "active": @->active,
      "target": @->target,
      "productHandles": @->productHandles
    },
    "deck": *[_id == "singleton.panelDeck"][0]{
      _updatedAt,
      rows[]{
        items[]{
          label,
          link{ kind, collectionHandle, route, "articleSlug": article->slug.current }
        }
      }
    },
    "hero": {
      "settings": *[_id == "singleton.emmaHero"][0]{ headline },
      "cta": *[_id == "singleton.emmaHeroStorefront"][0]{ featuredProductHandle }
    },
    "couples": *[_id == "singleton.homepage"][0].sections[_type == "playTogetherBanner" && active == true][0]{
      "imageRef": image.asset._ref,
      heading,
      body,
      active,
      productHandles
    }
  }`)

  const wired = (raw.rails ?? []).filter(
    (r) => r && r.status === 'live' && r.active !== false && r.target !== 'pdp',
  )
  const railInputs = wired.map((r) => ({
    key: r.key ?? '',
    heading: r.heading ?? '',
    handles: normalizeProductHandles(r.productHandles),
  }))

  const tiles: { label: string; destination: string }[] = []
  for (const row of raw.deck?.rows ?? []) {
    for (const item of row?.items ?? []) {
      if (!item?.label) continue
      const link = item.link
      const destination =
        link?.kind === 'collection'
          ? `/collections/${link.collectionHandle ?? ''}`
          : link?.kind === 'article'
            ? `/notebook/${link.articleSlug ?? ''}`
            : (link?.route ?? '')
      tiles.push({ label: item.label, destination })
    }
  }

  return {
    fingerprints: {
      rails: railsSlotFingerprint(railInputs),
      deck: deckSlotFingerprint(raw.deck?._updatedAt ?? null, tiles),
      hero: heroSlotFingerprint(
        raw.hero?.cta?.featuredProductHandle ?? null,
        raw.hero?.settings?.headline ?? null,
      ),
      couples: couplesSlotFingerprint(
        raw.couples
          ? {
              imageRef: raw.couples.imageRef ?? null,
              heading: raw.couples.heading ?? null,
              body: raw.couples.body ?? null,
              handles: normalizeProductHandles(raw.couples.productHandles),
            }
          : null,
      ),
    },
    railsLegacy: railsSlateFingerprint(railInputs.map((r) => r.heading)),
    railCount: railInputs.length,
  }
}

/** A capture-mode JSON baseline, or a legacy plain rails string. */
function parseBaseline(raw: string): { kind: 'json'; value: Partial<MerchSlotFingerprints> } | { kind: 'legacy'; value: string } {
  const trimmed = raw.trim()
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    const value: Partial<MerchSlotFingerprints> = {}
    for (const slot of MERCH_SLOTS) {
      if (typeof parsed[slot] === 'string') value[slot] = parsed[slot] as string
    }
    return { kind: 'json', value }
  }
  return { kind: 'legacy', value: trimmed }
}

async function main(): Promise<number> {
  let reads: SlotReads
  try {
    reads = await readPublishedSlots()
  } catch (err) {
    process.stderr.write(`ERROR: could not read the published homepage: ${(err as Error).message}\n`)
    return 2
  }
  const { fingerprints, railsLegacy, railCount } = reads

  const baselineRaw = flag('baseline')
  if (baselineRaw === undefined) {
    // Capture mode: one JSON line to stdout, context to stderr.
    process.stdout.write(`${JSON.stringify(fingerprints)}\n`)
    process.stderr.write(
      `captured merch fingerprints (${railCount} wired rail(s); deck ${fingerprints.deck ? 'published' : 'absent'}; ` +
        `hero ${fingerprints.hero ? 'set' : 'unset'}; couples ${fingerprints.couples ? 'active' : 'absent'})\n`,
    )
    return 0
  }

  let mustChange: MerchSlot[]
  try {
    mustChange = parseMustChangeSlots(hasFlag('assert-changed') ? (flag('assert-changed') ?? '') : 'rails')
  } catch (err) {
    process.stderr.write(`ERROR: ${(err as Error).message}\n`)
    return 2
  }

  let baseline: ReturnType<typeof parseBaseline>
  try {
    baseline = parseBaseline(baselineRaw)
  } catch (err) {
    process.stderr.write(`ERROR: --baseline is neither valid JSON nor a plain rails string: ${(err as Error).message}\n`)
    return 2
  }

  if (baseline.kind === 'legacy') {
    // Pre-#3531 baseline: rail headings joined with |. Rails-only comparison,
    // byte-identical formula to the healthcheck's, so old routine snippets and
    // in-flight runs keep working across the upgrade.
    const verdict = evaluateRailsFreshness(baseline.value, railsLegacy)
    process.stdout.write(`${JSON.stringify(verdict)}\n`)
    if (verdict.fresh) {
      process.stderr.write(`OK — ${verdict.reason}\n`)
      return 0
    }
    process.stderr.write(
      `FAIL — ${verdict.reason}\n  baseline: "${baseline.value}"\n  current : "${railsLegacy}"\n` +
        'The rails slot did not change this run. Vary the wired rails before finishing.\n',
    )
    return 1
  }

  const verdict = evaluateMerchFreshness(baseline.value, fingerprints, mustChange)
  process.stdout.write(`${JSON.stringify(verdict)}\n`)
  if (verdict.ok) {
    const changed = MERCH_SLOTS.filter((s) => verdict.perSlot[s].fresh)
    process.stderr.write(`OK — every must-change slot moved (changed: ${changed.join(', ') || 'none'})\n`)
    return 0
  }
  process.stderr.write(
    `FAIL — byte-identical must-change slot(s): ${verdict.stale.join(', ')}\n` +
      verdict.stale.map((s) => `  ${s}: ${verdict.perSlot[s].reason}\n`).join('') +
      'The run cannot report done with an unchanged must-change slot.\n',
  )
  return 1
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`ERROR: ${(err as Error).message}\n`)
    process.exit(2)
  },
)

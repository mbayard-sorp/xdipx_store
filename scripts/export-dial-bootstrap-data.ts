// One-off export for the dial-registry bootstrapping work.
//
// Produces three files the user can hand to Cowork (along with their Nalpac
// data) so Cowork can write the rich per-dimension dial taxonomy:
//
//   /tmp/xdipx-dial-bootstrap-products.csv
//     One row per non-archived xdipx product. Columns:
//       sku, handle, title, brand, shopify_product_type, existing_dial,
//       description (cleaned, truncated to 400 chars)
//
//   /tmp/xdipx-dial-bootstrap-registry.csv
//     One row per ProductTypeDial value with the current label coverage.
//     Includes runtime FALLBACK constants (vibrator / lube / wear) so Cowork
//     sees the voice template Emma is already using on PDPs.
//
//   /tmp/xdipx-dial-bootstrap-prompt.md
//     The Cowork brief — voice, schema, scoring rules, output JSON shape.
//
// No Anthropic calls — this is pure catalog + Sanity read. Free.
import './_load-env'
import { writeFileSync } from 'node:fs'
import { db } from '../app/lib/db.server'
import { dealHistory } from '../db/schema'
import { sql } from 'drizzle-orm'
import { shopifyAdmin } from '../app/lib/shopify.server'
import { getDialRegistry } from '../app/lib/dial-registry.server'
import { PRODUCT_TYPE_DIALS, type ProductTypeDial } from '../app/types'

const PRODUCTS_CSV = '/tmp/xdipx-dial-bootstrap-products.csv'
const REGISTRY_CSV = '/tmp/xdipx-dial-bootstrap-registry.csv'
const PROMPT_MD    = '/tmp/xdipx-dial-bootstrap-prompt.md'

interface ShopProduct {
  id:           number
  title:        string
  handle:       string
  vendor:       string
  body_html:    string | null
  product_type: string | null
  status:       string
}

interface MetaResp {
  metafields: Array<{ namespace: string; key: string; value: string }>
}

function csvEscape(v: string | undefined | null): string {
  if (v === undefined || v === null) return ''
  const s = String(v)
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

function cleanDescription(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400)
}

async function fetchOne(numericId: string, sku: string): Promise<{
  handle: string; title: string; brand: string; productType: string;
  description: string; existingDial: string;
} | null> {
  try {
    const res = await shopifyAdmin<{ product: ShopProduct | null }>(
      `/products/${numericId}.json`,
    )
    if (!res.product) return null
    if (res.product.status === 'archived') return null

    let existingDial = ''
    try {
      const mf = await shopifyAdmin<MetaResp>(
        `/products/${numericId}/metafields.json?namespace=xdipx&limit=20`,
      )
      const dial = mf.metafields.find(m => m.key === 'product_type_dial')?.value
      if (dial && (PRODUCT_TYPE_DIALS as readonly string[]).includes(dial)) {
        existingDial = dial
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('429')) {
        await new Promise(r => setTimeout(r, 1500))
        return fetchOne(numericId, sku)
      }
      // Non-fatal — leave existingDial empty.
    }

    return {
      handle:      res.product.handle ?? '',
      title:       res.product.title ?? '',
      brand:       res.product.vendor ?? '',
      productType: res.product.product_type ?? '',
      description: cleanDescription(res.product.body_html),
      existingDial,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('429')) {
      await new Promise(r => setTimeout(r, 1500))
      try { return await fetchOne(numericId, sku) } catch { /* fall through */ }
    }
    console.warn(`  fetch ${sku}: ${msg.slice(0, 80)}`)
    return null
  }
}

async function exportProducts(): Promise<{ written: number; skipped: number }> {
  const rows = await db
    .select({ sku: dealHistory.sku, shopifyProductId: dealHistory.shopifyProductId })
    .from(dealHistory)
    .where(sql`${dealHistory.status} != 'archived' AND ${dealHistory.sku} NOT LIKE 'XDX-TEST-%'`)
    .orderBy(dealHistory.sku)

  console.log(`[products] ${rows.length} candidate rows`)

  const lines: string[] = []
  lines.push(['sku', 'handle', 'title', 'brand', 'shopify_product_type', 'existing_dial', 'description']
    .map(csvEscape).join(','))

  let written = 0
  let skipped = 0
  let i = 0
  for (const row of rows) {
    i++
    const numericId = row.shopifyProductId.split('/').pop()
    if (!numericId) { skipped++; continue }
    const meta = await fetchOne(numericId, row.sku)
    if (!meta) { skipped++; continue }
    lines.push([
      row.sku,
      meta.handle,
      meta.title,
      meta.brand,
      meta.productType,
      meta.existingDial,
      meta.description,
    ].map(csvEscape).join(','))
    written++
    if (i % 25 === 0) process.stdout.write(`  ...${i}/${rows.length} written=${written} skipped=${skipped}\r`)
    // Stay under Shopify Admin REST burst limits.
    await new Promise(r => setTimeout(r, 80))
  }
  console.log()
  writeFileSync(PRODUCTS_CSV, lines.join('\n') + '\n', 'utf8')
  console.log(`[products] wrote ${written} rows to ${PRODUCTS_CSV} (${skipped} skipped)`)
  return { written, skipped }
}

async function exportRegistry(): Promise<void> {
  const reg = await getDialRegistry()
  const lines: string[] = []
  lines.push(['type', 'label_count', 'labels_pipe_separated', 'note'].map(csvEscape).join(','))

  for (const type of PRODUCT_TYPE_DIALS) {
    const labels = reg[type as ProductTypeDial] ?? []
    const note = labels.length === 0
      ? 'EMPTY — needs starter labels from Cowork'
      : (type === 'vibrator' || type === 'lube' || type === 'wear')
        ? 'fallback constants in code (use as voice template)'
        : 'sanity-populated'
    lines.push([type, String(labels.length), labels.join(' | '), note].map(csvEscape).join(','))
  }

  writeFileSync(REGISTRY_CSV, lines.join('\n') + '\n', 'utf8')
  console.log(`[registry] wrote ${PRODUCT_TYPE_DIALS.length} rows to ${REGISTRY_CSV}`)
}

function buildPrompt(): string {
  return `# xdipx — Dial Taxonomy Bootstrap (brief for Cowork)

You are producing the **starter sensation-dial taxonomy** for xdipx.com — an editorially-curated sexual-wellness storefront. The dial is the 5–6-axis sensation map shown on every product detail page (PDP). Each axis is scored 1–5 for that specific product, and customers read both the axis label AND the 1/3/5 scale documentation when comparing products.

This brief asks you to seed **all 19 ProductTypeDial values** with 5–6 dimensions each. Editors will refine over time; this is the editorial baseline.

---

## The voice you're writing in

Emma is the editorial voice of xdipx — a trusted, funny friend who tests everything she recommends. First person, warm, specific, never clinical, never sleazy. Suggestive is fine; explicit is not.

**Hard rules (will fail review otherwise):**
- **No em-dashes** anywhere ("—" or "–"). Use periods, commas, or parentheses.
- **No price, MAP, or discount language.**
- **Word choice**: prefer "intimate," "pleasure," "wellness." "sex" / "sexy" only where contextually natural (e.g. "safer sex," "sexy gift"). Never use "sex" as an adjective ("sex toys" is fine because it's the trade term, but "sex aesthetic" would not be).
- **No countdowns**, no "buy now," no "limited time" — the dial copy is durable, the deals rotate beneath it.

---

## What you're producing

A **single JSON object** keyed by every \`ProductTypeDial\` value (the 19 listed below). Each value is an array of 5–6 dimension entries. Each entry has this exact shape:

\`\`\`json
{
  "label":      "string (≤24 chars, sentence case, no trailing punctuation)",
  "definition": "string (one sentence — what does this dimension measure? written for editor reference, not surfaced to customers)",
  "scaleLow":   "string (what does '1' feel like for this product type? be SPECIFIC and sensory, ≤140 chars)",
  "scaleMid":   "string (what does '3' feel like? ≤140 chars)",
  "scaleHigh":  "string (what does '5' feel like? ≤140 chars)"
}
\`\`\`

All four text fields are required. Don't ship blanks.

---

## Voice templates (existing production labels — match this register)

These three types are already in the catalog. The label lists below are what Emma is using today on PDPs. Use them as the voice anchor when writing labels and scale entries for the other 16 types.

- **vibrator** — Intensity, Quietness, Pattern variety, Buildup speed, Battery life, Learning curve
- **lube** — Slipperiness, Longevity, Taste-safe, Body-safe, Tidy-up, Skin feel
- **wear** — Fit, Softness, Washability, Discretion, Adjustability, Occasion

Note the pattern: factual axes a buyer can actually compare across products. Not marketing words ("Wow factor," "Premium vibe") and not clinical ("Vibration frequency in Hz"). Sensation language a friend would use.

For these three types, **rewrite them** in the rich shape (label + definition + scaleLow/Mid/High). They're voice-anchoring; use the labels above verbatim and add the supporting fields.

---

## The 19 ProductTypeDial values + scope

For each, think about what 5–6 axes a thoughtful buyer actually weighs. Avoid axis overlap (e.g. don't have both "Intensity" and "Power" on the same type — they're the same thing).

| Type | Catalog scope |
|---|---|
| **vibrator** | Internal + external vibrators, bullets, eggs, rabbits, g-spot, finger/clit toys, wands, air-pulsation devices, rotating/thrusting, remote and wearable. Subtypes are folded under this. |
| **dildo** | Realistic, glass/metal, silicone, dual-density, non-phallic, vibrating dildos, packers, large/extreme. |
| **anal** | Plugs, beads, prostate massagers, anal training kits, P-spot toys. |
| **bondage** | Restraints, cuffs, blindfolds, gags, ropes, paddles, floggers, kits. |
| **cock-ring** | Cock rings, couples rings, vibrating rings, ball stretchers, harnesses-with-rings. |
| **stroker** | Manual masturbators, automatic strokers, sleeves, suction strokers, mouth/themed designs. |
| **couples** | Couples-focused toys (worn during partnered play, hands-free shared toys, kits). |
| **harness** | Strap-on harnesses, harness-and-dildo sets, panty harnesses. |
| **extender** | Penis extenders, sleeves, girth enhancers, hollow strap-ons. |
| **pump** | Penis pumps, vulva pumps, nipple pumps, suction trainers. |
| **lube** | Water-based, silicone, hybrid, oil-based, flavored, warming/cooling, anal-specific. |
| **massage** | Massage candles, oils, gels, body lotions for sensual / non-genital massage. |
| **enhancer** | Arousal gels, delay sprays, stamina/edge supports, libido products. |
| **wear** | Lingerie, bodysuits, harnesses-as-fashion, panties, role-play outfits. |
| **condom** | Condoms — latex, non-latex, ribbed, ultra-thin, flavored. |
| **wellness** | Pelvic-floor trainers, kegel devices, postpartum recovery, menstrual products. |
| **novelty** | Gag gifts, party games, bachelor/ette accessories, conversation pieces. |
| **book-media** | Books, card decks, DVDs, audio guides, educational media. |
| **sex-machine** | Power-driven thrusting machines, mounted devices, large machines. |

Some axes will recur across types (e.g. "Body-safe" makes sense for any insertable). Reuse labels intentionally where they fit; don't invent synonyms just to avoid repetition. The goal is a CONSISTENT vocabulary across the catalog.

---

## Scale-writing rules (the 1/3/5 anchors are the most important deliverable)

The scale entries are what makes the dial actually useful — a "3 on Intensity" should mean the same thing across every vibrator. Write them so a customer reading **just** the 1 and 5 entries can predict what 3 feels like.

**Good** (sensory, specific, anchored):
- scaleLow: "Whisper-soft buzz, barely perceptible — for slow buildup or first-timers."
- scaleMid: "Confident hum, clearly felt but not overwhelming. The everyday setting."
- scaleHigh: "Deep, rumbly thud you can feel through clothing. Almost too much for some."

**Bad** (vague, generic, marketing-ish):
- scaleLow: "Mild." → too short, no sensory anchor
- scaleMid: "Medium-intensity vibration." → restates the axis
- scaleHigh: "Wow factor through the roof." → marketing copy, not measurable

For non-physical types (book-media, novelty), translate "intensity" to the relevant register (e.g. "Educational depth" for book-media: 1 = playful primer, 5 = clinical/scholarly).

---

## Reference data attached

- \`/tmp/xdipx-dial-bootstrap-products.csv\` — every non-archived xdipx product with its title, brand, Shopify product type, and a cleaned 400-char description. Use this to ground labels in the actual catalog.
- \`/tmp/xdipx-dial-bootstrap-registry.csv\` — current dial label state per type (mostly empty; see the three populated rows for the existing voice).
- **Nalpac source data** — the user will hand this to you separately. It's the canonical product feed; cross-reference for richer category context, especially for less-common types.

---

## Output format

Return ONE JSON file (no markdown fences, no commentary) with this exact shape:

\`\`\`json
{
  "vibrator": [
    {
      "label": "Intensity",
      "definition": "How forceful the vibration feels at peak — separate from speed or pattern.",
      "scaleLow": "Whisper-soft buzz, barely perceptible. Good for slow buildup.",
      "scaleMid": "Confident hum, clearly felt but not overwhelming. The everyday setting.",
      "scaleHigh": "Deep, rumbly thud you can feel through clothing. Almost too much for some."
    },
    { /* 4–5 more dimensions for vibrator */ }
  ],
  "dildo":      [ /* 5–6 dimensions */ ],
  "anal":       [ /* 5–6 dimensions */ ],
  "bondage":    [ /* 5–6 dimensions */ ],
  "cock-ring":  [ /* 5–6 dimensions */ ],
  "stroker":    [ /* 5–6 dimensions */ ],
  "couples":    [ /* 5–6 dimensions */ ],
  "harness":    [ /* 5–6 dimensions */ ],
  "extender":   [ /* 5–6 dimensions */ ],
  "pump":       [ /* 5–6 dimensions */ ],
  "lube":       [ /* 5–6 dimensions */ ],
  "massage":    [ /* 5–6 dimensions */ ],
  "enhancer":   [ /* 5–6 dimensions */ ],
  "wear":       [ /* 5–6 dimensions */ ],
  "condom":     [ /* 5–6 dimensions */ ],
  "wellness":   [ /* 5–6 dimensions */ ],
  "novelty":    [ /* 5–6 dimensions */ ],
  "book-media": [ /* 5–6 dimensions */ ],
  "sex-machine":[ /* 5–6 dimensions */ ]
}
\`\`\`

Hyphenated keys (\`cock-ring\`, \`book-media\`, \`sex-machine\`) match the ProductTypeDial enum exactly — preserve hyphens, don't camelCase.

---

## Final checks before handing back

- [ ] Every one of the 19 type keys is present.
- [ ] Each type has 5–6 entries (not 3, not 8 — the dial generator picks 5–6 per product).
- [ ] Every entry has all four text fields filled in.
- [ ] No em-dashes anywhere.
- [ ] Labels are ≤24 chars, no trailing punctuation.
- [ ] Scale entries are sensory and specific, not generic ("low/medium/high" is a fail).
- [ ] No marketing copy, no countdowns, no price language.
- [ ] Voice matches the existing vibrator/lube/wear labels — factual axes, friend-not-clinician register.
`
}

async function exportPrompt(): Promise<void> {
  writeFileSync(PROMPT_MD, buildPrompt(), 'utf8')
  console.log(`[prompt]   wrote brief to ${PROMPT_MD}`)
}

async function main() {
  console.log('export-dial-bootstrap-data — building three files for Cowork')
  console.log()

  await exportRegistry()
  await exportPrompt()
  console.log()
  const summary = await exportProducts()

  console.log()
  console.log('— done —')
  console.log(`  prompt:    ${PROMPT_MD}`)
  console.log(`  registry:  ${REGISTRY_CSV}  (${PRODUCT_TYPE_DIALS.length} rows)`)
  console.log(`  products:  ${PRODUCTS_CSV}  (${summary.written} rows)`)
  console.log()
  console.log('Hand all three files to Cowork along with your Nalpac source data.')
  console.log('Cowork returns ONE JSON file with the rich shape (label + definition +')
  console.log('scaleLow/Mid/High per dimension). Drop it anywhere and I will write a')
  console.log('tiny importer that calls writeDialTaxonomyForType for each type — that')
  console.log('writes both dialTaxonomy AND mirrors flat labels into dialRegistry.')
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })

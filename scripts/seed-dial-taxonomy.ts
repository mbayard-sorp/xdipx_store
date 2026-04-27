/**
 * Seed the rich dial taxonomy (Sanity singleton.dialTaxonomy) with a
 * comprehensive per-dimension definition + 1/3/5 scale documentation for
 * each product type.
 *
 * Why: the older `dialRegistry` singleton stores only flat label arrays. The
 * orchestrator reads it as hints, so generated values are inconsistent across
 * products of the same type ("Intensity 4" can mean very different things on
 * two wands). This script asks Claude to define the full dimension set per
 * product type and seeds Sanity so the generator gets anchored value scales.
 *
 * Idempotent: writes are full replacements per product type. Re-running
 * regenerates with the same prompt. Editors can hand-edit in Studio after.
 *
 * Usage:
 *   npx tsx scripts/seed-dial-taxonomy.ts                # dry-run, prints proposals
 *   npx tsx scripts/seed-dial-taxonomy.ts --apply        # writes to Sanity
 *   npx tsx scripts/seed-dial-taxonomy.ts --type=wand    # one type only
 *   npx tsx scripts/seed-dial-taxonomy.ts --apply --type=lube
 *
 * Env: ANTHROPIC_API_KEY, SANITY_PROJECT_ID, SANITY_API_TOKEN
 */
import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import { writeDialTaxonomyForType, type DialDimensionEntry } from '../app/lib/dial-registry.server'
import type { ProductTypeDial } from '../app/types/index'

const MODEL = 'claude-sonnet-4-20250514'

const PRODUCT_TYPE_HINTS: Record<ProductTypeDial, string> = {
  'air-pulsation': 'Clitoral suction / air-pulse / pressure-wave devices (e.g. Womanizer, Satisfyer Pro). Dimensions cover suction strength, pulse pattern, fit, learning curve, quietness, and travel-friendliness.',
  'vibrator':      'Internal/external vibrators including bullets, rabbits, couples vibes, app-controlled toys. Dimensions cover intensity, rumble depth (vs buzzy surface), pattern variety, motor placement, ergonomics, battery life, app/remote, quietness.',
  'wand':          'Large-format wand massagers (e.g. Magic Wand, Doxy). Dimensions cover head intensity, rumble depth, head firmness, weight/grip, reach, attachment compatibility, corded vs rechargeable, quietness.',
  'lube':          'Lubricants, gels, oils, intimate moisturizers, warming/cooling. Dimensions cover slipperiness, longevity (re-application interval), water-vs-silicone-vs-oil base, taste/scent profile, condom + silicone-toy compatibility, easy cleanup, skin sensitivity.',
  'wear':          'Lingerie, harnesses, panties, restraints, plugs/rings worn on the body. Dimensions cover fit, softness, adjustability, discretion under clothing, washability, durability, occasion, body-safe materials.',
}

const SYSTEM_PROMPT = `You are designing the "How it feels" sensation dial taxonomy for xdipx.com — an editorially-curated sexual-wellness storefront. Editors and shoppers see a 1–5 dial on every product. You produce the dimension catalog: every meaningful axis a buyer cares about for one product type, plus what 1, 3, and 5 mean on each axis so values are consistent across products.

Voice: tasteful, plainspoken, helpful. NO em-dashes ("—") or en-dashes. Use periods or commas. Hyphens in compound words are fine.`

interface TaxonomyResponse {
  dimensions: Array<{
    label:      string
    definition: string
    scaleLow:   string
    scaleMid:   string
    scaleHigh:  string
  }>
}

function stripFences(s: string): string {
  return s.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
}

async function generateTaxonomyForType(
  client: Anthropic,
  type: ProductTypeDial,
): Promise<DialDimensionEntry[]> {
  const hint = PRODUCT_TYPE_HINTS[type]
  const userPrompt = `Define the comprehensive sensation dial taxonomy for product type: ${type}.

Context: ${hint}

Produce 8–12 dimensions — every meaningful axis a thoughtful buyer cares about for this product type. Skip vague or duplicative axes (e.g. don't include "Quality" if "Build quality" or "Materials" already covers it).

For each dimension, give:
  - label (≤ 24 chars, sentence case, no trailing punctuation)
  - definition (1 short sentence describing what this measures, ≤ 200 chars)
  - scaleLow  — what 1 means in plain language (≤ 120 chars)
  - scaleMid  — what 3 means (≤ 120 chars)
  - scaleHigh — what 5 means (≤ 120 chars)

Rules:
- Each scale rung must be concrete and comparative. "Mid-range vibration" is too vague — try "Mid-rumble: noticeable through clothing, comfortable on bare skin without numbing".
- Scale rungs should describe an OBJECTIVE feel/experience, not a value judgement. Don't say "5 = best".
- Adjacent product-type dimensions are OK (e.g. wand can have "Head firmness" AND "Head intensity"). Avoid synonyms.
- NEVER use em-dashes ("—"). Hyphens in compound words are fine.

Return ONLY raw JSON (no markdown):
{
  "dimensions": [
    {
      "label": "Intensity",
      "definition": "How strong the strongest setting feels.",
      "scaleLow":  "Gentle: barely-there hum, comfortable for hours.",
      "scaleMid":  "Solid mid-range: distinct buzz, body-friendly for most.",
      "scaleHigh": "Powerful: deep rumble that some find too much over bare skin."
    }
  ]
}`

  const msg = await client.messages.create({
    model:      MODEL,
    max_tokens: 4096,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: userPrompt }],
  })
  const block = msg.content[0]
  if (block?.type !== 'text') throw new Error(`non-text response for ${type}`)

  const parsed = JSON.parse(stripFences(block.text)) as TaxonomyResponse
  if (!parsed.dimensions || !Array.isArray(parsed.dimensions)) {
    throw new Error(`invalid response shape for ${type}`)
  }

  const out: DialDimensionEntry[] = []
  const seen = new Set<string>()
  for (const d of parsed.dimensions) {
    if (typeof d.label !== 'string') continue
    const label = d.label.trim()
    if (!label || label.length > 30) continue
    const key = label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const entry: DialDimensionEntry = { label }
    if (typeof d.definition === 'string' && d.definition.trim()) entry.definition = d.definition.trim()
    if (typeof d.scaleLow   === 'string' && d.scaleLow.trim())   entry.scaleLow   = d.scaleLow.trim()
    if (typeof d.scaleMid   === 'string' && d.scaleMid.trim())   entry.scaleMid   = d.scaleMid.trim()
    if (typeof d.scaleHigh  === 'string' && d.scaleHigh.trim())  entry.scaleHigh  = d.scaleHigh.trim()
    out.push(entry)
  }
  return out
}

function parseArgs(argv: string[]): { apply: boolean; type?: ProductTypeDial } {
  const args = argv.slice(2)
  const apply = args.includes('--apply')
  const typeArg = args.find(a => a.startsWith('--type='))
  const type = typeArg ? (typeArg.slice('--type='.length).trim() as ProductTypeDial) : undefined
  if (type && !(['air-pulsation', 'vibrator', 'wand', 'lube', 'wear'] as const).includes(type)) {
    console.error(`Invalid --type=${type}. Must be one of: air-pulsation | vibrator | wand | lube | wear`)
    process.exit(1)
  }
  const result: { apply: boolean; type?: ProductTypeDial } = { apply }
  if (type) result.type = type
  return result
}

async function main() {
  const apiKey = process.env['ANTHROPIC_API_KEY']?.trim()
  if (!apiKey) {
    console.error('ERROR: ANTHROPIC_API_KEY required')
    process.exit(1)
  }
  const args = parseArgs(process.argv)
  const client = new Anthropic({ apiKey })

  const types: ProductTypeDial[] = args.type
    ? [args.type]
    : ['air-pulsation', 'vibrator', 'wand', 'lube', 'wear']

  console.log(`${args.apply ? 'APPLYING' : 'DRY-RUN'} dial taxonomy for: ${types.join(', ')}`)
  console.log()

  for (const type of types) {
    process.stdout.write(`[${type}] generating taxonomy via Claude... `)
    let entries: DialDimensionEntry[]
    try {
      entries = await generateTaxonomyForType(client, type)
    } catch (err) {
      console.log('FAILED')
      console.error(`  ${err instanceof Error ? err.message : err}`)
      continue
    }
    console.log(`got ${entries.length} dimensions`)
    for (const e of entries) {
      console.log(`  - ${e.label}`)
      if (e.definition) console.log(`      def:  ${e.definition}`)
      if (e.scaleLow)   console.log(`      1:    ${e.scaleLow}`)
      if (e.scaleMid)   console.log(`      3:    ${e.scaleMid}`)
      if (e.scaleHigh)  console.log(`      5:    ${e.scaleHigh}`)
    }
    console.log()

    if (args.apply) {
      try {
        await writeDialTaxonomyForType(type, entries)
        console.log(`  ✓ wrote ${entries.length} entries to Sanity for ${type}`)
      } catch (err) {
        console.error(`  ✗ Sanity write failed for ${type}: ${err instanceof Error ? err.message : err}`)
      }
      console.log()
    }
  }

  if (!args.apply) {
    console.log('— dry-run complete. Re-run with --apply to write to Sanity. —')
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

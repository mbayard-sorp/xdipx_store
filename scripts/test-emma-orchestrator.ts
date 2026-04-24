/**
 * Dry-run the Emma orchestrator against 5 fake products (one per product_type_dial).
 * Hits real Anthropic + Gemini + Shopify Files APIs. Skips writing to Shopify.
 *
 * Usage:
 *   npx tsx scripts/test-emma-orchestrator.ts               # all 5 products
 *   npx tsx scripts/test-emma-orchestrator.ts vibrator      # just one
 *   npx tsx scripts/test-emma-orchestrator.ts --no-image    # skip mood image (faster/cheaper)
 */
import dotenv from 'dotenv'
// Force-override shell-level empty vars (Claude Code clears ANTHROPIC_API_KEY in the parent shell).
dotenv.config({ path: '.env.local', override: true })
dotenv.config({ path: '.env',       override: true })
// Dynamic import so env is populated before db.server.ts (and other side-effecting modules) evaluate.
const { generateProductContent } = await import('../app/lib/emma-orchestrator.server.ts')

interface Fixture {
  typeHint:   string
  product: {
    title:       string
    brand:       string
    description: string
    categories:  string[]
    dealPrice:   number
    msrp:        number
  }
  seoTitle:   string
  category:   'for-him' | 'for-her' | 'both' | 'couples'
}

const FIXTURES: Fixture[] = [
  {
    typeHint: 'air-pulsation',
    product: {
      title:       'Satisfyer Pro 2 Next Generation',
      brand:       'Satisfyer',
      description: 'Clitoral stimulator with air-pulse technology. 11 intensity settings, whisper-quiet, waterproof IPX7. USB rechargeable. Medical-grade silicone touch surface.',
      categories:  ['Air Pulse and Suction', 'Finger and Clit'],
      dealPrice:   34.99,
      msrp:        69.95,
    },
    seoTitle: 'Satisfyer Pro 2 — Air-Pulse Clitoral Stimulator',
    category: 'for-her',
  },
  {
    typeHint: 'vibrator',
    product: {
      title:       'We-Vibe Tango X Bullet Vibrator',
      brand:       'We-Vibe',
      description: 'Powerful rechargeable bullet vibrator with a tapered tip for pinpoint stimulation. 8 vibration modes. Ultra-quiet. Body-safe silicone. USB-C magnetic charging.',
      categories:  ['Bullets and Eggs', 'Finger and Clit'],
      dealPrice:   59.99,
      msrp:        99.00,
    },
    seoTitle: 'We-Vibe Tango X — Pinpoint Bullet Vibrator',
    category: 'for-her',
  },
  {
    typeHint: 'wand',
    product: {
      title:       'Hitachi Magic Wand Original',
      brand:       'Hitachi',
      description: 'The iconic corded wand massager. Two speeds, high-amplitude vibrations, tennis-ball-sized head. 110V plug-in. Large surface area.',
      categories:  ['Wands'],
      dealPrice:   49.99,
      msrp:        69.99,
    },
    seoTitle: 'Hitachi Magic Wand — The Original',
    category: 'for-her',
  },
  {
    typeHint: 'lube',
    product: {
      title:       'Sliquid Sassy Water-Based Lubricant 4.2oz',
      brand:       'Sliquid',
      description: 'Water-based personal lubricant with a thicker consistency. Glycerin-free, paraben-free, pH-balanced. Compatible with all toys and condoms. Unscented, tasteless.',
      categories:  ['Lubricants'],
      dealPrice:   12.99,
      msrp:        18.00,
    },
    seoTitle: 'Sliquid Sassy — Thicker Water-Based Lube',
    category: 'both',
  },
  {
    typeHint: 'wear',
    product: {
      title:       'Strap-On Harness — Classic Leather',
      brand:       'SpareParts',
      description: 'Adjustable fabric harness with a stretchy O-ring system that accommodates dildos from 1" to 2.5" in diameter. Machine washable. Fits waists 24"-50".',
      categories:  ['Strap-ons and Harnesses', 'Couples and Wearable'],
      dealPrice:   79.99,
      msrp:        109.00,
    },
    seoTitle: 'SpareParts Joque — Adjustable Strap-On Harness',
    category: 'couples',
  },
]

const args    = process.argv.slice(2)
const noImage = args.includes('--no-image')
const only    = args.find(a => !a.startsWith('--'))

if (noImage) {
  process.env.EMMA_SKIP_IMAGE = '1'
  console.warn('[dry-run] --no-image: mood image generation + Shopify Files upload will be skipped')
}

const fixtures = only
  ? FIXTURES.filter(f => f.typeHint === only)
  : FIXTURES

if (fixtures.length === 0) {
  console.error(`No fixture matches "${only}". Options: ${FIXTURES.map(f => f.typeHint).join(', ')}`)
  process.exit(1)
}

console.log(`\n━━━ Emma orchestrator dry-run — ${fixtures.length} fixture(s) ━━━\n`)

let totalTokens = 0
let totalMs     = 0
const failures: string[] = []

for (const fx of fixtures) {
  console.log(`▸ ${fx.typeHint.toUpperCase()} — ${fx.product.brand} ${fx.product.title}`)
  try {
    const { writes, telemetry } = await generateProductContent({
      product:  fx.product,
      seoTitle: fx.seoTitle,
      category: fx.category,
    })

    totalTokens += telemetry.totalTokens
    totalMs     += telemetry.durationMs

    console.log(`  turns=${telemetry.turns} tokens=${telemetry.totalTokens} (${telemetry.totalInputTokens} in / ${telemetry.totalOutputTokens} out) duration=${telemetry.durationMs}ms`)
    console.log(`  tools called: ${telemetry.toolCalls.map(c => `${c.name}${c.ok ? '' : '✗'}`).join(', ')}`)

    console.log(`  productTypeDial:     ${writes.productTypeDial}${writes.productTypeDial === fx.typeHint ? ' ✓' : `  (expected ${fx.typeHint})`}`)
    console.log(`  tagline:             ${writes.tagline.slice(0, 90)}`)
    console.log(`  featureBullets:      ${writes.featureBullets.length}`)
    console.log(`  worksForHim/Her:     ${(writes.worksForHim?.length ?? 0)}ch / ${(writes.worksForHer?.length ?? 0)}ch`)
    console.log(`  specifications:      ${(writes.specifications?.length ?? 0)}ch`)
    console.log(`  seoMetaDescription:  ${writes.seoMetaDescription.length}ch`)
    console.log(`  descriptionHtml:     ${writes.descriptionHtml.length}ch (Emma's take)`)
    console.log(`  careInstructions:    ${writes.careInstructions ? `${writes.careInstructions.length} bullets` : 'skipped'}`)
    console.log(`  sensationDialV2:     ${writes.sensationDialV2 ? `${writes.sensationDialV2.items.length} items — [${writes.sensationDialV2.items.map(i => `${i.label}:${i.value}${i.proposed ? '*' : ''}`).join(', ')}]` : 'skipped'}`)
    console.log(`  boxContents:         ${writes.boxContents ? `${writes.boxContents.length} items` : 'skipped'}`)
    console.log(`  moodTags:            [${writes.moodTags.join(', ')}]`)
    console.log(`  audienceTags:        [${writes.audienceTags.join(', ')}]`)
    console.log(`  mattersTags:         [${writes.mattersTags.join(', ')}]`)
    console.log(`  emmaHero:            ${writes.emmaHero ? `variant=${writes.emmaHero.variant}` : 'skipped'}`)
    console.log(`  moodImageUrl:        ${writes.moodImageUrl ? writes.moodImageUrl.slice(0, 80) : 'skipped'}`)

    // Basic assertions
    const issues: string[] = []
    if (writes.productTypeDial !== fx.typeHint) issues.push(`wrong productTypeDial: got ${writes.productTypeDial}, expected ${fx.typeHint}`)
    if (!writes.tagline) issues.push('tagline empty')
    if (writes.featureBullets.length === 0) issues.push('no featureBullets')
    if (!writes.descriptionHtml) issues.push('descriptionHtml (Emma\'s take) empty')
    if (writes.moodTags.length === 0) issues.push('no moodTags')
    if (writes.audienceTags.length === 0) issues.push('no audienceTags')
    if (writes.mattersTags.length === 0) issues.push('no mattersTags')
    if (fx.typeHint === 'lube' && writes.boxContents && writes.boxContents.length > 0) issues.push('lube should not have boxContents')
    if (issues.length > 0) {
      console.log(`  ⚠ issues: ${issues.join('; ')}`)
      failures.push(`${fx.typeHint}: ${issues.join('; ')}`)
    } else {
      console.log(`  ✓ passes checks`)
    }
  } catch (err) {
    console.error(`  ✗ failed: ${err instanceof Error ? err.message : String(err)}`)
    failures.push(`${fx.typeHint}: threw — ${err instanceof Error ? err.message : 'error'}`)
  }
  console.log('')
}

console.log(`━━━ totals ━━━`)
console.log(`fixtures: ${fixtures.length}  tokens: ${totalTokens}  duration: ${totalMs}ms  avg: ${Math.round(totalTokens / fixtures.length)} tokens / fixture`)
if (failures.length > 0) {
  console.log(`\n${failures.length} failure(s):`)
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log(`all fixtures passed ✓`)

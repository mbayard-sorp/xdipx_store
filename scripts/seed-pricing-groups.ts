/**
 * Seed pricing_groups, pricing_sub_groups, pricing_product_type_map, and
 * pricing_rules with the starting hierarchy and margin values from the
 * Pricing Agent refactor spec (ss3.2 and ss3.3).
 *
 * Idempotent: uses ON CONFLICT DO NOTHING. Safe to re-run.
 *
 *   pnpm tsx scripts/seed-pricing-groups.ts
 */
import './_load-env'
import { neon } from '@neondatabase/serverless'

const url = process.env['DATABASE_URL']
if (!url) {
  console.error('DATABASE_URL is required.')
  process.exit(1)
}

const sql = neon(url)

// ---------------------------------------------------------------------------
// Source data (spec ss3.2)
// ---------------------------------------------------------------------------

type SubGroup = {
  id: string
  name: string
  productTypes: string[]
}

type Group = {
  id: string
  name: string
  usesClearanceLadder?: boolean
  subGroups: SubGroup[]
}

const GROUPS: Group[] = [
  {
    id: 'insertable_toys',
    name: 'Insertable Toys',
    subGroups: [
      { id: 'dildos',           name: 'Dildos',           productTypes: ['Realistic Dildo', 'Silicone Dildo', 'Dildo', 'Fantasy Dildo'] },
      { id: 'vibrating_dildos', name: 'Vibrating Dildos', productTypes: ['Vibrating Dildo', 'Thrusting Vibrator'] },
      { id: 'anal',             name: 'Anal',             productTypes: ['Anal Plug', 'Anal Beads', 'Anal Training Kit', 'Anal Toy', 'Vibrating Anal Toy', 'Prostate Massager'] },
    ],
  },
  {
    id: 'vibrators',
    name: 'Vibrators',
    subGroups: [
      { id: 'external_clitoral', name: 'External / Clitoral', productTypes: ['Bullet Vibrator', 'Clitoral Vibrator', 'Suction Vibrator', 'Vibrator'] },
      { id: 'wands',             name: 'Wands',              productTypes: ['Wand Massager'] },
      { id: 'internal',          name: 'Internal',           productTypes: ['G-Spot Vibrator', 'Rabbit Vibrator'] },
      { id: 'couples',           name: 'Couples',            productTypes: ['Couples Vibrator', 'Couples Toy'] },
    ],
  },
  {
    id: 'male_enhancement',
    name: 'Male & Enhancement',
    subGroups: [
      { id: 'strokers',              name: 'Strokers',              productTypes: ['Stroker'] },
      { id: 'cock_rings',            name: 'Cock Rings',            productTypes: ['Cock Ring'] },
      { id: 'pumps',                 name: 'Pumps',                 productTypes: ['Penis Pump', 'Enhancement Pump'] },
      { id: 'extenders_supplements', name: 'Extenders & Supplements', productTypes: ['Penis Extender', 'Enhancement Supplement'] },
    ],
  },
  {
    id: 'strapons_machines',
    name: 'Strap-Ons & Machines',
    subGroups: [
      { id: 'harnesses',    name: 'Harnesses',    productTypes: ['Strap-On Harness'] },
      { id: 'sex_machines', name: 'Sex Machines', productTypes: ['Sex Machine'] },
    ],
  },
  {
    id: 'lubes_topicals',
    name: 'Lubes & Topicals',
    subGroups: [
      { id: 'lubricants',          name: 'Lubricants',            productTypes: ['Lubricant'] },
      { id: 'arousal_performance', name: 'Arousal & Performance', productTypes: ['Arousal Gel', 'Desensitizer', 'Oral Enhancer', 'Enhancer'] },
      { id: 'oils_fragrance',      name: 'Oils & Fragrance',      productTypes: ['Massage Oil', 'Pheromone Fragrance'] },
    ],
  },
  {
    id: 'bondage_fetish',
    name: 'Bondage & Fetish',
    subGroups: [
      { id: 'restraints_collars', name: 'Restraints & Collars', productTypes: ['Restraints', 'Collar'] },
      { id: 'impact_sensory',     name: 'Impact & Sensory',     productTypes: ['Paddle', 'Gag', 'Blindfold'] },
      { id: 'fetish_wear',        name: 'Fetish Wear',          productTypes: ['Fetish Wear'] },
    ],
  },
  {
    id: 'apparel_lingerie',
    name: 'Apparel & Lingerie',
    subGroups: [
      { id: 'lingerie', name: 'Lingerie', productTypes: ['Lingerie Set', 'Bodysuit', 'Bra & Panty Set', 'Apparel'] },
      { id: 'hosiery',  name: 'Hosiery',  productTypes: ['Hosiery'] },
      { id: 'mens',     name: "Men's",    productTypes: ["Men's Underwear"] },
    ],
  },
  {
    id: 'accessories_care_novelty',
    name: 'Accessories, Care & Novelty',
    subGroups: [
      { id: 'stimulators',   name: 'Stimulators',     productTypes: ['Nipple Toy', 'Kegel Exerciser'] },
      { id: 'hygiene_care',  name: 'Hygiene & Care',  productTypes: ['Toy Cleaner', 'Intimate Hygiene', 'Body Care'] },
      { id: 'protection',    name: 'Protection',      productTypes: ['Condom'] },
      { id: 'novelty_games', name: 'Novelty & Games', productTypes: ['Adult Game', 'Novelty Gift'] },
      { id: 'gift_card',     name: 'Gift Card',       productTypes: ['Gift Card'] },
      { id: 'other_accessory', name: 'Other',         productTypes: ['Accessory'] },
    ],
  },
  {
    id: 'discontinued',
    name: 'Discontinued',
    usesClearanceLadder: true,
    subGroups: [
      { id: 'discontinued', name: 'Discontinued', productTypes: ['Discontinued'] },
    ],
  },
]

// Group-level pricing starting values (spec ss3.3).
// target_margin_pct: null for discontinued (uses clearance ladder).
type GroupRule = {
  targetMarginPct: number | null
  marginFloorPct: number
  mapBehavior: string
}

const GROUP_RULES: Record<string, GroupRule> = {
  insertable_toys:          { targetMarginPct: 0.52, marginFloorPct: 0.30, mapBehavior: 'at_map' },
  vibrators:                { targetMarginPct: 0.52, marginFloorPct: 0.30, mapBehavior: 'at_map' },
  male_enhancement:         { targetMarginPct: 0.50, marginFloorPct: 0.28, mapBehavior: 'at_map' },
  strapons_machines:        { targetMarginPct: 0.50, marginFloorPct: 0.28, mapBehavior: 'at_map' },
  lubes_topicals:           { targetMarginPct: 0.45, marginFloorPct: 0.22, mapBehavior: 'at_map' },
  bondage_fetish:           { targetMarginPct: 0.55, marginFloorPct: 0.30, mapBehavior: 'at_map' },
  apparel_lingerie:         { targetMarginPct: 0.55, marginFloorPct: 0.30, mapBehavior: 'at_map' },
  accessories_care_novelty: { targetMarginPct: 0.50, marginFloorPct: 0.25, mapBehavior: 'at_map' },
  discontinued:             { targetMarginPct: null,  marginFloorPct: 0.15, mapBehavior: 'ignore_map' },
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Seeding pricing groups...')

  // 1. Global default rule
  await sql`
    INSERT INTO pricing_rules
      (scope_level, scope_id, target_margin_pct, margin_floor_pct,
       map_behavior, compare_at_strategy, velocity_modifier_enabled)
    VALUES
      ('global', 'global', 0.50, 0.25, 'at_map', 'msrp', false)
    ON CONFLICT DO NOTHING
  `
  console.log('  ✓ global rule')

  // 2. Groups
  for (let gi = 0; gi < GROUPS.length; gi++) {
    const g = GROUPS[gi]!
    await sql`
      INSERT INTO pricing_groups (id, name, uses_clearance_ladder, sort_order)
      VALUES (${g.id}, ${g.name}, ${g.usesClearanceLadder ?? false}, ${gi})
      ON CONFLICT DO NOTHING
    `

    // 3. Group-level pricing rule
    const gr = GROUP_RULES[g.id]!
    await sql`
      INSERT INTO pricing_rules
        (scope_level, scope_id, target_margin_pct, margin_floor_pct,
         map_behavior, compare_at_strategy, velocity_modifier_enabled)
      VALUES (
        'group',
        ${g.id},
        ${gr.targetMarginPct},
        ${gr.marginFloorPct},
        ${gr.mapBehavior},
        'msrp',
        false
      )
      ON CONFLICT DO NOTHING
    `

    // 4. Sub-groups
    for (let si = 0; si < g.subGroups.length; si++) {
      const sg = g.subGroups[si]!
      await sql`
        INSERT INTO pricing_sub_groups (id, group_id, name, sort_order)
        VALUES (${sg.id}, ${g.id}, ${sg.name}, ${si})
        ON CONFLICT DO NOTHING
      `

      // 5. Product type mappings
      for (const pt of sg.productTypes) {
        await sql`
          INSERT INTO pricing_product_type_map (product_type, sub_group_id)
          VALUES (${pt}, ${sg.id})
          ON CONFLICT DO NOTHING
        `
      }
    }

    console.log(`  ✓ ${g.name} (${g.subGroups.length} sub-groups)`)
  }

  console.log('\nDone.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

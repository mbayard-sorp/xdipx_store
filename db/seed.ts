/**
 * Dev seed — creates placeholder deal history rows.
 * Run with: npm run db:seed
 * Allows full UI development without live Shopify or Nalpac connections.
 */
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'
import 'dotenv/config'

const sql = neon(process.env['DATABASE_URL']!)
const db  = drizzle(sql, { schema })

const today = new Date()
function dateOffset(days: number): string {
  const d = new Date(today)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]!
}

async function seed() {
  console.log('Seeding database...')

  // ToS version
  await db.insert(schema.tosVersions).values({
    version:          '1.0',
    publishedAt:      new Date(),
    summaryOfChanges: 'Initial version',
    fullTextUrl:      'https://xdipx.com/terms',
  }).onConflictDoNothing()

  // Deal history — past 7 days archived + today live + 2 upcoming
  const deals = [
    {
      sku: 'SEED-001', seoTitle: 'Premium Wand Massager Pro', brand: 'WellnessWorks',
      categories: ['Wands'], dealDate: dateOffset(-6),
      wholesaleCost: '18.50', dealPrice: '39.99', msrp: '79.99', mapPrice: '0',
      unitsAvailable: 150, unitsSold: 42, totalRevenue: '1679.58', totalProfit: '895.38',
      dealScore: '0.845', sortOrder: 1, status: 'queued',
      shopifyProductId: null,
    },
    {
      sku: 'SEED-002', seoTitle: 'Dual-Action Rabbit Vibrator Rose', brand: 'PureBliss',
      categories: ['Dual Action and Rabbits'], dealDate: dateOffset(-5),
      wholesaleCost: '24.00', dealPrice: '49.99', msrp: '99.99', mapPrice: '49.99',
      unitsAvailable: 200, unitsSold: 61, totalRevenue: '3049.39', totalProfit: '1585.39',
      dealScore: '0.812', sortOrder: 2, status: 'queued',
      shopifyProductId: null,
    },
    {
      sku: 'SEED-003', seoTitle: 'System JO Refresh Foaming Toy Cleaner', brand: 'System JO',
      categories: ['Toy Cleaners'], dealDate: dateOffset(-4),
      wholesaleCost: '5.80', dealPrice: '14.99', msrp: '22.99', mapPrice: '0',
      unitsAvailable: 500, unitsSold: 87, totalRevenue: '1304.13', totalProfit: '790.53',
      dealScore: '0.791', sortOrder: 3, status: 'queued',
      shopifyProductId: null,
    },
    {
      sku: 'SEED-004', seoTitle: 'Air Pulse Clitoral Stimulator Pearl', brand: 'SensaTouch',
      categories: ['Air Pulse and Suction'], dealDate: dateOffset(-3),
      wholesaleCost: '28.00', dealPrice: '59.99', msrp: '119.99', mapPrice: '59.99',
      unitsAvailable: 180, unitsSold: 54, totalRevenue: '3239.46', totalProfit: '1727.46',
      dealScore: '0.867', sortOrder: 4, status: 'queued',
      shopifyProductId: null,
    },
    {
      sku: 'SEED-005', seoTitle: 'Couples Wearable Vibrator Teal', brand: 'TogetherTech',
      categories: ['Couples and Wearable'], dealDate: dateOffset(-2),
      wholesaleCost: '32.00', dealPrice: '69.99', msrp: '129.99', mapPrice: '69.99',
      unitsAvailable: 120, unitsSold: 38, totalRevenue: '2659.62', totalProfit: '1443.62',
      dealScore: '0.823', sortOrder: 5, status: 'queued',
      shopifyProductId: null,
    },
    {
      sku: 'SEED-006', seoTitle: 'Prostate Massager Curved Silicone', brand: 'ForHimPro',
      categories: ['Prostate Toys'], dealDate: dateOffset(-1),
      wholesaleCost: '21.00', dealPrice: '44.99', msrp: '89.99', mapPrice: '0',
      unitsAvailable: 95, unitsSold: 29, totalRevenue: '1304.71', totalProfit: '693.71',
      dealScore: '0.798', sortOrder: 6, status: 'queued',
      shopifyProductId: null,
    },
    {
      sku: 'SEED-007', seoTitle: 'Magic Wand Rechargeable Classic', brand: 'BodyWand',
      categories: ['Wands'], dealDate: dateOffset(0),
      wholesaleCost: '38.00', dealPrice: '79.99', msrp: '149.99', mapPrice: '79.99',
      unitsAvailable: 241, unitsSold: 0, totalRevenue: '0', totalProfit: '0',
      dealScore: '0.892', sortOrder: 0, status: 'live',
      shopifyProductId: null,
    },
    {
      sku: 'SEED-008', seoTitle: 'Bullet Vibrator 10-Speed Waterproof', brand: 'PureBliss',
      categories: ['Bullets and Eggs'], dealDate: dateOffset(1),
      wholesaleCost: '9.50', dealPrice: '24.99', msrp: '49.99', mapPrice: '0',
      unitsAvailable: 320, unitsSold: 0, totalRevenue: '0', totalProfit: '0',
      dealScore: '0.834', sortOrder: 7, status: 'queued',
      shopifyProductId: null,
    },
    {
      sku: 'SEED-009', seoTitle: 'Remote Control Panty Vibrator Black', brand: 'TogetherTech',
      categories: ['Remote', 'Couples and Wearable'], dealDate: dateOffset(2),
      wholesaleCost: '26.00', dealPrice: '54.99', msrp: '109.99', mapPrice: '54.99',
      unitsAvailable: 155, unitsSold: 0, totalRevenue: '0', totalProfit: '0',
      dealScore: '0.811', sortOrder: 8, status: 'queued',
      shopifyProductId: null,
    },
  ]

  for (const deal of deals) {
    await db.insert(schema.dealHistory).values(deal).onConflictDoNothing()
    console.log(`  ✓ ${deal.status.padEnd(8)} ${deal.seoTitle}`)
  }

  // Daily profit summary for past 7 days
  for (let i = 6; i >= 1; i--) {
    const d = deals[6 - i]
    if (!d || d.unitsSold === 0) continue
    await db.insert(schema.dailyProfitSummary).values({
      summaryDate:   dateOffset(-i),
      totalOrders:   d.unitsSold,
      totalRevenue:  d.totalRevenue,
      totalCogs:     (parseFloat(d.wholesaleCost) * d.unitsSold).toFixed(2),
      totalProfit:   d.totalProfit,
      avgOrderValue: (parseFloat(d.totalRevenue) / d.unitsSold).toFixed(2),
      featuredSku:   d.sku,
    }).onConflictDoNothing()
  }

  console.log('\n✅ Seed complete.')
}

seed().catch(err => { console.error(err); process.exit(1) })

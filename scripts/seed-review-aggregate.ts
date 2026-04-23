// One-off: seed a review_aggregates row so the PDP brand line's stars render for verification.
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env['DATABASE_URL']!)

const PRODUCT_GID = process.argv[2] ?? 'gid://shopify/Product/8741193187499'
const AVG = parseFloat(process.argv[3] ?? '4.6')
const COUNT = parseInt(process.argv[4] ?? '27', 10)

await sql`
  INSERT INTO review_aggregates (
    shopify_product_id, total_count, approved_count, average_rating,
    rating_1_count, rating_2_count, rating_3_count, rating_4_count, rating_5_count,
    verified_count, with_photo_count, last_updated
  ) VALUES (
    ${PRODUCT_GID}, ${COUNT}, ${COUNT}, ${AVG},
    0, 1, 2, 8, ${COUNT - 11},
    ${COUNT - 5}, 3, NOW()
  )
  ON CONFLICT (shopify_product_id) DO UPDATE SET
    total_count = EXCLUDED.total_count,
    approved_count = EXCLUDED.approved_count,
    average_rating = EXCLUDED.average_rating,
    last_updated = NOW()
`
console.log(`Seeded aggregate for ${PRODUCT_GID}: ${AVG}★ (${COUNT})`)
process.exit(0)

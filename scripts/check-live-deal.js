import 'dotenv/config';
import { db } from '../app/lib/db.server.ts';
import { dealHistory } from '../db/schema.ts';
import { eq } from 'drizzle-orm';
import { getDealByShopifyId } from '../app/lib/shopify.server.ts';
const [liveDeal] = await db
    .select()
    .from(dealHistory)
    .where(eq(dealHistory.status, 'live'))
    .limit(1);
console.log('DB live deal row:', liveDeal ?? 'none');
if (liveDeal?.shopifyProductId) {
    const deal = await getDealByShopifyId(liveDeal.shopifyProductId);
    console.log('\nShopify product:');
    console.log('  Title:     ', deal?.seoTitle);
    console.log('  Status:    ', deal?.dealStatus);
    console.log('  Deal date: ', deal?.dealDate);
    console.log('  Images:    ', deal?.images.length);
}

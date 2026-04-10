/**
 * Test script — runs the full video generation pipeline against the current live deal.
 * Usage: npx tsx scripts/test-video-generation.ts
 */
import 'dotenv/config';
import { getDailyDeal } from '../app/lib/shopify.server.ts';
import { generateProductVideo } from '../app/lib/video-generator.server.ts';
async function main() {
    console.log('=== xdipx Video Generation Test ===\n');
    // 1. Fetch the current live deal
    console.log('Fetching current live deal from Shopify...');
    const deal = await getDailyDeal();
    if (!deal) {
        console.error('No live deal found. Make sure a product has deal_status=live in Shopify.');
        process.exit(1);
    }
    console.log(`\nLive deal: ${deal.seoTitle}`);
    console.log(`Brand: ${deal.brand}`);
    console.log(`Category: ${deal.category}`);
    console.log(`Price: $${deal.dealPrice} (was $${deal.msrp})`);
    console.log(`Images: ${deal.images.length}`);
    console.log(`Shopify ID: ${deal.shopifyProductId}`);
    console.log(`Tagline: ${deal.tagline}`);
    console.log();
    if (deal.images.length < 1) {
        console.error('Deal has no images — cannot render video.');
        process.exit(1);
    }
    // 2. Run the pipeline
    console.log('Starting video generation pipeline...\n');
    const result = await generateProductVideo({
        productId: deal.shopifyProductId,
        productName: deal.seoTitle,
        oneLiner: deal.tagline || `${deal.brand}'s best deal today.`,
        imageUrls: deal.images.map(img => img.url),
        category: deal.category,
        brand: deal.brand,
        tagline: deal.tagline,
        dealPrice: deal.dealPrice,
        msrp: deal.msrp,
    });
    console.log('\n=== RESULT ===');
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'complete') {
        console.log('\n✓ Video generation complete.');
        console.log(`  Media ID: ${result.shopify_media_asset_id}`);
        console.log(`  Thumbnail set — home: ${result.thumbnail_set.home_page}, pdp: ${result.thumbnail_set.pdp}`);
    }
    else if (result.status === 'review_pause') {
        console.log('\n⏸  VIDEO_REVIEW_MODE=true. Set it to false to continue with render.');
    }
}
main().catch(err => {
    console.error('\nFATAL:', err);
    process.exit(1);
});

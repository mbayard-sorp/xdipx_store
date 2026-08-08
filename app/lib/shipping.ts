/**
 * Shipping constants shared by client and server code.
 *
 * Plain module (no .server suffix) because the cart drawer, a client
 * component, needs the threshold to render its free-shipping progress bar.
 *
 * Source of truth is the Shopify delivery profile. Verified 2026-07-27:
 *   - US Standard ships free at TOTAL_PRICE >= $99.00
 *   - HI / AK / PR ship free at $145.00
 *   - base US rate is $9.99
 *
 * Any on-site copy that advertises a different threshold over-promises and
 * gets contradicted at checkout, so interpolate this constant instead of
 * hardcoding a dollar figure in marketing strings.
 *
 * COUPLING GUARD (ticket #715): this constant MUST equal the live Shopify
 * US-Standard free-shipping TOTAL_PRICE condition. Nothing in CI, tests, QA,
 * or the release engine reads Shopify, so a code edit here can silently
 * over-promise free shipping that checkout will not honor (this is why R-DEV
 * had to block ticket #420, which wanted 50 while Shopify still free-ships at
 * 99). To stop a silent code-side drift, `shipping.test.ts` pins this value
 * against the documented Shopify condition: changing it fails the test with a
 * message telling you to update the Shopify delivery profile in the same
 * change, then update the pin. If you change one, change all three: this
 * constant, the Shopify rule, and the test. (The test can only catch a
 * code-side edit; catching a Shopify-side change too needs a runtime cron
 * assertion, which requires a vercel.json cron entry and is out of the dev
 * lane's scope.)
 */
export const FREE_SHIPPING_THRESHOLD = 99

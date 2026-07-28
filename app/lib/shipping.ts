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
 */
export const FREE_SHIPPING_THRESHOLD = 99

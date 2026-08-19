/**
 * Shipping constants shared by client and server code.
 *
 * Plain module (no .server suffix) because the cart drawer, a client
 * component, needs the threshold to render its free-shipping progress bar.
 *
 * Source of truth is the Shopify delivery profile.
 *
 * !!! TICKET #3450 (2026-08-19): CODE-SIDE ONLY. SHOPIFY NOT YET UPDATED !!!
 * This constant was moved to 59 as the code half of ticket #3450 (lower US
 * free-shipping threshold $99 -> $59, a CVR move, see the ticket for the
 * modeling). Read live via the Shopify Admin GraphQL API on 2026-08-19
 * (gid://shopify/DeliveryProfile/103413973163, zone Domestic, method
 * gid://shopify/DeliveryMethodDefinition/818015142059): the US-Standard
 * delivery profile's TOTAL_PRICE rate-range condition was STILL 99.0, not 59.
 * Changing the Shopify rate rule is an owner-gated checkout money-path
 * mutation (docs/store-team/operating-system.md §7) that no agent may make.
 * UNTIL AN OWNER CHANGES THE SHOPIFY US-STANDARD FREE-SHIPPING CONDITION TO
 * 59.0, MERGING/DEPLOYING THIS CONSTANT ALONE MEANS THE STOREFRONT (cart
 * drawer progress bar, collection/PLP copy, trust strip) ADVERTISES FREE
 * SHIPPING AT $59 THAT CHECKOUT WILL NOT HONOR for a $59.00-$98.99 order —
 * a customer-facing lie, the same failure mode that blocked ticket #420.
 * This PR and the Shopify change must land together; see the PR description
 * for the required manual owner step.
 *
 * Other prior-threshold values, for reference:
 *   - HI / AK / PR ship free at $145.00 (unchanged by ticket #3450)
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
export const FREE_SHIPPING_THRESHOLD = 59

/**
 * scripts/smoke-sms-phase2-checkout.ts
 *
 * Phase 2 smoke test — calls executeCheckoutStage() directly in-process.
 * The dispatcher is NOT wired yet (orchestrator does that at integration time).
 *
 * Run with:
 *   set -a; source .env.local; set +a; npx tsx scripts/smoke-sms-phase2-checkout.ts
 *
 * Scenarios:
 *   1. UPSELL_ACCEPT  — both handles set → 1 segment, checkout URL, stateWrites correct
 *   2. UPSELL_DECLINE — pitch handle only → 1 item cart, URL valid, stateWrites correct
 *   3. COMMIT_PICK    — pitch handle only → same behavior as UPSELL_DECLINE
 *   4. Missing pitch  — currentPitchHandle=null → DISCOVERY fallback, no cart
 *   5. 50-iteration   — scenario 1 repeated 50x with real handles, assert 100% produce Shopify URL
 */
import 'dotenv/config'
import { executeCheckoutStage } from '../app/lib/sms-v2/stages/checkout.server'
import { getProductByHandle } from '../app/lib/shopify.server'
import type { EmmaContext, IntentResult, Stage } from '../app/lib/sms-v2/types.server'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

function assertLoose(cond: boolean, msg: string): void {
  if (!cond) {
    console.warn(`  ⚠  ${msg}`)
  } else {
    console.log(`  ✓ ${msg}`)
  }
}

/** Regex matching a real Shopify checkout URL. */
const SHOPIFY_URL_RE = /https?:\/\/[\w-]+(?:\.myshopify\.com|xdipx\.com)\/(?:cart\/|checkouts?\/)\S+/i

function looksReal(url: string): boolean {
  return SHOPIFY_URL_RE.test(url)
}

/** Minimal EmmaContext stub that bypasses buildEmmaContext (stubby in Phase 1). */
function makeCtx(opts: {
  pitchHandle: string | null
  upsellHandle?: string | null
  stage?: Stage
}): EmmaContext {
  return {
    conversation: {
      phone: '+15550000001',
      conversationId: 'test-conv-id-phase2',
      stage: opts.stage ?? 'CHECKOUT',
      currentPitchHandle:  opts.pitchHandle,
      currentUpsellHandle: opts.upsellHandle ?? null,
      lastQuoteUrl: null,
    },
  }
}

function makeIntent(intent: IntentResult['intent'], confidence = 0.95): IntentResult {
  return { intent, confidence, source: 'regex' }
}

// ---------------------------------------------------------------------------
// Resolve two real product handles from Shopify Storefront API.
// We use getProductByHandle on handles that are likely to exist based on
// the store's product catalog. Fall back to a simple DB query if none found.
//
// If Shopify env vars aren't set, these calls fail fast with a clear error.
// ---------------------------------------------------------------------------

async function resolveRealHandles(): Promise<{ pitchHandle: string; upsellHandle: string }> {
  // Use the Shopify Admin REST API to list published products. This is more
  // reliable than the Storefront tag-search + cursor approach for a smoke test.
  // We need SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN.
  const domain     = process.env['SHOPIFY_STORE_DOMAIN']
  const adminToken = process.env['SHOPIFY_ADMIN_ACCESS_TOKEN']
  if (!domain || !adminToken) {
    throw new Error(
      `smoke-phase2: SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN must be set in .env.local`,
    )
  }

  interface RestVariant { inventory_quantity: number }
  interface RestProduct { handle: string; status: string; variants: RestVariant[] }
  interface RestResponse { products: RestProduct[] }

  const res = await fetch(
    `https://${domain}/admin/api/2024-10/products.json?status=active&published_status=published&limit=20&fields=handle,status,variants`,
    {
      headers: {
        'X-Shopify-Access-Token': adminToken,
        'Content-Type': 'application/json',
      },
    },
  )
  if (!res.ok) {
    throw new Error(`smoke-phase2: Admin products list failed: ${res.status} ${await res.text()}`)
  }
  const { products } = await res.json() as RestResponse

  // Find products where at least one variant has inventory > 0
  const inStock = products.filter(
    (p) => p.status === 'active' && p.variants.some((v) => v.inventory_quantity > 0),
  )

  if (inStock.length < 2) {
    throw new Error(
      `smoke-phase2: need at least 2 in-stock products — found ${inStock.length}. ` +
      `Ensure the Shopify store has active published products with inventory.`,
    )
  }

  return {
    pitchHandle:  inStock[0]!.handle,
    upsellHandle: inStock[1]!.handle,
  }
}

// ---------------------------------------------------------------------------
// Scenario 1: UPSELL_ACCEPT — both handles set
// ---------------------------------------------------------------------------

async function scenario1(pitchHandle: string, upsellHandle: string): Promise<void> {
  console.log('\n── Scenario 1: UPSELL_ACCEPT (both handles) ──')
  const ctx    = makeCtx({ pitchHandle, upsellHandle })
  const intent = makeIntent('UPSELL_ACCEPT')
  const result = await executeCheckoutStage(ctx, intent, '')

  assert(result.stageOut === 'POST_CHECKOUT', `stageOut = 'POST_CHECKOUT' (got '${result.stageOut}')`)
  assert(result.goalAchieved === true, 'goalAchieved = true')
  assert(result.segments.length === 1, `1 segment (got ${result.segments.length})`)
  assert(!!result.segments[0]!.prose, 'segment has prose')
  assert(result.segments[0]!.cta?.kind === 'checkout', `cta.kind = 'checkout'`)
  const url = result.segments[0]!.cta?.url ?? ''
  assert(looksReal(url), `cta.url is a real Shopify URL: ${url}`)
  assert(result.stateWrites.lastQuoteUrl === url, `stateWrites.lastQuoteUrl = cart URL`)
  assert(Array.isArray(result.stateWrites.lastQuoteItems), 'stateWrites.lastQuoteItems is array')
  assert((result.stateWrites.lastQuoteItems as unknown[]).length === 2, 'cart has 2 items')
  assert(result.stateWrites.currentPitchHandle === null, 'currentPitchHandle wiped')
  assert(result.stateWrites.currentUpsellHandle === null, 'currentUpsellHandle wiped')
  assert(result.stateWrites.stage === 'POST_CHECKOUT', `stateWrites.stage = 'POST_CHECKOUT'`)
  assert(result.stateWrites.lastQuoteCreatedAt instanceof Date, 'lastQuoteCreatedAt is a Date')
  assert(result.telemetry.intent === 'UPSELL_ACCEPT', 'telemetry.intent correct')
  console.log(`  url: ${url.slice(0, 80)}…`)
}

// ---------------------------------------------------------------------------
// Scenario 2: UPSELL_DECLINE — pitch handle only
// ---------------------------------------------------------------------------

async function scenario2(pitchHandle: string): Promise<void> {
  console.log('\n── Scenario 2: UPSELL_DECLINE (pitch handle only) ──')
  const ctx    = makeCtx({ pitchHandle, upsellHandle: null })
  const intent = makeIntent('UPSELL_DECLINE')
  const result = await executeCheckoutStage(ctx, intent, '')

  assert(result.stageOut === 'POST_CHECKOUT', `stageOut = 'POST_CHECKOUT'`)
  assert(result.goalAchieved === true, 'goalAchieved = true')
  assert(result.segments.length === 1, '1 segment')
  const url = result.segments[0]!.cta?.url ?? ''
  assert(looksReal(url), `cta.url is real: ${url}`)
  assert((result.stateWrites.lastQuoteItems as unknown[]).length === 1, 'cart has 1 item')
  assert(result.stateWrites.currentPitchHandle === null, 'currentPitchHandle wiped')
  assert(result.telemetry.intent === 'UPSELL_DECLINE', 'telemetry.intent correct')
  console.log(`  url: ${url.slice(0, 80)}…`)
}

// ---------------------------------------------------------------------------
// Scenario 3: COMMIT_PICK — pitch handle only
// ---------------------------------------------------------------------------

async function scenario3(pitchHandle: string): Promise<void> {
  console.log('\n── Scenario 3: COMMIT_PICK (pitch handle only) ──')
  const ctx    = makeCtx({ pitchHandle, upsellHandle: null })
  const intent = makeIntent('COMMIT_PICK')
  const result = await executeCheckoutStage(ctx, intent, '')

  assert(result.stageOut === 'POST_CHECKOUT', `stageOut = 'POST_CHECKOUT'`)
  assert(result.goalAchieved === true, 'goalAchieved = true')
  const url = result.segments[0]!.cta?.url ?? ''
  assert(looksReal(url), `cta.url is real: ${url}`)
  assert((result.stateWrites.lastQuoteItems as unknown[]).length === 1, 'cart has 1 item')
  assert(result.telemetry.intent === 'COMMIT_PICK', 'telemetry.intent correct')
  console.log(`  url: ${url.slice(0, 80)}…`)
}

// ---------------------------------------------------------------------------
// Scenario 4: Missing pitch handle → DISCOVERY fallback
// ---------------------------------------------------------------------------

async function scenario4(): Promise<void> {
  console.log('\n── Scenario 4: Missing pitch handle → DISCOVERY fallback ──')
  const ctx    = makeCtx({ pitchHandle: null })
  const intent = makeIntent('COMMIT_PICK')
  const result = await executeCheckoutStage(ctx, intent, '')

  assert(result.stageOut === 'DISCOVERY', `stageOut = 'DISCOVERY' (got '${result.stageOut}')`)
  assert(result.goalAchieved === false, 'goalAchieved = false')
  assert(result.segments.length === 1, '1 fallback segment')
  assert(!result.segments[0]!.cta, 'no CTA on fallback segment')
  assert(result.stateWrites.stage === 'DISCOVERY', "stateWrites.stage = 'DISCOVERY'")
  // Verify no lastQuoteUrl set
  assert(result.stateWrites.lastQuoteUrl === undefined, 'no lastQuoteUrl on fallback')
  console.log(`  prose: "${result.segments[0]!.prose}"`)
}

// ---------------------------------------------------------------------------
// Scenario 5: 50-iteration stress test — 100% must produce real Shopify URLs
// ---------------------------------------------------------------------------

async function scenario5(pitchHandle: string, upsellHandle: string): Promise<void> {
  console.log('\n── Scenario 5: 50-iteration UPSELL_ACCEPT (fabrication guard) ──')
  console.log(`  pitchHandle  : ${pitchHandle}`)
  console.log(`  upsellHandle : ${upsellHandle}`)

  let realUrls = 0
  const errors: string[] = []

  for (let i = 0; i < 50; i++) {
    try {
      const ctx    = makeCtx({ pitchHandle, upsellHandle })
      const intent = makeIntent('UPSELL_ACCEPT')
      const result = await executeCheckoutStage(ctx, intent, '')
      const url    = result.segments[0]!.cta?.url ?? ''
      if (looksReal(url)) {
        realUrls++
      } else {
        errors.push(`iter ${i}: suspicious url: ${url}`)
      }
    } catch (err) {
      errors.push(`iter ${i}: threw: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.log(`  Real Shopify URLs: ${realUrls}/50`)
  if (errors.length > 0) {
    console.log(`  Errors:`)
    for (const e of errors) console.log(`    ${e}`)
  }

  assert(realUrls === 50, `50/50 iterations produced a real Shopify checkout URL (got ${realUrls}/50)`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\nPhase 2 SMS smoke test — CHECKOUT stage')
  console.log('=========================================')

  // Resolve two real in-stock handles from Shopify (used for carts)
  console.log('\nResolving real product handles from Shopify…')
  const { pitchHandle, upsellHandle } = await resolveRealHandles()
  console.log(`  pitchHandle  : ${pitchHandle}`)
  console.log(`  upsellHandle : ${upsellHandle}`)

  await scenario1(pitchHandle, upsellHandle)
  await scenario2(pitchHandle)
  await scenario3(pitchHandle)
  await scenario4()
  await scenario5(pitchHandle, upsellHandle)

  console.log('\n✓ All Phase 2 smoke tests passed.\n')
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error('\n✗', err instanceof Error ? err.message : String(err))
    if (err instanceof Error && err.stack) console.error(err.stack)
    process.exit(1)
  },
)

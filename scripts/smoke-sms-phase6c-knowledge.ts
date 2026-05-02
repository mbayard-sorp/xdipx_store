/**
 * smoke-sms-phase6c-knowledge.ts
 *
 * Phase 6c smoke test — 7 scenarios for the kbLookup knowledge-base tool.
 * Run in-process: npx tsx scripts/smoke-sms-phase6c-knowledge.ts
 */

// Load env BEFORE any module imports that read process.env at import time.
// Use dotenv/config (sync, side-effect import) so env is injected before
// the @sanity/client reads SANITY_PROJECT_ID during createClient().
import 'dotenv/config'

import { kbLookup, _resetKbLookupCache } from '../app/lib/sms-v2/tools/kb-lookup.server.js'

// ─── Test harness ─────────────────────────────────────────────────────────

let passed = 0
let failed = 0
const results: { name: string; ok: boolean; detail: string }[] = []

function assert(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++
    results.push({ name, ok: true, detail })
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    results.push({ name, ok: false, detail })
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// ─── Scenarios ────────────────────────────────────────────────────────────

async function runScenarios() {
  // 1. Shipping lookup
  {
    _resetKbLookupCache()
    const result = await kbLookup({ topic: 'shipping' })
    assert(
      '1. Shipping lookup returns non-null KbResult with non-empty quickAnswer',
      result !== null && typeof result.quickAnswer === 'string' && result.quickAnswer.length > 0,
      result ? `quickAnswer="${result.quickAnswer.slice(0, 60)}..."` : 'returned null',
    )
  }

  // 2. Returns lookup
  {
    _resetKbLookupCache()
    const result = await kbLookup({ topic: 'returns' })
    assert(
      '2. Returns lookup returns non-null KbResult with non-empty quickAnswer',
      result !== null && typeof result.quickAnswer === 'string' && result.quickAnswer.length > 0,
      result ? `quickAnswer="${result.quickAnswer.slice(0, 60)}..."` : 'returned null',
    )
  }

  // 3. Compatibility hit — silicone-toy + silicone-lube
  {
    _resetKbLookupCache()
    const result = await kbLookup({
      topic: 'compatibility',
      productCategory: 'silicone-toy',
      query: 'silicone lube',
    })
    assert(
      '3. Compatibility hit: silicone-toy + silicone-lube returns incompatibility rule',
      result !== null &&
        typeof result.quickAnswer === 'string' &&
        result.quickAnswer.length > 0 &&
        // The rule is incompatible — answer should mention not using or degrading
        (result.quickAnswer.toLowerCase().includes('silicone') ||
          result.quickAnswer.toLowerCase().includes('not') ||
          result.quickAnswer.toLowerCase().includes('do not')),
      result ? `quickAnswer="${result.quickAnswer.slice(0, 80)}"` : 'returned null',
    )
  }

  // 4. Compatibility miss — unknown category returns null without throwing
  {
    _resetKbLookupCache()
    let threw = false
    let result: Awaited<ReturnType<typeof kbLookup>> = null
    try {
      result = await kbLookup({
        topic: 'compatibility',
        productCategory: 'completely-unknown-category-xyz',
        query: 'mystery material',
      })
    } catch {
      threw = true
    }
    assert(
      '4. Compatibility miss: unknown category returns null without throwing',
      !threw && result === null,
      threw ? 'threw an error' : `result=${JSON.stringify(result)}`,
    )
  }

  // 5. Troubleshooting — "won't charge" matches charge-related entry
  {
    _resetKbLookupCache()
    const result = await kbLookup({
      topic: 'troubleshooting',
      productCategory: 'air-pulsation',
      query: "won't charge",
    })
    assert(
      "5. Troubleshooting: \"won't charge\" matches charge-related entry",
      result !== null &&
        typeof result.quickAnswer === 'string' &&
        result.quickAnswer.length > 0 &&
        (result.sourceTitle.toLowerCase().includes('charge') ||
          result.quickAnswer.toLowerCase().includes('charg')),
      result ? `sourceTitle="${result.sourceTitle}"` : 'returned null',
    )
  }

  // 6. Brand FAQ — billing descriptor query returns XDIPX in answer
  {
    _resetKbLookupCache()
    const result = await kbLookup({
      topic: 'brand',
      query: 'credit card statement',
    })
    assert(
      '6. Brand FAQ — billing descriptor: answer contains XDIPX',
      result !== null &&
        typeof result.quickAnswer === 'string' &&
        result.quickAnswer.includes('XDIPX'),
      result ? `quickAnswer="${result.quickAnswer}"` : 'returned null',
    )
  }

  // 7. Sanity failure — simulate by clearing SANITY_PROJECT_ID temporarily
  // This exercises the null-return + warn path without needing ES module monkey-patching.
  {
    _resetKbLookupCache()

    const warnMessages: string[] = []
    const origWarn = console.warn
    console.warn = (...args: unknown[]) => {
      warnMessages.push(args.join(' '))
      origWarn(...args)
    }

    // Temporarily remove the project ID so getSanityClient() returns null
    const savedProjectId = process.env['SANITY_PROJECT_ID']
    delete process.env['SANITY_PROJECT_ID']

    let threw = false
    let result: Awaited<ReturnType<typeof kbLookup>> = null
    try {
      result = await kbLookup({ topic: 'shipping' })
    } catch {
      threw = true
    } finally {
      // Restore
      if (savedProjectId) process.env['SANITY_PROJECT_ID'] = savedProjectId
      console.warn = origWarn
      _resetKbLookupCache()
    }

    const warnedAboutFailure = warnMessages.some(
      (m) => m.includes('[kbLookup]') || m.includes('Sanity'),
    )

    assert(
      '7. Sanity failure: kbLookup returns null and emits a warning, does not throw',
      !threw && result === null && warnedAboutFailure,
      threw
        ? 'threw an error (should have caught)'
        : !warnedAboutFailure
          ? `did not emit a warning (warnings: ${warnMessages.join('; ')})`
          : 'ok',
    )
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────

async function main() {
  console.log('\nPhase 6c smoke — knowledge-base (kbLookup)\n')

  // Quick env check
  if (!process.env['SANITY_PROJECT_ID']) {
    console.error('ERROR: SANITY_PROJECT_ID not set. Run `bash scripts/setup-worktree.sh` first.')
    process.exit(1)
  }

  await runScenarios()

  console.log(`\n${'─'.repeat(55)}`)
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`)
  if (failed > 0) {
    console.error('\nFailed scenarios:')
    results.filter((r) => !r.ok).forEach((r) => console.error(`  - ${r.name}`))
    process.exit(1)
  } else {
    console.log('All scenarios passed.')
    process.exit(0)
  }
}

main().catch((err) => {
  console.error('Smoke test crashed:', err)
  process.exit(1)
})

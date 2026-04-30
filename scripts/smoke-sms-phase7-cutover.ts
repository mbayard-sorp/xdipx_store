/**
 * scripts/smoke-sms-phase7-cutover.ts
 *
 * Phase 7 cutover smoke test — verifies the SMS_PIPELINE_VERSION default
 * flipped from 'v1' to 'v2' and that the kill-switch + allowlist still
 * work as expected.
 *
 * Tests the pipeline-flag module directly (in-process). The HTTP path is
 * already covered by phase5.5-dispatcher and phase0; the cutover question
 * is purely about which version the routing logic picks.
 *
 * Scenarios:
 *   1. Default-v2: env unset → pickPipelineVersion returns 'v2'.
 *   2. Kill-switch: SMS_PIPELINE_VERSION='v1' → returns 'v1'.
 *   3. Allowlist override: SMS_PIPELINE_VERSION='v1' + phone in SMS_V2_PHONES → 'v2'.
 *   4. Coercion: garbage SMS_PIPELINE_VERSION → 'v2' (was 'v1' before cutover).
 *
 * Usage:
 *   set -a; source .env.local; set +a
 *   npx tsx scripts/smoke-sms-phase7-cutover.ts
 */
import 'dotenv/config'
import { pickPipelineVersion, __resetForTest } from '../app/lib/sms-v2/pipeline-flag.server'

const PHONE_TEST = '+15555550700'
const PHONE_OTHER = '+15555550701'

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`  ✗ FAIL: ${msg}`)
    throw new Error(`FAIL: ${msg}`)
  }
  console.log(`  ✓ ${msg}`)
}

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {}
  for (const k of Object.keys(env)) saved[k] = process.env[k]
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    __resetForTest()
    fn()
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    __resetForTest()
  }
}

function main(): void {
  console.log('Phase 7 cutover smoke — pipeline-flag default flipped to v2')
  console.log('============================================================')

  console.log('\n── Scenario 1: Default-v2 (env unset) ──')
  withEnv({ SMS_PIPELINE_VERSION: undefined, SMS_V2_PHONES: undefined }, () => {
    const v = pickPipelineVersion(PHONE_TEST)
    assert(v === 'v2', `pickPipelineVersion with no env returns 'v2' (got '${v}')`)
  })

  console.log('\n── Scenario 2: Kill-switch (SMS_PIPELINE_VERSION=v1) ──')
  withEnv({ SMS_PIPELINE_VERSION: 'v1', SMS_V2_PHONES: undefined }, () => {
    const v = pickPipelineVersion(PHONE_TEST)
    assert(v === 'v1', `kill-switch routes to 'v1' (got '${v}')`)
  })

  console.log('\n── Scenario 3: Allowlist overrides v1 kill-switch ──')
  withEnv({ SMS_PIPELINE_VERSION: 'v1', SMS_V2_PHONES: PHONE_TEST }, () => {
    const vAllowed = pickPipelineVersion(PHONE_TEST)
    const vOther = pickPipelineVersion(PHONE_OTHER)
    assert(vAllowed === 'v2', `allowlisted phone gets 'v2' even with kill-switch active (got '${vAllowed}')`)
    assert(vOther === 'v1', `non-allowlisted phone respects kill-switch (got '${vOther}')`)
  })

  console.log('\n── Scenario 4: Garbage env coerces to v2 ──')
  withEnv({ SMS_PIPELINE_VERSION: 'banana', SMS_V2_PHONES: undefined }, () => {
    const v = pickPipelineVersion(PHONE_TEST)
    assert(v === 'v2', `unrecognised SMS_PIPELINE_VERSION coerces to 'v2' (got '${v}')`)
  })

  console.log('\n✓ All Phase 7 cutover smoke scenarios passed.\n')
}

try {
  main()
  process.exit(0)
} catch {
  process.exit(1)
}

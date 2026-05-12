/**
 * Run the daily pricing agent from the CLI.
 *
 * Usage:
 *   pnpm tsx scripts/run-pricing-review.ts [--dry] [--apply] [--mode=all|guardrails|auto]
 *
 * Flags:
 *   --dry           Force dry-run (default unless --apply is passed)
 *   --apply         Apply prices that pass the approval-mode rules
 *   --mode=<mode>   Override approval mode (all|guardrails|auto)
 *
 * DATABASE_URL and other env vars are loaded from .env / .env.local via dotenv.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Load env files before any other imports.
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return
  const raw = readFileSync(path, 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 0) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = val
  }
}

const root = join(process.cwd())
loadEnvFile(join(root, '.env'))
loadEnvFile(join(root, '.env.local'))

import type { ApprovalMode } from '../app/lib/pricing-agent.server'

function parseArgs(): { dryRun: boolean; approvalMode: ApprovalMode | undefined } {
  const args = process.argv.slice(2)
  const hasDry   = args.includes('--dry')
  const hasApply = args.includes('--apply')
  const modeArg  = args.find((a) => a.startsWith('--mode='))
  const modeVal  = modeArg ? modeArg.slice('--mode='.length) : undefined

  let approvalMode: ApprovalMode | undefined
  if (modeVal === 'all' || modeVal === 'guardrails' || modeVal === 'auto') {
    approvalMode = modeVal
  } else if (modeVal !== undefined) {
    console.error(`Unknown --mode value: ${modeVal}. Use all, guardrails, or auto.`)
    process.exit(1)
  }

  // --apply wins over --dry; default is dry
  const dryRun = hasApply ? false : (hasDry ? true : true)

  return { dryRun, approvalMode }
}

async function main(): Promise<void> {
  if (!process.env['DATABASE_URL']) {
    console.error('DATABASE_URL is required. Run scripts/setup-worktree.sh to symlink .env files.')
    process.exit(1)
  }

  const { dryRun, approvalMode } = parseArgs()

  console.log(`Starting pricing review...`)
  console.log(`  dry-run: ${dryRun}`)
  console.log(`  mode: ${approvalMode ?? '(from pipeline_settings)'}`)
  console.log('')

  const { runDailyPriceReview } = await import('../app/lib/pricing-agent.server.js')

  const result = await runDailyPriceReview({
    source: 'cli',
    dryRun,
    approvalMode,
  })

  console.log(JSON.stringify(result, null, 2))
  console.log('')
  console.log(
    `scanned ${result.productsScanned} products / ${result.variantsScanned} variants` +
    ` | proposed ${result.changesProposed}` +
    ` | auto-applied ${result.changesAutoApplied}` +
    ` | pending ${result.changesPending}` +
    ` | failed ${result.changesFailed}`,
  )

  if (result.feedErrors.length > 0) {
    console.warn('\nFeed errors:')
    for (const e of result.feedErrors) console.warn(' ', e)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

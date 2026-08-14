/**
 * rails-fingerprint.ts
 *
 * The definition-of-done gate for homepage rail freshness. It reads the
 * currently-published homepage rails slate from Sanity and prints its
 * fingerprint, so the daily merchandiser (Routine A) can catch its own rails
 * no-op before the healthcheck files a `sameness:rails` ticket (#2080).
 *
 * Why a verifier and not a write-path guard: the merchandiser writes rails
 * DIRECTLY to Sanity (via the generic scripts/sanity-content-cli.ts / the Sanity
 * MCP), never through this repo's rail helpers, so no code sits in the write
 * path to intercept a stale republish. Verifying the published OUTCOME is the
 * only enforcement a code change can offer, and it matches the routine's
 * existing "fetch the live homepage and assert" done-state checks.
 *
 * Intended use in the routine:
 *   BASELINE=$(npx tsx scripts/rails-fingerprint.ts)                # Step 3, before touching rails
 *   ...do the merchandising run...
 *   npx tsx scripts/rails-fingerprint.ts --baseline "$BASELINE"     # Step 6 DOD; non-zero blocks done
 *
 * Modes:
 *   (default / capture)      print the current published rails fingerprint to stdout
 *   --baseline <fingerprint> compare current vs baseline; exit 1 if byte-identical
 *
 * Exit codes:
 *   0 — printed the fingerprint, or the slate is fresh vs the baseline
 *   1 — the slate is byte-identical to the baseline (or empty): a freshness miss
 *   2 — missing Sanity config, or the read failed
 */

import 'dotenv/config'
import { createClient } from '@sanity/client'
import { railsSlateFingerprint, evaluateRailsFreshness } from '../app/lib/rails-freshness'

const projectId = process.env['SANITY_PROJECT_ID']
const dataset = process.env['SANITY_DATASET'] ?? 'production'
const token =
  process.env['SANITY_API_TOKEN'] ?? process.env['SANITY_WRITE_TOKEN'] ?? process.env['SANITY_TOKEN']

if (!projectId || !token) {
  process.stderr.write(
    'ERROR: SANITY_PROJECT_ID and a Sanity token (SANITY_API_TOKEN / SANITY_WRITE_TOKEN / SANITY_TOKEN) ' +
      'are required. Run scripts/setup-worktree.sh first.\n',
  )
  process.exit(2)
}

const argv = process.argv.slice(2)
function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  const v = argv[i + 1]
  return v && !v.startsWith('--') ? v : undefined
}

interface RailRow {
  heading?: string | null
  status?: string | null
  active?: boolean | null
  target?: string | null
}

/**
 * Read the published homepage rail headings in render order. Dereferences the
 * `emmaCuratedRailRef` entries in `singleton.homepage.sections[]` and keeps the
 * ones that would actually render (a live, active, homepage-targeted rail),
 * approximating `buildHomeContentBlocks` closely enough to fingerprint what the
 * team published.
 */
async function readPublishedRailHeadings(): Promise<string[]> {
  const client = createClient({ projectId, dataset, apiVersion: '2024-10-01', useCdn: false, token })
  const rows = await client.fetch<RailRow[] | null>(
    `*[_id == "singleton.homepage"][0].sections[_type == "emmaCuratedRailRef"]->{heading, status, active, target}`,
  )
  return (rows ?? [])
    .filter((r) => r && r.status === 'live' && r.active !== false && r.target !== 'pdp')
    .map((r) => r.heading ?? '')
}

async function main(): Promise<number> {
  let headings: string[]
  try {
    headings = await readPublishedRailHeadings()
  } catch (err) {
    process.stderr.write(`ERROR: could not read the published homepage: ${(err as Error).message}\n`)
    return 2
  }

  const current = railsSlateFingerprint(headings)
  const baseline = flag('baseline')

  if (baseline === undefined) {
    // Capture mode: fingerprint to stdout, context to stderr.
    process.stdout.write(`${current}\n`)
    process.stderr.write(`captured rails fingerprint (${headings.length} wired rail(s)): "${current}"\n`)
    return 0
  }

  const verdict = evaluateRailsFreshness(baseline, current)
  process.stdout.write(`${JSON.stringify(verdict)}\n`)
  if (verdict.fresh) {
    process.stderr.write(`OK — ${verdict.reason}\n`)
    return 0
  }
  process.stderr.write(
    `FAIL — ${verdict.reason}\n  baseline: "${baseline}"\n  current : "${current}"\n` +
      'The rails slot did not change this run. Vary the wired rails before finishing.\n',
  )
  return 1
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`ERROR: ${(err as Error).message}\n`)
    process.exit(2)
  },
)

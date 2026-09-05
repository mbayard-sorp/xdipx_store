/**
 * Apply the hand-written SQL migrations (004–017) to the target Postgres.
 *
 * These are outside drizzle-kit's journal (drizzle only tracks 0000–0003),
 * so we run them manually. All files are idempotent (CREATE TABLE/INDEX
 * IF NOT EXISTS), so re-running is safe.
 *
 *   DATABASE_URL=postgres://... tsx scripts/apply-migrations.ts
 *   DATABASE_URL=... tsx scripts/apply-migrations.ts --from 013
 *
 * Ledger: every file this script successfully runs is recorded in
 * schema_migrations_applied (migration 081), the same ledger
 * scripts/apply-additive-migrations.ts writes at build time. Before this, a
 * MANUAL-classified migration applied through this script left no trace
 * anywhere that it had run, so "is it applied?" was unanswerable without
 * inspecting the schema by hand, and the build-time script's own MANUAL
 * warning had no way to ever clear itself.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { neon } from '@neondatabase/serverless'
import { ensureLedgerTable, getAppliedFilenames, markApplied, type QueryClient } from './apply-additive-migrations'

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations')

function parseArgs(): { from: string } {
  const args = process.argv.slice(2)
  const fromIdx = args.indexOf('--from')
  return { from: fromIdx >= 0 ? (args[fromIdx + 1] ?? '004') : '004' }
}

// Split on `;\n` (statement terminator). Within each chunk, drop SQL
// line-comments (`-- ...`) so a chunk that begins with a comment block still
// runs the SQL after it. The previous filter (`!/^--/.test(s)`) silently
// dropped the entire chunk if it began with a comment, which caused 3 of 6
// statements in migration 030 to be skipped.
function splitLegacyStatements(body: string): string[] {
  return body
    .split(/;\s*\n/)
    .map((s) =>
      s.split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((s) => s.length > 0)
}

export interface ApplyResult {
  applied: string[]
  skipped: string[]
}

/**
 * Runs every named file in `dir` not already in the ledger, in order, then
 * records it. A file already recorded is skipped entirely (its statements
 * are not re-read or re-run), which is what makes `--from` safe to re-run
 * over a range that includes files a previous invocation already applied.
 */
export async function applyMigrationFiles(
  client: QueryClient,
  filenames: string[],
  dir: string,
): Promise<ApplyResult> {
  await ensureLedgerTable(client)
  const applied = await getAppliedFilenames(client)
  const result: ApplyResult = { applied: [], skipped: [] }

  for (const f of filenames) {
    if (applied.has(f)) {
      console.log(`→ ${f} (already applied, skipping)`)
      result.skipped.push(f)
      continue
    }

    const body = readFileSync(join(dir, f), 'utf8')
    const statements = splitLegacyStatements(body)
    console.log(`→ ${f} (${statements.length} statements)`)
    for (const stmt of statements) {
      try {
        await client.query(stmt)
      } catch (err) {
        console.error(`✗ failed in ${f}:\n${stmt.slice(0, 200)}...\n`, err)
        throw err
      }
    }
    await markApplied(client, f)
    result.applied.push(f)
    console.log(`  ✓ applied`)
  }

  return result
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL']
  if (!url) {
    console.error('DATABASE_URL is required.')
    process.exit(1)
  }

  const { from } = parseArgs()
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3,4}_.*\.sql$/.test(f))
    .filter((f) => {
      const num = f.slice(0, f.indexOf('_'))
      return num.length === 3 && num >= from
    })
    .sort()

  if (files.length === 0) {
    console.log(`No hand-written migrations >= ${from} to apply.`)
    return
  }

  console.log(`Target: ${url.replace(/:[^:@/]+@/, ':***@')}`)
  console.log(`Applying ${files.length} migration(s):`)
  for (const f of files) console.log(`  - ${f}`)
  console.log('')

  const raw = neon(url)
  const client: QueryClient = {
    async query(text, params) {
      const rows = (await raw(text, params ?? [])) as Array<Record<string, unknown>>
      return { rows }
    },
  }

  try {
    await applyMigrationFiles(client, files, MIGRATIONS_DIR)
  } catch {
    process.exit(1)
  }

  console.log('\nDone.')
}

// Only run when invoked directly (not when imported by the unit tests).
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

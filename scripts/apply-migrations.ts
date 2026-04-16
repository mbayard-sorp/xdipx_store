/**
 * Apply the hand-written SQL migrations (004–017) to the target Postgres.
 *
 * These are outside drizzle-kit's journal (drizzle only tracks 0000–0003),
 * so we run them manually. All files are idempotent (CREATE TABLE/INDEX
 * IF NOT EXISTS), so re-running is safe.
 *
 *   DATABASE_URL=postgres://... tsx scripts/apply-migrations.ts
 *   DATABASE_URL=... tsx scripts/apply-migrations.ts --from 013
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { neon } from '@neondatabase/serverless'

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations')

function parseArgs(): { from: string } {
  const args = process.argv.slice(2)
  const fromIdx = args.indexOf('--from')
  return { from: fromIdx >= 0 ? (args[fromIdx + 1] ?? '004') : '004' }
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

  const sql = neon(url)
  for (const f of files) {
    const path = join(MIGRATIONS_DIR, f)
    const body = readFileSync(path, 'utf8')
    const statements = body
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !/^--/.test(s))
    console.log(`→ ${f} (${statements.length} statements)`)
    for (const stmt of statements) {
      try {
        await sql(stmt)
      } catch (err) {
        console.error(`✗ failed in ${f}:\n${stmt.slice(0, 200)}...\n`, err)
        process.exit(1)
      }
    }
    console.log(`  ✓ applied`)
  }

  console.log('\nDone.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

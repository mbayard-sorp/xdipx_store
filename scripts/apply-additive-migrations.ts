/**
 * Auto-apply additive-only SQL migrations at production build time.
 *
 * Why this exists: migration 080 (and 079 before it) merged to main and sat
 * unapplied for hours because applying a hand-written migration was a manual,
 * easy-to-forget step. 080 specifically 500ed the social lane store-wide for
 * about 20 hours before anyone ran scripts/apply-migrations.ts against prod.
 * This script closes that gap for the safe subset of migrations: additive,
 * non-destructive DDL that can run automatically without an owner in the loop.
 * Anything destructive (DROP, ALTER TYPE, RENAME, data-mutating statements)
 * stays on the existing manual path (scripts/apply-migrations.ts), unchanged.
 *
 * Two modes:
 *
 *   tsx scripts/apply-additive-migrations.ts --build
 *     Meant to run as the first step of `npm run build`. HARD GATE: this is a
 *     no-op everywhere except a real Vercel production build (VERCEL_ENV ===
 *     'production'). Preview builds and local builds must never mutate the
 *     database, full stop; see the gate check below before touching it.
 *
 *   tsx scripts/apply-additive-migrations.ts --dry-run
 *     Meant to run in CI against a throwaway postgres:16 service container.
 *     Classifies every migration file and actually executes the additive ones
 *     against DATABASE_URL, proving the SQL is valid and idempotent. Ignores
 *     the production gate (there is no production to protect from a scratch
 *     DB) and never writes to the ledger table (the scratch DB is discarded
 *     after the job, so there is nothing to remember).
 *
 * Ledger: schema_migrations_applied (migration 081) records which files this
 * script has already run, so re-running it on every build only applies files
 * it has not seen before. On its very first run in an environment whose
 * schema already reflects everything up to and including migration 081 (true
 * for prod the day this ships), every file numbered <= 081 is *seeded* into
 * the ledger without being executed, so this script's first run does not
 * attempt to blindly re-run years of prior migrations.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations')

/** Files numbered at or below this were already applied to prod by the time
 *  this script ships (081 is the ledger table itself). Used only to seed the
 *  ledger on first run; has no effect once the ledger already has entries. */
const LEDGER_BASELINE_MAX = 81

/** Same DDL as db/migrations/081_schema_migrations_ledger.sql. Kept inline so
 *  this script can bootstrap the ledger table before the ledger migration
 *  file itself has necessarily run (first-ever execution against a DB that
 *  predates the ledger). */
const LEDGER_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations_applied (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`

// ---------------------------------------------------------------------------
// SQL parsing: comment stripping, statement splitting, statement classifying.
// Pure functions, no I/O, exported for the unit tests in this file's *.test.ts.
// ---------------------------------------------------------------------------

/**
 * Strip `-- line` and block comments, leaving string literals alone (a
 * semicolon or `--` inside a quoted string must not be treated as SQL).
 * Handles the standard `''` escaped-quote form inside single-quoted strings.
 */
export function stripSqlComments(sql: string): string {
  let out = ''
  let i = 0
  let inLineComment = false
  let inBlockComment = false
  let inString = false

  while (i < sql.length) {
    const c = sql[i] as string
    const c2 = sql[i + 1]

    if (inLineComment) {
      if (c === '\n') {
        inLineComment = false
        out += c
      }
      i++
      continue
    }
    if (inBlockComment) {
      if (c === '*' && c2 === '/') {
        inBlockComment = false
        i += 2
        continue
      }
      i++
      continue
    }
    if (inString) {
      out += c
      if (c === "'") {
        if (c2 === "'") {
          out += c2
          i += 2
          continue
        }
        inString = false
      }
      i++
      continue
    }
    if (c === "'") {
      inString = true
      out += c
      i++
      continue
    }
    if (c === '-' && c2 === '-') {
      inLineComment = true
      i += 2
      continue
    }
    if (c === '/' && c2 === '*') {
      inBlockComment = true
      i += 2
      continue
    }
    out += c
    i++
  }
  return out
}

/**
 * Split a (comment-stripped) SQL file into individual statements on `;`,
 * respecting single-quoted strings so a semicolon inside a string literal
 * does not split the statement in two. Empty/whitespace-only chunks (e.g. a
 * trailing newline after the last `;`) are dropped.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = []
  let current = ''
  let inString = false
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i] as string
    const c2 = sql[i + 1]
    current += c
    if (inString) {
      if (c === "'") {
        if (c2 === "'") {
          current += c2
          i++
          continue
        }
        inString = false
      }
      continue
    }
    if (c === "'") {
      inString = true
      continue
    }
    if (c === ';') {
      const trimmed = current.slice(0, -1).trim()
      if (trimmed.length > 0) out.push(trimmed)
      current = ''
    }
  }
  const rest = current.trim()
  if (rest.length > 0) out.push(rest)
  return out
}

/**
 * Statement-class allowlist. Fail-closed: only these four DDL shapes are
 * considered additive-safe to auto-apply. Everything else (DROP, RENAME,
 * ALTER TYPE, any DML like UPDATE/DELETE/INSERT-outside-the-ledger, ALTER
 * TABLE without IF NOT EXISTS, etc.) is NOT matched, which is the point:
 * an unrecognized statement must read as "manual", never as "safe by
 * default".
 */
const ADDITIVE_PATTERNS: RegExp[] = [
  // ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...
  /^ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+/i,
  // CREATE TABLE IF NOT EXISTS ...
  /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+/i,
  // CREATE [UNIQUE] INDEX [CONCURRENTLY] IF NOT EXISTS ...
  /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?IF\s+NOT\s+EXISTS\s+/i,
]

export function isAdditiveStatement(statement: string): boolean {
  const normalized = statement.trim()
  return ADDITIVE_PATTERNS.some((re) => re.test(normalized))
}

export interface FileClassification {
  /** 'auto' only when every statement in the file matches the allowlist. A
   *  file with zero statements (e.g. comments-only) is vacuously 'auto'. */
  verdict: 'auto' | 'manual'
  statements: string[]
  /** Set only when verdict === 'manual': the first statement that failed to
   *  classify, truncated for logging. */
  reason?: string
}

/** Classify a whole migration file. Never partially applies a file: if ANY
 *  statement fails to match the allowlist, the entire file is 'manual'. */
export function classifyFile(sqlBody: string): FileClassification {
  const statements = splitStatements(stripSqlComments(sqlBody))
  const offender = statements.find((s) => !isAdditiveStatement(s))
  if (offender) {
    return { verdict: 'manual', statements, reason: offender.slice(0, 160) }
  }
  return { verdict: 'auto', statements }
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

export interface MigrationFile {
  filename: string
  path: string
  /** Numeric prefix, e.g. 81 for "081_schema_migrations_ledger.sql". */
  number: number
}

/** Same file-discovery convention as scripts/apply-migrations.ts: files named
 *  `NNN_description.sql` (3-4 digit prefix), sorted by filename. */
export function readMigrationFiles(dir = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => /^\d{3,4}_.*\.sql$/.test(f))
    .sort()
    .map((filename) => ({
      filename,
      path: join(dir, filename),
      number: Number(filename.slice(0, filename.indexOf('_'))),
    }))
}

// ---------------------------------------------------------------------------
// DB plumbing
// ---------------------------------------------------------------------------

/** Minimal surface this script needs from a pg client, so tests can stub it
 *  without a real connection if ever needed. */
export interface QueryClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>
}

/**
 * pg (node-postgres), not @neondatabase/serverless: this script must run
 * against a plain postgres:16 CI service container in --dry-run as well as
 * against Neon in --build, and Neon accepts standard wire-protocol
 * connections on the same DATABASE_URL (the HTTP driver used elsewhere in
 * this repo is a serverless/edge optimization, not a requirement). SSL is
 * enabled only when the connection string looks like it needs it, so local
 * and CI postgres (no TLS configured) are not forced into a handshake that
 * would fail.
 */
export function sslConfigFor(url: string): { rejectUnauthorized: boolean } | undefined {
  return /sslmode=require|neon\.tech/i.test(url) ? { rejectUnauthorized: false } : undefined
}

async function ensureLedgerTable(client: QueryClient): Promise<void> {
  await client.query(LEDGER_DDL)
}

async function getAppliedFilenames(client: QueryClient): Promise<Set<string>> {
  const res = await client.query('SELECT filename FROM schema_migrations_applied')
  return new Set(res.rows.map((r) => String(r['filename'])))
}

async function markApplied(client: QueryClient, filename: string): Promise<void> {
  await client.query('INSERT INTO schema_migrations_applied (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING', [filename])
}

async function executeFile(client: QueryClient, statements: string[]): Promise<void> {
  await client.query('BEGIN')
  try {
    for (const stmt of statements) {
      await client.query(stmt)
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {
      // Best-effort. If ROLLBACK itself fails the connection is already
      // broken and the caller is about to fail the build anyway.
    })
    throw err
  }
}

// ---------------------------------------------------------------------------
// Run modes
// ---------------------------------------------------------------------------

export type RunVerdict = 'auto' | 'manual' | 'already-applied'

export interface FileResult {
  file: string
  verdict: RunVerdict
  statementCount: number
  reason?: string
}

export interface RunOutcome {
  results: FileResult[]
  /** Set when an auto-appliable file failed to execute. The caller must fail
   *  the build in that case rather than deploy code whose migration failed. */
  failedFile: string | null
  failedError: string | null
}

/**
 * Production build mode: ledger-driven, seeds the pre-ledger baseline once,
 * writes the ledger as it goes, stops on the first execution failure.
 */
export async function runBuildMode(client: QueryClient, files: MigrationFile[]): Promise<RunOutcome> {
  await ensureLedgerTable(client)
  const applied = await getAppliedFilenames(client)
  const results: FileResult[] = []

  for (const f of files) {
    if (applied.has(f.filename)) {
      results.push({ file: f.filename, verdict: 'already-applied', statementCount: 0 })
      continue
    }
    if (f.number <= LEDGER_BASELINE_MAX) {
      console.log(`[apply-additive-migrations] seeding pre-ledger baseline: ${f.filename} (recorded, not executed)`)
      await markApplied(client, f.filename)
      applied.add(f.filename)
      results.push({ file: f.filename, verdict: 'already-applied', statementCount: 0, reason: 'seeded pre-ledger baseline' })
      continue
    }

    const body = readFileSync(f.path, 'utf8')
    const { verdict, statements, reason } = classifyFile(body)

    if (verdict === 'manual') {
      console.warn(
        `[apply-additive-migrations] MANUAL: ${f.filename} is not additive-only (${reason}). requires owner: run scripts/apply-migrations.ts`,
      )
      results.push({ file: f.filename, verdict: 'manual', statementCount: statements.length, reason })
      continue
    }

    try {
      await executeFile(client, statements)
      await markApplied(client, f.filename)
      applied.add(f.filename)
      console.log(`[apply-additive-migrations] applied ${f.filename} (${statements.length} statement(s))`)
      results.push({ file: f.filename, verdict: 'auto', statementCount: statements.length })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { results, failedFile: f.filename, failedError: message }
    }
  }

  return { results, failedFile: null, failedError: null }
}

/**
 * CI dry-run mode: no production gate, no ledger writes. Runs every
 * additive-classified file against DATABASE_URL (a throwaway CI database) to
 * prove the SQL actually executes; manual files are reported and skipped.
 * The ledger table is still read (never written) so a file already present
 * there is reported as 'already-applied' rather than re-run, matching build
 * mode's verdict vocabulary even though a fresh scratch DB will not normally
 * have any entries.
 */
export async function runDryRunMode(client: QueryClient, files: MigrationFile[]): Promise<RunOutcome> {
  await ensureLedgerTable(client)
  const applied = await getAppliedFilenames(client)
  const results: FileResult[] = []

  for (const f of files) {
    if (applied.has(f.filename)) {
      results.push({ file: f.filename, verdict: 'already-applied', statementCount: 0 })
      continue
    }

    const body = readFileSync(f.path, 'utf8')
    const { verdict, statements, reason } = classifyFile(body)

    if (verdict === 'manual') {
      console.warn(`[apply-additive-migrations] MANUAL: ${f.filename} is not additive-only (${reason}). requires owner: run scripts/apply-migrations.ts`)
      results.push({ file: f.filename, verdict: 'manual', statementCount: statements.length, reason })
      continue
    }

    try {
      await executeFile(client, statements)
      console.log(`[apply-additive-migrations] dry-run applied ${f.filename} (${statements.length} statement(s))`)
      results.push({ file: f.filename, verdict: 'auto', statementCount: statements.length })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { results, failedFile: f.filename, failedError: message }
    }
  }

  return { results, failedFile: null, failedError: null }
}

function printSummary(results: FileResult[]): void {
  const auto = results.filter((r) => r.verdict === 'auto')
  const manual = results.filter((r) => r.verdict === 'manual')
  const already = results.filter((r) => r.verdict === 'already-applied')
  console.log('')
  console.log('[apply-additive-migrations] summary:')
  console.log(`  auto-applied:    ${auto.length}${auto.length ? ' (' + auto.map((r) => r.file).join(', ') + ')' : ''}`)
  console.log(`  already-applied: ${already.length}`)
  if (manual.length > 0) {
    console.log(`  manual (owner):  ${manual.length}`)
    for (const m of manual) console.log(`    - ${m.file}: ${m.reason ?? 'not additive-only'}`)
  }
  console.log('')
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const isBuild = args.includes('--build')
  const isDryRun = args.includes('--dry-run')

  if (isBuild && isDryRun) {
    console.error('[apply-additive-migrations] --build and --dry-run cannot be combined.')
    process.exit(1)
  }

  if (isBuild) {
    // HARD GATE, load-bearing: preview and local builds must NEVER touch the
    // database. Only a real Vercel production build may auto-apply anything.
    // Same discriminator app/lib/botid.server.ts and app/lib/meta-capi.server.ts
    // use, for the same reason (NODE_ENV is 'production' on preview too).
    const vercelEnv = process.env['VERCEL_ENV']
    if (vercelEnv !== 'production') {
      console.log(
        `[apply-additive-migrations] VERCEL_ENV=${vercelEnv ?? '(unset)'}, not a production build. No-op.`,
      )
      process.exit(0)
    }
  }

  const url = process.env['DATABASE_URL']
  if (!url) {
    if (isBuild) {
      console.warn('[apply-additive-migrations] DATABASE_URL is unset. No-op.')
      process.exit(0)
    }
    console.error('[apply-additive-migrations] DATABASE_URL is required for --dry-run.')
    process.exit(1)
  }

  const files = readMigrationFiles()
  if (files.length === 0) {
    console.log('[apply-additive-migrations] no migration files found.')
    return
  }

  const client = new Client({ connectionString: url, ssl: sslConfigFor(url) })
  await client.connect()
  try {
    const outcome = isBuild ? await runBuildMode(client, files) : await runDryRunMode(client, files)
    printSummary(outcome.results)

    if (outcome.failedFile) {
      console.error(`[apply-additive-migrations] ✗ ${outcome.failedFile} failed to apply:\n${outcome.failedError}`)
      process.exitCode = 1
    }
  } finally {
    await client.end()
  }
}

// Only run when invoked directly (not when imported by the unit tests).
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

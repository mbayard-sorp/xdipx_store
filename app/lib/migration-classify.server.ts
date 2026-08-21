/**
 * Pure SQL-migration classification, shared by two consumers with one rule set:
 *
 *   - scripts/apply-additive-migrations.ts decides what SQL may auto-apply at
 *     production build time
 *   - app/lib/github.server.ts (refineMigrationProtection) decides whether a
 *     migration PR stays protected (owner-merged) or may ride the ordinary
 *     CI + QA + release-engine lane
 *
 * The two decisions MUST agree: the engine may only merge a migration the
 * build step will actually apply, or the merged-but-unapplied outage class
 * (migrations 079/080, 2026-08) comes back. Keeping one classifier is the
 * mechanism. This file is a protected path for that reason.
 *
 * No I/O and no imports: pure string functions.
 */

/**
 * Strip `-- line` and block comments, leaving string literals alone (a
 * semicolon or `--` inside a quoted string must not be treated as SQL).
 * Handles the standard `''` escaped-quote form inside single-quoted strings,
 * and Postgres dollar-quoted strings (`$$...$$` / `$tag$...$tag$`, as used by
 * PL/pgSQL function/trigger bodies): once opened, everything up to the
 * matching closing delimiter is opaque, not re-tokenized as comments/strings.
 */
export function stripSqlComments(sql: string): string {
  let out = ''
  let i = 0
  let inLineComment = false
  let inBlockComment = false
  let inString = false
  let dollarTag: string | null = null

  while (i < sql.length) {
    const c = sql[i] as string
    const c2 = sql[i + 1]

    if (dollarTag !== null) {
      const closer = `$${dollarTag}$`
      if (sql.startsWith(closer, i)) {
        out += closer
        i += closer.length
        dollarTag = null
        continue
      }
      out += c
      i++
      continue
    }
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
    if (c === '$') {
      const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
      if (match) {
        dollarTag = match[1] ?? ''
        out += match[0]
        i += match[0].length
        continue
      }
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
 * does not split the statement in two, and respecting Postgres dollar-quoted
 * strings (`$$...$$` / `$tag$...$tag$`) so a semicolon inside a PL/pgSQL
 * function/trigger body doesn't fragment it into invalid partial statements.
 * Empty/whitespace-only chunks (e.g. a trailing newline after the last `;`)
 * are dropped.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = []
  let current = ''
  let inString = false
  let dollarTag: string | null = null
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i] as string
    const c2 = sql[i + 1]
    current += c

    if (dollarTag !== null) {
      if (c === '$') {
        const closer = `$${dollarTag}$`
        if (sql.startsWith(closer, i)) {
          current += closer.slice(1)
          i += closer.length - 1
          dollarTag = null
        }
      }
      continue
    }
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
    if (c === '$') {
      const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
      if (match) {
        dollarTag = match[1] ?? ''
        current += match[0].slice(1)
        i += match[0].length - 1
        continue
      }
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

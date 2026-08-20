import { describe, expect, it } from 'vitest'
import { classifyFile, isAdditiveStatement, splitStatements, sslConfigFor, stripSqlComments } from './apply-additive-migrations'

describe('stripSqlComments', () => {
  it('drops a line comment', () => {
    expect(stripSqlComments("-- hello\nCREATE TABLE IF NOT EXISTS t (id int);")).toBe(
      '\nCREATE TABLE IF NOT EXISTS t (id int);',
    )
  })

  it('drops a block comment', () => {
    expect(stripSqlComments('/* hello\nworld */CREATE TABLE IF NOT EXISTS t (id int);')).toBe(
      'CREATE TABLE IF NOT EXISTS t (id int);',
    )
  })

  it('leaves a double-dash inside a string literal alone', () => {
    const sql = "ALTER TABLE t ADD COLUMN IF NOT EXISTS note text DEFAULT 'a -- not a comment';"
    expect(stripSqlComments(sql)).toBe(sql)
  })

  it('handles an escaped quote inside a string literal', () => {
    const sql = "ALTER TABLE t ADD COLUMN IF NOT EXISTS note text DEFAULT 'it''s fine';"
    expect(stripSqlComments(sql)).toBe(sql)
  })

  it('leaves a -- and a semicolon inside a $$-quoted function body alone', () => {
    const sql = "CREATE FUNCTION f() RETURNS trigger AS $$\nBEGIN\n  -- not a real comment to drop\n  INSERT INTO t (id) VALUES (1);\n  RETURN NEW;\nEND;\n$$ LANGUAGE plpgsql;"
    expect(stripSqlComments(sql)).toBe(sql)
  })

  it('leaves content inside a tagged dollar-quote ($tag$...$tag$) alone', () => {
    const sql = 'CREATE FUNCTION f() RETURNS void AS $body$ -- inner comment; not stripped $body$ LANGUAGE sql;'
    expect(stripSqlComments(sql)).toBe(sql)
  })
})

describe('splitStatements', () => {
  it('splits on semicolons and trims each statement', () => {
    const out = splitStatements('CREATE TABLE IF NOT EXISTS a (id int);\nCREATE TABLE IF NOT EXISTS b (id int);\n')
    expect(out).toEqual(['CREATE TABLE IF NOT EXISTS a (id int)', 'CREATE TABLE IF NOT EXISTS b (id int)'])
  })

  it('does not split on a semicolon inside a string literal', () => {
    const out = splitStatements("ALTER TABLE t ADD COLUMN IF NOT EXISTS note text DEFAULT 'a; b';")
    expect(out).toEqual(["ALTER TABLE t ADD COLUMN IF NOT EXISTS note text DEFAULT 'a; b'"])
  })

  it('drops empty trailing chunks', () => {
    const out = splitStatements('CREATE TABLE IF NOT EXISTS a (id int);\n\n  \n')
    expect(out).toEqual(['CREATE TABLE IF NOT EXISTS a (id int)'])
  })

  it('does not split on semicolons inside a $$-quoted function/trigger body (repro: db/migrations/004_reviews.sql)', () => {
    const sql = [
      'CREATE FUNCTION refresh() RETURNS trigger AS $$',
      'BEGIN',
      '  INSERT INTO agg (id) VALUES (NEW.id);',
      '  UPDATE agg SET n = n + 1;',
      '  RETURN NEW;',
      'END;',
      '$$ LANGUAGE plpgsql;',
      'CREATE TABLE IF NOT EXISTS t (id int);',
    ].join('\n')
    const out = splitStatements(sql)
    expect(out).toHaveLength(2)
    expect(out[0]).toContain('BEGIN')
    expect(out[0]).toContain('END;\n$$ LANGUAGE plpgsql')
    expect(out[1]).toBe('CREATE TABLE IF NOT EXISTS t (id int)')
  })

  it('does not split on a semicolon inside a tagged dollar-quote ($tag$...$tag$)', () => {
    const out = splitStatements('CREATE FUNCTION f() RETURNS void AS $body$ SELECT 1; SELECT 2; $body$ LANGUAGE sql;')
    expect(out).toEqual(['CREATE FUNCTION f() RETURNS void AS $body$ SELECT 1; SELECT 2; $body$ LANGUAGE sql'])
  })
})

describe('isAdditiveStatement', () => {
  it.each([
    'ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS shopify_product_id varchar(60)',
    'alter table foo add column if not exists bar int',
    'CREATE TABLE IF NOT EXISTS schema_migrations_applied (filename text PRIMARY KEY)',
    'CREATE INDEX IF NOT EXISTS idx_foo ON foo (bar)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_foo ON foo (bar)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_foo ON foo (bar)',
    'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_foo ON foo (bar)',
  ])('accepts additive statement: %s', (stmt) => {
    expect(isAdditiveStatement(stmt)).toBe(true)
  })

  it.each([
    'DROP TABLE foo',
    'ALTER TABLE foo DROP COLUMN bar',
    'ALTER TABLE foo ADD COLUMN bar int', // missing IF NOT EXISTS
    'ALTER TYPE mood_enum ADD VALUE \'beginner\'',
    'ALTER TABLE foo RENAME COLUMN bar TO baz',
    'CREATE TABLE foo (id int)', // missing IF NOT EXISTS
    'CREATE INDEX idx_foo ON foo (bar)', // missing IF NOT EXISTS
    'UPDATE foo SET bar = 1',
    'DELETE FROM foo',
    'INSERT INTO foo (bar) VALUES (1)',
    'TRUNCATE foo',
    'GRANT ALL ON foo TO bar',
  ])('rejects non-additive statement: %s', (stmt) => {
    expect(isAdditiveStatement(stmt)).toBe(false)
  })
})

describe('classifyFile', () => {
  it('classifies an all-additive file as auto', () => {
    const body = `-- 081: ledger table\nCREATE TABLE IF NOT EXISTS schema_migrations_applied (\n  filename text PRIMARY KEY,\n  applied_at timestamptz NOT NULL DEFAULT now()\n);\n`
    const result = classifyFile(body)
    expect(result.verdict).toBe('auto')
    expect(result.statements).toHaveLength(1)
  })

  it('classifies migration 080 (a real additive file) as auto', () => {
    const body = 'ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS shopify_product_id varchar(60);\n'
    expect(classifyFile(body).verdict).toBe('auto')
  })

  it('classifies a file containing a DROP statement as manual', () => {
    const body = 'DROP TABLE old_table;\n'
    const result = classifyFile(body)
    expect(result.verdict).toBe('manual')
    expect(result.reason).toContain('DROP TABLE')
  })

  it('classifies a file containing ALTER TYPE as manual', () => {
    const body = "ALTER TYPE mood_enum ADD VALUE 'beginner';\n"
    expect(classifyFile(body).verdict).toBe('manual')
  })

  it('classifies a file containing RENAME as manual', () => {
    const body = 'ALTER TABLE foo RENAME COLUMN bar TO baz;\n'
    expect(classifyFile(body).verdict).toBe('manual')
  })

  it('classifies a file containing UPDATE/DELETE as manual', () => {
    expect(classifyFile('UPDATE foo SET bar = 1;\n').verdict).toBe('manual')
    expect(classifyFile('DELETE FROM foo;\n').verdict).toBe('manual')
  })

  it('classifies a MIXED file (one additive statement + one destructive statement) as manual, never partial', () => {
    const body = [
      'ALTER TABLE foo ADD COLUMN IF NOT EXISTS bar int;',
      'DROP TABLE old_table;',
    ].join('\n')
    const result = classifyFile(body)
    expect(result.verdict).toBe('manual')
    // Both statements are still surfaced (never partially applied), even
    // though only the second one is the reason it's manual.
    expect(result.statements).toHaveLength(2)
  })

  it('strips comments before classifying, so a comment mentioning DROP does not make an additive file manual', () => {
    const body = '-- this migration replaces the old DROP TABLE approach\nCREATE TABLE IF NOT EXISTS t (id int);\n'
    expect(classifyFile(body).verdict).toBe('auto')
  })

  it('is vacuously auto for a comments-only / empty file', () => {
    const body = '-- nothing to do here\n'
    const result = classifyFile(body)
    expect(result.verdict).toBe('auto')
    expect(result.statements).toHaveLength(0)
  })
})

describe('sslConfigFor', () => {
  it('enables ssl for a neon.tech host', () => {
    expect(sslConfigFor('postgresql://user:pass@ep-foo.us-east-2.aws.neon.tech/db')).toEqual({ rejectUnauthorized: false })
  })

  it('enables ssl when sslmode=require is present', () => {
    expect(sslConfigFor('postgresql://user:pass@host/db?sslmode=require')).toEqual({ rejectUnauthorized: false })
  })

  it('leaves ssl undefined for a plain local/CI postgres URL', () => {
    expect(sslConfigFor('postgresql://ci:ci@localhost:5432/ci')).toBeUndefined()
  })
})

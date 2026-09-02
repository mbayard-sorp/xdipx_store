/**
 * The 2026-09-02 ticket-bus outage, pinned.
 *
 * PR #1045 changed both `suggestion_links` writers to
 * `onConflictDoNothing({ target: [suggestionId, kind, ref] })` and shipped the
 * unique index those columns need in migration 092. That migration opens with a
 * DELETE, so `classifyFile()` calls it 'manual' and the build-time apply step
 * skips it: the code deployed to production, the index did not, and Postgres
 * rejected every insert at PLAN time with 42P10, "there is no unique or
 * exclusion constraint matching the ON CONFLICT specification".
 *
 * `addTicketLinks` does not catch, so every note, every link and every
 * transition carrying either -- which is most of /api/team/suggestion -- 500'd
 * until someone noticed. `addTicketLink` in the release engine does catch, so
 * the engine merely stopped recording links, silently, for the same hours.
 *
 * The rule these tests hold: a WRITE the estate depends on may not depend on an
 * index that cannot auto-apply. Untargeted, the clause plans against any schema
 * and simply gets better -- race-safe dedupe instead of duplicate rows -- once
 * 092 is run.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { describe, expect, it } from 'vitest'

import * as schema from '../../db/schema'

// Never connected: `.toSQL()` renders the statement without executing it.
const db = drizzle(neon('postgresql://u:p@localhost/db'), { schema })

const ROW = { suggestionId: 1, kind: 'note', ref: 'x', state: 'approved' }

/** Source of the two writers, read rather than imported: both are private. */
function writerSource(file: string): string {
  return readFileSync(join(process.cwd(), 'app/lib', file), 'utf8')
}

describe('suggestion_links conflict clause', () => {
  it('renders no arbiter column list, so no index is inferred at plan time', () => {
    const sql = db.insert(schema.suggestionLinks).values(ROW).onConflictDoNothing().toSQL().sql
    expect(sql).toContain('on conflict do nothing')
    // The exact shape that broke production. Anything between `on conflict` and
    // `do nothing` is an arbiter Postgres has to resolve against a real index.
    expect(sql).not.toMatch(/on conflict\s*\(/)
  })

  it('pins the targeted form as the one that needs the index, so the difference stays visible', () => {
    const sql = db.insert(schema.suggestionLinks).values(ROW)
      .onConflictDoNothing({
        target: [schema.suggestionLinks.suggestionId, schema.suggestionLinks.kind, schema.suggestionLinks.ref],
      })
      .toSQL().sql
    expect(sql).toContain('on conflict ("suggestion_id","kind","ref") do nothing')
  })

  // The regression guard. A future edit that "restores the upsert" reintroduces
  // the outage on any database where 092 has not been run, which today includes
  // production. Both writers are checked because only one of them 500s -- the
  // other fails silently, which is worse to diagnose.
  it.each([
    ['team.server.ts', 'addTicketLinks'],
    ['release-engine.server.ts', 'addTicketLink'],
  ])('%s keeps its %s conflict clause untargeted', (file) => {
    const src = writerSource(file)
    const targeted = src.match(/onConflictDo(?:Nothing|Update)\(\{[^}]*target:[^}]*suggestionLinks/gs) ?? []
    expect(targeted).toEqual([])
    expect(src).toContain('.onConflictDoNothing()')
  })
})

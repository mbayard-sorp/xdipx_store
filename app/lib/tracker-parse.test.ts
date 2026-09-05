/**
 * The tracker parser is positional, so a stray pipe shifts every field after it.
 *
 * `cells.length < 10` was the only guard, which catches a row with too FEW
 * columns and silently mis-parses one with too many: a pipe in the evidence
 * probe turns `lastVerified` into the tail of the probe text and `notes` into
 * the old `lastVerified`. A row that quietly parses into plausible-looking
 * wrong values is worse than one that says it could not be read, and
 * `lastVerified` is exactly the field a staleness judgement would rest on.
 */
import { describe, expect, it } from 'vitest'
import { parseTracker } from '~/lib/tracker.server'

const HEAD = [
  '# Tracker — Test',
  '',
  'Program: testing',
  'Overall: GREEN',
  '',
  '| id | milestone | phase | owner | target week | status | RAG | evidence probe | last verified | notes |',
  '|---|---|---|---|---|---|---|---|---|---|',
].join('\n')

function parse(row: string) {
  return parseTracker('test', `${HEAD}\n${row}\n`).milestones
}

describe('a well-formed row', () => {
  const [m] = parse('| a1 | does a thing | A | someone | 2026-09-06 | done | GREEN | count is 0 | 2026-09-02 | shipped |')

  it('lands every column where it belongs', () => {
    expect(m).toMatchObject({
      id: 'a1', phase: 'A', status: 'done', rag: 'GREEN',
      evidenceProbe: 'count is 0', lastVerified: '2026-09-02', notes: 'shipped',
    })
  })

  it('is not flagged', () => {
    expect(m!.malformed).toBe(false)
  })
})

describe('a row with an extra pipe', () => {
  // The realistic case: prose in the last column containing a pipe.
  const [m] = parse('| a2 | thing | A | someone | 2026-09-06 | done | GREEN | count is 0 | 2026-09-02 | shipped | and more |')

  it('is flagged rather than silently trusted', () => {
    expect(m!.malformed).toBe(true)
  })

  it('folds the overflow back into notes instead of dropping it', () => {
    expect(m!.notes).toContain('shipped')
    expect(m!.notes).toContain('and more')
  })

  it('still parses the columns before the overflow', () => {
    // The flag says "do not trust the tail", not "this row is unusable".
    expect(m!.id).toBe('a2')
    expect(m!.rag).toBe('GREEN')
  })
})

describe('rows that are not milestones', () => {
  it('skips the separator and header', () => {
    expect(parse('| a3 | t | A | o | w | done | GREEN | p | v | n |')).toHaveLength(1)
  })

  it('skips a row with too few columns rather than guessing', () => {
    expect(parse('| a4 | too | short |')).toEqual([])
  })
})

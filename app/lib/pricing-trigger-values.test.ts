/**
 * The code's trigger vocabulary and the database's CHECK constraint are two
 * copies of one list, and they drifted for months.
 *
 * `pricing_audit_log_trigger_check` allowed webhook|batch|manual|
 * clearance_ladder. The code had since started passing 'batch_catchup' and then
 * 'batch_continuation'. Every audit insert carrying one of those violated the
 * CHECK, was swallowed by the try/catch around the write, and the run reported
 * success -- so on 2026-09-03 the continuation passes applied 1,426 price
 * changes and recorded none of them, and catalog coverage read 44% on a day the
 * walk reached 94%.
 *
 * This test is the lockstep. Adding a value to PRICING_TRIGGERS without the
 * migration that permits it now fails here instead of in production silence.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { PRICING_TRIGGERS } from './pricing-apply-v2.server'

const MIGRATION = 'db/migrations/093_pricing_audit_trigger_values.sql'

/** The values inside the ADD CONSTRAINT's ARRAY[...], in file order. */
function constraintValues(): string[] {
  const sql = readFileSync(join(process.cwd(), MIGRATION), 'utf8')
  const add = sql.slice(sql.indexOf('ADD CONSTRAINT'))
  const array = add.slice(add.indexOf('ARRAY['), add.indexOf(']'))
  return [...array.matchAll(/'([^']+)'/g)].map(m => m[1]!)
}

describe('pricing trigger vocabulary', () => {
  it('the migration permits exactly the values the code can pass', () => {
    expect([...constraintValues()].sort()).toEqual([...PRICING_TRIGGERS].sort())
  })

  it('still carries the two values whose absence caused the outage', () => {
    // Named explicitly so a careless "tidy up the list" cannot quietly drop the
    // ones that were missing, which is how this started.
    expect(constraintValues()).toContain('batch_catchup')
    expect(constraintValues()).toContain('batch_continuation')
  })
})

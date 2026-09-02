import { describe, expect, it } from 'vitest'

import {
  BACKUP_MANIFEST,
  classOf,
  criticalTables,
  missingFromDatabase,
  tierOf,
  unclassified,
} from '~/lib/backup-manifest'

describe('the manifest is well-formed', () => {
  it('classifies every table exactly once', () => {
    const names = BACKUP_MANIFEST.map(c => c.table)
    expect(new Set(names).size).toBe(names.length)
  })

  it('makes every entry say why', () => {
    // A tier with no reason is a guess, and a guess is what gets a table
    // excluded from a backup by someone who did not think about it.
    //
    // The floor is low on purpose. A longer one was tried and it was the wrong
    // test: "Dormant video-studio application." and "Customer-created." are
    // complete, accurate reasons, and a length gate would only have bought
    // padding around them. The substantive check is the `derived` one below,
    // where the claim is falsifiable.
    for (const c of BACKUP_MANIFEST) {
      expect(c.why.trim().length, `${c.table} has no reason`).toBeGreaterThan(11)
      expect(c.why, `${c.table} restates its tier instead of a reason`).not.toBe(c.tier)
    }
  })

  it('names a rebuild path on everything it calls derived', () => {
    // `derived` is a claim: this table can be reconstructed. If the mechanism
    // cannot be named, the tier is wrong and the table belongs in critical.
    for (const c of BACKUP_MANIFEST.filter(c => c.tier === 'derived')) {
      expect(
        /rebuil|recomput|re-?fetch|re-?send|re-?ping|re-?run|re-?establish|upsert|source of truth|cache/i.test(c.why),
        `${c.table} is called derived but names no rebuild path`,
      ).toBe(true)
    }
  })
})

describe('the tiering itself', () => {
  it('backs up the things that exist nowhere else', () => {
    // Each of these is here for a specific reason, and losing any one of them
    // is unrecoverable in a way no external system can undo.
    for (const t of [
      'consent_log',            // legally load-bearing, unreconstructable by definition
      'sms_optouts',            // an opt-out we lose is an opt-out we violate
      'voicemails',             // a real person's voice
      'pipeline_settings',      // 2,182 keys; losing it un-gates the whole fleet at once
      'pricing_rules',          // 98 hand-tuned rules that decide what every SKU costs
      'owner_blockers',         // the owner's queue and its probe state
      'homepage_team_suggestions',
      'suggestion_links',       // the evidence a retire edge cites
      'daily_profit_summary',   // the only ledger of what the store earned
      'referrals',              // money we owe someone
      'schema_migrations_applied', // a restore that cannot say its own version
      'video_episodes',         // renumbering an aired episode is forbidden, which needs the numbers
    ]) {
      expect(tierOf(t), `${t} must be backed up`).toBe('critical')
    }
  })

  it('does not back up the 188 MB audit log', () => {
    // This is the whole size argument. pricing_audit_log is 81% of the database
    // and records what a price WAS; pricing_rules records what it should be,
    // and that is the one in the critical tier.
    expect(tierOf('pricing_audit_log')).toBe('disposable')
    expect(tierOf('pricing_rules')).toBe('critical')
  })

  it('keeps the dumped set small enough to finish inside a lambda', () => {
    // Measured 2026-09-02: 62 critical tables, 17,137 rows, 16 MB on disk. The
    // cap is not the real budget — db-backup.server.ts enforces wall clock and
    // bytes at runtime — but a manifest edit that doubles the tier should be a
    // deliberate act, not a side effect.
    expect(criticalTables().length).toBeLessThanOrEqual(80)
  })

  it('returns tables in a stable order, so two dumps are comparable', () => {
    expect(criticalTables()).toEqual([...criticalTables()].sort())
  })
})

describe('coverage against a live database', () => {
  const live = BACKUP_MANIFEST.map(c => c.table)

  it('is silent when the database matches', () => {
    expect(unclassified(live)).toEqual([])
    expect(missingFromDatabase(live)).toEqual([])
  })

  it('shouts about a table it has never heard of', () => {
    // The normal steady state of this system: a migration adds a table and the
    // release engine merges it unattended, with nothing in that path asking
    // whether the new table needs backing up.
    expect(unclassified([...live, 'loyalty_ledger'])).toEqual(['loyalty_ledger'])
  })

  it('shouts about a table that has gone away', () => {
    expect(missingFromDatabase(live.filter(t => t !== 'returns'))).toEqual(['returns'])
  })

  it('reads an unknown table as unclassified rather than as some default tier', () => {
    expect(tierOf('not_a_table')).toBeNull()
    expect(classOf('not_a_table')).toBeNull()
  })
})

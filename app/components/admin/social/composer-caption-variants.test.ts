/**
 * Ticket #5418(b): silent data loss in the Composer's caption editor.
 *
 * The Composer used to hold captions as a per-platform record and advertised
 * "N platform variants", but `submitSave` only ever sent the active
 * platform's text (a post row has one `platform`), so writing an Instagram
 * caption, tabbing to X, writing that, then saving silently dropped the
 * Instagram one. Persisting real per-platform variants needs a schema
 * change (protected path), judged too large for this PR, so the affordance
 * was removed: one caption, shared across every platform tab.
 *
 * This is a static source guard, honestly labelled (precedent:
 * structured-data.contract.test.tsx): the Composer uses `useFetcher`/`Link`,
 * which need a router context this project has no React Testing Library
 * harness to provide, so the regression this pins is "the misleading
 * counter, or a per-platform captions record, does not come back" rather
 * than a simulated typing/tab-switch interaction.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, 'Composer.tsx'), 'utf-8')

describe('Composer caption state (ticket #5418b)', () => {
  it('never advertises platform variants that are not stored', () => {
    // The old rendered counter, verbatim: `${...} platform variants` / 'one
    // variant'. Explanatory comments about why it was removed are fine (and
    // expected); only the rendered strings must be gone.
    expect(SRC).not.toContain('platform variants`')
    expect(SRC).not.toContain("'one variant'")
  })

  it('holds one caption, not a per-platform record', () => {
    expect(SRC).not.toMatch(/captions\[platform\]/)
    expect(SRC).not.toMatch(/setCaptions/)
    expect(SRC).toMatch(/useState<string>\(initial\.caption\)/)
  })

  it('switching platform tabs never resets or forks the caption text', () => {
    // The tab button's onClick must do nothing but change the active
    // platform; if it starts touching caption state again, the affordance is
    // silently coming back.
    const start = SRC.indexOf('role="tab"')
    const end = SRC.indexOf('</button>', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const tabButton = SRC.slice(start, end)
    expect(tabButton).not.toMatch(/caption/i)
    expect(tabButton).toContain('onClick={() => setPlatform(p)}')
  })
})

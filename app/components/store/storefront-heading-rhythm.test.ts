// Doctrine-scale H2 bottom margin on the storefront homepage (run 2212,
// design-critic ranked cheapest-certain item 1).
//
// How the class this pins produces the pixel it prevents, in one sentence
// (run 1703's rule): the homepage's section H2s all carry one display type
// signature, the gap between that heading and the section's content is set by
// the heading's own `mb-`, and the Nº 10 Notebook heading carried `mb-4` where
// its two siblings carry `mb-9` -- so the measured heading-to-grid gap was 35px
// under the Notebook against 51px under the panel deck, a rhythm break in the
// one axis doctrine §1 calls MANDATORY.
//
// Axes this binds (ticket #22810): WHAT (the mb value), HOW MANY (three
// margin-setting instances), WHERE (every instance in this file, not only the
// one that was edited -- run 1298's lesson), and the count of the DELIBERATE
// remaining instance that sets no margin at all, so a later sweep does not
// "fix" it into a margin it does not want.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync(new URL('./StorefrontHome.tsx', import.meta.url), 'utf8')
const SIGNATURE = String.raw`text-\[1\.9rem\] leading-\[1\.1\] tracking-\[-0\.01em\] text-ink md:text-\[2\.9rem\]`

describe('storefront doctrine-scale H2 rhythm', () => {
  it('gives every margin-setting instance the same mb-9', () => {
    const withMargin = SOURCE.match(new RegExp(String.raw`mb-\d+ ${SIGNATURE}`, 'g')) ?? []
    expect(withMargin).toHaveLength(3)
    for (const cls of withMargin) expect(cls.startsWith('mb-9 ')).toBe(true)
  })

  it('pins the one instance in this file that deliberately sets no margin', () => {
    // Nº 06's heading takes its spacing from a wrapper instead. Counted here so
    // a sweep that sees "a heading without mb-9" does not add one, and so that
    // adding a second margin-less heading has to be a deliberate edit to this
    // number. CuriosityShelf.tsx carries the same type signature and also sets
    // no margin; it is a different file and out of this guard's scope, which is
    // said here rather than left for the next reader to rediscover.
    const all = SOURCE.match(new RegExp(SIGNATURE, 'g')) ?? []
    const withMargin = SOURCE.match(new RegExp(String.raw`mb-\d+ ${SIGNATURE}`, 'g')) ?? []
    expect(all.length - withMargin.length).toBe(1)
    expect(all).toHaveLength(4)
  })
})

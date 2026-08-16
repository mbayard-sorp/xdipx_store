import { describe, expect, it } from 'vitest'
import { fixCharterCopy } from '~/lib/feed-processor.server'

describe('fixCharterCopy', () => {
  it('strips the "from someone who" lived-experience clause, keeping the lead-in and colon', () => {
    const { text, changed } = fixCharterCopy(
      "<p><em>Pro tip from someone who's tested plenty:</em> start slow with your favorite lube.</p>",
    )
    expect(changed).toBe(true)
    expect(text).toBe('<p><em>Pro tip:</em> start slow with your favorite lube.</p>')
    expect(text).not.toContain('someone who')
  })

  it('converts "</em> — clause" into its own capitalized sentence', () => {
    const { text } = fixCharterCopy(
      "<p><em>My tip? Start slow</em> — the anticipation builds beautifully.</p>",
    )
    expect(text).toBe('<p><em>My tip? Start slow.</em> The anticipation builds beautifully.</p>')
  })

  it('does not double a period when the aside already ends in terminal punctuation', () => {
    const { text } = fixCharterCopy('<p><em>Pro tip: warm it first.</em> — it makes a big difference.</p>')
    expect(text).toBe('<p><em>Pro tip: warm it first.</em> It makes a big difference.</p>')
  })

  it('collapses a double em-dash parenthetical into a comma pair', () => {
    const { text } = fixCharterCopy('<p>known for — up to 6,300 RPM — with the freedom to move.</p>')
    expect(text).toBe('<p>known for, up to 6,300 RPM, with the freedom to move.</p>')
  })

  it('turns a remaining mid-sentence em-dash into a comma, no capitalization', () => {
    const { text } = fixCharterCopy('<p>This is the lube that just works — a best-seller for good reason.</p>')
    expect(text).toBe('<p>This is the lube that just works, a best-seller for good reason.</p>')
  })

  it('handles a no-space em-dash', () => {
    const { text } = fixCharterCopy('<p>perfect transparency—sculpted balls, natural curves.</p>')
    expect(text).toBe('<p>perfect transparency, sculpted balls, natural curves.</p>')
  })

  it('never leaves an em-dash behind', () => {
    const { text } = fixCharterCopy(
      '<p>A — B. <em>C from someone who has been there:</em> D — E — F. G—H.</p>',
    )
    expect(text).not.toMatch(/—/)
  })

  it('reports changed: false and leaves clean text untouched', () => {
    const clean = '<p>This lube works great, no complaints so far. Rinses clean, plays nice with toys.</p>'
    const { text, changed } = fixCharterCopy(clean)
    expect(changed).toBe(false)
    expect(text).toBe(clean)
  })

  it('is idempotent: running it twice produces the same result', () => {
    const once = fixCharterCopy(
      "<p><em>Pro tip from someone who's tried it all:</em> start slow</em> — trust the process.</p>",
    )
    const twice = fixCharterCopy(once.text)
    expect(twice.text).toBe(once.text)
    expect(twice.changed).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { EmphasizedHeading } from './EmphasizedHeading'

/**
 * Doctrine §2: exactly one plum-italic emphasis word per headline, never zero
 * and never two.
 *
 * Ticket #461 stopped a published emphasis word that is ABSENT from its heading
 * from rendering as a stray, unspaced <em> glued to the end of the sentence
 * ("...favorites?safe"). It did that by rendering the heading entirely plain,
 * which then produced the opposite failure: on 2026-09-30 the live hero H1 —
 * "Fits in a carry-on, rumbles like it never heard of one.", the biggest type
 * on the site — carried no emphasis word at all, because `emmaHero.headline`
 * had been rewritten and `emmaHero.emphasisWord` had not (design-critic run
 * 1162, ticket #12340). A stale Sanity field silently deleting a doctrine
 * requirement is worse than the thing #461 was guarding against, and both are
 * avoidable: a mismatch now degrades to the SAME last-word treatment an unset
 * field already gets, so the <em> is always a real word in its real position.
 */
describe('EmphasizedHeading', () => {
  const html = (el: React.ReactElement) => renderToStaticMarkup(el)

  it('wraps the supplied emphasis word when it is present', () => {
    expect(html(<EmphasizedHeading text="Find your way in." emphasis="way" />))
      .toBe('Find your <em class="em">way</em> in.')
  })

  it('italicizes the last word when no emphasis is supplied', () => {
    expect(html(<EmphasizedHeading text="Chosen for how they feel." />))
      .toBe('Chosen for how they <em class="em">feel</em>.')
  })

  it('falls back to the last word when the emphasis is absent from the heading', () => {
    // The #12340 regression. Previously this rendered plain, with no <em>.
    const out = html(<EmphasizedHeading text="Fits in a carry-on, rumbles like it never heard of one." emphasis="stale" />)
    expect(out).toContain('<em class="em">one</em>')
    expect(out).not.toContain('stale')
  })

  it('never appends a stray unspaced <em> to the end (ticket #461)', () => {
    const out = html(<EmphasizedHeading text="Not sure which glide belongs with your favorites?" emphasis="safe" />)
    expect(out).not.toContain('?safe')
    expect(out).not.toContain('<em class="em">safe</em>')
    // and the fallback still leaves exactly one em, on a word that is really there
    expect(out.match(/<em /g)).toHaveLength(1)
    expect(out).toContain('<em class="em">favorites</em>?')
  })

  it('emits exactly one em for every shape it handles', () => {
    for (const el of [
      <EmphasizedHeading text="Find your way in." emphasis="way" />,
      <EmphasizedHeading text="Find your way in." />,
      <EmphasizedHeading text="Find your way in." emphasis="absent" />,
    ]) {
      expect(html(el).match(/<em /g), html(el)).toHaveLength(1)
    }
  })

  it('renders a one-word heading plain rather than italicizing the whole thing', () => {
    expect(html(<EmphasizedHeading text="Sale" />)).toBe('Sale')
  })

  it('uses the lifted plum on dark grounds', () => {
    // Base .em plum clears only ~2.48:1 on ink, under the 3:1 large-display floor.
    expect(html(<EmphasizedHeading text="Still deciding?" onDark />))
      .toContain('<em class="em em-on-dark">deciding</em>')
  })
})

/**
 * Trailing-symbol and whitespace handling in the last-word fallback. This path
 * used to run only on a handful of hardcoded headings; since ticket #12340 it
 * runs on every published rail heading, which is exactly where an Emma-voice
 * line is most likely to end on a ♥ (tech-architect, run 1162).
 */
describe('EmphasizedHeading last-word fallback picks a word, not a glyph', () => {
  const html = (el: React.ReactElement) => renderToStaticMarkup(el)

  it.each([
    ['Chosen for how they feel.', 'feel', '.'],
    ['Where do you want to start?', 'start', '?'],
    ['Hand over the remote ♥', 'remote', ' ♥'],
    ['Find your fit →', 'fit', ' →'],
    ['Under thirty, and every one of them packs a real buzz…', 'buzz', '…'],
  ])('%s → italicizes %s', (text, word) => {
    const out = html(<EmphasizedHeading text={text} />)
    expect(out).toContain(`<em class="em">${word}</em>`)
    expect(out.match(/<em /g)).toHaveLength(1)
  })

  it('keeps the trailing symbol outside the em, and the text intact', () => {
    expect(html(<EmphasizedHeading text="Hand over the remote ♥" />))
      .toBe('Hand over the <em class="em">remote</em> ♥')
  })

  it('never italicizes an empty string on a double space', () => {
    expect(html(<EmphasizedHeading text="Two  spaces here." />))
      .toBe('Two spaces <em class="em">here</em>.')
  })
})

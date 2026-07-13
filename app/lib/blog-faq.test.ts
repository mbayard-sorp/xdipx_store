import { describe, expect, it } from 'vitest'
import { extractFaqItems } from './blog-faq'

function block(style: string, text: string) {
  return { _type: 'block', style, children: [{ _type: 'span', text }] }
}

describe('extractFaqItems', () => {
  it('extracts question/answer pairs from an FAQ section', () => {
    const body = [
      block('h2', 'How they work'),
      block('normal', 'Some intro prose.'),
      block('h2', 'Frequently asked questions'),
      block('h3', 'How long until results?'),
      block('normal', 'Most people notice a difference in a few weeks.'),
      block('h3', 'Who are they for?'),
      block('normal', 'Anyone with a pelvic floor.'),
    ]
    expect(extractFaqItems(body)).toEqual([
      { question: 'How long until results?', answer: 'Most people notice a difference in a few weeks.' },
      { question: 'Who are they for?', answer: 'Anyone with a pelvic floor.' },
    ])
  })

  it('returns empty when there is no FAQ heading', () => {
    const body = [block('h2', 'How they work'), block('normal', 'Prose.')]
    expect(extractFaqItems(body)).toEqual([])
  })

  it('matches a bare "FAQ" heading case-insensitively', () => {
    const body = [
      block('h2', 'FAQ'),
      block('h3', 'Q one?'),
      block('normal', 'A one.'),
    ]
    expect(extractFaqItems(body)).toEqual([{ question: 'Q one?', answer: 'A one.' }])
  })

  it('stops at the next h2 after the FAQ section', () => {
    const body = [
      block('h2', 'Frequently asked questions'),
      block('h3', 'Q one?'),
      block('normal', 'A one.'),
      block('h2', 'The bottom line'),
      block('h3', 'Not a question'),
      block('normal', 'Not an answer.'),
    ]
    expect(extractFaqItems(body)).toEqual([{ question: 'Q one?', answer: 'A one.' }])
  })

  it('joins multi-paragraph answers and ignores embed blocks', () => {
    const body = [
      block('h2', 'FAQs'),
      block('h3', 'Q one?'),
      block('normal', 'First paragraph.'),
      { _type: 'blogProductEmbed', productHandle: 'some-product' },
      block('normal', 'Second paragraph.'),
    ]
    expect(extractFaqItems(body)).toEqual([
      { question: 'Q one?', answer: 'First paragraph. Second paragraph.' },
    ])
  })

  it('drops questions with no answer text', () => {
    const body = [
      block('h2', 'FAQ'),
      block('h3', 'Q with no answer?'),
      block('h3', 'Q two?'),
      block('normal', 'A two.'),
    ]
    expect(extractFaqItems(body)).toEqual([{ question: 'Q two?', answer: 'A two.' }])
  })
})

import { describe, expect, it } from 'vitest'
import { sweepPublishedCorpus } from './published-self-consistency-sweep'

function block(style: string, text: string) {
  return { _type: 'block', style, children: [{ _type: 'span', text }] }
}

describe('sweepPublishedCorpus (ticket #21021: published-vs-published, not just draft-vs-published)', () => {
  it('flags two published posts that give opposite instructions for the same code', () => {
    const posts = [
      {
        slug: 'post-a',
        title: 'Post A',
        body: [block('normal', "This toy's IPX7 rating means you can use it right in the shower.")],
      },
      {
        slug: 'post-b',
        title: 'Post B',
        body: [block('normal', 'IPX7 covers immersion only, so never run it under a shower or a direct tap.')],
      },
    ]

    const report = sweepPublishedCorpus(posts)
    expect(report.overLimit).toBe(true)
    expect(report.crossPost).toHaveLength(1)
    const [c] = report.crossPost
    expect(c?.token).toBe('IPX7')
    expect([c?.draftSite.section, c?.priorSlug]).toBeTruthy()
  })

  it('reports a conflicting pair exactly once, not twice, regardless of scan order', () => {
    const posts = [
      {
        slug: 'post-a',
        title: 'Post A',
        body: [block('normal', "This toy's IPX7 rating means you can use it right in the shower.")],
      },
      {
        slug: 'post-b',
        title: 'Post B',
        body: [block('normal', 'IPX7 covers immersion only, so never run it under a shower or a direct tap.')],
      },
    ]

    const report = sweepPublishedCorpus(posts)
    expect(report.crossPost).toHaveLength(1)
  })

  it('flags a published post that contradicts itself (in-document), not only cross-post pairs', () => {
    const posts = [
      {
        slug: 'self-contradicting-post',
        title: 'Self-contradicting post',
        body: [
          block('normal', 'IPX7 covers immersion only, so never run it under a shower or a direct tap.'),
          block('normal', "Because it's IPX7, the shower is fair game."),
        ],
      },
      {
        slug: 'unrelated-post',
        title: 'Unrelated post',
        body: [block('normal', 'Store this one in its drawstring bag, away from other toys.')],
      },
    ]

    const report = sweepPublishedCorpus(posts)
    expect(report.overLimit).toBe(true)
    expect(report.perPost).toHaveLength(1)
    expect(report.perPost[0]?.slug).toBe('self-contradicting-post')
    expect(report.perPost[0]?.findings.some(f => f.kind === 'conflicting-instruction')).toBe(true)
  })

  it('is clean when every post agrees with every other post and with itself', () => {
    const sentence = 'IPX7 covers immersion only, so never run it under a shower or a direct tap.'
    const posts = [
      { slug: 'post-a', title: 'Post A', body: [block('normal', sentence)] },
      { slug: 'post-b', title: 'Post B', body: [block('normal', sentence)] },
      { slug: 'post-c', title: 'Post C', body: [block('normal', 'Nothing about water ratings here at all.')] },
    ]

    const report = sweepPublishedCorpus(posts)
    expect(report.overLimit).toBe(false)
    expect(report.perPost).toHaveLength(0)
    expect(report.crossPost).toHaveLength(0)
  })

  it('does not flag a cross-post conflict between two different, unrelated ingress codes', () => {
    const posts = [
      { slug: 'post-a', title: 'Post A', body: [block('normal', "This toy's IPX7 rating means you can use it right in the shower.")] },
      { slug: 'post-b', title: 'Post B', body: [block('normal', 'This toy is rated IPX4, and that means it should never go under a shower or a direct tap.')] },
    ]

    const report = sweepPublishedCorpus(posts)
    expect(report.crossPost).toHaveLength(0)
  })
})

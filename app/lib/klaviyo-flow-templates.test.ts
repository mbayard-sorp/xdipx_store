import { describe, it, expect } from 'vitest'
import {
  ACT_BLOCKS,
  ACT_DEFAULT,
  CTA_WHITELIST,
  FLOW_EMAILS,
  renderFlowEmail,
} from './klaviyo-flow-templates'

// Every string a customer can read: subjects, previews, headline, lead, closer,
// discreet line, CTA, the act blocks, and the rendered HTML and text.
const EM_DASH = '\u2014'
const EN_DASH = '\u2013'

function allCopy(): string[] {
  const out: string[] = [ACT_DEFAULT, ...Object.values(ACT_BLOCKS)]
  for (const e of FLOW_EMAILS) {
    out.push(...e.subjects, ...e.previews, e.headline, e.lead, e.closer, e.discreetLine, e.cta)
    const r = renderFlowEmail(e)
    out.push(r.html, r.text)
  }
  return out
}

describe('klaviyo flow templates', () => {
  it('covers the three flows with five emails', () => {
    expect(FLOW_EMAILS.map(e => e.key)).toEqual(['browse-4h', 'cart-1h', 'cart-24h', 'post-3d', 'post-14d'])
    expect(new Set(FLOW_EMAILS.map(e => e.flow)).size).toBe(3)
  })

  it('has three subject and three preview variants per email', () => {
    for (const e of FLOW_EMAILS) {
      expect(e.subjects).toHaveLength(3)
      expect(e.previews).toHaveLength(3)
      expect(new Set(e.subjects).size).toBe(3)
    }
  })

  it('contains no em-dash or en-dash anywhere', () => {
    for (const s of allCopy()) {
      expect(s.includes(EM_DASH)).toBe(false)
      expect(s.includes(EN_DASH)).toBe(false)
    }
  })

  it('carries the unsubscribe tag and a postal address tag in html and text', () => {
    for (const e of FLOW_EMAILS) {
      const r = renderFlowEmail(e)
      expect(r.html).toContain("{% unsubscribe '")
      expect(r.text).toContain("{% unsubscribe '")
      expect(r.html).toContain('{{ organization.full_address }}')
    }
  })

  it('uses exactly one CTA, from the whitelist', () => {
    for (const e of FLOW_EMAILS) {
      expect(CTA_WHITELIST as readonly string[]).toContain(e.cta)
      const r = renderFlowEmail(e)
      const links = r.html.match(/<a href="[^"]*utm_source=klaviyo[^"]*"/g) ?? []
      // The header image is linked to the same URL; the button is the one text CTA.
      const buttons = r.html.match(new RegExp(`>${e.cta.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</a>`, 'g')) ?? []
      expect(buttons).toHaveLength(1)
      expect(links.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('tags every link with utm source, medium, campaign and content', () => {
    for (const e of FLOW_EMAILS) {
      const r = renderFlowEmail(e)
      expect(r.html).toContain('utm_source=klaviyo&amp;utm_medium=email')
      expect(r.html).toContain(`utm_campaign=${e.flow}`)
      expect(r.html).toContain(`utm_content=${e.step}`)
      expect(r.text).toContain(`utm_campaign=${e.flow}&utm_content=${e.step}`)
    }
  })

  it('interpolates the product name and header image with safe defaults', () => {
    for (const e of FLOW_EMAILS) {
      const r = renderFlowEmail(e)
      expect(r.html).toContain('{{ event.HeaderImageURL }}')
      expect(r.html).toContain('{% if event.HeaderImageURL %}')
      expect(r.html).toContain('{{ event.ProductName|default:')
      expect(r.html).toContain('{{ event.ProductURL|default:')
    }
  })

  it('states the discreet line once per email and never shows a price or countdown', () => {
    const banned = [
      /\$\s?\d/,
      /\bprice\b/i,
      /\bbuy now\b/i,
      /\bsexy\b/i,
      /last chance/i,
      /hurry/i,
      /midnight/i,
      /expires?\b/i,
      /limited time/i,
      /\bI (tried|tested|own)\b/i,
    ]
    for (const e of FLOW_EMAILS) {
      const r = renderFlowEmail(e)
      expect(r.html.match(/XDIPX/g)?.length ?? 0).toBeLessThanOrEqual(1)
      for (const re of banned) {
        expect(re.test(r.html)).toBe(false)
        expect(re.test(r.text)).toBe(false)
        for (const s of [...e.subjects, ...e.previews]) expect(re.test(s)).toBe(false)
      }
    }
  })

  it('keeps the desire register free of hedges and dares', () => {
    const hedges = /\b(if|unless|might|maybe|designed to|can help)\b/i
    const dares = /\b(beg|see how long|you'll lose)\b/i
    for (const s of [ACT_DEFAULT, ...Object.values(ACT_BLOCKS)]) {
      expect(hedges.test(s)).toBe(false)
      expect(dares.test(s)).toBe(false)
    }
  })

  it('renders a 600px max, table-based layout with the Newsreader fallback stack', () => {
    const r = renderFlowEmail(FLOW_EMAILS[0]!)
    expect(r.html).toContain('width="600"')
    expect(r.html).toContain('max-width:100%')
    expect(r.html).toContain('role="presentation"')
    expect(r.html).toContain("Newsreader, Georgia, 'Times New Roman', serif")
  })
})

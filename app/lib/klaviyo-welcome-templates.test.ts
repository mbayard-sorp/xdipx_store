import { describe, expect, it } from 'vitest'
import { LEAD_INTERESTS, LEAD_OFFER } from './lead-interests'
import {
  CTA_WHITELIST,
  WELCOME_EMAILS,
  buildWelcomeFlowPayload,
  renderWelcomeEmail,
  welcomeEmailsFor,
  welcomeTemplateName,
} from './klaviyo-welcome-templates'

const EM_DASH = '—'
const EN_DASH = '–'

function allCopy(): string[] {
  const out: string[] = []
  for (const e of WELCOME_EMAILS) {
    out.push(e.subject, e.preview, e.headline, e.lead, e.closer, e.discreetLine, e.cta, ...Object.values(e.shelf))
    const r = renderWelcomeEmail(e)
    out.push(r.html, r.text)
  }
  return out
}

describe('klaviyo welcome templates', () => {
  it('covers the two families: two paid-leads emails, three email-list emails', () => {
    expect(welcomeEmailsFor('paid-leads-welcome').map(e => e.key)).toEqual(['welcome-0h', 'welcome-3d'])
    expect(welcomeEmailsFor('email-list-welcome').map(e => e.key)).toEqual(['hello-0h', 'hello-3d', 'hello-7d'])
    expect(WELCOME_EMAILS.map(welcomeTemplateName)).toContain('xdipx paid-leads-welcome welcome-0h')
  })

  it('contains no em dash or en dash anywhere, and never the banned adjective', () => {
    for (const s of allCopy()) {
      expect(s).not.toContain(EM_DASH)
      expect(s).not.toContain(EN_DASH)
      expect(s.toLowerCase()).not.toMatch(/\bsexy\b/)
    }
  })

  it('uses one whitelisted CTA per email and the unsubscribe and address tags', () => {
    for (const e of WELCOME_EMAILS) {
      expect(CTA_WHITELIST).toContain(e.cta)
      const r = renderWelcomeEmail(e)
      expect(r.html).toContain("{% unsubscribe 'Unsubscribe' %}")
      expect(r.html).toContain('{{ organization.full_address }}')
      expect(r.text).toContain("{% unsubscribe 'Unsubscribe' %}")
    }
  })

  it('paid-leads emails branch on person.interest for all seven shelves, with a /start fallback', () => {
    for (const e of welcomeEmailsFor('paid-leads-welcome')) {
      const r = renderWelcomeEmail(e)
      for (const i of LEAD_INTERESTS) {
        expect(r.html).toContain(`person.interest == "${i.slug}"`)
        expect(r.html).toContain(encodeURIComponent(i.destination))
      }
      expect(r.html).toContain('{% else %}')
      expect(r.html).toContain('https://xdipx.com/discount/CURIOUS15?redirect=')
      expect(r.html).toContain(encodeURIComponent('/start'))
      expect(r.text).toContain('person.interest == "wands"')
    }
  })

  it('paid-leads emails show the code and its full terms; email-list emails show neither', () => {
    for (const e of welcomeEmailsFor('paid-leads-welcome')) {
      const r = renderWelcomeEmail(e)
      expect(r.html).toContain(LEAD_OFFER.code)
      expect(r.html).toContain(LEAD_OFFER.terms)
      expect(r.text).toContain(LEAD_OFFER.terms)
    }
    for (const e of welcomeEmailsFor('email-list-welcome')) {
      const r = renderWelcomeEmail(e)
      expect(r.html).not.toContain(LEAD_OFFER.code)
      expect(r.html).not.toContain('person.interest')
      expect(r.html).toMatch(/https:\/\/xdipx\.com\/(start)?\?utm_source=klaviyo/)
    }
  })

  it('tags every shelf link with utm source, medium, campaign and content', () => {
    for (const e of WELCOME_EMAILS) {
      const r = renderWelcomeEmail(e)
      const links = r.html.match(/href="https:\/\/xdipx\.com[^"]*"/g) ?? []
      expect(links.length).toBeGreaterThan(0)
      for (const l of links) {
        const decoded = decodeURIComponent(l.replace(/&amp;/g, '&'))
        expect(decoded).toContain('utm_source=klaviyo')
        expect(decoded).toContain('utm_medium=email')
        expect(decoded).toContain(`utm_campaign=${e.flow}`)
        expect(decoded).toContain(`utm_content=${e.step}`)
      }
    }
  })

  it('says the discreet line once, names no countdown, and sets one plum emphasis word', () => {
    for (const e of WELCOME_EMAILS) {
      const r = renderWelcomeEmail(e)
      expect(r.html.split('XDIPX').length - 1).toBe(1)
      expect(r.html.toLowerCase()).not.toMatch(/last chance|expires (today|soon|in)|hurry up|ends tonight|only \d+ left/)
      expect(e.headline).toContain(e.emphasis)
      expect(r.html.split('class="x-plum"').length - 1).toBe(1)
    }
  })

  it('never claims Emma used a product or cites proof we do not have', () => {
    for (const s of allCopy()) {
      expect(s.toLowerCase()).not.toMatch(/\bi (tried|tested|own|use|love)\b/)
      expect(s.toLowerCase()).not.toMatch(/most people|\d+% of (people|customers|readers)|customers say|best.?seller|come back to/)
    }
  })
})

describe('buildWelcomeFlowPayload', () => {
  const ctx = { listId: 'LIST1', placedOrderMetricId: 'PO', templateIds: { 'welcome-0h': 'T0', 'welcome-3d': 'T3' }, fromEmail: 'hello@xdipx.com', fromLabel: 'xdipx' }

  it('triggers on the list, sends the first email immediately, then day 3, and never sets a status', () => {
    const p = buildWelcomeFlowPayload(ctx) as { data: { attributes: { definition: { triggers: unknown[]; entry_action_id: string; actions: Record<string, unknown>[] } } } }
    const def = p.data.attributes.definition
    expect(def.triggers).toEqual([{ type: 'list', id: 'LIST1' }])
    expect(def.entry_action_id).toBe('email-1')
    expect(def.actions.map(a => a['type'])).toEqual(['send-email', 'time-delay', 'send-email'])
    const delay = def.actions[1]!['data'] as { unit: string; value: number }
    expect(delay).toMatchObject({ unit: 'days', value: 3 })
    expect(JSON.stringify(p)).not.toContain('"status"')
    const last = def.actions[2]!['links'] as { next: null }
    expect(last.next).toBeNull()
  })

  it('filters out profiles with a Placed Order, and drops the filter when the metric is unknown', () => {
    const withFilter = buildWelcomeFlowPayload(ctx) as { data: { attributes: { definition: Record<string, unknown> } } }
    expect(JSON.stringify(withFilter.data.attributes.definition['profile_filter'])).toContain('"metric_id":"PO"')
    const noFilter = buildWelcomeFlowPayload({ ...ctx, placedOrderMetricId: null }) as { data: { attributes: { definition: Record<string, unknown> } } }
    expect(noFilter.data.attributes.definition['profile_filter']).toBeUndefined()
  })

  it('uses the template id per email key and turns smart sending off for the immediate email', () => {
    const p = buildWelcomeFlowPayload(ctx) as { data: { attributes: { definition: { actions: { type: string; data: { message?: { template_id: string; smart_sending_enabled: boolean } } }[] } } } }
    const emails = p.data.attributes.definition.actions.filter(a => a.type === 'send-email').map(a => a.data.message!)
    expect(emails.map(m => m.template_id)).toEqual(['T0', 'T3'])
    expect(emails.map(m => m.smart_sending_enabled)).toEqual([false, true])
  })
})

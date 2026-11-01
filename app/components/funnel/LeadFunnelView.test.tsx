import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoutesStub } from 'react-router'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getLeadFunnelPage } from '~/lib/lead-funnel'
import { LeadFunnelView } from './LeadFunnelView'

/**
 * /api/lead answers a filled honeypot with a fake success and drops the lead.
 * Chrome and iOS Safari ignore autoComplete="off" on that input. With "company"
 * as its name and label, a saved address (Chrome 156) or a contact (iOS 27
 * Safari, "work" card) filled it. Chrome still read it as COMPANY_NAME with the
 * name changed and the label kept, so both have to stay neutral. These pin the
 * markup that keeps real visitors out of the trap.
 */

function renderForm(smsOptin: boolean): string {
  const page = getLeadFunnelPage('hello')
  if (!page) throw new Error('hello funnel page missing')
  const Stub = createRoutesStub([
    { path: '/', Component: () => <LeadFunnelView page={page} utm={{}} terms="terms" smsOptin={smsOptin} /> },
  ])
  return renderToStaticMarkup(<Stub initialEntries={['/']} />)
}

function honeypotBlock(html: string): string {
  const block = html.match(/<div aria-hidden="true"[^>]*>.*?<\/div>/s)?.[0]
  if (!block) throw new Error('honeypot block missing')
  return block
}

describe('LeadFunnelView honeypot', () => {
  it.each([true, false])('still renders off-screen with smsOptin=%s', smsOptin => {
    const block = honeypotBlock(renderForm(smsOptin))
    expect(block).toContain('-left-[9999px]')
    expect(block).toContain('name="xdx_hp"')
    expect(block).toContain('tabindex="-1"')
  })

  it('has no name or label a browser reads as an address field', () => {
    expect(honeypotBlock(renderForm(true))).not.toMatch(
      /company|organi[sz]ation|business|employer|address|street|city|state|zip|postal|country|phone|email|name="name"|first|last/i,
    )
  })

  it('renders no input named company anywhere in the form', () => {
    expect(renderForm(true)).not.toMatch(/name="company"/)
  })

  it('still reports the trap to /api/lead as company', () => {
    const source = readFileSync(fileURLToPath(new URL('./LeadFunnelView.tsx', import.meta.url)), 'utf8')
    expect(source).toContain("company: String(form.get('xdx_hp') ?? '')")
  })
})

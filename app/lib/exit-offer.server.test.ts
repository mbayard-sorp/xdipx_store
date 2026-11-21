import { describe, expect, it } from 'vitest'
import { claimedExitCode, getExitOffer } from './exit-offer.server'

describe('the Gawk exit offer while the page deal is the free lube kit', () => {
  it('carries no code, so nothing is promised that the kit cart cannot give', () => {
    const offer = getExitOffer('gawk-gawk-3000')
    expect(offer?.code).toBeNull()
    expect(offer?.terms).not.toMatch(/%|GAWK10/)
    expect(offer?.smsLine).not.toMatch(/%|GAWK10/)
  })

  it('puts no code on the cart, even for a browser still holding the old GAWK10 cookie', () => {
    const request = new Request('https://curious.xdipx.com/gawk-gawk-3000', { headers: { Cookie: 'xdipx_exit_code=GAWK10' } })
    expect(claimedExitCode(request, 'gawk-gawk-3000')).toBeNull()
  })
})

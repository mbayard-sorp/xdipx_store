// Ticket #13154: the credential-health sweep covers nine integrations but
// not the two prepaid balances every publishing lane actually depends on —
// the Anthropic API key and Atlas Cloud's account credit. These lock in the
// three states that matter for each: a live answer, an authoritative
// rejection (dead key or empty balance, both of which must file the same
// owner blocker), and a could-not-ask that must never be mistaken for dead.
import { afterEach, describe, expect, it, vi } from 'vitest'

const anthropicCreateMock = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: anthropicCreateMock }
  },
}))

import { checkCredential } from './credential-health.server'

describe('anthropic credential check', () => {
  const realFetch = global.fetch

  afterEach(() => {
    vi.unstubAllEnvs()
    anthropicCreateMock.mockReset()
    global.fetch = realFetch
  })

  it('is unconfigured when the env var is absent', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const v = await checkCredential('anthropic')
    expect(v.state).toBe('unconfigured')
  })

  it('is live when the 1-token probe answers', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
    anthropicCreateMock.mockResolvedValueOnce({ content: [{ type: 'text', text: 'hi' }] })
    const v = await checkCredential('anthropic')
    expect(v.state).toBe('live')
  })

  it('is dead on an empty credit balance', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
    anthropicCreateMock.mockRejectedValueOnce(
      new Error(
        '400 {"type":"error","error":{"type":"invalid_request_error",'
        + '"message":"Your credit balance is too low to access the Anthropic API. '
        + 'Please go to Plans & Billing to upgrade or purchase credits."}}',
      ),
    )
    const v = await checkCredential('anthropic')
    expect(v.state).toBe('dead')
  })

  it('is dead on an authentication rejection, not just a missing env var', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-revoked')
    anthropicCreateMock.mockRejectedValueOnce(
      new Error('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'),
    )
    const v = await checkCredential('anthropic')
    expect(v.state).toBe('dead')
  })

  it('is unknown, never dead, on a network error', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
    anthropicCreateMock.mockRejectedValueOnce(new Error('fetch failed: ECONNRESET'))
    const v = await checkCredential('anthropic')
    expect(v.state).toBe('unknown')
  })
})

describe('atlas credential check', () => {
  const realFetch = global.fetch

  afterEach(() => {
    vi.unstubAllEnvs()
    global.fetch = realFetch
  })

  it('is unconfigured when the env var is absent', async () => {
    vi.stubEnv('ATLAS_CLOUD_API_KEY', '')
    const v = await checkCredential('atlas')
    expect(v.state).toBe('unconfigured')
  })

  it('is live with a positive available balance', async () => {
    vi.stubEnv('ATLAS_CLOUD_API_KEY', 'apikey-test')
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ available: { value: '12.500000', currency: 'USD' } }), { status: 200 }),
    ) as unknown as typeof fetch
    const v = await checkCredential('atlas')
    expect(v.state).toBe('live')
  })

  it('is dead when the key is valid but the available balance is zero', async () => {
    vi.stubEnv('ATLAS_CLOUD_API_KEY', 'apikey-test')
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ available: { value: '0.000000', currency: 'USD' } }), { status: 200 }),
    ) as unknown as typeof fetch
    const v = await checkCredential('atlas')
    expect(v.state).toBe('dead')
  })

  it('is dead on an authoritative 401', async () => {
    vi.stubEnv('ATLAS_CLOUD_API_KEY', 'apikey-revoked')
    global.fetch = vi.fn(async () => new Response('{}', { status: 401 })) as unknown as typeof fetch
    const v = await checkCredential('atlas')
    expect(v.state).toBe('dead')
  })

  it('is unknown, never dead, on a network error', async () => {
    vi.stubEnv('ATLAS_CLOUD_API_KEY', 'apikey-test')
    global.fetch = vi.fn(async () => { throw new Error('network down') }) as unknown as typeof fetch
    const v = await checkCredential('atlas')
    expect(v.state).toBe('unknown')
  })

  it('is unknown, never dead, on a 5xx', async () => {
    vi.stubEnv('ATLAS_CLOUD_API_KEY', 'apikey-test')
    global.fetch = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch
    const v = await checkCredential('atlas')
    expect(v.state).toBe('unknown')
  })
})

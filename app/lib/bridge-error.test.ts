import { describe, it, expect } from 'vitest'
import { data } from 'react-router'
import { BRIDGE_404, STOREFRONT_404, bridgeErrorStatus, isBridgeError } from './bridge-error'

// Mirrors what react-router hands useRouteError(): an ErrorResponse with status + data.
const asRouteError = (d: ReturnType<typeof data>) => ({ status: d.init?.status, data: d.data })

describe('isBridgeError', () => {
  it('sends a storefront 404 to the root boundary', () => {
    expect(isBridgeError(asRouteError(data(STOREFRONT_404, { status: 404 })))).toBe(false)
  })
  it('keeps a bridge-host 404 on the funnel view', () => {
    expect(isBridgeError(asRouteError(data(BRIDGE_404, { status: 404 })))).toBe(true)
  })
  it('treats thrown Errors, plain strings and 500s as bridge errors', () => {
    expect(isBridgeError(new Error('boom'))).toBe(true)
    expect(isBridgeError({ status: 500, data: 'Server error' })).toBe(true)
    expect(isBridgeError(undefined)).toBe(true)
  })
})

describe('bridgeErrorStatus', () => {
  it('uses the thrown status, defaults to 500', () => {
    expect(bridgeErrorStatus({ status: 404, data: BRIDGE_404 })).toBe(404)
    expect(bridgeErrorStatus(new Error('x'))).toBe(500)
    expect(bridgeErrorStatus({ status: 200 })).toBe(500)
  })
})

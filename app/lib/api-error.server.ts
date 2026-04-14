import { randomBytes } from 'node:crypto'
import { Sentry } from '~/lib/sentry.server'

const isProd = process.env['NODE_ENV'] === 'production'

export interface ApiErrorResponse {
  error: string
  requestId: string
}

/**
 * Log an error server-side and return a sanitized Response for a client.
 *
 * In production, the response contains only `fallbackMessage` plus a `requestId`
 * the server logs alongside the full error — no stack traces, no internal
 * messages reach the client. In development, `err.message` is echoed for DX.
 */
export function apiError(
  tag: string,
  err: unknown,
  fallbackMessage = 'Internal server error',
  status = 500,
): Response {
  const requestId = randomBytes(6).toString('hex')
  console.error(`[${tag}] [req:${requestId}]`, err)
  Sentry.captureException(err, { tags: { api: tag, requestId } })

  const body: ApiErrorResponse = {
    error:
      isProd || !(err instanceof Error)
        ? fallbackMessage
        : `${fallbackMessage}: ${err.message}`,
    requestId,
  }
  return Response.json(body, { status })
}

import { PassThrough } from 'node:stream'

import type { AppLoadContext, EntryContext } from 'react-router'
import { createReadableStreamFromReadable } from '@react-router/node'
import { ServerRouter } from 'react-router'
import { isbot } from 'isbot'
import type { RenderToPipeableStreamOptions } from 'react-dom/server'
import { renderToPipeableStream } from 'react-dom/server'
import { Sentry } from '~/lib/sentry.server'

export const streamTimeout = 5_000

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: AppLoadContext,
) {
  if (request.method.toUpperCase() === 'HEAD') {
    return new Response(null, { status: responseStatusCode, headers: responseHeaders })
  }

  return new Promise((resolve, reject) => {
    let shellRendered = false
    const userAgent = request.headers.get('user-agent')

    const readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode
        ? 'onAllReady'
        : 'onShellReady'

    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => abort(),
      streamTimeout + 1000,
    )

    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} />,
      {
        [readyOption]() {
          shellRendered = true
          const body = new PassThrough({
            final(callback) {
              clearTimeout(timeoutId)
              timeoutId = undefined
              callback()
            },
          })
          const stream = createReadableStreamFromReadable(body)
          responseHeaders.set('Content-Type', 'text/html')
          pipe(body)
          resolve(new Response(stream, { headers: responseHeaders, status: responseStatusCode }))
        },
        onShellError(error: unknown) {
          reject(error)
        },
        onError(error: unknown) {
          responseStatusCode = 500
          if (shellRendered) console.error(error)
        },
      },
    )
  })
}

// React Router calls this for every error thrown in loaders, actions, and
// during server rendering. Report to Sentry here so loader errors are tracked
// even when the route-level ErrorBoundary handles them.
export function handleError(
  error: unknown,
  { request }: { request: Request },
) {
  if (request.signal.aborted) return
  if (error instanceof Error) {
    Sentry.captureException(error, { extra: { url: request.url } })
    return
  }
  // React Router sometimes surfaces thrown Responses as non-Error values.
  // Don't report 4xx Responses — those are intentional (redirects, 404s).
  if (error instanceof Response) {
    if (error.status >= 500) {
      Sentry.captureException(
        new Error(`Response thrown: ${error.status} ${error.statusText}`),
        { extra: { url: request.url, status: error.status } },
      )
    }
    return
  }
  let message: string
  try {
    message = typeof error === 'string' ? error : JSON.stringify(error)
  } catch {
    message = Object.prototype.toString.call(error)
  }
  const wrapped = new Error(`Non-Error thrown: ${message}`)
  Sentry.captureException(wrapped, { extra: { url: request.url, raw: error } })
}

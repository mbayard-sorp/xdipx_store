import { PassThrough } from 'node:stream'

import type { AppLoadContext, EntryContext } from 'react-router'
import { createReadableStreamFromReadable } from '@react-router/node'
import { ServerRouter } from 'react-router'
import { isbot } from 'isbot'
import type { RenderToPipeableStreamOptions } from 'react-dom/server'
import { renderToPipeableStream } from 'react-dom/server'
import { Sentry } from '~/lib/sentry.server'

// Must sit ABOVE the homepage loader's per-leg fallback budgets (8–9s in
// _index.tsx). React Router aborts pending deferred promises at streamTimeout;
// the renderer hard-abort below fires 1s later. When this was 5s the render
// died before the loader fallbacks could swap in real data, so cold-instance
// Googlebot crawls got the error boundary (and a stray noindex) instead of HTML.
export const streamTimeout = 10_000

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
    let renderErrored = false
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

          // Error pages must never be cached. Routes set a shared
          // s-maxage/stale-while-revalidate policy (STOREFRONT_CACHE_HEADERS)
          // that applies to whatever the route returns, so without this one
          // unlucky render could be stored at the edge and handed to every
          // subsequent visitor, crawlers included, for the rest of the SWR
          // window. That turns a single transient failure into a stretch of
          // identical, canonical-less HTML, which is how URLs end up clustered
          // under the homepage in Search Console.
          if (renderErrored || responseStatusCode >= 400) {
            responseHeaders.set('Cache-Control', 'no-store')
            responseHeaders.delete('Vercel-CDN-Cache-Control')
          }

          pipe(body)
          resolve(new Response(stream, { headers: responseHeaders, status: responseStatusCode }))
        },
        onShellError(error: unknown) {
          reject(error)
        },
        onError(error: unknown) {
          renderErrored = true
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

  // An error served to a crawler is a different severity of event than the same
  // error served to a person: the visitor retries, Google records a verdict and
  // keeps it for months. Tagging the crawler case makes it alertable on its own,
  // which is the leading indicator that was missing while ~337 URLs were being
  // clustered under the homepage. The damage was only visible in Search
  // Console weeks later, long after the window that caused it had closed.
  const ua = request.headers.get('user-agent')
  const tags = { crawler: String(!!ua && isbot(ua)) }

  if (error instanceof Error) {
    Sentry.captureException(error, { tags, extra: { url: request.url, userAgent: ua } })
    return
  }
  // React Router sometimes surfaces thrown Responses as non-Error values.
  // Don't report 4xx Responses — those are intentional (redirects, 404s).
  if (error instanceof Response) {
    if (error.status >= 500) {
      Sentry.captureException(
        new Error(`Response thrown: ${error.status} ${error.statusText}`),
        { tags, extra: { url: request.url, status: error.status, userAgent: ua } },
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
  Sentry.captureException(wrapped, { tags, extra: { url: request.url, raw: error, userAgent: ua } })
}

/**
 * IndexNow key file, served at the fixed path GET /indexnow.txt.
 *
 * IndexNow (Bing, Yandex) requires the key used to sign ping requests to
 * also be servable as plain text somewhere on the host. The spec allows
 * keyLocation to be any URL on the site, so we use a static path instead
 * of the default /{key}.txt shape: a dynamic `:key.txt` route ties with
 * other root-level .txt routes (llms.txt, robots.txt) in React Router's
 * matcher and can shadow them depending on file-sort order. A static
 * bracket route like this one can never collide.
 *
 * app/lib/search-ping.server.ts advertises this URL as keyLocation in
 * every ping, reading the same INDEXNOW_API_KEY env var. Returns 404
 * until that env var is set.
 */
export async function loader() {
  const key = process.env['INDEXNOW_API_KEY']

  if (!key) {
    return new Response('Not found', { status: 404 })
  }

  return new Response(key, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}

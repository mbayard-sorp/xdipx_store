/**
 * Pure URL-joining helper for GA4's page_view `page_location` field.
 *
 * Deliberately NOT a `.client.ts` file: React Router's client-module
 * convention strips `.client.ts` exports when the module is loaded outside
 * the browser bundle (see `analytics.client.ts`), which makes a function
 * defined there untestable under Vitest (it runs in Node). This function has
 * no DOM dependency, so it lives in a plain, framework-neutral module that
 * both `analytics.client.ts`'s callers and its own test can import directly.
 */

/**
 * Join an origin, pathname, and search into one absolute URL with exactly one
 * query string.
 *
 * `search` may be `''` or start with `?` (URL.prototype.search's own shape,
 * e.g. `location.search`), so this normalizes rather than blindly
 * concatenating — blind concatenation is what produced the corrupted
 * `/?variant=b?variant=b` landing URL GA4 recorded (ticket #3441).
 */
export function buildPageLocation(origin: string, pathname: string, search: string): string {
  const query = search && !search.startsWith('?') ? `?${search}` : search
  return `${origin}${pathname}${query}`
}

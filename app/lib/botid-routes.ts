/**
 * The POST routes BotID challenges in the browser and `rejectIfBot()` checks
 * on the server (app/lib/botid.server.ts). Client-safe: imported by
 * app/entry.client.tsx, which initializes BotID before hydration.
 *
 * Each route is listed twice: the bare path, and the `.data` twin that React
 * Router's single fetch actually POSTs to when the submit goes through a
 * fetcher (fetcher.submit / <fetcher.Form>). BotID's client matches the
 * protect path against the request pathname exactly (wildcards aside), so
 * without the twin the fetcher's POST carries no challenge header and the
 * server classes a real visitor as a bot (403). Found by the 2026-10-18
 * lead-funnel audit on /api/lead; the waitlist and review forms submit the
 * same way.
 */
export const BOTID_PROTECTED_ROUTES = [
  { path: '/api/waitlist',      method: 'POST' },
  { path: '/api/waitlist.data', method: 'POST' },
  { path: '/api/reviews',       method: 'POST' },
  { path: '/api/reviews.data',  method: 'POST' },
  { path: '/api/lead',          method: 'POST' },
  { path: '/api/lead.data',     method: 'POST' },
] as const

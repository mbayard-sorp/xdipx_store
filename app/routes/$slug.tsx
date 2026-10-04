/**
 * Host-root alias for the bridge page: https://curious.xdipx.com/<slug>.
 *
 * The real implementation is app/routes/bridge.$slug.tsx. This file re-exports
 * it so the route table also matches the single-segment path the visitor's
 * browser shows, which keeps client hydration on the same route the server
 * rendered. On any host other than curious.xdipx.com the loader throws a 404,
 * which is exactly what an unknown single-segment path returned before.
 */
export { default, loader, meta, headers } from './bridge.$slug'

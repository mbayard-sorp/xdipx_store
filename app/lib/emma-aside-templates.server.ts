/**
 * Server re-export of the client-safe template library. The templates contain
 * no secrets, so both server (loader fallback, preflight render) and client
 * (Await errorElement) import paths resolve to the same data.
 */
export { getFallbackAside } from './emma-aside-templates'

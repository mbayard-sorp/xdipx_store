/**
 * The citation host allowlist, split out from citation-liveness.server.ts
 * (ticket #24678) so a non-server module can read it too. This file does
 * network I/O nowhere and has no server-only dependency, so it is safe to
 * import from either a `.server.ts` file or a plain `.ts` one.
 *
 * citation-liveness.server.ts re-exports CITATION_HOST_ALLOWLIST from here
 * unchanged, so every existing import of it keeps working.
 */

/**
 * Hosts the accuracy gate is allowed to cite from. Suffix-matched, so a bare
 * domain also covers its subdomains (e.g. `ncbi.nlm.nih.gov` covers
 * `pubmed.ncbi.nlm.nih.gov`). The named-in-ticket set plus well-known peer
 * health and authority sources. Extend this list when the accuracy gate starts
 * citing a new reputable domain; keep it to public health/authority sources.
 */
export const CITATION_HOST_ALLOWLIST: readonly string[] = [
  // Named explicitly in ticket #2417
  'medicalnewstoday.com',
  'plannedparenthood.org',
  'clevelandclinic.org',
  'who.int',
  'ncbi.nlm.nih.gov', // covers pubmed.ncbi.nlm.nih.gov
  // Peer reputable health / authority sources the accuracy gate cites
  'nih.gov',
  'cdc.gov',
  'mayoclinic.org',
  'healthline.com',
  'medlineplus.gov',
  'kinseyinstitute.org',
  'ashasexualhealth.org',
  'issm.info',
  'nhs.uk',
] as const

/** True when `host` is on CITATION_HOST_ALLOWLIST, or a subdomain of one. */
export function isAllowedCitationHost(host: string): boolean {
  const h = host.toLowerCase()
  return CITATION_HOST_ALLOWLIST.some((d) => h === d || h.endsWith(`.${d}`))
}

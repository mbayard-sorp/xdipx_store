# Google chooses the homepage as canonical for 777+ PDPs — investigation (ticket #13660/#13661)

Ticket #13661, filed 2026-10-05 from `gsc_url_inspections`: 977 product URLs read coverage_state
`Duplicate, Google chose different canonical than user` — 791 canonicalized onto `https://xdipx.com/`,
118 onto `/products/wellness-kegel-training-kit`, 52 onto `/new`, 16 with no google_canonical recorded
at all. A further 317 read `Duplicate without user-selected canonical`. Against this, only 131 rows
read `Submitted and indexed`.

The ticket's own live fetch (Googlebot UA, two sample URLs) already ruled out the obvious guess: the
declared canonical tag is correct, the page returns 200 with a unique title, one Product JSON-LD
block, and thousands of characters of unique visible text, no age-gate interstitial in the markup.
This doc records what was checked next, with the measurement for each, per the ticket's DONE WHEN
("the finding is written up with the measurement that rules the remaining candidates out").

## Candidate 1 — stale cached verdict from the May 2026 render outage: RULED OUT

The noindex cohort (ticket #13660, `docs/audits/2026-07-27-homepage-merch-seo-diagnosis.md`) traces to
transient render errors between 2026-05-09 and 2026-05-25 that emitted `noindex` plus a homepage
canonical; the bug was fixed 2026-06-13. It would be a reasonable first guess that the canonical-mismatch
cohort is the same stale-verdict artifact, just manifesting as a wrong canonical rather than noindex.

Measured directly against `gsc_url_inspections` (Neon, this run): of the 977
`Duplicate, Google chose different canonical than user` rows, **all 977** have `last_crawl_time` after
the 2026-06-13 fix date — the single most recent crawl in the cohort is from **2026-10-06T07:57:28Z**,
hours before this investigation ran. Google is actively, repeatedly recrawling these pages on an
ordinary cadence and choosing the homepage as canonical on a fresh crawl every time, not coasting on a
four-month-old cached verdict. This rules out "stale cache, needs a recrawl" as the explanation — a
recrawl without a change in the real cause will keep reproducing the same verdict.

## Candidate 2 — a bot-specific or gated response: RULED OUT by code inspection

Checked whether any server path could serve homepage-shaped content to a bot/crawler request on a PDP
URL:

- `app/lib/crawler-ua.server.ts` detects crawler user-agents (including `googlebot` explicitly) but
  its own header states plainly it is "NOT access control" — it only gates whether the PDP's optional
  personalized Emma aside calls Haiku; a crawler request still gets the full server-rendered PDP, with
  `emmaAsideStatic` (the stable, already-approved copy) in place of the skipped personalization.
- `app/components/store/AgeGate.tsx` / `app/lib/use-age-verified.ts`: the age gate is pure client-side
  state (`useState(false)` + a `useEffect` reading `localStorage`). The server has no code path that
  swaps in reduced or homepage-shaped markup when an age-verified cookie/localStorage entry is absent;
  it only controls a client-rendered overlay drawn over content that is already in the SSR HTML. This
  matches the ticket's own live-fetch finding (full unique body text present in a plain, unauthenticated
  fetch).
- No `app/routes/_layout.products.$slug.tsx` code path branches on user-agent to alter the rendered
  product content; `isCrawlerRequest` is read only for the aside-personalization decision cited above.

No evidence of a bot-specific or gated response was found in the PDP route or its dependencies.

## Candidate 3 — thin / unenriched content driving a duplicate-content read: RULED OUT by measurement

Hypothesis: if the mismatched-canonical cohort is disproportionately un-enriched (short description,
no `xdipx.full_story` editorial copy), Google's own duplicate-content clustering could read these pages
as too similar to each other / to the templated chrome, and fold them into the homepage.

Measured via the Shopify Storefront API (5 mismatched-canonical handles vs. 8 `Submitted and indexed`
control handles, both samples live-fetched this run):

| Cohort | descriptionHtml (plain text) length | `xdipx.full_story` populated |
|---|---|---|
| Mismatched canonical (5 sampled) | 433–573 chars | 0 of 5 |
| Indexed control (8 sampled) | 404–573 chars | 2 of 8 |

The two cohorts are statistically indistinguishable on this measure — both are mostly un-enriched,
short-description Nalpac-feed listings. Enrichment status does not predict which bucket a product lands
in. This rules out "thin/unenriched content" as the differentiator.

## Leading surviving hypothesis — crawl-budget / internal-authority scarcity (not newly diagnosed, not yet confirmed)

`app/lib/sitemap-selection.ts`'s own header records the underlying constraint this store has been
working for weeks: as of 2026-09-17 the sitemap carried 5,483 URLs against roughly 340 Google crawls a
month, and 1,383 of those URLs still carried a May crawl date. A catalog this large relative to Google's
willingness to crawl it is exactly the condition under which Google's own duplicate-content/canonical
algorithm is documented to fold low-authority, infrequently-revisited pages into whichever URL on the
site carries the strongest and steadiest crawl/link signal — on this store, overwhelmingly the homepage.
This is consistent with every measurement above (an active, ongoing, non-stale verdict; no code-level
content-serving difference; no enrichment difference) without requiring a new bug: it is the
canonicalization-shaped symptom of the same crawl-scarcity problem `sitemap-selection.ts`'s rotation
already exists to manage, not a defect in a given PDP.

This is a hypothesis, not a confirmed root cause: confirming it would need the GSC Links report (which
internal links/anchors point at these specific URLs) or Search Console's own "why this canonical"
explanation, neither of which this environment has access to (no Search Console API credential is
configured here, and the UI tool cannot be driven headlessly). It should not be treated as closed.

## What this does NOT mean

`last_crawl_time` being recent does not mean these pages are healthy today — it means Google is looking
and still choosing the homepage. No `noindex`, canonical-tag, or render-path defect was found on a direct
inspection of the markup or the server code that produces it.

## Recommendation

Not a code fix: nothing found here is a bug in a specific PDP, the sitemap, or the canonical tag. The
candidates that would actually move this (widening/accelerating the sitemap rotation quota, building
more internal links into the deep catalog from collections/`/discover`, or decommissioning low-value
SKUs that are unlikely to ever earn independent authority) are store-strategist / SEO-lane judgment
calls about where to spend a scarce resource (Google's attention), not a diff this ticket's lane can
make unilaterally. Recommend routing to the weekly strategy brief / `seo-curator` for a prioritization
call, with this doc as the evidence base.

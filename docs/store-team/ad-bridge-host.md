# Ad bridge host: curious.xdipx.com

Ad Studio v2 PR-D. The paid-lane bridge pages are served by this app, not a second platform. Binding
rules: `docs/ads-policy.md` §Meta strategic lane (M1 to M7). Plan: `docs/store-team/ad-studio-v2-plan.md`
§3 and §5.

## What it is

A bridge page is one screen: a photograph, one headline, one claim, one button. The button opens the
destination product page on xdipx.com with the paid UTMs:

`https://xdipx.com/products/<handle>?utm_source=<lane>&utm_medium=paid&utm_campaign=<utmCampaign>&utm_content=<slug>`

Every visitor and every reviewer gets the same page. There is no redirect hop, no shortener and no
user-agent, referrer, IP or geo switching. The page keeps our own 18+ gate, loads the Meta pixel and
GA4 through the same bootstrap as the rest of the site, carries `noindex`, and canonicals to itself.

Content lives in Sanity as `adBridgePage` documents. The destination handles that carry the health
block live in one `adLaneProductSubset` document per lane.

## What the owner has to do (DNS and Vercel)

1. In Vercel, open the `xdipx` project, then Settings, Domains, and add `curious.xdipx.com`.
2. At the DNS host for xdipx.com, add the record Vercel shows. For a subdomain it is a CNAME:
   `curious` pointing to `cname.vercel-dns.com`. If xdipx.com already uses Vercel nameservers there is
   nothing to add.
3. Wait for the certificate (usually a minute or two), then check the gate:
   - `curl -sI https://curious.xdipx.com/` returns `404` with `x-robots-tag: noindex`. The apex is
     deliberately empty.
   - `curl -sI https://curious.xdipx.com/some-unpublished-slug` returns `404`.
   - A published slug with `live` on returns `200`.

The route is host-gated, so adding the domain is the only switch. Until the domain exists nothing
answers on that host, and on xdipx.com itself `/bridge/<slug>` and `/<slug>` return the ordinary 404.

This step is filed as owner blocker `ads:bridge-host-dns`.

## How the host gate works

- `server/index.ts` checks the host on every request (`x-forwarded-host`, then `host`). On
  `curious.xdipx.com` only these are served: a slug that has a published bridge page with `live` on,
  React Router's `/__manifest`, `/api/consent` (the cookie banner's log), `/robots.txt`, and static
  assets. Everything else, including `/`, `/about` and every product or collection URL, is a plain 404
  with `X-Robots-Tag: noindex`. This is what keeps the storefront from ever rendering on that host
  (M1).
- The route files `app/routes/bridge.$slug.tsx` and `app/routes/$slug.tsx` (a re-export, so the client
  router matches the URL the browser shows) re-check the host in the loader.
- Logic and tests: `app/lib/bridge-host.server.ts`, `app/lib/ad-bridge.test.ts`.

## Preview locally

Run `npm run dev`, then open `http://localhost:3000/bridge/<slug>?bridgeHost=1`. The override works
only outside production. Drafts and pages with `live` off show when the Sanity preview cookie is set
(`document.cookie = '__sanity_preview=1; path=/'`), with a purple "not live" strip across the top.
Clear `xdipx_age_verified` from local storage to see the gate. The Vite dev server rejects a custom
`Host` header, so test the real-host behavior with `curl -H 'X-Forwarded-Host: curious.xdipx.com'`.

## Publishing a page

1. In Studio, open Ad bridge pages, edit the document, add the photograph if there is one, and publish.
2. Run the checklist below.
3. Turn `live` on and publish again. Off means 404, for everyone.

Seeded drafts (written 2026-10-03, `live` off): `second-spring` (LELO moisturizer, health framing on)
and `plain-box` (Dame Zee). Sources are in `scripts/seeds/ad-studio-v2-pr-d/`. Apply with
`npx tsx scripts/sanity-content-cli.ts create-or-replace --id drafts.<type>.<name> --file <json>`.

The curated subset is the draft `adLaneProductSubset.meta`. The PDP health block shows for a handle
only after that document is published, because the PDP reads the published dataset.

## Checklist a bridge page passes before any ad points at it

Every box is yes or no. One no means the ad is not created.

- **M1 Destination.** The ad URL is `https://curious.xdipx.com/<slug>`, returns 200, no redirect, no
  shortener. Open it as a logged-out visitor, then again with a Meta crawler user agent
  (`curl -sA 'facebookexternalhit/1.1' -I`): same status, same body. The button goes to a PDP in the
  Meta subset, and that PDP shows the "Good to know" block with the "not a medical device" line to a
  logged-out visitor. Never the homepage, a collection, or any other xdipx.com page.
- **M2 Creative.** The photograph, or the packshot fallback, is an object on coral-soft, plum-soft or
  paper, or held in a hand over fabric. Never in use, never on or near bare skin, no nipple of any
  sex, no phallic or clinical silhouette in frame. Look at the first screen at 375px and decide; the
  fallback packshot is the product's media position 0 and can show the whole product.
- **M3 Copy.** Register 3 to 4. No "sex toy", no act name, no pleasure outcome, no orgasm claim, no
  countdown, no number we did not source. The first screen has no category word; the product name is
  allowed. Buttons use the whitelist: Take a peek, Show me, Find your fit.
- **M4 Account and audience.** One advertiser page, xdipx. Audience hard-set to 25+, never an open
  Advantage+ audience. The ad is created as a paused draft. Only the owner turns it on.
- **M5 Catalog.** The destination is in the curated subset, under its renamed display title, and its
  position-0 packshot is marked `positionZeroOk`. No catalog or Advantage+ shopping campaign.
- **M6 Never.** No persona, byline or invented author, no rotating domain or page, no shortener, no
  countdown, no orgasm claim.
- **M7 Account health.** No open rejection on the Meta business. A second rejection citing the same
  policy pauses the whole lane until the owner reopens it.

## Known limits

- The site's root shell loads GA4, GTM and the Meta pixel but no Klaviyo onsite script, so the bridge
  loads none either. Klaviyo still gets profiles through the existing server-side paths.
- The cookie banner is the site's own and sits over the lower part of the screen on a first visit at
  375px. It is one tap to dismiss, and consent mode keeps the pixel quiet until the visitor decides.
- The pixel bootstrap never fired a `PageView` before this PR. The bridge page fires one on load,
  through the same consent gate.
- Packshot sweep on the eight subset handles (read only, 2026-10-03): four have the retail packaging
  shot at media position 0 with a cleaner sibling (Wild Rose, ROMP Lipstick, the LELO moisturizer, LELO
  BEADS Plus), and four are clean (Dame Zee, Naturals H2O, Steele Balls, Womanizer Liberty 2). Until
  `scripts/sweep-packshot-primaries.ts --apply` reorders Shopify, the bridge fallback picks the clean
  sibling itself and the four affected entries stay `positionZeroOk: false`.

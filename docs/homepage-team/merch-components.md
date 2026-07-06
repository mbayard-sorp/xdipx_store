# Merch component family (v1)

A family of 12 merchandising components for the homepage, PLP, and PDP, built from the
`Merch Components.dc.html` design comp. Every component separates a fixed **shell** (layout,
states, brand chrome) from swappable **content slots** the homepage team edits. Mobile-first
@375px, SSR-visible, `Reveal` motion primitive, v3 tokens, CTA whitelist only.

## The 12 components

| # | Component | Surface | Sanity block | Content source |
|---|---|---|---|---|
| 1a | Headliner spotlight | Homepage (below hero, the one primary CTA) | `headlinerSpotlight` | product ref + image + copy |
| 1b | Trust & discretion strip | Homepage + footer echo | none (fixed shell) | hardcoded brand fact |
| 1c | Curiosity spread rail | Homepage | `curiosityRail` (4 typed roles) | product ref + copy + image per role |
| 1d | Sensation dial card | "How it actually feels" section | none | `sensation_dial_v2` metafield + dialRegistry |
| 1e | Curiosity chooser | Homepage | `curiosityChooser` | tiles: label + preset + products + narrator + image |
| 1f | "Or" fork | Homepage | `orFork` | two sides: product + answer + image |
| 1g | Category quick-nav grid | Homepage | `quickNavGrid` | tint tiles: label + collection link |
| 1h | Honest proof | Homepage | `honestProof` | verbatim quotes + provenance + press (empty until real approved quotes) |
| 1i | Email capture band | Homepage (late) | `emailCaptureBand` | copy slots; posts to Klaviyo via EmailSubscribe action |
| 1j | Promo tile (no-scrim) | Homepage wayfinder promo | `wayfinderMosaic.promo.scrim` (additive field) | image + copy + scrim choice |
| 1k | PLP merch header | Collection pages | `collectionPage.merchHeader` (`plpMerchHeader`) | theme masthead + ≤5 emmaPreset pills |
| 1l | Pairs-with | PDP | none | `accessory_product_ids` + `pairing_why` metafields |

Shared primitives: `SensationDialCard`, `ProofChip`, whitelist CTA button.

## Deploy sequence (three independent deploys, not one)
1. **App (Vercel):** merge + promote — ships the components + GROQ that render them.
2. **Sanity Studio:** `npx sanity deploy` from `studio/` — so editors can create/edit the new
   blocks in the Studio UI (new block types + fields are not visible in Studio until this runs).
3. **Content:** author the blocks' content (products/copy/images) via the Studio or API — renders
   as soon as #1 is live. The storefront reads content over GROQ and does NOT need a Sanity build.

## Binding-rule corrections applied vs the comp
- 1c trailing link renders "Show me" (comp said "see the shelf"; CTA whitelist is closed).
- 1k has no "+N more" overflow (max 5 presets means the row cannot overflow).
- 1e implements the combined two-tile-selected state (described in the comp rationale, not drawn).

## Known flags (pre-launch)
- **1l accessory `jo-refresh-foaming-toy-cleaner-7-oz` has 0 inventory** — restock or swap before shipping.
- **1g:** `first-timers` and `essentials` collections do not exist; tiles point at `/collections/first-time`
  ("First time?") and `/collections/best-sellers` ("Best sellers"). Create aliases or keep relabeled.
- **1l "+ add" / "in the cart ♥"** utility labels are kept pending a charter decision on utility micro-labels.
- **1l remove-from-cart** is optimistic UI only (the cart add response carries no line id); a real remove
  needs a cart re-fetch. Non-blocking.
- **1d dial data** is sparse in-catalog (mostly out-of-stock SKUs); the showcase currently resolves
  `temptasia-rattle-snake-dark-millenia`. Populate `sensation_dial_v2` on more in-stock SKUs to rotate it.

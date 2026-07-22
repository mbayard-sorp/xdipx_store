# Competitive Design Analysis — Live Teardown (July 2026)

> Owner: `homepage-designer` (art director). **Current decision doc for Routine B
> step 0.5**; supersedes `competitor-teardown-2026-07.md` (the blind, no-fetch
> run). Built from 16 real full-page captures of 10 competitor sites, July 21
> 2026, reviewed screenshot-by-screenshot by the homepage team.
> Binds to `docs/design-doctrine.md` (wins on pixels — its §4 archetypes, §6
> proof & trust components, and §7 bench are the promoted, binding form of this
> doc's findings) and `docs/emma-voice.md` (wins on words). Weekly Monday recon
> appends dated delta sections here rather than starting a new doc.

**Coordinator's report to the store owner.** Sixteen live captures across ten competitors (Lovehoney home + PLP + PDP, Adam & Eve, Honey Play Box, Fable & Femme, In The Groove, sextoy.com, Spectrum Boutique, TheTazzle, TooTimid x3, Vush x2), synthesized through design, trust/CRO, and IA lenses, plus a root-cause investigation of the Emma image problem. This plan extends the standing program in `docs/homepage-team/design-elevation-plan.md` (doctrine, design-critic gate, imagery vision gate, prompt library); nothing here restarts that work, and several items below slot directly into its Phase 1-2 deliverables.

---

## What the winners do (cross-site patterns, with which sites prove each)

**1. Consistency is the money signal, not budget.** The loudest "expensive" cue named in every teardown is one unified image/type/component system applied without drift: Vush's identical render language across 20+ SKUs (same angle, glow ground, rose-gold detail), Spectrum's 16 individually art-directed category tiles that still read as one palette, sextoy.com's uniform pink-gradient packshot tiles, Lovehoney's grey-seamless catalog with a recurring hand-model program. The loudest "cheap" cue, also universal, is register whiplash: vendor art dropped in wholesale (TheTazzle, Adam & Eve), supplier cutouts on mismatched grounds (In The Groove, TooTimid), per-module color chaos. For a mixed-vendor Nalpac catalog, **normalizing the ground and light behind inconsistent supplier photos is the single highest-leverage "million dollars" move, and it needs zero reshoots.**

**2. The seven-beat homepage spine is near-universal.** Hero with multi-path CTA → trust strip before any product → intent-language wayfinding in scroll 1-2 → a finite named bestseller set → a guide/finder moment → a pre-footer proof stack → editorial band + membership-framed email capture + legitimacy-dense footer. Lovehoney, sextoy.com, Vush, Honey Play Box, and Spectrum all run it. Honey Play Box's closing proof act (reviews → community → awards → press → trust icons → payment marks) is the clearest "end on safety" sequence.

**3. Intent language beats taxonomy for wayfinding.** Beginners don't know product-type nouns. The best sites label doors by situation or anxiety: sextoy.com's "EASY START / PARTNER PLAY" kickers, In The Groove's "Small & Discreet" collection, TooTimid's "Beginner Sex Toys" circles, Lovehoney's audience-segmented pills. Circular photo-chip subcategory nav (Lovehoney PLP, TooTimid, Groove) is the recurring "pictures navigate for people who don't know the words" device.

**4. Reviews at the product-card level are table stakes.** Stars plus an exact count on every card, everywhere: Lovehoney (1,678 / 2,185 / 3,482), A&E (4,846), Vush ("15,000+ reviews" printed in the hero itself), sextoy.com, TooTimid (29,301 aggregate). The credible refinement is attribute-level evidence (Lovehoney's Design/Ease/Quality/Orgasm sliders) and product-attributed named quotes (Vush's "Danielle M. — Empress Tidal"). The inverse is equally proven: Fable & Femme's (0.0) empty stars, Groove's visible 2-star bestseller, and sextoy.com's "1 review" cards actively destroy trust. **Suppress below threshold, never fake, never show tiny counts.**

**5. Four AI-reproducible imagery archetypes recur across every credible site.** (a) Hand-holding-product on a tinted ground: scale + texture + normalization in one frame (Lovehoney, A&E's Magic-Massager-on-silk, TooTimid's PDP macro row, Groove). Multiple teardowns call this the most premium-reading treatment on the page. (b) Color-block still life, product LARGE on a saturated flat field with one styling echo (TheTazzle's b-Vibe quadrant, Spectrum's water/column/flower scenes, Fable's cream-plinth cutouts, Lovehoney's lemon-toy-with-yellow-manicure). (c) In-situ believable bright scene (Honey Play Box's hotel-bed hero, Vush's toys-on-thigh pink-on-pink hero). (d) Cropped human presence: hands, torso, thigh, never faces, never explicit (Spectrum's harness torsos, Vush, A&E's joy-in-a-pool register). All four are producible from real Shopify photos via the Kontext ref-image pipeline within doctrine §4.

**6. The universal cheap-tells are xdipx's confirmed bans.** Discount walls, stacked offers, countdowns, "ends soon"; text baked into image pixels; ALL-CAPS shouting; unbounded palettes; "Click Here"/"SHOP NOW" CTAs; competing floating widgets; fabricated or anonymous "Verified-Customer" review walls. Every teardown's avoid-list validates the existing voice charter and coral budget. **On the "loud" axis xdipx is structurally immune; the risk is the other named failure mode, "timid."**

**7. Motion is an open lane.** No competitor does anything beyond carousels. The one motion device worth money is per-product motion at the buy surface (TooTimid's "see it in action" promise, Lovehoney's per-SKU video), which maps to the existing `hero_video` metafield.

---

## Trust architecture: why customers trust them and not yet us

The field's four trust primitives, present on 10-11 of 11 captures:

1. **Concrete discretion, stated early.** Not a badge; mechanics. Fable & Femme: "No logos, no hints, no awkward moments." TooTimid: "the shipping label doesn't say what company it's from." The device that converts is naming the dreaded moments (the box on the porch, the statement line). **xdipx owns the single strongest fact in the field, "your statement reads XDIPX, nothing else," and currently states it flattest.** It's in the trust strip and FAQ, but as a flat fact, not a named-fear promise.
2. **Per-card review evidence.** Entirely absent from xdipx by deliberate choice (`StorefrontHome.tsx` lines 740-745 suppress the social-proof section honestly, pre-launch). Correct discipline, but the slot isn't even wired: the reviews automation shipped in the SEO loop (PRs #220-#227) already ingests data the homepage never renders. This is the largest single gap between xdipx and every credible competitor.
3. **A named, time-boxed guarantee at the click moment.** Lovehoney's "100 Day Pleasure Guarantee" is a proper noun with its own mark, a homepage band, and a seat next to Add to Cart; A&E and TooTimid run plainer versions. xdipx has the substance ("30-day returns") but not the name, the mark, or the buy-box placement. Trust at the top of the page reassures browsers; trust at the button reassures buyers. xdipx currently only does the former.
4. **Footer as legitimacy document.** Payment marks, dull policy links (returns, privacy, 2257/18+, accessibility), human contact. Every teardown notes the wary first-timer scrolls to the footer to decide whether the store is real before entering a card number. Doubly load-bearing for xdipx: unknown brand plus high-risk processor.

Also missing versus the field: borrowed manufacturer credibility (9 of 11 sites surface We-Vibe/Lovense/CalExotics-class brand names as card eyebrows or a "names you know" row; xdipx already fetches `p.brand` and renders it nowhere), human reachability (hello@xdipx.com is real and unsurfaced), and a deliberate closing proof act before the email ask.

What xdipx already does better than most of the field: trust strip inside the first viewport (ahead of Fable, Groove, Spectrum), an honest named guide (Meet Emma is the truthful version of A&E's Dr. Jenni pattern), an FAQ that answers the scary questions with JSON-LD, and zero urgency theater.

What we must NOT deploy yet: review counts before they exist, press logos, awards, tenure claims, named testimonials. Suppress rather than fake, matching the discipline already coded into the shell.

---

## Site-by-site: one tight paragraph each + top steal

**Lovehoney** (~25K visitors/day, the proven pattern). Mass-market judgment-free superstore: Costco energy with sex-positive puns, trust earned through scale (24,928 Trustpilot reviews, 20 years, test lab, licensed therapists), merchandising relentlessly deal-led. Its visual style is exactly what xdipx should not be; its trust and merchandising mechanics are the category's proof set. **Top steal: the named guarantee as a product ("100 Day Pleasure Guarantee" with its own mark, homepage band, and buy-box seat), plus the buy-box trust duo (discretion + guarantee restated beside Add to Cart).**

**Adam & Eve.** Legacy discount catalog: offer-stacked hero, per-module color chaos, text baked into every banner, but a masterclass credibility stack (Dr. Jenni's credentials, 100+ physical stores, thousands-deep review counts, 50 years). **Top steal: the credentialed-expert card structure applied honestly to Emma (framed portrait, one-line "what she is and how she picks," persistent footer entry), plus the hand-on-silk product treatment, its most premium image.**

**Honey Play Box.** Tech-drop energy on a near-black ground: cinematic per-product "color worlds," real app UI as proof, authentic UGC reviews with sensory headlines, and the field's best-sequenced closing proof act. Dark grade and discount stacking are the anti-lessons. **Top steal: the in-situ lifestyle hero (product lying casually in a believable sunlit private scene), executed bright on paper per doctrine, and the pre-footer proof-act ordering.**

**Fable & Femme.** Boutique shell (burgundy/cream/gold, didone serif, museum-plinth product cutouts) undermined by execution: (0.0) star ratings, stock flower-field hero, typos, agency credit in the footer. **Top steal: the giant cropped serif wordmark closing the footer, a pure fashion-house device for xdipx's ink closer band; runner-up, the best discretion line in the dataset ("No logos, no hints, no awkward moments").**

**In The Groove.** Brick-and-mortar chain's utilitarian Shopify skin: one genuinely art-directed hero composite above a flyer of supplier cutouts. Real-world proof (store photo, local press award, named staff) is what money can't fake. **Top steal: need-state collection naming ("Small & Discreet"), a wayfinder door named after the anxiety it solves, plus the themed product-still-life hero formula rebuilt bright.**

**sextoy.com.** Tenure-led generalist ("Since 1999" welded into the H1) with the field's most disciplined card system: uniform tinted packshot tiles, mono kickers framing intent (EASY START, PARTNER PLAY), one dark card per grid for rhythm, a confident dark footer closer. Image-poor but systematized. **Top steal: the "Top Ten" finite ranked franchise as the first product section, which maps perfectly onto xdipx's Nº numeral motif, plus intent-based kickers on wayfinder tiles.**

**Spectrum Boutique.** Candy-store maximalism executed with real art direction: every one of 16+ category tiles is a custom color-field still life, a two-register image system (editorial stills for browsing, clean packshots for buying), fully committed solid-color bands. The palette breadth is the anti-lesson; the commitment level is the lesson. **Top steal: the color-field product still-life formula (product composited large into one bold scene: water, column, flowers, foil), constrained to coral-soft/plum-soft/paper so the set reads as one xdipx system.**

**TheTazzle.** A container for vendor assets: every band inherits a different manufacturer's palette and typeface, porn-adjacent copy, watermarked banners. One commissioned-looking moment (the b-Vibe color-block quadrant hero) and a footer more complete than its page. **Top steal: the homepage FAQ accordion answering the four scary questions verbatim in the customer's words ("Do you ship discreetly?" "Do you invoice discreetly?"), plus shoppable '+' hotspots on an editorial flat-lay.**

**TooTimid.** The "Loud" failure mode live (stacked coupons, emoji stickers baked into images, "Click Here") wrapped around the category's most instructive trust scaffolding: concrete label/billing mechanics, 29,301 reviews with named reviewers and named products, a 12-logo press wall, one-year guarantee, staffed phone hours. Its PDP macro-detail row (texture close-up, in-hand scale, tip detail) is the most useful photography in the dataset. **Top steal: the three-part discretion promise made mechanical and placed early, plus the PDP macro/scale/texture image row (fully AI-reproducible).**

**Vush.** The most expensive-looking site in the set, and 80% of it is grid consistency: one render language for every SKU, one signature material detail (the rose-gold band), a single confident campaign hero with products staged on a body, retailer logos (Sephora, Ulta, Saks) doing borrowed-authority work. Discount chips on every card are the anti-lesson. **Top steal: proof printed in the hero itself (stars + count above the H1) and the unified render language that makes a mixed catalog read as one designed family.**

---

## Where xdipx stands (honest gap assessment)

**Ahead of the field (protect):** the Newsreader/DM Sans/mono type system (only Spectrum and Vush landed anything comparable); §1 color-rhythm shell; coral budget, no gradients, no urgency (structural immunity to every teardown's cheap-list); trust strip inside the first viewport; Meet Emma as an honest expert anchor; the Compass finder (a better asset than any competitor quiz); SSR-safe motion primitives and zero-CLS discipline (beyond the entire field); and the elevation plan's pipeline scaffolding (doctrine, critic, vision gate) that no competitor's team has an equivalent of.

**The gaps, in order of severity:**

1. **Imagery is the owner's complaint and the teardown confirms it.** The shipped shell leans on tint fallbacks and `♥` glyph placeholders (hero fallback, wayfinder tiles cycling `bg-coral-soft/plum-soft/paper-3`, couples fallback) precisely because art-directed imagery isn't reliably present. Wayfinder tiles with no imagery are the sextoy.com "18 imageless cards" failure the teardown warns against; a giant sage heart in a tinted box reads CMS-empty. The hero is a colored frame around a bare supplier packshot where credible competitors (Vush, HPB) put the product in a scene or on a body. This is the "disjointed / missing images" complaint, root-caused. The elevation plan's Phase 2.4 imagery gate and prompt library exist to prevent bad images; what's missing is the **program that produces good ones at volume**.
2. **Zero visible social proof.** Intentional and honest, but the slot isn't even built, and the review data pipeline already runs.
3. **Guarantee unnamed, discretion under-told.** Substance present, packaging absent; the strongest discretion fact in the field stated the flattest.
4. **No borrowed credibility.** `p.brand` fetched, rendered nowhere; no "names you know" surface despite a catalog of recognizable manufacturers.
5. **Footer not yet a legitimacy document** (payment marks, compliance links, human contact, 18+ line). Matters before any advertising: ad-network reviewers check the same things nervous customers do.
6. **Compass under-distributed.** Every competitor with a finder gives it nav-level billing; ours surfaces only in the Nº 09 closer and one mosaic tile.
7. **Cards read as inventory, not curation.** No brand eyebrow, no benefit line (the `tagline` metafield exists and is unsurfaced), no spec micro-labels (`sensation_dial`/`feature_bullets` exist and are unsurfaced).
8. **Emma's homepage portrait is the wrong asset** (illustrated art instead of the canonical photorealistic photo; root cause and fix below).

---

## The plan (prioritized)

Ordering logic: the owner is holding advertising until the site looks competitive, so P0 is everything that changes the first-impression read this week; P1 is the trust architecture that converts the traffic ads will buy; P2 is depth. All shell changes ride Routine B reviewed PRs per the carve-out rules; every PR passes the elevation plan's Phase 2 gates (design-critic, screenshot harness, Lighthouse/axe) as they come online this same window.

### P0 — this week

- **Fix the Meet Emma image** (exact fix in the final section). Wrong asset live on the homepage today; smallest possible change with immediate cohesion payoff. `[shell-PR]` — `rr7-engineer`; alt-text patch `[content-only]` — `sanity-content-builder`.
- **Launch the imagery program, wave 1: kill every placeholder.** Generate Archetype B color-block stills for all wayfinder tiles and the Emma's-edit rail, and one Archetype C in-situ scene for the Couples photo band, per the shot list below. Every image passes the Phase 2.4 vision gate; every keeper prompt lands in the prompt library the elevation plan specifies. This retires the `♥` fallbacks and the imageless-tint-tile failure in one wave. `[asset-generation]` — `media-manager` (fal.ai Kontext, ref-image mandatory per the hardened rule).
- **Rebuild the hero as an art-directed frame.** Replace the coral-soft-box-around-a-packshot with an Archetype C scene or Archetype A hand shot of the current pick. Layout unchanged: the image stays the unwrapped LCP, fixed 4/5 aspect, `priority`, never inside a Reveal (doctrine §5; the qa-reviewer verifies this explicitly). `[asset-generation]` — `media-manager`; `[shell-PR]` if the frame markup changes — `rr7-engineer`.
- **Rewrite discretion to name the dreaded moments + name the guarantee.** Trust-strip copy moves from flat facts to the Fable/TooTimid specificity level: what the box looks like, what the label says, "your statement reads XDIPX, nothing else." Coin the guarantee as a proper noun in Emma's register with a sage ♥ mark; it takes a trust-strip line and an FAQ entry now, the PDP buy-box seat in P1. Guarantee terms need owner sign-off before publish. `[content-only]` — `emma-copywriter`, gated by `emma-empathy-reviewer`; owner approves the name and terms.
- **Brand eyebrow on product cards.** Render `p.brand` as a mono ink-4 eyebrow on `StorefrontProductCard` in every grid and rail. Data already in the payload; near-zero build; imports manufacturer reputation into every card. `[shell-PR]` — `rr7-engineer`.
- **Footer legitimacy pass.** Greyscale payment marks (whatever Segpay/Verotel supports), policy links (returns, privacy, shipping, 18+, accessibility), "reach a human at hello@xdipx.com," quiet "brands we carry" name row from the Nalpac catalog. One afternoon, disproportionate pre-ad-launch return. `[shell-PR]` — `rr7-engineer` (footer in `_layout.tsx`); owner supplies processor mark assets.

### P1 — this month

- **Wire the reviews slot, populated only when real.** (a) Stars + count in ink-4 on cards, hard-suppressed below a defensible threshold (the field's cautionary exhibits: (0.0), 2-star bestseller, "1 review"). (b) A conditional pull-quote review band between Nº 06 and Nº 07: Newsreader quote cards, first names/initials, each tagged to and deep-linking its PDP (feeds the 70% PDP-link target). Sanity block is additive. `[shell-PR]` — `rr7-engineer` + `sanity-content-builder`; visual spec — `homepage-designer`.
- **PDP evidence surfaces.** Buy-box trust duo (named guarantee + discretion, mono kickers, sage icons, hairline frame) directly under the primary CTA; the "How it Feels" four-group spec rendering from existing `sensation_dial`/material/`feature_bullets` metafields (with the body-safe/allergen line as a trust signal); macro detail row (texture / in-hand scale / tip) from Archetype A generation, the TooTimid steal. Mostly metafield rendering. `[shell-PR]` — `rr7-engineer`; `[asset-generation]` — `media-manager`.
- **Wayfinder upgrade: intent tiles + "The Ten."** Expand Nº 05 to 5-6 Archetype B photo tiles with intent/anxiety labels ("First toy," "Quiet ones," "Small & discreet," "For two") instead of taxonomy; one ink tile per row for grid rhythm (the sextoy.com dark-card device). Convert Nº 03 into a finite ranked franchise, "The Ten. Most picked right now," with Nº 01-10 mono numerals (final wording clears the voice gate before ship). Labels and edition names `[content-only]` — `emma-copywriter`; tiles `[asset-generation]` — `media-manager`; structure `[shell-PR]` — `rr7-engineer`, taxonomy confirmed by `homepage-ia`, mockup by `homepage-designer`.
- **Compass to nav-level billing.** Persistent header/nav presence for `/discover` ("Find your fit →"), not just the closer band. `[shell-PR]` — `rr7-engineer`.
- **Benefit line on cards.** One Emma-voice sentence from the existing `tagline` metafield between name and price (the Vush card pattern): inventory becomes curation. `[content-only]` where taglines exist — `emma-copywriter`; card render `[shell-PR]` — `rr7-engineer`.
- **One committed tinted band.** Dial §1 from a whisper to a statement: a single full-bleed plum-soft or coral-soft band carrying a rail of white cards (the Spectrum "Top Picks" lesson), within the coral budget. `[shell-PR]` — `rr7-engineer` + `homepage-designer`.
- **Homepage FAQ: promote the four scary questions.** Reorder so discretion and billing lead, phrased in the customer's words (the TheTazzle steal); add the guarantee entry. `[content-only]` — `emma-copywriter`.

### P2 — later

- **Per-PDP product-motion video.** The field's open lane and the owner's stated video budget's best home: 3-5s image-to-video loops (Kling/Seedance) from the compliant still into the existing `hero_video` metafield, fixed poster aspect, quiet play glyph, zero CLS. Start with the top 5 picks. `[asset-generation]` — `media-manager`. Not the homepage hero (LCP risk, and no competitor does homepage video credibly).
- **Two-frame card image flip.** Product still to Archetype A hand/mood frame on hover/swipe, transform/opacity only, LCP frame never wrapped (the Lovehoney card-carousel richness cue, minimized). `[shell-PR]` — `rr7-engineer`.
- **Closing proof act.** Once reviews + brands + guarantee + payment marks all exist, sequence them as a short pre-exit band before email capture (the HPB ordering steal). `[shell-PR]` — `homepage-ia` then `rr7-engineer`.
- **Membership-framed email capture.** Reframe the Klaviyo ask as a named Emma list with curiosity, not discount ("Emma keeps a few things off the homepage. Get the next one first."), plus one line of privacy fine print at the capture moment (the TooTimid steal). `[content-only]` — `emma-copywriter`.
- **Shoppable hotspots on editorial flat-lays** and a **"real packaging" texture band** (the plain box, the Emma's-desk still life) as the no-storefront answer to Groove's store photo. `[asset-generation]` + `[shell-PR]`.
- **Press logo slot, built empty.** Render the moment the offsite/PR automation earns one real placement; never before.

All of P0-P1 feeds the elevation plan's measurement loop: section-visibility GA4 events and per-module PDP click-through (its Phase 4) are what tell us which of these earned their place.

---

## AI imagery + video program (concrete shot list, treatments, budget-worthy video placements)

This is the operational spec for the elevation plan's fal.ai Kontext pipeline (ref-image mandatory, vision gate before upload, keepers logged to `docs/homepage-team/image-prompt-library.md`). Four archetypes, one hard constraint: **backdrops only from coral-soft, plum-soft, and paper tints (sage is an accent, never a ground; see doctrine §4), high-key daylight, product LARGE, no text in pixels, no faces required, nothing a lingerie campaign couldn't run.** The palette constraint is what makes 30 generated images read as one funded brand instead of Spectrum's rainbow.

**Archetype A — hand-on-product** (the cheapest expensive signal in the teardown: Lovehoney, A&E, TooTimid). Real Shopify photo as `--ref-image`, one undistorted hand holding or reaching, silk/linen/skin-adjacent surface, coral-soft or plum-soft ground. Uses: default second image per featured product; PDP in-hand scale shot; card flip frame (P2). Vision-gate hard check: hand anatomy (the gate's existing uncanny-artifact rule).

**Archetype B — color-block still** (TheTazzle b-Vibe, Spectrum, sextoy.com, Fable plinths). Product LARGE on one flat saturated tint, soft shadow, one styling echo of the product's own color (the Lovehoney lemon-toy manicure lesson: one prop or detail rhymes with the product). Uses: all wayfinder tiles, Emma's-edit rail cards, "The Ten," category chips.

**Archetype C — in-situ bright scene** (HPB hotel bed, Vush toys-on-thigh). Product composited into a believable sunlit private space among personal objects, or a cropped human-presence frame (thigh/torso/hands). Bright, never boudoir-gloom (collection-hero feedback on file: private space + human presence + use-adjacent context). Uses: hero primary, Couples photo band, occasion edits.

**Archetype D — editorial metaphor macro** (Lovehoney's fruit macros, Spectrum's water). Tasteful single-concept scenes (silk, water, soft foil) for PDP mood slides and Notebook cover templates (one paper/coral Newsreader cover system per the TheTazzle blog-rail lesson).

**Wave-1 shot list (P0, ~20 images):** 1 hero (Archetype C or A, current pick); 6 wayfinder tiles (B, intent-labeled); 6 Emma's-edit rail cards (B); 1 Couples band scene (C); 3 PDP macro/scale shots for the current pick (A); 2-3 spares per surface for the vision gate to cull. **Wave 2 (P1):** "The Ten" set (B x10), buy-box companion shots, remaining PDP macro rows for top sellers. Emma likeness policy applies as approved: her image usable in merch imagery, product always the hero, additive only.

**Video (the owner's stated budget, spent where it differentiates):**
1. **Per-PDP motion loops** — the one placement worth paying for now. Image-to-video from the gated still, 3-5s, product rotating/pulsing on a color-block ground, `hero_video` metafield, top 5 picks first. No competitor delivers this premium-grade; TooTimid only gestures at it.
2. **Compass explainer capture** — a short screen-capture band of the real finder UI beside warm photography (the HPB app-panel steal): proves the AI guide is product substance, costs near nothing.
3. **Not the homepage hero** (LCP/CLS risk, zero competitor precedent), and **no fabricated UGC/presenter faces ever** — the one Lovehoney/HPB tier AI cannot honestly replicate; the slot waits for real customers.

---

## Emma section fix (root cause + exact fix)

**Root cause.** The "Meet Emma" section (Nº 04) of the variant-b homepage never reads Sanity. `MeetEmma()` in `app/components/store/StorefrontHome.tsx` (line 438) hardcodes `<OptimizedImage src="/emma.webp">`, which is the illustrated AI-art portrait (introduced for the Compass UI in PRs #132/#193; PR #295 only recompressed it). The canonical photorealistic photo exists and is current in Sanity: `singleton.editor.photo` (project `0nlwk8cf`, updated 2026-07-14, a real-photo portrait at 768x1376). The plumbing to use it also exists (`getEmmaPersona()` in `app/lib/sanity.server.ts:873-893`, fetched by the layout loader in `app/routes/_layout.tsx:39-46`), but the homepage component bypasses it entirely. Not a stale asset, not a wrong document: a hardcoded path.

**Exact fix** `[shell-PR]` — `rr7-engineer`:
1. Fetch the full-size editor photo in `assembleStorefrontHome()` (`app/lib/storefront-home.server.ts`) via `getEditor()` (or a new full-size projection of `singleton.editor.photo`; the existing `emmaPersona.avatarUrl` is capped at w=192, too small for the 420px 4/5 slot), pass `photoUrl` through `StorefrontData` into `MeetEmma`.
2. Render via `OptimizedImage` (already handles Sanity CDN srcsets); the 768x1376 portrait crops correctly under the existing `aspect-[4/5]` + `object-cover`.
3. Keep `/emma.webp` only as the Sanity-outage fallback.
4. `[content-only]` — `sanity-content-builder`: set `photo.alt` on `singleton.editor` (currently null).
5. Housekeeping: `/about` already uses `getEditor().photoUrl` correctly; `EmmaHeroIntro.tsx:40` and `EmmaSidekick.tsx:39` fall back to the illustration only on persona-fetch failure (acceptable, but they inherit the art on cold KV, the known KV-cold-start issue); `public/emma.png` is dead weight, delete in the same PR.

**Verification:** `qa-reviewer` confirms the photorealistic portrait renders at 375px, the hero LCP remains unwrapped, and zero CLS holds.
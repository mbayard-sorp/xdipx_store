# claude.ai/design prompt — hi-fi pass (locked structure)

Paste the **v2** block below into claude.ai/design to revise the imported `xdipx Wireframes` project
into the owner-approved "Emma's Edit" homepage at full brand fidelity. It renders the locked skeleton
from [`homepage-redesign-brief.md`](./homepage-redesign-brief.md). The output is a visual reference;
the team re-implements it natively in React Router v7 + Sanity.

## What changed in v2

v2 is the **corrected hi-fi pass** after the team reviewed the imported Claude Design wireframe across
five lenses (CRO, IA, copy/voice, visual, AEO/SEO). It locks the open decisions and fixes the issues
the wireframe surfaced:

- **Hero = Direction A only** (editorial split, product-forward). Drop the alternate hero directions
  (cover-image lead, portrait-led). Keep one short first-person Emma advisory line; horizontal-scroll
  mood pills; a single primary coral CTA with a clearly secondary ghost CTA (not co-equal).
- **Voice/AI-identity fixes (must):** Emma is an AI guide with no lived experience. Remove "I read
  specs for a living", "I read specs so you don't have to", "Tell me what you're into. I'll find it.",
  and "CURATING SINCE 2026". No em-dashes anywhere (testimonial attributions use "Mara K.", not
  "— Mara K."). No "Buy now", no countdowns, no emoji in headings; `♥` only in CTAs/asides.
- **Trust strip raised** into the first viewport; reword "Vetted by humans" → "Hand-checked, not
  auto-listed".
- **Discover You** mosaic tile uses a plum-**soft** tint (not a solid plum block); the section-9 dark
  mood band uses a **different** kicker than the mosaic so the two guided entries don't read as
  duplicates. Notebook cards each also link a product/collection. Social proof keeps real first-name
  quotes with **no invented counts**.

The v1 prompt (initial generation) is preserved at the bottom for history.

---

## v2 — corrected hi-fi prompt (paste this)

```
Revise the xdipx homepage design. Commit to hero DIRECTION A (editorial split) — drop directions B and C — and render the ENTIRE page at full brand fidelity (the current version is low-fi wireframe; this pass applies the real brand system). Keep all 12 sections in the same order. Mobile-first 375px, then desktop (max ~1320px). Tasteful, never explicit; age-gated; discreet.

BRAND VISUAL SYSTEM (apply exactly, replace all placeholder fonts/grays):
- Backgrounds: white #FFFFFF; quiet alt bands #FAFAF9 / #F4F3F1; one dark band #1A1418. No gradients, no orange, no cream/pink.
- Text #1A1418 / #6B5F68 / #9A8F97. Coral #FF5A36 = accent, used for ONE primary CTA per section + sale pills only. Plum #7A2BB8 = exactly one italic emphasis word per headline. Sage #7C8F78 = the ♥ glyph and quiet states.
- Type: Newsreader serif for all headlines at weight 400–500 (never bold/black); DM Sans for body, nav, buttons, prices; JetBrains Mono for small uppercase kickers (letter-spacing 0.18em).
- 22px radii on cards/tiles/images/pills; hairline 1px borders rgba(26,20,24,0.08), not heavy shadows; subtle hover lift only. Gentle fade/up reveals on scroll; the hero product image is STATIC (never animated), with a fixed aspect box so nothing shifts.
- CTA labels only: "Take a peek →" (browse/product), "I'll take it ♥" (buy), "Find your fit →" (guided finder), "Show me →" (category), "I'm in ♥" (email). Never "Buy now". The ♥ appears only in CTAs and Emma asides. No emoji in headings. No em-dashes anywhere.

HERO (Direction A, with these specific changes):
- Above the fold, top to bottom on mobile: kicker "CURATED BY EMMA, YOUR AI GUIDE" → headline (Newsreader) "Pleasure, worth getting right." with "right" in italic plum → a small Emma byline chip (round portrait + "Emma, your guide") with one advisory line beside it "Tell me what matters and I'll point you to the fit." → primary coral button "Take a peek →" with a clearly secondary ghost button "Find your fit →" (NOT co-equal) → the guided prompt "Where do you want to start?" with a HORIZONTALLY-SCROLLING pill row: "Just curious" "Slow nights" "For two" "Hands-free" "Surprise me" → then the large product still (the LCP image). The product still must sit with the CTAs, not far below them.
- Move the TRUST STRIP up so it sits inside or immediately under the hero, within the first viewport: "Ships in plain packaging" · "Billed as XDIPX" · "30-day returns" · "Hand-checked, not auto-listed".

VOICE CORRECTIONS (use this exact copy; do not reintroduce the old lines):
- Section 4 "Meet Emma": kicker "MEET EMMA" (remove "CURATING SINCE 2026"). Copy: "I'm Emma, xdipx's AI guide. I know the catalog cold, every spec and thousands of reviews, so I can point you to what actually fits. I don't get embarrassed, and I don't have a shelf to push." (Emma is explicitly an AI guide; never imply she has personally used, owned, or tested anything, and never imply a human job or tenure.)
- Trust item is "Hand-checked, not auto-listed" (not "Vetted by humans").
- Section 7 social proof: real, short, attributable quotes only, attribution as "Mara K., Austin" (first name, initial, city — NO em-dash, no leading dash). Do not invent review counts or star totals.

REMAINING SECTION UPDATES:
- 5 FIND YOUR WAY IN (mosaic): tiles "For her", "For him", "First time?", and a LARGER "Discover You" tile that uses a soft plum tint background (#F3E8FB), not a solid plum block.
- 6 ROTATING RAILS: 2–3 rails; the FIRST is an always-present "Best sellers" anchor (kicker "WHAT'S WORKING", heading "The ones people keep coming back to."). Cards: small mono category kicker, product name, price in ink (not coral), "Take a peek →". One curated "Emma's edit" rail shows a single italic Emma aside under its lead card in sage with a ♥: "the one I'd point you to for slow nights."
- 8 COUPLES: warm play-together banner, headline "Better together.", CTA "Show me →".
- 9 dark "mood" band: kicker "STILL DECIDING?" (do not repeat "Discover You" here), headline "Tell me what you're into, or what you're curious about. Same thing." with one plum italic word, coral CTA "Find your fit →".
- 10 FROM THE NOTEBOOK: kicker "EMMA'S READS", 3 article cards (image, headline, 2-line excerpt, read-time); each card also links a related product or collection, not just the article.
- 11 FAQ: heading "Questions, answered." with 4 expandable items: "What is xdipx?", "How discreet is shipping?", "Who is Emma?", "What payment methods do you take?".
- 12 EMAIL: "Good taste, delivered quietly." / "Emma's picks, once a week. Discreet, direct." + field + "I'm in ♥". No discount or countdown.
- Footer: sparse, 4 columns (Shop / Discover / About / Discreet), a line "Everything ships in plain packaging. Your statement reads XDIPX, nothing else.", a sage ♥ in the divider. Use "Discover You", never "Vault".

Deliver the full responsive page (375px + desktop) in the brand system above, with a clear H1 (hero headline) and H2 per section, and tasteful warm in-context placeholder imagery.
```

---

## v1 — initial generation prompt (history)

<details>
<summary>Original prompt used to produce the first wireframe pass (superseded by v2 above).</summary>

```
Design a high-fidelity, mobile-first homepage for "xdipx" — a tasteful, editorially-curated intimate-wellness store (never explicit; age-gated; discreet, billed "XDIPX"). Treat it as the cover + contents of a beautiful independent magazine, NOT a generic product grid. The star is "Emma," the brand's AI wellness guide: a cold visitor must immediately learn who she is and feel guided to the right products. Design at 375px first, then desktop (max ~1320px). Imagery: warm, editorial, in-context, tasteful — no nudity, nothing explicit or clinical.

VISUAL SYSTEM (exact):
- White paper #FFFFFF canvas; quiet alt bands #FAFAF9 / #F4F3F1; one dark band #1A1418. No gradients, no orange, no pink/cream backgrounds.
- Text #1A1418 / #6B5F68 / #9A8F97. Accent coral #FF5A36 = CTAs + sale pill ONLY (max ~one coral element per section). Emphasis plum #7A2BB8 = exactly one italic word per headline. Sage #7C8F78 = ♥ and quiet states.
- Type: Newsreader serif headlines weight 400–500 (NEVER bold/black); DM Sans body/UI/buttons; JetBrains Mono uppercase kickers (0.18em). 22px radii; hairline borders rgba(26,20,24,0.08), not heavy shadows; subtle hover lift only.
- Motion (if prototyped): gentle fade/up-16px reveals on scroll; the hero image is STATIC (never animated); reduced-motion → final state. No parallax, no countdowns.
- CTA labels only (verbatim): "I'll take it ♥" (buy), "Take a peek →" (browse/product), "Find your fit →" (guided finder), "Show me →" (category), "I'm in ♥" (email). NEVER "Buy now". ♥ only in CTAs + Emma asides. No emoji in headings. No em-dashes.

PAGE (top → bottom), render this REAL copy:

1. ANNOUNCEMENT BAR — thin dark strip, mono uppercase: "EDITORIALLY PICKED. DISCREETLY SHIPPED."

2. HERO (asymmetric editorial; the product image is the static LCP) — left text column over generous whitespace; right (desktop) / below (mobile) ONE large warm in-context product still.
   - Kicker: "CURATED BY EMMA, YOUR AI WELLNESS GUIDE"
   - Headline (Newsreader, "right" italic plum): "Pleasure, worth getting right."
   - Emma byline chip: small round portrait + "Emma · your guide"
   - Primary CTA (coral, the revenue action): "Take a peek →"   Secondary (ghost): "Find your fit →"
   - Below the CTAs, a guided-entry line "What are you in the mood for?" with a row of tappable PILLS (label + tiny sublabel): "Just curious · new to this" · "Slow nights · quiet, no-rush" · "For two · together's better" · "Hands-free · wearable" · "Surprise me · trust Emma". The pills are the above-the-fold path into the finder.

3. TRUST STRIP (immediately under the hero) — slim, 4 items: "Ships in plain packaging" · "Billed as XDIPX" · "30-day returns" · "Vetted by humans, not an algorithm".

4. MEET EMMA — editorial band: Emma's portrait (sage-tinted frame, NOT a chat bubble) + her first-person intro: "Hi, I'm Emma. I read specs for a living, cross-reference thousands of reviews, and point you to what actually fits your life. I'm an AI, not a customer — so I don't get embarrassed, and I don't have a shelf to push." A small "curating since 2026" line establishes her as a real editorial voice.

5. FIND YOUR WAY IN — editorial category mosaic (asymmetric; 2-col mobile). Image-backed tiles with Newsreader labels: "For her", "For him", "First time?", and a LARGER, visually distinct (plum-soft) "Discover You" tile linking to the guided finder.

6. ROTATING RAILS — 2 to 3 product rails (an always-present "Best sellers" first, then 1–2 rotating). Kicker + Newsreader heading per rail, e.g. "WHAT'S WORKING / The ones people keep coming back to." Cards: square image, mono category micro-kicker, Newsreader title, price in INK (not coral), "Take a peek →"; horizontal scroll on mobile. One curated rail ("Emma's edit") may show a single italic Emma aside under its lead card (sage ♥).

7. SOCIAL PROOF — heading "From people who took the plunge." 3 quote cards: 2–3 line quote, first name + initial only, no photos, NO invented aggregate numbers.

8. COUPLES — a warm play-together banner + a small couples rail, CTA to the couples collection. "Better together."

9. TELL EMMA A MOOD — full-width dark #1A1418 band (the guided path, a second time). Kicker "DISCOVER YOU", headline (one plum italic word) "Tell me what you're into. Or what you're curious about. Same thing.", coral CTA "Find your fit →".

10. FROM THE NOTEBOOK — kicker "EMMA'S READS", 3 editorial article cards (image, headline, 2-line excerpt, read-time) linking to guides; each card can also point to a relevant product.

11. FAQ — heading "Questions, answered." 4 Q&A: "What is xdipx?", "How discreet is shipping?", "Who is Emma?", "What payment methods do you take?". Answer-shaped, calm, on-brand.

12. EMAIL CAPTURE — "Good taste, delivered quietly." / "Emma's picks, once a week. Discreet, direct." + field + "I'm in ♥". No discount promise.

FOOTER — editorially sparse, 4 columns (Shop / Discover / About / Discreet), a line "Everything ships in plain packaging. Your statement reads XDIPX, nothing else.", social icons, a sage ♥ in the divider. Use "Discover You", never "Vault".

Make it feel like an editorial brand a person trusts — confident, warm, never crude, never a discount marketplace. Deliver responsive 375px + desktop with tasteful placeholder imagery and the exact copy above, and a clear H1 (hero) + H2 (each section) hierarchy.
```

</details>

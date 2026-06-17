# claude.ai/design prompt — hi-fi pass (locked structure)

Paste the block below into claude.ai/design to generate the high-fidelity visual for the
owner-approved "Emma's Edit" homepage. It renders the locked skeleton from
[`homepage-redesign-brief.md`](./homepage-redesign-brief.md) in full brand polish. The output is a
visual reference; the team re-implements it natively in React Router v7 + Sanity.

---

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

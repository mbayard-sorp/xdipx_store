# Google Ads: approved copy bank

Status: **drafted, awaiting owner sign-off.** Written 2026-08-15 from an `/all-hands` convening
(`emma-copywriter`, verified against the charter by this session).

`docs/emma-voice.md` and `docs/ads-policy.md` are binding and outrank this document.
`docs/store-team/google-ads-launch-plan.md` owns campaign structure; this file owns words.

---

## Register lock

Paid ads run at **education register 3-4**, not the site's intensity 9. This is the charter's own
rule (`docs/emma-voice.md`, marketing addendum): *"Paid ads (Meta, Google): the desire-forward
register does NOT apply. Education, mechanism, and health register only, dialed at 3-4. No
pleasure-focused claims in ad creative."*

That is not a compromise of the voice. It is the voice's own instruction for this surface.

## Format limits (Responsive Search Ads)

| Asset | Cap | Count needed |
|---|---|---|
| Headline | 30 chars | 15 per ad group |
| Description | 90 chars | 4 per ad group |
| Display path | 15 chars | 2 fields |
| Callout | 25 chars | 4+ |
| Sitelink text | 25 chars | 4+ |
| Sitelink description line | 35 chars | 2 per sitelink |

**Every line below has been programmatically length-checked.** Counts in parentheses. If you edit a
line, re-check it: Google silently rejects the asset, it does not warn you.

## Two rules that killed lines in this bank

- **No CTA glyphs in ad text.** The on-site whitelist uses `→` and `♥`. Google's ad-text symbol
  policy rejects them. Use the whitelist words bare: "Take a Peek", "Find Your Fit", "Show Me".
  Keep the glyphs on-site.
- **No price, discount, "% off", or promotion extension anywhere.** `MAP_RESTRICTED_VENDORS`
  (`app/lib/pricing-engine.server.ts`) blocks discount framing for some vendors, and the pricing
  agent moves prices daily, so any price baked into an ad drifts out of MAP compliance on its own.

---

## Theme A · Body-safe materials (informational intent)

**Headlines**

Body-Safe Materials Guide (25) · Is Silicone Body-Safe? (22) · Medical-Grade Silicone (22) ·
What Body-Safe Means (20) · Materials, Named Plainly (24) · Silicone, Glass, Steel (22) ·
Non-Porous Toy Materials (24) · Know What You're Buying (23) · Body-Safe on Every Page (23) ·
Skip the Guesswork (18) · Toy Materials 101 (17) · Choose With Confidence (22) ·
Silicone vs Glass vs Steel (26) · Take a Peek (11) · Find Your Fit (13)

**Descriptions**

1. Every product page names its materials plainly: silicone, glass, or steel. (74)
2. Hand-checked before it's listed, not auto-added from a warehouse feed. (70)
3. No wrong answers. Learn what body-safe actually means before you buy. (69)
4. Medical-grade silicone, glass, and stainless steel, named on every page. (72)

**Display path:** /materials (9) · /guide (5)

## Theme B · Beginner / first-time buyer

**Headlines**

Buying Your First Toy? (22) · New to Sex Toys? Start Here (27) · Best Beginner Vibrators (23) ·
No Experience Needed (20) · A Guide for First-Timers (24) · Beginner-Friendly Picks (23) ·
Start Simple, Start Smart (25) · No Wrong Answers Here (21) · Easy, Low-Intimidation Picks (28) ·
Where First-Timers Start (24) · Simple Toys, Clearly Explained (30) · Curated for Beginners (21) ·
Find Your First, Easily (23) · Take a Peek (11) · Find Your Fit (13)

**Descriptions**

1. New to sex toys? Start with beginner-friendly picks, plainly explained. (71)
2. No wrong answers, no experience assumed. Just a guided place to start. (70)
3. Hand-checked picks for first-timers, not an overwhelming warehouse list. (72)
4. Beginner guides and body-safe materials, named clearly on every page. (69)

**Display path:** /beginners (9) · /guide (5)

## Theme C · Discreet shipping and privacy

Every claim here is verified trust canon (`docs/emma-voice.md` §Trust canon,
`app/lib/faq-content.ts`). Do not extend it without re-verifying.

**Headlines**

Plain Box, Plain Label (22) · Discreet Shipping, Always (25) · No Logos, No Labels (19) ·
Statement Reads XDIPX (21) · Privacy, Built In (17) · Discreet From Box to Bill (25) ·
Plain Packaging, Every Order (28) · Not a Secret, Just Private (26) ·
Return Address Reads XD Inc. (28) · Your Privacy, Respected (23) · Billing Reads XDIPX Only (24) ·
Shipped Plain, Every Time (25) · Discreet Packaging, Verified (28) · Take a Peek (11) ·
Find Your Fit (13)

**Descriptions**

1. Plain box, plain label. Not a secret, just nobody's business. (61)
2. Your statement reads XDIPX. Return address reads XD Inc. (56)
3. No branding on the box. Ordering stays your business, not ours. (63)
4. Discreet shipping on every order, every time, no exceptions. (60)

**Display path:** /shipping (8) · /discreet (8)

## Theme D · Couples

**Headlines**

Toys Made for Couples (21) · Explore Together (16) · Couples Vibrators, Explained (28) ·
Shared Control, Made Easy (25) · Built for Two (13) · Curated Picks for Couples (25) ·
Vibrators for Shared Use (24) · Wearable Couples Toys (21) · For Partners, Together (22) ·
No Experience Needed, Together (30) · Compare Couples Toys (20) · Body-Safe, Built for Two (24) ·
Hand-Checked Couples Picks (26) · Take a Peek (11) · Find Your Fit (13)

**Descriptions**

1. Hand-checked couples toys, body-safe materials named on every page. (67)
2. Compare couples vibrators by fit, material, and control style. (62)
3. No wrong answers. Explore what works for both of you, together. (63)
4. Discreet shipping, plain packaging, statement reads XDIPX. (58)

**Display path:** /couples (7) · /guide (5)

## Theme E · Curated / guided shopping

**Headlines**

Hand-Checked, Not Listed (24) · Curated, Not Auto-Listed (24) · A Guided Toy Finder (19) ·
Not a 50,000-SKU Warehouse (26) · Every Pick, Reviewed by Hand (28) ·
Don't Know Where to Start? (26) · Answer 3 Questions, Get Picks (29) ·
Guided Shopping, No Guesswork (29) · Skip the Endless Scroll (23) · Curated Picks, Explained (24) ·
A Smaller, Smarter Catalog (26) · Find Your Fit in Minutes (24) · Try the Guided Finder (21) ·
Take a Peek (11) · Show Me (7)

**Descriptions**

1. Hand-checked picks, not an auto-listed warehouse. Answer a few questions. (73)
2. A guided finder for people who don't know where to start looking. (65)
3. Every product is reviewed by hand before it's ever listed for sale. (67)
4. No wrong answers. Tell us what you're looking for, we'll narrow it down. (72)

**Display path:** /discover (8) · /guide (5)

---

## Extensions (apply at campaign level)

**Callouts.** Hand-Checked, Not Listed (24) · Plain Box, Plain Label (22) ·
Body-Safe Materials Named (25) · Statement Reads XDIPX (21) · No Wrong Answers (16) ·
30-Day Unopened Returns (23) · Discreet Shipping (17) · Guided Toy Finder (17)

> The returns callout reads "30-Day **Unopened** Returns", not "30-Day Returns". The policy is
> *"unopened items in original packaging within 30 days, hygiene restrictions apply to used
> products"* (`app/lib/faq-content.ts`). A bare "30-Day Returns" overstates it, and in this
> category the hygiene restriction is the part that actually bites.

**Sitelinks**

| Text | Line 1 | Line 2 |
|---|---|---|
| Guided Finder (13) | Answer a few questions. (23) | Get picks matched to you. (25) |
| Body-Safe Materials (19) | Silicone, glass, stainless steel. (33) | Named clearly on every page. (28) |
| Discreet Shipping (17) | Plain box, plain label. (23) | Statement reads XDIPX. (22) |
| Beginner Guide (14) | New to sex toys? Start here. (28) | No wrong answers, ever. (23) |
| Couples Picks (13) | Toys built for two. (19) | Compare by fit and feel. (24) |
| About Curation (14) | Hand-checked, not auto-listed. (30) | Every pick reviewed by hand. (27) |

**Structured snippets** (header "Types"): Vibrators, Wands, Lubricants, Couples toys

---

## What was deliberately not written, and why

This section matters more than the volume above. It is where the line is.

- **Any arousal, orgasm, or act language.** Killed by the marketing addendum's register cap (3-4)
  and by `docs/ads-policy.md` §Creative ("no pleasure-focused claims in ad creative"). On a Google
  Search surface this is not a style question: explicit creative in a restricted category escalates
  from a rejected ad to account action.
- **"Sexy" or "sex" as a branding adjective.** Banned outright by the charter regardless of channel.
  ("Sex toy" as a plain noun is fine and is used above.)
- **"Buy Now" or any non-whitelisted CTA.** The whitelist is closed.
- **Any percent-off, price, or "today only" line.** MAP rules plus daily price movement. See the
  two hard rules at the top.
- **Countdowns and urgency theater.** Hard charter rule, every channel.
- **First-person product experience** ("I tried this", "Emma's own pick"). Emma is an AI guide with
  no lived experience.
- **Star ratings, review counts, "#1", awards.** The store has no verified review corpus to cite.
  Never fabricate proof.
- **"Free shipping" as a bare claim.** Free shipping starts at $99 and the store's only observed
  order was $26.47, so as an unqualified ad claim it is both misleading and useless. It is also the
  exact claim that currently misrepresents the product feed (see the launch plan §6).
- **Em-dashes.** None anywhere above.

## Handoff

Final assets go through `emma-empathy-reviewer` before they enter the account, per
`docs/store-team/google-ads-launch-plan.md` §3. This bank is pre-gate.

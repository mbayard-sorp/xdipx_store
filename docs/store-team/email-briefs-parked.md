# Parked email briefs

These are complete, voice-gate-passed email briefs the email routine produced (suggestion rows #18/#21/#22), preserved here after the improvement-bus rows were retired. **They are deliberately not sent.** The store has taken 0 orders / $0 for 14+ days (see `ops-blockers.md` #15); sending before the checkout path is confirmed would spend list goodwill on a funnel that may be broken. In fact both briefs are designed to double as a warm-traffic checkout smoke test — run them **once the owner has confirmed a stranger can buy end-to-end**, then read clicks-vs-orders as the diagnostic.

Execution is manual in Klaviyo (the store's Klaviyo integration only fires events + manages lists; there is no campaign API). MAP note applies to both: no price or discount framing anywhere; product copy is mechanism/materials/fit only.

Context (#18): Email is the largest uncovered revenue surface and produced 0 runs in the 7 days before these briefs. Confirm true list size in Klaviyo before building send volume — the DB only yields a ~150 full-consent proxy (see `ops-blockers.md` #23).

---

## Brief A — Welcome / first-purchase flow (#21)

3-email Klaviyo flow, evergreen, per-profile. **Trigger:** "Added to List" for any consented marketing list (Waitlist, Daily Deal, Notebook). **Filters:** marketing consent = Subscribed; Placed Order 0 times (exit on first order). Suppress anyone in the re-engagement broadcast that week (frequency guard: max 2 marketing sends/week). Flow spans 4 days.

- **Email 1 — immediately on join (0h):** welcome + trust.
  - Subject A: "You're in. Here's how to start." / Preview: "No experience assumed. Plain box, plain label."
  - Subject B: "Curious? Good. That's the whole idea." / Preview: "A sex toy shop for people with questions."
  - Body beats: welcome + curious-is-right framing; plain box / plain label (statement reads XDIPX, return address XD Inc.); hand-checked not auto-listed; body-safe materials named on every page; CTA "Find your fit →" to `/discover?utm_source=klaviyo&utm_medium=email&utm_campaign=welcome-series`; teases Emma's day-2 email.
- **Email 2 — +2 days, 11:00 local (Smart Send):** Emma education, body-safe materials.
  - Subject A: "How to tell if it's body-safe" / Subject B: "Emma on the one spec worth checking first"
  - Body beats: Emma introduces herself as an AI guide (no body, no favorites; works from specs + review patterns); the material named outright test (medical-grade silicone, borosilicate glass, stainless steel = non-porous/body-safe); "Show me" → `/notebook/is-silicone-body-safe?...campaign=welcome-series`; "Find your fit →" → `/discover?...`.
- **Email 3 — +4 days, 18:00 local:** one honest beginner pick + returns.
  - Subject A: "One good place to start" / Subject B: "If you'd rather pick with your head, not just the bestseller list"
  - Body beats: beginner wants simple/quiet/easy; the Délice Fleur air-pulsation massager (pulses air over the clitoris, softer than a vibrator, little to learn); body-safe silicone, rechargeable, quiet; "Take a peek →" → `/products/delice-fleur-clitoral-fluttering-suction-personal-massager-barely?...`; "Find your fit →" fallback; 30-day returns, ends with ♥.

**Success metric (not opens):** clicks to /discover, the notebook post, and the PDP; Klaviyo-attributed placed orders + revenue in the 5-day window vs the 0-order baseline. Diagnostic: if E1/E2 earn clicks but E3 drives PDP visits with zero orders, that points at the checkout/payment path (the owner's #1 open question).

---

## Brief B — Re-engagement broadcast "The Unhurried Night" (#22)

Single broadcast. Covers the other half of the list: subscribers who joined **before** this week and never ordered (the welcome flow only reaches new joins). Was aligned to the homepage editorial theme "The Unhurried Night" (hero `we-vibe-chorus-cosmic`) — **note that theme window (through Sun Jul 19) has passed, so re-theme before sending.**

- **Segment:** consented marketing subscribers (Waitlist/Daily Deal/Notebook), joined before the send week, Placed Order 0 times. EXCLUDE anyone in the welcome flow (joined last 7 days). One send (satisfies 2/week guard).
- **Timing (original):** Thursday 18:00 local, Smart Send, no resend-to-non-openers.
- **Copy beats:**
  - Subject A: "Made for the unhurried night" / Preview: "No rush. Just a few things worth a slow look."
  - Subject B: "For the nights you're in no hurry" / Preview: "A quiet edit from the shelf, hand-checked."
  - Body: an edit for unhurried nights; hand-checked, named-to-material. The We-Vibe Chorus couples vibrator (steer by squeezing a remote; pace is a conversation; body-safe silicone) → "Take a peek →" `/products/we-vibe-chorus-cosmic?...campaign=reengage-unhurried`. The Délice Fleur (works by air, not contact) → "Show me" `/products/delice-fleur-...?...`. "Find your fit →" `/discover?...`. Plain box / plain label / statement reads XDIPX / 30-day returns. Sign-off: "Unsubscribe anytime. We're not needy."

**Success metric (not opens):** clicks to the two PDPs and /discover; Klaviyo-attributed orders + revenue (5-day window) vs the 0-order baseline. Report clicks even at 0 orders — the split is the diagnostic. If an offer rides along later it must reference an owner-approved promo code with a MAP check first (none exists today).

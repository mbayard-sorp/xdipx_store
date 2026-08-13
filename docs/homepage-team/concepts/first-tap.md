# Concept Wire — First Tap

> Routine B (Design Cycle) ambition-mandate deliverable, run #282, 2026-08-12.
> Mission brief §9: carry at least one genuinely new exploration/self-discovery
> experience concept to a wire each cycle. **This is a design artifact only.**
> Nothing here ships without IA review, additive-only Sanity schema, and an
> `emma-empathy-reviewer` pass on every customer-facing string. All copy below
> is **illustrative** and has not cleared the voice gate. The doctrine
> (`docs/design-doctrine.md`) wins over this wire on every visual call; the
> voice charter (`docs/emma-voice.md`) wins over everything. Format precedent:
> `concepts/sensation-map.md`, `concepts/either-or.md`, `concepts/how-you-arrive.md`,
> `concepts/the-next-step.md`.

## 1. The idea in one line, and the job it serves

On `/social`, the Instagram bio-link arrival surface, place **one tap between
the age gate and the Emma chat**: "What pulled you in tonight?" with three or
four warm, plain-language intents ("Just curious," "Shopping for me," "Shopping
for us," "Show me what's new"). The tap does two things at once: it reshapes
Emma's opening line to meet that intent, and it reorders the page's product
modules so the pinned feature and the grid lead with what that intent is
actually about. Every downstream reveal stays a direct `/products/{handle}`
link carrying the existing social UTM.

**Journey job (mission brief §7): ORIENT the rented-channel arrival, then TEMPT.**
This is the one surface where we *know* the visitor came from a video and chose
to tap through. They arrive warm but contextless. The four site finders we
already have (Compass, Sensation Map, Either / Or, How You Arrive) all live
deeper in the site and all ask *what fits you?* **None of them lives on the
arrival surface, and none of them is built for the "I clicked a bio link and I
have five seconds of patience" mindset.** First Tap is not a finder; it is a
single self-selection that makes the very first screen feel authored for the
person who just showed up, instead of a generic "chat with Emma" funnel.

## 2. Why it is new (not a repeat of what we have)

- **It is one tap, not a flow.** The Compass and the banked finders are
  multi-step narrowers. First Tap is a single fork with an immediate payoff,
  sized for an in-app browser and a distracted arrival. It never dead-ends in a
  results page; it re-dresses the page the visitor is already on.
- **It lives on the new front door.** Since Instagram went live (strategy brief
  #5, 2026-08-10), `/social` is the priority IG→landing→PDP surface. Today that
  page opens the same way for everyone: gate → "So this is where the good part
  happens" → chat CTA. First Tap is the only banked concept that treats the
  social arrival as a distinct moment with its own orientation need.
- **It is self-discovery in the lightest possible form.** The visitor learns
  something by choosing: naming "for us" vs "for me" out loud, to a friendly
  screen, is itself the small permission the brand exists to give. The reward is
  a page that visibly listened.

## 3. The interaction

1. Post-gate, before the chat CTA renders, show a compact card: a one-line
   prompt and three or four tappable pills (doctrine Archetype-free; type +
   token treatment only, no generated imagery needed for v1).
2. On tap, the pill choice is held client-side (and echoed as a URL param so a
   back/forward or a share preserves it, e.g. `/social?intent=for-us`).
3. Emma's hero line and the featured-module heading swap to the intent's copy.
   The pinned feature and the "lately on my feed" grid reorder to lead with the
   products tagged for that intent; everything else on the page is unchanged.
4. A quiet "actually, something else →" resets the fork. No intent is ever
   forced; skipping the card lands on today's default page exactly as now.

### Intent → module reading (illustrative)

| Tap | Emma opens with (illustrative) | Modules lead with |
|---|---|---|
| Just curious | the on-ramp, permission-first | approachable / under-$30, beginner-safe tags |
| Shopping for me | solo, self-focused | solo-pleasure archetypes from the pin's tags |
| Shopping for us | couples, shared | couples/wearable tags (this week's calendar lane) |
| Show me what's new | the freshest picks | recent-post grid promoted above the pin |

Copy is illustrative and product selection is by existing discovery tags
(`mood_tags` / `audience_tags` / `matters_tags`); no new taxonomy is invented.

## 4. How it serves the mission

- **Product-forward (mission brief §1):** every intent leads to real
  `/products/{handle}` links with the social UTM already carried. The fork
  cannot point at `/discover` beyond the existing single closer.
- **Measures the hop the brief says we are blind to:** the intent param rides
  the same UTM the page already sets, so IG→intent→PDP becomes legible once GA4
  is readable. This is the surface where "measure each hop honestly" (brief #5)
  has the most leverage, because it is the only one with real audience.
- **Serves both visitors (mission brief §7):** "Just curious" is the browser's
  warm on-ramp; the three shopping intents are the seeker's one-click orient.

## 5. What it needs before it can be built (shipping stays disciplined)

1. **IA review** — this adds an interaction to an existing route, not a new
   route or a new homepage section, so it stays inside the fence; but the intent
   card is a new module and needs a named spec through `homepage-ia` before
   build, and the two-link `/discover` cap and retired-route denylist still bind.
2. **Additive Sanity schema only** — a new `socialIntentFork` block document in
   a new file (enable/disable, the prompt line, the three-to-four intent labels,
   per-intent Emma opener + module heading + tag filter). Never modify existing
   schema; the existing `singleton.socialLanding` doc is read, not changed.
3. **Reads existing discovery tags** — the reorder is a new read over
   `mood_tags`/`audience_tags`/`matters_tags` already in the discovery index, not
   new data.
4. **Voice gate** — every prompt line, intent label, and Emma opener clears
   `emma-empathy-reviewer`. Emma's openers here run the plain-warm arrival
   register, not the desire-forward 9 (this is a first-touch orientation surface).
5. **RR7 + motion discipline** — intent state is client-held and URL-synced with
   no `useEffect` data fetching (the reorder is a pure client sort over
   loader data already present); the card reveal is transform/opacity only and
   honors reduced motion; the page carries no LCP hero image above it to wrap.

## 6. Rejected alternatives this cycle (logged so ambition compounds)

- **A full quiz on /social.** A multi-step quiz on the arrival surface would
  duplicate the Compass and burn the five seconds of patience an in-app arrival
  actually has. Rejected: one tap with an immediate reward beats a flow here.
- **Auto-personalizing from the referring post silently.** Inferring intent from
  which IG post drove the click (and skipping the tap) is technically possible
  but removes the self-selection that *is* the self-discovery value, and guesses
  where the visitor would rather choose. Rejected: the tap is the point, not
  friction to optimize away.
- **A personality-label output** ("You're a Curious One"). Off-register for the
  calm shame-free voice and risks boxing the visitor. Rejected in favor of an
  intent the page simply *acts on*, no badge.
- **Building it this cycle.** Deferred by design: while sessions < 300/week the
  ambition mandate is satisfied by a wire, and this needs additive schema + IA
  spec + a design pass first. Banked, not built.

## 7. Status

Proposal only. Not scheduled. Filed so the next design cycle (or the first one
after IG traffic clears the measurement floor) can adopt it, or a better idea it
provokes, with the IA spec and additive schema already scoped here. No code, no
route, no schema written this cycle. This cycle's shipped work is the separate,
cheap-and-certain hardening of the same `/social` surface (in-stock featured
pin, attributed primary PDP link, retired-tic hero copy) in the accompanying PR.

# Social Video Viral Checklist (38 rules, PASS/FAIL)

> **Provenance note (read first):** the content strategist's original formula memo was lost; it
> lived only in a session scratchpad and was never committed. This file is a **reconstruction**
> from the surviving synthesis in `docs/store-team/social-video-strategy-DRAFT.md` §3. Five rules
> (H1, A1, A4, S1, S2) are verbatim-known from the surviving draft; the rest are written in the
> same spirit as concrete, testable statements. Owner: please correct anything here that does not
> match your memory of the original memo. Corrections replace rules in place; IDs are stable.

Every script must PASS all 20 numbered rules **and** the eight craft rules (CR1-CR8) before
enqueue. Serialized episodes (a script carrying `seriesSlug` and `episodeNumber`) must
additionally PASS the six serialization rules (SE1-SE6) and the four shopper rules (SH1-SH4)
below, for 38 total. The writer self-checks at scripting time; `script-doctor` verdicts every rule
adversarially for serialized episodes; the `emma-empathy-reviewer` voice gate verdicts each rule
PASS/FAIL independently. Any FAIL is at minimum a REVISE. An SH FAIL is a BLOCK (it is the
charter's invented-testimonial ban wearing a rule number).

## Hook (H1-H4): the first 2-3 seconds

- **H1.** The transcript of the first 3 seconds reads clean and intriguing with zero context.
  Paste it alone into a doc; if it needs the video to make sense, it fails.
- **H2.** A named-series episode opens on its fixed cold-open, and the cold-open carries its own
  referent in the same line — no orphaned "it" or "one thing" the viewer cannot yet resolve:
  "Ten seconds, and here's how to keep your [product] like new." / "There's exactly one thing that
  matters when you're buying a [category]." translate-the-feeling opens on the scene; the old
  "Let me translate." tag is retired.
- **H3.** Frame one is already inside the scene with something specific in motion by second 2.
  No logo card, no intro, no "hey everyone" throat-clearing.
- **H4.** The hook survives sound-off viewing: on-screen text or the visual itself carries the
  promise before second 3.

## Arc (A1-A4): setup and payoff

- **A1.** One idea per video, never two. A second idea is next week's video.
- **A2.** The payoff resolves the exact tension the hook opened, and lands in the final third.
  A hook that promises X and a close that delivers Y fails.
- **A3.** No spec dumps: at most one number or spec is spoken aloud, chosen because it is
  screenshot-able. Everything else lives in the caption or on the PDP.
- **A4.** Every third script in a series calls back to a numbered earlier episode by its number.

## Wink-curve (W1-W3): the escalation of knowing humor across the arc

- **W1.** The knowing humor escalates: the boldest wink lands later in the video than the first.
  A cold open that out-winks the close fails.
- **W2.** The wink is with the viewer, never at them. No jokes at the customer's expense,
  no smirking at the category.
- **W3.** Displacement holds: speech covers care, storage, and materials, never usage technique.
  The wink implies what everyone knows; the words never say it. (Relaxed for the serialized video
  program per the 2026-09-04 amendment: that show's cast may name pleasure and sensation plainly;
  displacement remains the default for every other script.)

## Share-trigger (S1-S3): why it gets sent

- **S1.** Exactly one designated share line, and it survives being pasted alone into a group
  chat. Mark it in scriptJson so the gate can find it.
- **S2.** Educational videos get a spoken save-line, e.g. "save this for the next time you're
  standing in that aisle."
- **S3.** Sharing is safe: no frame, caption, or the share line itself would embarrass the
  sharer if seen over their shoulder. Plausible deniability holds end to end.

## CTA (C1-C3): the close

- **C1.** The CTA is from the whitelist only, never "Buy now", no countdowns, no urgency theater.
- **C2.** Exactly one CTA per video. Spoken close and caption close point at the same action.
- **C3.** "My DMs" always means site chat at xdipx.com, never platform DMs, and pairs with the
  bio-link mechanic on IG/TikTok.

## Platform (P1-P3): survival

- **P1.** Register caps hold on the most intense line: TikTok 5, IG/YT Shorts 6-7. Acts implied,
  never named, in anything spoken or on screen. (Lifted for the serialized video program per the
  charter amendment 2026-09-04: that show's spoken track runs at 9, plain, with acts nameable; the
  owner posts it manually and accepts the platform risk. These caps remain the default for every
  other script.)
- **P2.** Judge by the most revealing frame: no product-on-body, no simulated use, wardrobe safe
  in every frame, and the AI-generated label is always on.
- **P3.** Audio and caption hygiene: no trending audio with flagged lyrics ever (instrumentals
  and trending formats are fine); explicit nouns allowed in caption prose per platform caps but
  never in hashtags or bio.

## Craft (CR1-CR8): line-level discipline

Eight additional gate-checkable rules from the 2026-08-16 video-scripts all-hands (owner-directed).
The voice gate verdicts each one PASS/FAIL the same way as the numbered rules; any FAIL is at
minimum a REVISE.

- **CR1.** No orphaned referent in a cold open. A cold open that leans on "it", "one thing", or
  "this" without naming what it means in the same line fails. "Ten seconds, I'll fix it." fails;
  "Ten seconds, and here's how to keep your [product] like new." passes.
- **CR2.** No body-part agency. A body part does not act on its own ("your hips will thank you").
  The person acts; the product is the tool.
- **CR3.** Never narrate a fact the viewer already knows. Stating the obvious to fill a beat reads
  as condescension and stalls the hook.
- **CR4.** Each idea is stated once per script. Restating the same point in new words is padding;
  cut it or replace it with the next idea (this sharpens A1's one-idea rule at the line level).
- **CR5.** A metaphor must land unexplained on first hearing. If the line has to gloss its own
  image, the image is wrong; pick one that carries itself.
- **CR6.** No meta-commentary announcing what the copy is about to do ("let me translate", "here's
  the thing", "what I want to tell you is"). Do the thing; do not narrate doing it.
- **CR7.** Never claim to give the viewer what is already theirs. Their time, their night, their
  privacy are not the store's to grant. Owner, verbatim 2026-08-16: "It is obvious people own their
  time... and it is a turn off to hear something so obvious."
- **CR8.** No false agency for time or settings. Evenings do not "give in" or "beg"; they are a
  wind down, a moment of privacy. Owner, verbatim 2026-08-16: "Evenings do not give in. They are a
  wind down, a moment of privacy."

**Calibration benchmark for reviewers.** The Spectrum drawer script — "In the drawer by the bed,
right where you left it. Tonight, and any night the wanting comes back." — rated 6.5/10 by the
owner. Physically true, specific, understated is the direction.

## Serialization and part-2 (SE1-SE6): serialized episodes only

Added 2026-08-26 at the video-program all-hands (owner direction: character arcs on a viral
formula, every episode leaves the viewer wanting a part 2). `script-doctor` holds BLOCK authority
on this family.

- **SE1.** The script carries `seriesSlug` and `episodeNumber` in scriptJson and matches an
  `approved` row in the episode ledger. No ledger row, no render.
- **SE2.** Exactly one loop is opened, named in the episode row, and it is a question about a
  **person**, never a product. "Will she tell him" passes; "will she buy it" fails.
- **SE3.** The part-2 hook is the final spoken or on-screen line, is recorded on the episode row,
  and is answerable only by a later episode. A hook this episode already answers fails.
- **SE4.** The episode closes at least one loop the ledger shows open, or is episode 1 of an arc.
- **SE5.** Every third episode names an earlier episode that actually aired, spoken or on screen,
  and the callback is legible to a viewer who missed that episode. (The enforceable form of A4;
  A4 passes when SE5 passes.)
- **SE6.** The payoff resolves before the door opens. An episode that leaves the viewer only
  curious, and not also satisfied, fails.

## Shopper not owner (SH1-SH4): serialized episodes only

The charter bans a named recurring character presented as if they used the product. These rules
make that mechanically checkable line by line. Any SH FAIL is a BLOCK.

**Serialized video program override (owner direction 2026-09-04, `docs/emma-voice.md` codify).**
For the serialized recurring-cast program only, SH is narrowed: the one banned product line is
claiming a character **tested or tried a specific product**. That show's cast MAY want to feel
sensation, want another person to feel it, and reference having felt things before, so **SH4**'s
"never a claimed sensation" and **W3**'s usage-displacement do not bind the program's spoken
track, and **P1**'s register cap is lifted for it (that track runs at 9, plain). **SH1** (a
consideration or gifting verb on the product line, never "I tried this one"), **SH2** (facts are
specs or audibly-aggregated review patterns, never personal knowledge of the SKU), and **SH3**
(no line claims the character used or is reacting to the specific product operating) still hold in
that narrowed form. Emma is never in this carve-out. The four rules below are the default and
govern every non-program script.

- **SH1.** Every product line uses a consideration verb: considering, comparing, asking about,
  gifting, saving for, going back to look. Possession and experience verbs fail in every mouth,
  including a friend's.
- **SH2.** Any factual product line is a spec or an aggregated review pattern with the
  aggregation **audible**: "the spec sheet says", "reviewers keep describing". A bare fact stated
  as personal knowledge fails.
- **SH3.** No line implies a character has used the product, is using it, or is reacting to it
  operating. Wearables worn as designed are wardrobe, not use (P2 governs the frame; SH3 governs
  the line that would imply it).
- **SH4.** Desire attaches to the person and the situation, never to a claimed sensation. "I want
  to know what she does with it" passes; "it feels incredible" fails in any mouth, voiceover
  included.

## Reconciliation clauses (serialized episodes)

Read these before failing an episode against A1, A2, or A4; without them a literal reviewer fails
every serialized script.

- **A1 and the door.** A1 governs the episode's one idea. The door (SE2/SE3) is not a second
  idea; it is an unanswered question about the same people. A door that introduces a new product,
  category, or tip IS a second idea and fails A1.
- **A2 and SE6.** The payoff still lands in the final third. The door comes after the payoff,
  never instead of it.
- **A4 and SE5.** A4 stays as the principle; SE5 is its enforceable form now that episode numbers
  exist in the ledger.
- **S2** (the spoken save-line) applies only to educational episodes, not to every serialized
  episode.

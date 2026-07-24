# xdipx Social Video Strategy — Team Draft v1 (2026-07-24)

Synthesized from four team workstreams: store-strategist (GTM frame), social-media-manager (platform playbook), video-producer (slate + scene kit), and the sexual-wellness content strategist (viral formula). Owner review pending; nothing here is executed until approved.

## 1. Thesis

Paid acquisition is structurally closed for this catalog, so organic video is the primary top-of-funnel lever. But rented channels (IG/TikTok/YT) cap our register (TikTok 5, IG/YT 6-7 vs owned-channel 9) and can ban the category overnight. Therefore: **video earns suppressed-but-real distribution on rented channels and converts attention to owned surfaces (email list, site chat) as fast as possible.** Success is measured in owned-audience equity, never followers. Video generation cost is a rounding error (~$35-40/month at launch cadence); the binding constraints are owner review/posting bandwidth and account survival.

## 2. Objectives and decide-metrics

| Phase | Question | Decide metric | Honest signals |
|---|---|---|---|
| Days 0-30 | Can we exist and get distributed? | Median organic reach per post (end vs week 1) + zero strikes | Saves, shares, watch-through, follows-per-view |
| Days 31-60 | Does distribution convert to owned capture? | UTM-tagged email/chat captures from social | Profile taps, link CTR, landing capture rate |
| Days 61-90 | Is there a revenue path? | Social-attributed orders and realized margin | Returning social sessions, email-segment purchase rate |

Cold-start reality: blended view→site-visit runs 0.1-0.5%. Social does not move revenue in 30-60 days; the early output is list growth. Below ~300 social sessions/week, GA4 is noise; decisions run on capture numbers and format heuristics.

**Prerequisite before day 30: end-to-end UTM attribution** (video → bio link → site → email tag), or every decide-metric above is unmeasurable.

## 3. The shows (viral formula, codified)

Three named series matching the owner's pillars, each with a fixed verbal cold-open that becomes the brand's recurring bit:

- **"Ten-Second Fix"** (tips & tricks) — "Ten seconds, I'll fix it." Carried by naming-the-unspoken + screenshot-able fact. Care/storage/materials territory only (displacement: never usage technique in speech).
- **"The One Thing"** (how to shop a category) — "There's exactly one thing that matters." Carried by permission-granting-as-status; one deciding factor per category, never a spec dump.
- **"Translate the Feeling"** (find-what-you're-looking-for) — "Let me translate." Carried by plausible-deniability confession; ends hot on the DM CTA. This is the conversion engine feeding site chat.

Brand tentpoles (the dream-job intro and its follow-ups) drop between series episodes. Every script runs the 20-item PASS/FAIL viral checklist (hook rules H1-H4, arc A1-A4, wink-curve W1-W3, share-trigger S1-S3, CTA C1-C3, platform P1-P3) — the full checklist is in the strategist's formula memo and should be codified into the video-producer charter so the voice gate can enforce it. Key rules: clean transcript in the first 3 seconds, one idea per video, exactly one designated share line that survives being pasted alone into a group chat, educational videos get a spoken save-line ("save this for the next time you're standing in that aisle"), every third script calls back to a numbered earlier episode.

## 4. Platform playbook (operating rules)

- **Accounts:** brand-first handle (@xdipx family) on IG + TikTok + YT, identical everywhere; never "Emma's personal account." YouTube Shorts launches third, after 2+ clean weeks on IG/TikTok. Bio stays euphemistic ("Sexual wellness, no shame attached. Emma picks, you shop. 18+"); one link straight to a dedicated `xdipx.com/social` landing route (age gate + chat-with-Emma above the fold + swappable product module), never a Linktree.
- **Warming from zero:** week 1 = 3 posts/platform total, safest formats only (b-roll, no presenter); step to 4-5/week by week 3-4 only with zero strikes. Format mix shifts 60/30/10 b-roll/talking-head/other → 40/40/20 as trust builds. TikTok always runs the lowest cadence and strictest register.
- **Survival rules:** never product-on-body or simulated use; judge by most revealing frame; AI-content labels always on; no trending audio with flagged lyrics ever (trending formats and instrumentals are fine); explicit nouns allowed in caption prose per platform caps but never in hashtags or bio; log every posted caption + thumbnail for appeal readiness.
- **DM routing:** "my DMs" always means site chat, never platform DMs. Comment questions get a public in-voice answer + bio-link pointer. Owner's 15-min/day playbook: 3 min safety triage, 5 min real answers, 4 min good-faith engagement, 3 min proactive.
- **Measurement:** weekly per-video scorecard (hook retention, saves, shares, profile taps, UTM link clicks) + per-account (follower velocity, reach mix, strike count). Owner self-reports five fields per video into metrics_json; unreported weeks stay "not yet reported," never estimated.

## 5. Scene kit and launch slate

**Scene kit** (composed once, owner frame-reviewed, reused forever — new scenes are the only reason to compose new identity frames): Couch Cozy, Vanity Bright, Kitchen Counter Casual first; Closet Edit, Out-and-About Stoop, Reading Nook as stretch. All archetype C, ground-locked, no product ever in a talking-head frame.

**First 8 videos (~$31 total):** sequenced identity/permission before product education —
1. Questions You're Too Polite to Ask: "Is it weird to buy a toy just for yourself?" (Couch Cozy, ~$3.20)
2. Myth-Busting b-roll: "Vibrators ruin your sensitivity" (~$1.80)
3. Ten-Second Fix: discreet storage (Closet Edit, ~$4.00)
4. The One Thing: first wand (Vanity Bright, ~$5.20)
5. Translate the Feeling: "tell me your vibe" → /discover (Kitchen Counter, ~$4.00)
6. Questions: "How loud is a vibrator, really?" (Couch Cozy, ~$3.20)
7. The One Thing: lube without overthinking (Vanity Bright, ~$5.20)
8. Ten-Second Fix: "you don't need an occasion" permission close (Kitchen Counter, ~$4.00)

Each has a named blog tie-in slug (video ↔ post pairs): the same weekly topic ships as video + blog + email beat + homepage placement. One store, one message per week.

## 6. Production architecture (proven 2026-07-24)

- **Talking-head:** Luna voice track first → OmniHuman avatar render from an approved scene frame ($0.16/s, 30s/render cap, scripts split at beat boundaries, halves join invisibly). Video length = speech length.
- **B-roll:** LTX (catalog-safe, no content checker) or Kling + Luna VO mux, sub-$1.
- **Post pass (mandatory):** punch-in cuts every ~3.5s, word-timed captions in DM Sans (timing from ElevenLabs with-timestamps at TTS time in the pipeline; whisper alignment as fallback), music bed, -14 LUFS loudnorm.
- Products never enter checker-guarded renders; product visuals are b-roll cutaways or post-composited stills.

## 7. Pipeline codification backlog (Phase 2 of the production plan)

From video-producer's charter-change list, all via the agent-editor/reviewed-PR path: scene-frame reuse exception to the likeness rule; talking-head framePrompt variant with no product blocking; duration derived from speech length for avatar tier (not the fixed allowed-list); new `presenterLine` field distinct from b-roll `voiceover`; OmniHuman/LTX model-table entries; the four new series added to the formula library; scene-kit inventory surfaced in the config op; the viral checklist added to the voice gate's review criteria.

## 8. Proposed new agents

Recommend adding **one** now, deferring two, and solving one with code:

- **ADD: trend-scout** (weekly, propose-only): monitors TikTok/IG format trends, sounds (lyrics-cleanliness verdicts), and competitor/creator activity in the wellness space; files trend briefs the video-producer can act on. This capability exists nowhere in the current roster and directly feeds the "trending formats yes, flagged audio never" rule.
- **DEFER: community-manager** (comment/DM reply drafting in Emma voice): social-media-manager + the owner's 15-min playbook covers current volume; revisit when comments exceed what 15 min/day handles.
- **DEFER: audience-analyst**: until the weekly scorecard has real data, store-strategist's weekly retro covers it; revisit at day 60.
- **CODE, NOT AGENT: post-producer**: the post pass (cuts/captions/music) is deterministic and belongs in the pipeline's assembly stage, not in an agent's judgment.

## 9. Owner decisions needed

1. Approve/adjust the three show names and the launch-slate order.
2. Approve scene kit concepts (frames get composed and come to you for review before any use).
3. Claim handles (@xdipx family) on IG/TikTok/YT.
4. Greenlight the `xdipx.com/social` landing route + UTM wiring (small build, prerequisite for all decide-metrics).
5. Budget knobs: keep $20/day video budget and raise the per-video ceiling to $8 for avatar renders, or cap avatar scripts at 35s.
6. trend-scout agent: yes/no.

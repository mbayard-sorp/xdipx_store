# Video content strategy: provider decision, format reset, one message

> Owner request 2026-09-23: decide how xdipx produces product video clips for Instagram and X
> consistently and cheaply, without content filters rejecting the catalog, at a visual register of
> 8 to 9; replace the writers-room scripts that read as robotic; and make every channel carry one
> cohesive message. This document is the analysis and the plan. Nothing in it is executed yet.
> Section 8 is the checklist; section 9 is what only the owner can decide.

## 0. The decision in five lines

1. **Provider: Atlas Cloud for video, same key we already pay for stills.** It hosts Grok Imagine
   v1.5 (the one model that cleared the filter 8 of 8 on a raw packshot), the Wan 2.2 and 2.7
   Spicy image-to-video tiers, and InfiniteTalk for talking heads. Wavespeed is the mirror
   provider behind the same seam. Eromify is a sandbox for the owner's hand, not a pipeline.
   Fannabe is a no. RunPod stays off.
2. **Format: retire the serialized drama for this season. Ship product talk.** Fifteen to thirty
   second single-speaker clips, one product, one claim, one laugh, cast on camera, Emma as the
   recurring answer. The show bible is shelved, not deleted.
3. **Rules: 38 checklist rules become 7.** The three-gate script pipeline is what made the scripts
   robotic. Keep one adversarial gate and one voice gate, both on the short list.
4. **Message: one thesis, every channel, each at its own register.** "The door does not have to
   stay closed." Drafted in section 6 for the owner to codify.
5. **Distribution is the real bottleneck, not rendering.** Both accounts have no audience. Reels
   and X video are the only organic surfaces that reach non-followers. One to three reels a week to
   start, daily stills as the base layer, X video upload built, everything else secondary.

## 1. What the data says (production DB, 2026-09-23)

Sixty days of social output, `social_posts` with `status='posted'`:

| Platform | Posts | Video posts | Avg reach / impressions | Avg likes |
|---|---|---|---|---|
| Instagram | 58 | 0 | 3 reach | 0.8 |
| X | 49 | 0 | 31 impressions | 0.0 |

Best single X post in the window: 141 impressions (a Herbenick statistic). Best Instagram post:
reach in single digits. Every row is a still image or text.

Video program ledgers:

| Ledger | State |
|---|---|
| `video_episodes` | 2 `pending_approval`, 2 `needs_changes`, 0 rendered, 0 aired |
| `video_jobs` (60 days) | 2 done, 3 failed, none in flight since 2026-08-23 |
| Talking-head tier | never deployed; the RunPod image only runs `i2v,t2v` |
| X video publishing | not implemented; chunked upload missing (`app/lib/social-publish/x.server.ts`) |
| Instagram reels publishing | implemented, gated by `video_autopublish_enabled` |

Two conclusions the numbers force:

- **"Videos get the most attention" is a market observation, not an account observation.** The
  pipeline has never posted a video. What the data does show is that stills at this cadence reach
  nobody. Reels and X video are the only organic formats with a non-follower discovery loop, so
  the instinct is right, and it is the only move that can change the reach number.
- **The provider was never the binding constraint.** The RunPod worker rendered clips. The chain
  broke upstream: four scripts, two rounds of owner rewrites, no approval, no render, no post.
  Fixing the render provider without fixing the format produces the same zero.

## 2. Why the writers room reads as robotic

This is structural, not a prompt problem. Five causes, all visible in the docs:

1. **Rule count.** `social-video-viral-checklist.md` binds 38 rules per episode (hook, arc, wink
   curve, share trigger, CTA, platform, craft, serialization, shopper). A writer satisfying 38
   constraints in 60 seconds writes to the checklist, not to a listener. The result sounds like a
   document that passed review, because that is what it is.
2. **Serialization with no audience.** The Group Chat bible builds arcs, open loops, part-2 hooks
   and numbered callbacks every third episode. Serial payoff requires a returning viewer. At a reach
   of 3 there is no returning viewer, so every callback is dead weight the writer still has to
   carry.
3. **Shoppers-not-owners as a plot engine.** The premise "wanting and choosing, never having" is a
   correct legal guardrail turned into the dramatic subject. Eight characters who can never use the
   product can only circle it. Circling reads as evasive, and evasive reads as fake.
4. **No mouths.** With the talking tier undeployed, every episode is "voiceover-carried b-roll with
   no on-camera mouths" (bible section 7). A 60-second voiceover over standing-set frames is a
   slideshow. The stiffness the owner heard is partly the format, not only the words.
5. **Three gates optimizing for compliance.** script-doctor (per-rule PASS/FAIL), then
   emma-empathy-reviewer (18 principles), then owner. Nothing in the chain asks the only question
   that matters for organic video: would a person say this out loud to a friend? The closest
   recorded owner feedback on the same voice problem is already in the charter: "It sounds fake and
   is immediately detectable by humans" (`docs/emma-voice.md:21`).

The fix is subtractive. Fewer rules, no serial state, product on camera, a cast member talking to
one viewer, and a read-aloud test as the gate.

## 3. Provider analysis

What was verified this session (vendor pages read 2026-09-23; DB and repo state from the worktree).

### 3.1 The filter problem, precisely

Filters rejected the catalog in three places, per `docs/media-model-routing.md`: Google (Imagen,
Veo, unconditional), fal's input checker on `nano-banana/edit` and on Seedream edit (even with the
safety flag off), and Kling/Veo/Seedance server-side moderation at the model owner. What passed:
Seedream on Atlas, Grok Imagine 1.5 on fal (8 of 8 including a raw Shopify packshot), and Wan
self-hosted. The pattern is simple: open-weight models on a permissive host pass; proprietary
models moderated by their owner do not, regardless of who resells them. That rule sorts every
vendor below.

### 3.2 Comparison

| | Atlas Cloud | Wavespeed | Eromify | Fannabe | A2E | RunPod (own worker) |
|---|---|---|---|---|---|---|
| Already wired | Yes, stills primary since 2026-08-15 (`app/lib/atlas.server.ts`, ADR-010 seam) | No, same REST shape | No | No | No | Yes, i2v/t2v only |
| Product in frame passes | Yes (Seedream verified; Spicy Wan tiers sold openly) | Wan 2.2 Spicy i2v endpoint, optional safety checker | Yes, Spicy tiers on Growth/Creator | Marketed uncensored | **No**, ToS bans "adult content of any kind" and nudity | Yes |
| Talking head | InfiniteTalk (10 min, 480p native, 720p upscale); Grok Imagine v1.5 native dialogue + lipsync, 1 to 15 s | InfiniteTalk and Wan 2.2 S2V, both $0.30 per 5 s at 720p | Not listed (avatar stills + i2v) | Lip-sync listed, unverified | Lipsync $0.06/s | S2V and InfiniteTalk validated 2026-08-30, never deployed |
| Cast continuity | Our own reference frames via Seedream edit, unchanged | Same, we bring the first frame | **Must rebuild the cast inside Eromify.** AUP section 4: uploads must be Eromify-generated or contain no people; face uploads are screened and flagged for human review | LoRA + reference groups, inside their platform | Own frames | Own frames |
| Automation path | REST, one API key, pay-per-second | REST, API key | Remote MCP at `api.eromify.com/mcp`; API key for non-chat clients; 50 videos/day cap | npm MCP, **browser login only**, credentials cached in a local file; no headless auth | REST | Our worker |
| Cost, 30 s 720p talking clip | InfiniteTalk pay-per-second (rate not on the marketing page; Wavespeed's identical model is $1.80); Grok $0.08/s = $1.20 per 15 s | $1.80 | Creator $23.99/mo for 6,000 credits; Wan 2.2 Spicy 9 credits, Seedance 2.0 Spicy 28, per "short clip", length unstated | $29 to $199/mo, credit-based, per-clip cost not published | $8.25 to $40/mo | $0.24 per 14 s at fast8, plus pod overhead, orphans ($1.43 each), an 18.7 h stray ($14) |
| Reliability evidence | In production for stills 5 weeks | Marketed "no cold starts" | Trustpilot 2.3/5 (47 reviews): lost credits, delayed support | None | None | 48 GB GPUs out of stock 3 of 3 attempts; 20-step S2V exceeds serverless timeout |
| Commercial use | AUP prohibits "adult content" while catalog sells Spicy models (known contradiction, owner action open since 2026-08-15) | Depends on model license, per their page | Explicitly allowed: "publishing, marketing, and monetizing" | License granted, but Zillatech keeps copyright and may train on and market our outputs | Allowed but content banned | Ours |
| Verdict | **Primary** | **Mirror** | Owner sandbox only | No | No | Off |

### 3.3 Why not Eromify as the backbone

It is cheap and it does allow the register. Four things disqualify it as infrastructure:

- The cast lives in Sanity as Seedream reference frames. Eromify's AUP requires reference images
  to be generated inside Eromify or contain no people, screens every upload for faces, and routes
  suspected real-person photos to human review. Rebuilding nine identities inside a consumer app
  with a 2.3-star support record, so that a second system of record owns Emma's face, is the
  wrong dependency.
- Its automation surface is a chat-client MCP with a 50-video daily cap and credit cost "per short
  clip" with unstated length scaling. A pipeline needs a per-second price and a job API.
- No talking-head tool. The product-talk format needs mouths.
- Its own terms list "automation" among moderation-evasion violations while selling MCP automation.
  Ambiguous enough to lose a credit balance over.

Where it earns a place: a $16 to $24 month where the owner personally tests Spicy Wan and Seedance
motion on our catalog from Claude Desktop, to calibrate what the register looks like in motion
before the team commits prompts. That is a hand tool, and it should stay one.

### 3.4 Why not Fannabe

Browser-only login with a cached credential file cannot run inside a cloud routine. Its terms keep
copyright of outputs with the vendor and grant them a right to train on and market what we make.
Positioned for AI-influencer creators, not product catalogs. Nothing here beats Atlas.

### 3.5 Why Atlas, and the one risk

Atlas is already the still provider, already behind the ADR-010 provider seam, already paid on a
prepaid balance, and it hosts the three models this plan needs: Grok Imagine v1.5 for short native
dialogue clips ($0.08/s, 1 to 15 s, lipsync in the same pass; superseded by §4.1, 2026-09-23), Wan 2.2 Turbo Spicy and Wan 2.7
Spicy for silent product motion, and InfiniteTalk for up to 10 minutes of talking head from one
frame and one audio file. The spike doc (`docs/media-providers-atlascloud-spike.md`) called the
talking tier the "HARD blocker" for Atlas; that was written before InfiniteTalk was listed there.

The risk is the AUP contradiction captured in `docs/atlascloud-aup-capture-2026-08-15.md`: legal
page prohibits adult content, catalog sells Spicy models, credits forfeit on termination. Two
mitigations were already prescribed and are still open: written confirmation from Atlas that
non-explicit sexual-wellness product marketing is permitted, and small top-ups. Wavespeed as the
mirror provider makes a termination a degraded day, not an outage.

### 3.6 Budget

Owner cadence to start (2026-09-23): one to three videos per week.

| Cadence | Per week | Per month |
|---|---|---|
| 1 sixty-second multi-cast video (InfiniteTalk turns + Wan Spicy b-roll, 1.5x re-rolls) | $5 to $8 | $20 to $35 |
| 3 twenty-to-thirty-second product-talk clips | $6 to $12 | $25 to $50 |
| 3 sixty-second multi-cast videos | $15 to $25 | $65 to $100 |

Unit costs behind the table, 720p: Seedream first frame $0.036; InfiniteTalk about $0.06/s
(Wavespeed's published rate for the same model, Atlas prints "pay per second" without a number);
Wan 2.2 Spicy i2v about $0.06/s; Wan 2.7 Spicy about $0.10/s; Grok Imagine v1.5 $0.08/s with
native dialogue, 15 s cap. Multi-cast dialogue renders one speaker per job off the same frame,
cut in assembly, so 35 s of dialogue is about six jobs. ElevenLabs voice is on the existing plan.

A single $25 Atlas top-up, the minimum tier, covers a month at any of these cadences, which also
keeps credit-forfeiture exposure small while the AUP confirmation is outstanding. Prefer three
short clips to one long one: same spend, three shots at the algorithm, three products named. The
60-second multi-cast piece is a monthly showcase, not the weekly unit.

Compare: the series bible budgeted $2 to $3 per 60-second episode and shipped zero.

## 4. Format reset: product talk

### 4.1 The clip

- **Length:** 15 to 30 seconds. 9:16, 720x1280, first frame at the owner's imagery ceiling
  (`instagram-campaigns.md` section 3.2a), on-skin treatment per 3.2c where the brief calls for it.
- **One speaker on camera,** a cast member or Emma, talking to one viewer. A second cast member may
  appear silent (the listener). Product visible in the first two seconds, in hand or on the body
  where 3.2c allows.
- **Two production modes, chosen by the writers per clip** (owner ruling 2026-09-23, superseding
  the Grok routing in §3.5, the video-producer row in §5, and the week 1 and week 2 items in §8): `talking` puts the cast member on camera on InfiniteTalk
  720p, `voiceover` shows the product in her hands on Wan 2.7 with the same ElevenLabs cast voice
  laid over, and Grok is not routed because every spoken word must be the speaker's cast voice.
- **One product, one claim, one laugh.** The claim is a spec or an aggregated reviewer pattern,
  stated plainly. The laugh is the cast member's personality doing something with that fact.
- **Spoken register 9, plain** (bible amendment 2026-09-04 stands). Caption register per platform:
  Instagram 9 by implication, X 6 to 7.
- **Close on a whitelist CTA** delivered as a line, never as a button read aloud.
- **No serial state.** No callbacks, no open loops, no episode numbers. A viewer who has never seen
  us must get the whole thing.

### 4.2 Seven repeatable formats

Each is a template a writer can fill in one sitting. Rotate across the week.

1. **"The spec nobody reads."** One number from the spec sheet, why it matters in bed, done.
2. **"Ask Emma."** A cast member asks the shy question; Emma answers in one breath.
3. **"Two on the counter."** Same category, two products, the one-sentence difference.
4. **"Gift math."** Who this is for, what it says about the giver, what it costs.
5. **"Material class."** Silicone versus glass versus steel, or lube chemistry, in 20 seconds.
6. **"Vivian's verdict."** The mid-50s confidante says the unshockable thing about a product.
7. **"Sofia dares you."** Names the want directly. Product as the answer.

### 4.3 The rules that replace 38 (superseded by docs/store-team/video-clip-rules.md: eight rules and two hard lines)

1. The first line is a claim or a question a stranger would stop for. No greeting, no brand name.
2. The product is on screen by second two and named by second five.
3. One verifiable fact (spec, material, reviewer pattern). Cite the source class in the beat sheet.
4. No character claims to have used, tested, or owned the product. Wanting is fine. Knowing is
   fine.
5. Every frame respects section 3.2a. Every spoken line respects the charter. Nothing else is
   gated.
6. **Read-aloud test:** the gate reads the script out loud at conversational pace. Anything that
   would not be said to a friend across a table gets cut, not rewritten.
7. Under 30 seconds spoken. If it needs more, it is two clips.

## 5. Agent team: who changes and what they are told

No new agents. Six briefs change. Each change is an `instructions`-kind suggestion for
agent-editor, one PR each, so the release engine can merge them.

| Agent | Today | New brief |
|---|---|---|
| series-showrunner | Weekly 2-episode serialized slate with arcs and loops | Weekly slate of 7 product-talk clips: product, format from 4.2, speaker, listener if any, the one fact, the one laugh. Picks products from what social has never posted (465 products with zero posts per the 2026-09-01 audit) and the strategy brief. Files one owner batch. Still never writes dialogue. |
| episode-writer | 60 s five-beat episodes, captions, site cut | Writes the 15 to 30 s script per clip on the 4.3 rules: beat sheet (3 beats max), spoken lines, first-frame brief for social-art-director, two captions (IG at 9 by implication, X at 6 to 7). Still never writes framePrompt or motionPrompt. |
| script-doctor | 38-rule PASS/FAIL, part-2 test, continuity test | 7-rule PASS/FAIL plus the read-aloud test. Returns REWRITE THIS LINE. BLOCK authority stays on rule 4 and rule 5 only. |
| emma-empathy-reviewer | Voice gate, 28 or 38 rule verdicts on scripts | Voice gate unchanged, but verdicts on the 7 rules only. |
| video-producer | Enqueues on RunPod; fal images only | Enqueues on Atlas: Grok Imagine v1.5 for clips with a spoken line up to 15 s (superseded by §4.1, 2026-09-23), InfiniteTalk from the cast frame plus ElevenLabs audio for 15 to 30 s, Wan Spicy i2v for silent product beats. Wavespeed is the mirror. Same frame gate, same byte-identical spoken-text assertion. |
| social-media-manager | Stills calendar, one IG plus one X companion daily | Reels on clip days (one to three a week to start), the same clip on X once upload ships, daily stills continue as the base layer. Caption discipline unchanged. |

Unchanged: social-art-director (first-frame briefs, now for video first frames), social-publish-gate,
media-manager, the imagery ceiling, the charter.

What to write into the top of each brief, verbatim, so the agents share the frame:

> The clip is a person telling a friend one true thing about one product, at the register the
> channel allows, in under 30 seconds. If a rule makes the line sound less like a person, the rule
> loses and gets reported on the bus. The product is on screen. Nobody on camera has used it.

## 6. One message across every channel

There is no positioning doc. The mission brief is operational, the charter is a voice charter, and
the closest thing to a thesis is the owner's own sentence quoted in two places: "Sex toys are
ALWAYS available for someone to use for pleasure. The door doesn't have to stay closed, and we
don't have to hide in the dark to use sex toys. That is a core message of the brand."

Draft for the owner to codify (per the voice rule, nothing below is written into the charter until
the owner says "codify"):

**Thesis:** The door does not have to stay closed.

**Three pillars, in the order every channel uses them:**

1. **Permission.** Wanting is normal, saying so is normal, buying is normal. (Emma's register.)
2. **Plain knowledge.** Specs, materials, what reviewers describe, said out loud without
   euphemism. (The authority register.)
3. **Discretion as a product feature.** XDIPX on the statement, plain box, no questions. (The trust
   register.)

**How each channel carries it:**

| Channel | Register | Which pillar leads | Proof it is the same message |
|---|---|---|---|
| Site, PDP, Emma | 9 | Permission | The hero line and Emma's asides say the want out loud |
| Email, opted-in SMS | 9 | Permission then knowledge | Subject lines are the clip's first line |
| Instagram reels and stills | Visual at 3.2a, caption 9 by implication | Permission | The clip; caption implies the act, names the fact |
| X | 6 to 7 | Knowledge | Same clip, caption leads with the fact |
| TikTok | 5 | Knowledge | Same clip cut to the spec beat only |
| Blog | Authority, desire capped 7 to 8 | Knowledge | The clip's fact expanded to 800 words, clip embedded |
| LinkedIn | 2 to 3 | Discretion and the business | The category, never the act |
| Paid ads | 3 to 4 | Discretion | Education-register per ads-policy; no clip audio |
| Support | 2 to 3 | Discretion | The promise kept |

The operational rule that makes this cohere: **the week's seven clips are the week's content
calendar for every channel.** Blog expands one, email quotes one, X reposts all seven at its
register, LinkedIn gets the category fact. One source, nine registers. This replaces the current
state where social, content, and email each choose subjects independently.

## 7. Distribution: what has to be true for any of this to matter

- **Instagram reels are the only organic surface that reaches non-followers at this account size.**
  Three a week to start (owner cadence), first two seconds carry the product, no price or "buy" language on screen or in
  caption (Meta removes posts that read as adult-product sales; the whitelist CTAs already comply).
  Reels publishing exists; flip `video_autopublish_enabled` once the first five clips are
  owner-approved.
- **X cannot post video today.** Chunked media upload is a bounded engineering ticket. Until it
  ships, the owner posts by hand, which is the same manual path that has produced zero posts.
- **Music is unavailable through the Instagram Graph API.** Clips carry voice and a generated bed,
  or silence with captions. Do not design around trending sounds.
- **Measure one number per clip:** reach on Instagram, impressions on X, both already captured in
  `metrics_json`. After 21 clips, keep the two formats from 4.2 that lead and drop the two that
  trail.

## 8. Plan and checklist

**Week 1: prove the render path and the format (about $20 in credits).**

- [ ] Owner: Atlas top-up at the minimum tier; send the AUP confirmation request that has been open
      since 2026-08-15 (section 9).
- [ ] Team: bake-off on Atlas, 3 models x 2 cast members x 1 product. Grok Imagine v1.5 with a
      spoken line, InfiniteTalk from a cast frame plus ElevenLabs, Wan 2.7 Spicy silent. Record
      pass/fail, seconds, dollars, and whether the product survived the filter, in
      `docs/media-model-routing.md`.
- [ ] Team: five product-talk scripts written by hand against the 4.3 rules, no agents, for the
      owner to approve. This is the calibration set the agents will be pointed at.
- [ ] Owner: approve or line-edit the five. Line edits land in `video_script_edits` so the showrunner
      can read them.

**Week 2: wire it.**

- [ ] Code PR: Atlas video adapter behind the ADR-010 seam (Grok (superseded by §4.1, 2026-09-23), InfiniteTalk, Wan Spicy tiers),
      Wavespeed mirror, RunPod tiers marked ineligible. Owner merge: `video-worker` paths are
      cost-adjacent, treat as protected.
- [ ] Code PR: X chunked video upload in `social-publish/x.server.ts`.
- [ ] Six `instructions` suggestions (section 5) through agent-editor. The 7-rule checklist becomes a
      new file; the 38-rule file is left in place and marked superseded for this season.
- [ ] Bible: add a header note that The Group Chat is shelved for season 1 of product talk, with
      the cast, sets, and voices carried over unchanged.

**Week 3 onward: cadence.**

- [ ] Showrunner files the first 7-clip batch. Owner approves in one sitting.
- [ ] Flip `video_autopublish_enabled`. Three clips a week, one to start if the batch is thin.
      Daily stills keep running as the base layer on the other days. X as soon as upload merges.
- [ ] Week 6 review: reach per format, cost per clip, filter rejections. Keep the leading formats,
      retire the trailing two, whatever the clip count is by then.

**Kill criteria.** If after six weeks of posted clips median Instagram reach is still under 100,
the problem is the account, not the content, and the next document is about seeding an audience
(creator reposts, the outreach queue, the X companion accounts), not about video.

## 9. Owner decisions (money, brand, valves; nothing else in this plan needs the owner)

1. **Atlas as the video provider** and a small credit top-up. Yes or no.
2. **Send the Atlas AUP confirmation request.** Open since 2026-08-15. The reply goes next to the
   capture doc.
3. **Shelve The Group Chat for this season.** Cast, sets, voices carry over. Yes or no.
4. **Codify the thesis and pillars in section 6** into the charter, or edit them first.
5. **Eromify:** optionally one Growth or Creator month for your own hand, no pipeline dependency.
6. **Valve flips when the first five clips are approved:** `video_autopublish_enabled`.
7. **Owner merge** for the provider adapter PR (cost-adjacent path).

## 10. What this plan deliberately does not do

- Does not buy a second identity system for the cast.
- Does not restart RunPod, on any GPU.
- Does not add a fourth gate, a longer checklist, or a second serialized show.
- Does not relax the imagery ceiling or the charter. Register is a constant; the format changed.
- Does not treat "AI influencer" platforms as infrastructure. Their unit of value is a persona they
  host. Ours is a catalog and a cast we own.

## Sources checked this session

Vendor pages read 2026-09-23: Eromify pricing, MCP, terms, and acceptable-use pages; Fannabe npm
package metadata (`@fannabe/mcp` 0.6.9, published 2026-09-23) and two third-party reviews; Atlas
Cloud InfiniteTalk and Grok Imagine v1.5 model pages; Wavespeed Wan 2.2 I2V, Wan 2.2 Spicy I2V,
Wan 2.2 S2V, and InfiniteTalk pages; A2E pricing and terms; fal Wan 2.2 A14B API page. Repo:
`app/lib/fal-video.server.ts`, `app/lib/atlas.server.ts`, `docs/media-model-routing.md`,
`docs/media-providers-atlascloud-spike.md`, `docs/atlascloud-aup-capture-2026-08-15.md`,
`docs/store-team/video-worker-runpod.md`, `docs/store-team/series-bible-the-group-chat.md`,
`docs/store-team/social-video-viral-checklist.md`, `docs/store-team/instagram-campaigns.md`,
`app/lib/social-publish/*.server.ts`. Production DB: `social_posts`, `video_episodes`, `video_jobs`.

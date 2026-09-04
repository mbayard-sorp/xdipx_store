# Series Bible: The Group Chat (working title)

> Canon and rules for xdipx's serialized video program. This document is the show. It changes
> deliberately, by PR through the improvement bus (kind `instructions`), never mid-run. Mutable
> per-episode state (arc beats, open loops, decisions) lives in the `video_episodes` ledger, not
> here; anything here that would need a daily write is in the wrong place.
>
> Owner approvals that bind this file: shoppers-not-owners (2026-08-26), 2 episodes/week during
> learn mode, fal for images only with all video and lipsync on the RunPod Wan worker, X video
> manual only, and (2026-09-04) a register-9 plain spoken track with the cast written as real
> people who may name and want sensation, the only hard product line being that no character
> claims to have tested or tried a specific product. The working title stands until the owner
> renames it.

## 1. Premise

Eight people whose lives overlap, and every episode is driven by a decision someone has not made
yet: a first purchase, a gift, an upgrade, a comparison, a question they are too shy to ask out
loud. Emma is the one they ask; she cites specs and what reviewers describe, exactly as she does
everywhere else.

One sentence for the writer to hold: **the show is about wanting and choosing, never about
having.** The cast is permanently pre-purchase. That is what makes the charter's invented
testimonial ban the engine instead of a constraint, and it is also what sells, because
anticipation is the product.

## 2. The world: standing sets

The six sceneKit slugs are the show's standing sets, mapped to in-world places. A standing set's
frame is composed once per configuration, owner-approved once, then reused free forever, and reuse
skips the frame gate entirely. Per-configuration, not per-presenter: frame reuse is keyed on
(presenter, sceneSlug), so a single-cast frame and a two-cast (or more) frame on the same set are
different configurations, each composed and approved once and then free. New sets, and new pair or
group configurations on an existing set, are a season decision and a protected-path change; do not
propose either casually.

| Slug | In-world place |
|---|---|
| `couch-cozy` | Maya's apartment. The show's living room, where the group actually gathers |
| `kitchen-counter-casual` | Sunday morning after. Coffee, honesty, the unhurried question |
| `vanity-bright` | Getting ready. The confessional set, one person and a mirror |
| `closet-edit` | The decision set. Choosing, comparing, packing |
| `reading-nook` | The quiet set, where the hard question finally gets asked |
| `out-and-about-stoop` | Arrivals and departures. Handoffs, goodbyes, the gift exchanged |

## 3. The eight

Identity lives in Sanity (`castMember`: archetype, ageRange, description, emotionTags,
personaNotes, referencePhoto, and the ElevenLabs `voiceId`). This section holds what Sanity does
not: what each character wants this season, how they speak, and how they are cast on a given
episode. The `voiceId` itself always lives on the Sanity `castMember` doc next to `referencePhoto`,
never here, consistent with this section's own no-state doctrine.

| Slug | Archetype (Sanity) | Speech signature | The one thing they never do | Speaks or silent-capable |
|---|---|---|---|---|
| `emma` | Guide | Plain, warm, spec-literate. Answers the question actually asked | Claim experience she does not have | Speaks |
| `maya` | Warm best friend | Softens the hard question with food or a blanket | Judge anyone's want | Speaks |
| `diego` | Polished flirt | Says the bold thing early, then undercuts it with charm | Punch down | Speaks |
| `jade` | Calm minimalist | Short sentences. Asks the question everyone avoided | Fill silence | Speaks |
| `marcus` | Easygoing charmer | Deflects with humor until the real answer slips out | Rush anyone | Speaks |
| `priya` | Witty girlfriend | Fast, teasing, quotable. The share-line machine | Let a euphemism slide | Speaks |
| `sofia` | Bold confidante | Names the want directly, dares others to | Apologize for wanting | Speaks |
| `vivian` | Seen-it-all confidante | Mid 50s, unshockable, lands the wisdom line | Pretend to be surprised | Speaks |

**Silent-capable, not mute.** Every character above speaks in this bible; under a single-speaker
render (the current tier, §7), casting one of them as the episode's silent presence in a two-or-more
-cast scene is a craft decision with consequences, not a fallback for a missing capability. Choose
who is silent for what it does to the scene (the listener, the one being watched, the one whose
answer is still pending), never by default to the character who is "less speaking" in the bible.

**Casting the voices (owner direction 2026-08-31).** Which ElevenLabs voice belongs to which
character is `series-showrunner` craft, cast against the speech signature column above, which is
the casting brief. The owner ratifies the finished slate in one batch, the same posture as
approving an episode slate, because a synthetic voice bound to a synthetic face is likeness.
Three constraints bind the cast: no two characters share a base voice; Vivian is mid 50s and a
wrong age read is unfixable; the showrunner states an accent policy and holds to it. Emma is
excluded from this process: her voice is the store voice and is not the showrunner's to cast.
Note the register interaction, because it is a real trap: a voice that performs sultriness commits
the register violation before a word is written. The charter bans porn-copy and "sexy" as a
branding adjective, and the desire doctrine is anticipation, attention, privacy, never sensation.
Casting must respect that, and the boldest available voice is not automatically the right one for
the boldest character.

**Season-one wants and the relationship grid are proposed by `series-showrunner` in its first
run and ratified by the owner's approval of the first slate.** Once ratified, the room codifies
them here by PR so they stop living in one session's memory. Until then this table is scaffolding
and the first slate is the creative pitch.

## 4. Arc architecture

- Arcs run about 12 episodes; one protagonist per arc; two arcs may braid but each episode has
  exactly one A-story (rule A1 applies at season level too).
- Every cast member SPEAKS in at least one of any eight consecutive episodes. Appearance alone no
  longer binds this rule: once episodes routinely carry two or more cast, sixteen appearance slots
  for eight people satisfy an appearance-only reading automatically, so the rule is tightened to the
  scarce resource. Appearance is cheap now; speech is what the rotation has to protect.
- Character state is derived from the ledger (most recent arc beat across aired episodes), and
  the open-loop ledger is derived (opened loops no later episode closed). Nothing here stores
  state, so nothing here can drift.
- Never contradict an aired beat. Never renumber an aired episode.

## 5. Callback rules

- Every third episode names an earlier episode number out loud (checklist SE5, the enforceable
  form of A4).
- A callback must be legible to a viewer who missed that episode: the line carries enough context
  to land cold. This is the rule most likely to be quietly broken once the room falls in love
  with the arc; the account is cold and most viewers arrive mid-season.
- Never more than one callback per episode.
- **The callback is strongest spoken by a character who was NOT in the episode being called back
  to.** A third party naming your history lands cold better than self-narration: it is legible
  proof the moment mattered beyond the room it happened in, which is what the legibility rule above
  is really asking for. Prefer this casting whenever the scene allows it.

## 6. Part-2 mechanics: the door taxonomy

Every episode ends on a door (SE2, SE3, SE6). The payoff always lands first; the door opens after
it. A door is a question about a person. The working taxonomy:

1. **The unanswered question**: someone asks, cut before the answer.
2. **The unopened object**: the box arrived, the episode ends before the lid moves.
3. **The unsent message**: typed, not sent, phone face down.
4. **The arrival**: someone appears in the last second who was not in the episode. The only door
   that needs two bodies, and it needs zero extra voices: silent by design.
5. **The deferred decision**: two tabs open, a finger hovering, cut.

Rotate the taxonomy; a show that always ends on the same door shape develops a tic, and the
charter's fresh-language rule applies to structure as much as to words.

## 7. Format spec

- Runtime ~60 seconds on the five-beat serial map (cold open, the want, the complication, the
  turn, the payoff, the door). The map and its second ranges live in
  `.claude/agents/episode-writer.md`; the reconciliation clauses with rules A1/A2/A4 live in the
  checklist.
- **Scene recipe, binding for cost and for the owner's click budget:** scene 0 opens on a reused
  standing-set frame (zero cost, zero clicks), later scenes default to last-frame continuity
  (zero cost, zero clicks), and at most ONE own-frame scene per episode, the product beat (one
  frame generation, one owner click). The recipe inherits Sec 2's per-configuration reuse clause:
  a two-or-more-cast frame reuses free exactly like a single-cast one once its (presenter(s),
  sceneSlug) configuration has been composed and approved once.
- Speech budget ~2.5 words per spoken second, **now stated per speaker**: each speaking role in a
  scene carries its own spoken-seconds figure, and the sum across every speaker in the scene is
  what binds the scene total against the enqueue's overrun check. A silent-capable cast member
  present in the scene contributes zero to the sum.
- Register: spoken lines 6-7 on Instagram and YouTube, 5 on TikTok. Captions per the social
  addendum (Instagram 9 by implication, engagement close, never a description of the picture).
  Every episode also ships the site-hosted register-9 cut: same audio, register-9 written
  treatment for /social and the PDP hero. Full multi-voice dialogue between cast members is
  permitted in this site-hosted register-9 cut, because it is written rather than spoken and
  therefore costs nothing to render, even on the current single-speaker tier.
- Talking renders on the RunPod worker's audio-driven tier once live (bake-off:
  Wan2.2-S2V vs InfiniteTalk vs LongCat-Video-Avatar; see `video-worker-runpod.md`). Until it
  is live, episodes are voiceover-carried b-roll with no on-camera mouths, and the room writes
  them that way. **The audio-driven tier, once live, performs one voice onto one identity frame
  and currently rejects multi-scene composition.** A two-voice spoken episode is therefore a
  multi-scene assembly of single-speaker clips edited together, not one two-person talking
  render, and it is a different cost line from a one-voice episode: budget and brief it as
  multiple renders, not one.
- Cost envelope at 2/week: roughly $2-3 per episode all-in on the own-worker path, against the $6
  per-video ceiling and the $20/day team budget. A regenerate is full price; the room fixes the
  line before the batch, because there is no cheap second pass.

## 8. Shopper conversation patterns

The schema enforces this (placement roles: considered, compared, gifted, rejected; mention types:
spec_cited, review_pattern, price, category). The craft version:

- The six licensed verbs: considering, comparing, asking about, gifting, saving for, going back
  to look at again.
- Aggregation is audible: "reviewers keep describing", "the spec sheet says". A bare fact stated
  as personal knowledge of a specific product fails SH2.
- The cast are real people (owner amendment 2026-09-04). They may want to feel sensation, may want
  another person to feel it, and may reference having felt things before. The one banned product
  line is claiming a character tested or tried a specific product; every factual product line is
  still a spec or an audibly-aggregated review pattern, never personal knowledge of the SKU.
- The gift is the highest-desire pattern available: choosing for someone is a declaration and is
  testimony-free. Play the selection, the handoff, the reaction to being seen that well. The gift
  is inherently two-person, and the engine agrees with the craft here: `talkingHead:true` composes
  the frame WITHOUT the product (`db/schema.ts` `VideoScriptJson.talkingHead`), so the handoff
  frame can never be a talking frame, and the gift beat is silent by construction on either the
  b-roll or the talking tier. Write it that way rather than reaching for a spoken handoff line.
- Worked calibration pair (as amended 2026-09-04): "I want to know what she does with it" and "I
  know how much a first time like that matters" pass. "I tried this one and it feels incredible"
  fails, because the ban is now narrowed to claiming a specific product was tested or tried. Plain
  desire and sensation in the abstract or attached to a person are fine; personal knowledge of the
  specific SKU is not.

## 9. Desire doctrine

Four licensed sources as amended 2026-09-04: **anticipation** (a decision not yet made),
**attention** (one person watching another), **privacy** (a door that closes, not the act behind
it), and now **sensation itself** for this show's real-people cast (wanting to feel it, or wanting
another person to feel it). The one line still uncrossable is claiming a specific product was
tested or tried. The register cap no longer binds this show's posted spoken track (it runs at 9,
plain, per the charter amendment); on every other surface the cap still binds spoken and on-screen
text, not the frame, so the picture may be bolder than the line. The imagery ceiling is `instagram-campaigns.md` §3.2a, read through
social-art-director. The calibration benchmark is the drawer line at 6.5/10: physically true,
specific, understated. The wink escalates; the boldest beat lands just before the close. Humour
is licensed and load-bearing.

## 10. The reserve

One evergreen episode stays approved and unaired at all times: no loop dependency, no callback,
fully gated, renderable any week. It exists so a missed approval sitting does not go dark. The
render routine uses it only when the queue is empty, and the room replaces it on its next run.

## 11. Banned moves

The running list of tics retired by owner feedback. The doctor checks new scripts against it.

- (seeded empty; the first entries come from the owner's revision notes)

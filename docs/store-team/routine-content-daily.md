# Routine: Daily Content Writer (content-writer)

The playbook for the scheduled blog content routine. Entry agent: `content-writer`. One post per
run, drafted as a Sanity `blogPost` (`status:'draft'`), dual-gated through `emma-empathy-reviewer`
(voice) and `sex-wellness-reviewer` (subject-matter accuracy), and published live only on a clean
PASS from both, with a hero image attached, **and** the
`content_team_autopublish` valve being on. Every published post carries a hero image (owner
directive, 2026-07); heroless is not an accepted published state. Valve off = the post stays a
Sanity draft for the owner; the routine still runs and reports.

Runs on the **Max subscription**. Recommended cadence: daily. Never call the site's Anthropic-keyed
endpoints (`app/lib/claude.server.ts`, `/api/generate-copy`, `/api/admin/blog/generate-outline|draft|seo`,
enricher, IVR); the site is for data reads and spend logging only. Sanity writes go through the
Sanity MCP tools.

Auth on every `/api/team/*` call and the revalidate endpoint: header `x-team-secret: $TEAM_TOKEN`
(falls back to `$HOMEPAGE_TEAM_TOKEN`, then `$CRON_SECRET`). `BASE_URL` = deployed origin.

## Step 0: Start

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"start","team":"content","runType":"content"}'   # → $RUN_ID
```

## Step 1: Gate

```bash
curl -s "$BASE_URL/api/team/gate?team=content&excludeRun=$RUN_ID" -H "x-team-secret: $TEAM_TOKEN"
```

If `ok:false`: post `{"op":"update","id":$RUN_ID,"update":{"status":"skipped","finished":true,"summary":"gate refused: <reason>"}}`
and **stop**: skip honestly, never work around the gate. If `ok:true`, capture
`valves.autopublish` from the response; it decides Step 6. Also capture
`contentSlot` (`{weekday, expectedCategory, fallbackCategory}`): the server
computes today's weekday in PT and the matching category slot; it is
authoritative for Step 3. Never compute the weekday yourself. The gate enforces the
`content_team_enabled` kill switch, `content_team_daily_cents` (500), and `content_team_max_runs`
(8; the extra runs are gate-retry headroom on double days (Sat trend-scout, Sun SEO curation,
Wed podcast review) plus writer-retry headroom, never a second post; migration 068 versions the
budget, 075 the cap).

## Step 2: Load doctrine + context (data only)

1. `docs/emma-voice.md` core + **blog addendum** (mandatory, before any words). Either missing →
   STOP and report.
2. `docs/store-team/mission-brief.md` (binding); the strategy brief (`GET /api/team/brief`); it may
   carry a per-team `content` section with the week's topic slate.
3. Calendar (`GET /api/team/calendar`) for campaign tie-ins.
4. Topic sources, in priority order: the `seoContentBrief` queue (primary — planned weekly by the
   seo-curator routine from the keyword bank), then `docs/store-team/content-plan.md` (the static
   backlog is the floor, still binding for slot themes and standing rules), then the strategy
   brief's content section. If content-plan.md is ever missing in your checkout, fall back
   gracefully and record a `step` event saying you did.

## Step 3: Topic selection + slug pre-check

Today's category is the gate response's `contentSlot.expectedCategory` (server-computed in PT;
use `contentSlot.fallbackCategory` only per the Thursday/Sunday rules below). The map mirrors
the weekly rhythm in content-plan.md §2 (Mon/Wed guides, Tue/Fri real-talk, Thu podcast-notes,
Sat care, Sun comparisons/wellness-basics flex); if the two ever disagree, trust the gate and
file a suggestion.

**Thursday first-check (podcast-notes):** query the pending podcast brief before anything else:

```groq
*[_type == "podcastReviewBrief" && status == "pending"] | order(publishedDate desc)[0]
```

Found → today's post is the podcast review (content-plan §8A shape): patch the brief
`status:'drafted'` immediately (idempotent claim), carry its takeaways, agree/pushback angles,
`productAngles` (stock-verified before embedding), `suggestedTitle`, and episode URL into Step 4,
and use category `blogCategory-podcast-notes`. None pending → fall back to a care post and note it
in the retro.

**Real Talk days (Tue/Fri):** pick the next unwritten topic from content-plan §8B (or a queued
brief that fits the problem→resolution shape), and write to the §8B structure — essay-shaped
(direct-answer capsule, scene-first problem, root cause with authority, resolution with at most
ONE earned embed).

## Step 3.5: Intimacy-advisor brief (Real Talk days only)

Before drafting a Real Talk post, hand the chosen §8B row (slug, problem, target query, † flag)
to `intimacy-advisor`. It returns a structured brief: the emotional arc, the reader's specific
unnamed fear, what clinicians commonly observe (always attributed, never first-person clinical
authority), 2-3 concrete validation lines, topic-specific clinician-line triggers on † rows,
0-3 real sources, and caution flags. Draft FROM the brief in Step 4; the brief is same-run
context, not a Sanity doc. The advisor contributes only — it has no verdict, no block authority,
and both downstream gates review the final draft exactly as before. If the advisor errors, note
it as a `step` event and draft without it; do not skip the day.

Otherwise pick, in order, logging the source as a `step` event:

1. **Brief queue (primary):**

```groq
*[_type == "seoContentBrief" && status == "queued" && category == $todayCategory]
  | order(coalesce(plannedFor, "9999") asc, priority desc)[0]
```

2. Any queued brief regardless of category (a filled queue beats rhythm purity).
3. The next unwritten entry in the content-plan §3 backlog.
4. The strategy brief's content section.

**Stale-claim reclaim (before selecting a fresh brief).** A brief can be left in `drafted` with no
published post two ways: a crashed run stranding its claim, or a live draft that failed a gate BLOCK
and was deliberately left `drafted` rather than re-queued (Step 5 item 4 / Step 6, ticket #94). Either
way the weekly curator sweep can hold that topic hostage for days. Do not wait for the sweep: if the
top brief in the queue is already `status:'drafted'` but has no corresponding published `blogPost`
(`*[_type == "blogPost" && slug.current == $slug && status == "published"][0]` returns nothing) and no
run is currently in flight for it, treat it as **reclaimable** and pick it up as today's topic,
recording a `step` event that says you reclaimed a stale drafted brief and which run stranded or
blocked it. A brief that is `drafted` **and** already has a published post is genuinely done; leave
it.

When a brief is chosen: patch it `status:'drafted'` immediately **and `publish_documents` on it**
(idempotent claim; a crashed run leaves it drafted, and the curator re-queues stale drafted briefs
weekly), and carry its `targetQuery`, keyword refs, `embedHints`, and `internalLinks` into Step 4.

> **Every Sanity write is `patch` THEN `publish_documents`.** A Sanity MCP `patch` writes to
> `drafts.<id>` only; the change is invisible to the live site and to any published-perspective GROQ
> read until `publish_documents` is called on that id. A claim, a status flip, or a closeout that was
> patched but never published is a no-op that will keep resurfacing. This applies to every Sanity
> write in Steps 3, 4, and 6.

Before drafting anything, check the slug against the **published** perspective, never the raw one:
an unpublished draft at this slug must never read as a taken slug, or you skip past your own
unfinished work (ticket #3401/#3405; run 327 held `blogPost-which-dildo-material-is-best` as a
draft and needed an owner nudge to avoid exactly this):

```bash
npx tsx scripts/check-slug-precheck.ts --slug "<slug>"
```

This runs the corrected published-perspective GROQ (`*[_type == "blogPost" && slug.current ==
"<slug>" && status == "published"][0]._id`) and prints one of three decisions:

- `{"action":"slug-taken","reason":"published"}`: a published post already lives at this slug.
  Take the next queued topic and re-check.
- `{"action":"resume-draft","reason":"unpublished-draft","draftId":"..."}`: an unpublished draft
  exists at this slug (typically a post Step 5 item 4 BLOCKed, or a crash-stranded claim). **Resume
  that draft as today's post instead of selecting a fresh topic**: carry it into Step 4 in place of
  drafting a new one, and record a `step` event naming which run stranded or blocked it (read the
  brief's/post's most recent events) so the resume is traceable. Selecting a fresh topic here is
  exactly what orphans finished work.
- `{"action":"slug-free","reason":"no-post-at-slug"}`: nothing exists at this slug; proceed.

One `step` event with the chosen topic, slug, source (brief / plan / strategy-brief fallback /
resumed-draft), and whether it was a fresh topic or a resume.

## Step 4: Draft the post (Sanity, status draft)

Create idempotently: doc `_id` is `blogPost-${slug}`, `createIfNotExists` then `patch`. Fields:

- `title`; `slug` (`{_type:'slug', current}`); `author` (reference to the Emma `blogAuthor` doc,
  `_ref:'blogAuthor-emma'`); `category` (reference to a `blogCategory`: `blogCategory-guides` |
  `blogCategory-comparisons` | `blogCategory-care` | `blogCategory-wellness-basics` |
  `blogCategory-podcast-notes` | `blogCategory-real-talk`; the first four are seeded and
  published — `createIfNotExists` the podcast-notes/real-talk docs on first use, title "Podcast
  Notes" / "Real Talk"); `tags[]`; `excerpt` (required); `publishedAt` (required, fresh ISO,
  today); `status:'draft'`.
- `body` (Portable Text): `normal`/`h2`/`h3`/`h4`/`blockquote` blocks plus `blogProductEmbed`
  (`{productHandle, ctaLabel, layout}`), `blogPullQuote`, `blogCta`.
- `seoTitle` (max 70 chars) and `seoDescription` (max 160 chars), both filled.
- `relatedPosts` (max 3, when relevant); `featured` and `noIndex` default off.
- `heroImage` + `heroImageAlt`: ask `media-manager` (reuse-first). The request MUST (a) state the
  post's publishing category and (b) point at the §0 **hero router** in
  `docs/notebook-team/image-brief.md`, which is binding: guides/comparisons/care/wellness-basics
  posts get the §0-P product hero (subject = one of the post's `blogProductEmbed` handles via its
  real Shopify photo as ref image); real-talk/podcast-notes posts get the §0-H **human hero**.
  On §0-H posts the hero request is a **structured payload**, not "category plus a pointer to
  the router" (owner direction 2026-08-11, ticket #2748). It carries all six fields:
  - `headline`: the post's title, verbatim (the hero stages this question);
  - `thesis`: the post's thesis in one line;
  - `heroEmbedHandle`: the `blogProductEmbed.productHandle` the figure holds at co-primary
    scale (or the explicit no-product reason per §0-H, which media-manager must write into
    the keeper log);
  - `sceneBeat`: the one-sentence scene, built from the §0-H question-to-gesture table;
  - `readerEmotion`: the feeling the reader brings to the headline;
  - `castSlug`: the cast member by slug (`maya`, `sofia`, `jade`, `priya`, `marcus`, `diego`,
    or Emma), respecting the no-repeat-within-5 rule.
  Never a domestic metaphor object in either archetype.
  **A hero image is mandatory on every published post** (owner directive, 2026-07). If imagery
  genuinely cannot be produced, hold the post as a Sanity `status:'draft'` for the owner and say
  so in the retro; do not publish it heroless.

Content quality bar (all mandatory, from `.claude/agents/content-writer.md`):

- Structure by category (content-plan §8B / blog addendum): answer-shaped with question-form H2s
  for guides/comparisons/care/wellness-basics; essay-shaped (direct-answer capsule + scene-first
  + statement H2s allowed) for real-talk. Register: authority max, desire capped 7-8, zero
  hedging, humor licensed (never on clinical beats), rhythm rules per the blog addendum.
- **IP ratings are SAFETY claims, not feature copy — map them before drafting.** Never infer a
  water permission from a vendor adjective ("splashproof", "shower-ready"). Resolve the actual IP
  code first: IPX4 = splashes only, keep out of the shower and never submerge; IPX7 = submersion to
  1m/30min, so shower, bath, and rinse-clean are all fine. A wrong water instruction is a safety
  defect the accuracy gate will BLOCK on (run 148: an IPX4 wand written as shower-safe). IP-rating
  and other safety strings then fall under the frozen-safety-string rule in Step 5.3.
- A `## Frequently asked questions` section in every post.
- At least one honest `blogProductEmbed` where it genuinely helps (in-stock products only,
  verified first). CTAs from the charter whitelist.
- Ranked buying guides use category `guides` (guides posts get ItemList JSON-LD generated from
  their blogProductEmbed blocks automatically).
- Emma authorship in the first person ("I") or editorial "we", never third person about Emma:
  the copy never refers to her by name or narrates her as a character (no "Where does Emma add
  nuance?", "Emma's take"); name a section by its substance instead. AI-guide honesty (never
  "I tried/tested/own it"); no medical claims; no
  prices or discount claims in body text (MAP-safe, evergreen); internal links to relevant
  collections and `/products/{slug}` PDPs (the embedded `productHandle` also drives the inbound
  PDP/collection backlinks — verify it resolves 200 and is in stock; doctrine in
  `docs/store-team/internal-linking.md`); no em dashes; no countdowns or urgency.

**Keyword weaving (when the topic came from a brief):** the brief's `primaryKeyword` term shapes
the title/H1; its 3-5 `secondaryKeywords` land naturally in H2s and body copy (never stuffed);
every `questionKeywords` term becomes a question-form H2 or an FAQ entry; the brief's cluster's
rejected/flagged terms are the avoid list:

```groq
*[_type == "seoKeyword" && cluster._ref == $clusterId && (status == "rejected" || flagged == true)].term
```

Use `embedHints` only after verifying the handles are in stock; use `internalLinks` where natural.

**Fresh-language pre-check (mandatory, before Step 5):** `emma-empathy-reviewer` has no Sanity
access and cannot see cross-post reuse, so this check runs here, not at the gate. Run the
deterministic checker and drive it to exit 0 before submitting to the voice gate:

```bash
npx tsx scripts/check-fresh-language.ts --category <categoryId> --slug <slug> --draft <draft.json>
```

Like `check-hero-embed-match.ts`, and unlike the two prose checkers below, it reads Sanity live: it
GROQs the last 10 published posts in the same cluster (the query below) and reports any word-6-gram
the draft shares with them, weighting headings. Six words is the right grain for this corpus:
headings were the surface a tic hardened on ("Where does this need a caveat?" shipped verbatim across
two published podcast-notes posts), a whole-post similarity score misses that because the body prose
did not overlap, and the 6-gram threshold ignores the short structural headings ("Sources", "Real
talk") that repeat by format on purpose. Added after that pair of live posts (ticket #3009); the
manual diff it replaces had let the tic through. The limit is zero shared 6-grams; rewrite each
recycled phrase, do not loosen the check.

`--slug` is not optional (ticket #3650). The script takes the self-exclusion slug as a separate flag
and defaults it to the empty string, so without it the query's `slug.current != $slug` excludes
nothing, and any re-run after the Sanity doc exists reports the post colliding with ITSELF.
Reproduced in run 346: the documented slug-less command reported 66 shared 6-grams, every one the
post matching its own title and H2s, flagged high risk; the same command with `--slug <self-slug>`
returned 0 across the same 5 prior posts. This bites exactly on the re-run path, i.e. runs that
already took a gate REVISE, and a run that trusts a slug-less result is instructed to rewrite its
own title and every H2 to escape phantom collisions. Before rewriting anything, confirm each
reported collision is with a different post's slug.

```groq
*[_type == "blogPost" && category._ref == $categoryId && slug.current != $slug]
  | order(publishedAt desc)[0...10]{title, "slug": slug.current, body}
```

**Aphorism-as-closer pre-flight (mandatory, before Step 5):** run the merged deterministic checker on
the draft JSON and trim until it exits 0, before submitting to the voice gate:

```bash
npx tsx scripts/check-aphorism-closers.ts <draft.json>
```

The checker implements the charter's binding three-part test: a hit needs an **anaphoric demonstrative
subject** (`this` / `that`) AND a copula AND a defining clause that re-describes what the previous
sentence already delivered — all three. (The earlier wording here, "[demonstrative **or abstract noun
phrase**]", was the pre-#925 wide reading the charter has since narrowed to
anaphoric-demonstrative-subject only; the charter wins and the script follows the charter, so a plain
abstract-noun-plus-copula sentence stating an idea for the first time is never a hit.) The caps are
unchanged: 3 per post, 1 per section, never 2 in a paragraph. Trim by de-constructing the flagged
shape, not by swapping synonyms inside it.

**Unsourced-frequency pre-flight (mandatory, before Step 5):** run the deterministic checker on the
draft JSON and drive it to exit 0 before submitting to the voice gate:

```bash
npx tsx scripts/check-unsourced-frequency.ts <draft.json>
```

The checker flags a frequency or population quantifier (`usually`, `most`, `almost every`, `people
keep`, `tends to`) bound to a subject the writer has no data on: customers, readers, or other
publishers (`most people assume`, `almost every article`, `people keep buying`, `someone writes in`).
It is subject-aware by design, so it does NOT flag the same quantifier on a product category (`as a
category, small bullets run quietest`; `usually costs you the sensation`) or on an attributed research
finding (`sex educators describe`, `reviewers draw the distinction`), and it never flags second-person
address (`that fear will keep you buying`). The limit is zero: any candidate trips it. Resolve each by
sourcing the claim, attributing it, or removing it. Do NOT soften it with a hedge (`can`, `often`,
`it's easy to`): those are charter-banned in this register, so hedging trades a claim defect for a
voice defect. Like the aphorism checker, it flags candidates and leaves the final judgment to the voice
gate. Added after runs 196 and 269 each lost a gate cycle to this class with no mechanical guard in
place (suggestions #1674, #2618).

**Solidarity-voice pre-flight (mandatory, before Step 5):** count the first-person markers (`I` /
`we` / `our`) in the body. If the count is under about 4, or they are not distributed across the
opening, middle, and close, add solidarity seams **now**, not after a REVISE — missing solidarity voice
is a first-submit voice-gate failure the writer otherwise discovers only at the gate, spending the one
allowed rewrite cycle. Shape each seam with a concrete subject and avoid the "This is / That is
[defining clause]" shape, so a seam does not itself create an aphorism-as-closer.

**Hero pre-flight (mandatory, before Step 5):** the hero image and its alt are reviewed by no gate,
and two hero guardrails shipped wired to nothing until #2750. After the hero is attached (Step 4) and
`gen-notebook-art.ts` has written `imagePrompt`, run the slug-scoped checker and drive it to exit 0:

```bash
npx tsx scripts/check-hero-embed-match.ts --slug <slug>
```

Unlike the prose checkers above it reads Sanity live, because it needs the post's structured hero
fields and the live catalog. It flags three things: an empty `imagePrompt` (the composed prompt was
not captured on upload, so a bad hero can never be retro'd), a hero that names a catalog product the
post does not embed, and the inverse the older audit is blind to, a post that carries embeds while its
hero names no catalog product at all. Resolve each by regenerating or re-uploading the hero with an
explicit `--prompt` that depicts a product the article is actually about, not by loosening the check.

One `step` event (`phase:'draft'`) with title, slug, category, embed handles.

## Step 5: Dual gate (voice + accuracy; mandatory, no publish path without both)

**Gate-subagent liveness (mandatory, applies to every gate launch below, including the shared
rewrite's re-run).** A gate subagent that dies is a loud, ordinary failure. A gate that **stalls** is
worse: run 176 launched the voice gate's cycle-2 re-run at 17:17 UTC, its transcript went silent at
17:17:44, and at 19:29 (2h12m later) there was still no verdict: it had vanished from the running-
agent set with no error and no completion notification, while the accuracy gate reviewing
byte-identical text on the same run returned in 73 seconds. Silence is indistinguishable from a slow
review unless you check liveness directly; waiting on a notification hangs indefinitely. So: note the
wall-clock time you launch each gate (Task tool) and its most recent observed transcript activity,
and before treating silence as "still working," run

```bash
npx tsx scripts/check-gate-liveness.ts --launched-at "<launch-iso>" \
  --last-activity-at "<last-activity-iso>" --attempt <1|2>
```

- `{"status":"live"}`: keep waiting.
- `{"status":"stalled-relaunch"}`: no transcript activity for 10+ minutes on the first launch.
  Relaunch the SAME gate exactly once, on the **unchanged** draft: a stall is an infrastructure
  failure, not a content defect, so this is not the shared rewrite cycle. Post a `step` event
  `phase:'gate-stall'` naming which gate, elapsed time, and that it is infrastructure, not a verdict.
- `{"status":"stalled-exhausted"}`: the relaunch also stalled. **Never** record this as a REVISE or
  BLOCK: a gate that never rendered a judgment returned no judgment, and scoring silence as a verdict
  would wrongly cost the post a rewrite cycle for a defect nothing ever found. Instead: file the Step
  5 item 4 suggestion row with `category:'bug'` stating plainly that the gate infrastructure stalled
  twice (not a content finding), and post a `decision` event `phase:'gate-stall-exhausted'` so the run
  row and dashboard event feed show a run blocked on infrastructure rather than one that looks like it
  is still working.

Two reviewers, both binding, sequenced so a cheap voice failure never spends the accuracy pass:

1. **Voice gate first.** Run the full draft through `emma-empathy-reviewer` against the charter +
   blog addendum, **naming every section explicitly** so none is silently skipped: title, excerpt,
   body, **the Frequently-Asked-Questions block**, SEO fields, and embed CTA labels. The request
   must also **state the post's category and its charter-granted structural exemptions** so a
   cycle-2 reviewer instance cannot re-litigate what the charter already settles: essay-shaped
   real-talk and podcast-notes posts are allowed statement (non-question) H2s, with the
   question-shaped material concentrated in the FAQ (blog addendum + content-plan §8B, owner-codified
   2026-07-28). Restate in the request that a mandatory or charter-granted element is never a valid
   gate objection. Any rule the
   gate enforces per-post or per-section (the aphorism-as-closer cap is the live example) must be
   **counted across the whole document on this first pass** — the FAQ block included. Because the
   routine allows exactly one shared rewrite (item 3), a defect first discovered in cycle 2 is
   unfixable by construction and converts straight to a BLOCK; a section that was never audited in
   cycle 1 is that trap. A voice **BLOCK** on sight → the post stays `status:'draft'`, file the
   suggestion row, skip the accuracy gate entirely, and go to Step 7.
2. **Accuracy gate.** Otherwise run the same draft through `sex-wellness-reviewer` (it
   web-verifies external claims: anatomy/physiology, "research shows" statistics, materials and
   safety, realistic expectations, terminology). Only a voice **BLOCK** short-circuits this gate;
   a voice **REVISE** still runs here, on the unmodified v1 draft, BEFORE any rewriting begins, so
   the single shared rewrite in item 3 carries both gates' feedback together.
3. **One shared rewrite cycle.** Merge BOTH gates' REVISE feedback into exactly one rewrite,
   then re-run both gates once, unless the selective re-run carve-out below applies. A second
   non-PASS from either is treated as BLOCK. **Change only the strings a gate actually flagged**
   — no cosmetic edits ride along, except the minimum surrounding sentences needed to satisfy a
   paragraph-scoped, section-scoped, **or post-scoped** cap (the aphorism-as-closer cap is the live
   example); a qualifying rewrite must de-construct the banned pattern rather than swap words inside
   it. A post-scoped (whole-document) cap is the case a cap can otherwise be unfixable in one cycle:
   when the count exceeds the cap but the offending sentences sit in sections the gate PASSed and
   never flagged, this carve-out permits the minimum edits **anywhere in the document** needed to
   bring the whole-document count under its cap, provided each such edit is **listed explicitly for
   the re-gate** and de-constructs the banned pattern rather than swapping words inside it. Any
   string carrying a safety enumeration ("no motor, battery, or electronics inside"), a material
   limit, or a never/only instruction is **frozen exactly as today** unless the ACCURACY gate asked
   for that exact change: a battery-plus-switch DC-motor toy is arguably not "electronic", so a
   purely cosmetic reword can flip an accuracy PASS to BLOCK and cost the whole post (run 92). The
   fresh-language rule (content-plan §7) does **not** apply to safety enumerations — an exact
   repeated safety phrase across posts is correct and preferable to a fresh but looser paraphrase.
   - **Gate precedence when the two gates' feedback conflicts:** on a factual or safety claim the
     accuracy gate wins; on register and phrasing the voice gate wins; a mandatory charter element
     (for example the clinician hand-off line content-plan §8B requires on health-adjacent Real
     Talk topics) is never a valid gate objection from either gate.
   - **Cross-gate self-check before resubmitting:** for every REWRITTEN string, check it against
     the OTHER gate's criteria too. Does this new sentence assert a spec, a comparative, a
     frequency, or an outcome that was not there before? This catches a voice fix that introduces
     an accuracy defect, and an accuracy fix that introduces a voice defect.
   - **Contradiction and scope-widening scan (part of the same pre-resubmit self-check, ticket
     #3400):** for every rewritten string, scan the rest of the document for a claim it now
     contradicts, especially strings a gate PASSed in an earlier cycle. A rewrite that widens the
     scope of a claim is the high-risk shape: check whether the wider claim is still true of every
     material, product, or case the post discusses elsewhere. Run 327 lost its publish to this class
     twice in one post (the accuracy gate's own cycle-1 rewrite contradicted a silicone-lube claim
     two sections earlier, then the cycle-2 rewrite widened a storage claim into contradiction with
     the already-PASSed glass line), and run 329 fixed it in one sentence, so the defect is cheap to
     fix and expensive to detect late. Cheap mechanical hint: a scope-widening rewrite almost always
     introduces a universal quantifier (whatever, anything, everything, always, never), so treat any
     of those words appearing in a rewrite as a prompt to re-read the rest of the post.
   - **Whole-document aphorism recount:** before resubmitting, re-run your own whole-document
     aphorism-as-closer count on the REWRITTEN draft (not just the changed strings), and separately
     count any newly added first-person sentences.
   - First-person solidarity-voice seams must use a concrete subject ("I start everyone from...",
     "I would rather you owned...") and must avoid the "This is / That is [defining clause]"
     shape, which itself creates an aphorism-as-closer.
   - **De-construct the pattern — standing rule for every flagged string, not only the post-scoped
     cap.** When a gate flags a string for its SHAPE (an aphorism-as-closer, a fabricated-anecdote
     opener, a recap-tag), resolving the flag means changing the shape, not swapping words inside it —
     for *every* flag, not just the whole-document-cap carve-out. Pre-resubmit self-check: for each
     rewritten string, state which shape the gate objected to and how the replacement differs
     **structurally**, not just lexically. (Run 225 bounced because a fabricated-anecdote opener was
     reworded into a first-person-endorsement opener of the same class the same rewrite had just
     stripped elsewhere; the shape survived the synonyms.)
   - **Checker-passed sections are settled.** A section the merged aphorism checker
     (`scripts/check-aphorism-closers.ts`) passes is settled for the aphorism-as-closer **count** for
     the remainder of the post lifecycle and is not re-litigated in later cycles. The checker is the
     single source of truth for the count; this is what makes the rewrite cycles converge instead of
     the reviewer recounting by judgement and self-contradicting across passes.
   - **Neither gate supplies replacement wording for a claim-carrying string.** For any string
     carrying a factual, comparative, frequency, or causal claim, a reviewer names the defect
     and the constraints but does **not** hand over literal replacement prose. The voice gate,
     because it does not web-verify and cannot judge claim strength, so gate-supplied wording can
     inject an overclaim that carries a gate verdict's authority (twice in one day, runs 201/204: a
     supply-side claim drifted to a population claim, and a thesis drifted to majority causation).
     The ACCURACY gate too (extended after run 311, ticket #3182): its cycle-1 suggested rewrite
     authored a comparative clause that the same reviewer could not verify on cycle 2 after eight
     searches, and the post BLOCKed on the gate's own sentence. Accuracy-gate wording is arguably the
     more dangerous source because it arrives carrying verified authority, so a writer has every
     reason to adopt it verbatim. The accuracy gate may state which facts it HAS verified; it still
     does not hand over literal replacement prose for a claim-carrying string. Where either gate
     offers wording anyway, the writer treats every comparative, superlative, quantifier, and named
     variable in that wording as unverified: trace each independently or drop it before resubmitting.
     This guard sits upstream, at the point the suggestion is written, because run 311 proved the
     downstream re-check alone is not enough, and one shared rewrite cycle means a gate-authored
     claim that fails re-verification costs the whole post. The writer drafts the replacement
     and the accuracy gate rules on it. Any claim-carrying string rewritten for a **style** reason
     **always** re-runs the accuracy gate, regardless of the selective re-run carve-out below.
   - **Selective re-run carve-out:** if one gate PASSed clean and the shared rewrite provably
     touches no string that gate verified, re-run only the gate that returned REVISE and carry the
     clean gate's verdict and citations forward unchanged. The mandatory dual re-run above still
     applies whenever the rewrite touches any accuracy-verified or frozen safety string.
4. **BLOCK** (from either gate, either cycle) → the post stays `status:'draft'`, and you file a
   suggestion row (`team:'content'`, kind `process`) with the reviewer's reasons. The blocked draft
   still occupies its slug: **leave its `seoContentBrief` status at `'drafted'` (do not re-queue it to
   `'queued'`, see Step 6)**, so the next run that picks this brief resumes that draft via the Step 3
   slug pre-check's `resume-draft` branch, instead of treating the slug as taken and skipping to
   another topic, or the finished work is silently orphaned.
5. **Sources insertion (mechanical, after the final PASS).** The accuracy gate returns 0-2
   citations it actually resolved. **Verify every returned URL through `/api/team/url-liveness`
   before appending it** — the endpoint enforces a fixed host allowlist (`CITATION_HOST_ALLOWLIST`
   in `app/lib/citation-liveness.server.ts`: `medicalnewstoday.com`, `plannedparenthood.org`,
   `clevelandclinic.org`, `who.int`, `ncbi.nlm.nih.gov`, `nih.gov`, `cdc.gov`, `mayoclinic.org`,
   `healthline.com`, `medlineplus.gov`, `kinseyinstitute.org`, `ashasexualhealth.org`, `issm.info`,
   `nhs.uk`), so a URL on any other host, or a legacy domain (e.g. `kinsey.indiana.edu` instead of
   the canonical `kinseyinstitute.org`), fails the check. `sex-wellness-reviewer` is told this
   allowlist up front and prefers an allowlisted, canonical host when one carries the same source;
   drop any returned URL that still does not pass liveness rather than shipping it. Append the
   verified ones as a `## Sources` section (source name + link, no new prose claims). This insertion
   is exempt from re-gating. If the gate reported `[web: degraded]`, follow its strip/soften
   instructions and ship without a Sources section; zero citations is a valid outcome, never padded.

   **`live:false` is not always "drop it" — read the `reason`.** The endpoint distinguishes a host
   that *refused* us from a page that is *gone* (ticket #3196). `reason:'blocked'` means an
   allowlisted host returned 401/403/429, i.e. bot/WAF protection rejecting the checker's fixed
   user-agent, not a bad path — `mayoclinic.org` does this even at its bare origin. In that case the
   page is very likely live; **keep the citation only when `sex-wellness-reviewer` has independently
   confirmed that page's content supports the claim**, and drop it otherwise.

   `reason:'challenge'` is the silent cousin of `blocked` and is treated identically (ticket #3946).
   Some bot-protection services do not refuse with a 403 at all — they answer **200 with the
   challenge page as the whole document** (Cloudflare "Just a moment", reCAPTCHA/hCaptcha gates,
   Incapsula, PerimeterX), so the endpoint used to report `live:true` and an unread challenge page
   could ship as a citation. Run 362 hit exactly this: a PMC article came back `live:true status:200`
   but the title was `Checking your browser - reCAPTCHA`. The checker now inspects the 2xx body and
   returns `live:false reason:'challenge'` (with the resolved page title surfaced) for these. Handle
   it the same as `blocked`: the page is very likely live, but we never saw its content, so keep the
   citation **only** when `sex-wellness-reviewer` has independently confirmed the source supports the
   claim, and drop it otherwise. Any other `live:false`
   (`reason:'dead'` for a genuine 404/410, `host-not-allowlisted`, `redirect-off-allowlist`,
   `too-many-redirects`, `timeout`, `fetch-failed`) is a real miss: drop the URL, never ship it. Do
   not blanket-keep a `blocked` URL — a dead or paywalled page shipping as a citation is worse than
   losing one. Same-host canonicalizing redirects (e.g. `https://www.cdc.gov/`) are now followed
   automatically and come back `live:true`, so they no longer need a hand-picked canonical URL.

Two `step` events: `phase:'voice-gate'` and `phase:'accuracy-gate'`, each with the verdict and
cycle count (the accuracy event also records citation count, `web: ok|degraded`, and, for every
candidate Sources URL, its `/api/team/url-liveness` result (`live:true/false`, `reason` when false),
so each shipped citation is provably resolved directly from the run's event feed, not just asserted;
ticket #2456's DONE WHEN).

## Step 6: Publish (only if both gates PASS, a hero is attached, and the valve is open)

Only when Step 5 ended in PASS from BOTH gates, a `heroImage` is attached (Step 4; mandatory on
every published post), **and** Step 1's `valves.autopublish` is `true`:

1. Patch the doc: `status` → `'published'` (keep `publishedAt` as set in Step 4), **then
   `publish_documents` on the blogPost id** — the patch alone leaves the post in `drafts.<id>` and it
   never goes live.
2. Flush the blog caches:

```bash
curl -s -X POST "$BASE_URL/api/revalidate/blog" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"slug":"<slug>"}'
```

3. If the topic came from a brief: patch the brief `status` → `'published'` and set
   `publishedPost` to a reference to the blogPost doc. A `podcastReviewBrief` gets
   `status` → `'published'` and `blogPostRef` set to the post's slug. **Then `publish_documents` on
   the brief id**, and immediately verify with a published-perspective read
   (`*[_id == "<briefId>"][0].status` must return `"published"`). A brief patched-but-not-published
   stays queued and will be re-picked every day until someone notices — this is exactly what
   stranded two briefs whose posts had been live since 07-25 and 07-29.

4. **Hand the live post to social (mandatory, owner direction 2026-08-15 and again 2026-08-16).**
   Verbatim: *"When we write posts, I want to have them sent to the social media agents on the
   /all-hands team to create a post to promote it through our instagram account"* and *"I want to
   add new posts when we write articles in the blog too."* File one row, and only after
   `publish_documents` has actually put the post live, so social never promotes something no reader
   can open:

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"create","team":"content","targetTeam":"social","kind":"campaign","priority":2,
       "dedupeKey":"notebook-promo:<slug>",
       "suggestion":"NOTEBOOK POST LIVE, ready for an Instagram draft. TITLE / URL / CATEGORY / the two or three teachable claims that cleared the accuracy gate / embedded product handles with their verified stock state / IG-ELIGIBILITY: <eligible | generic-angle: the transferable topic that can be named | route-to-X>"}'
```

   The claims are the point. The social drafter cannot re-verify anything and must not invent
   substance, and a post that already cleared both gates is the cheapest citable teaching material
   the store produces. One post per run, so this adds at most one row a day and cannot flood the
   social queue.

   **Check Instagram eligibility before filing, not after.** `instagram-campaigns.md` §2 is
   categorical: never dildos and never anatomically realistic products. A Notebook post whose
   *subject* is one of those cannot be promoted on Instagram even as pure education, because the
   subject cannot be named: run 331 drafted a genuinely compliant product-free materials carousel
   for `/notebook/which-dildo-material-is-best` and the voice gate correctly BLOCKed it on one
   factual, non-sexual use of the word. Machine moderation reads words, not intent. So state the
   verdict in the row itself:

   - **eligible**: the subject can be named on Instagram. Normal handoff.
   - **generic-angle**: name the transferable topic that *can* be said (here: body-safe materials
     literacy) and say explicitly that the source article's product category may not appear in the
     caption, on-slide text, alt text, or hashtags.
   - **route-to-X**: the substance only works where the category can be named. X's organic
     adult-content policy is genuinely more permissive at register 6-7.

   Filing the row is your whole job here. You never decide the post is not worth promoting: you have
   no visibility into this week's pillar rotation or quota, and social's own queue-hygiene pass
   expires an unused row. **Do not file when the post stayed a draft.**

**Valve off, or no hero image could be produced, with both gates PASS** → leave the post as a Sanity
draft, post an event saying exactly that, re-queue the brief if one was claimed
(`seoContentBrief` → `'queued'`, `podcastReviewBrief` → `'pending'`), and finish the run as
succeeded. Draft-only is a valid, honest outcome, not a failure; publishing a post with no hero
image is not. This post is finished work waiting on an administrative gate, not a content defect, so
`'queued'` correctly tells tomorrow's run "pick this back up" (Step 3's `resume-draft` branch will
find and resume it either way, since it is still an unpublished draft at that slug).

**A gate BLOCK is different: do not re-queue it to `'queued'` (ticket #94).** A drafted post already
exists in Sanity for this brief. Re-queuing to `'queued'` puts it back in the Step 3 primary
brief-queue GROQ (`status == "queued"`) looking indistinguishable from a topic that was never
started, and the topic can cycle: pick it up, hit the slug pre-check, and either skip past your own
unfinished work (pre-#3401 fix) or silently resume-and-retry it with no visibility beyond the one
suggestion row filed at BLOCK time (Step 5 item 4). **Leave the brief's status at `'drafted'`**
(already set by the Step 3 claim, do not touch it) so the Step 3 `resume-draft` branch finds and
resumes it explicitly next time, and post a `step` event `phase:'gate-block-held'` naming the brief,
its slug, and the BLOCK reason. If the SAME brief BLOCKs a second time, escalate: file (or bump the
priority of) a `priority:2` suggestion row asking the owner to review the brief by hand: two
independent drafts failing the same gate on the same topic is a signal the topic needs a human
decision, not a third automated attempt. (A first-class `blocked`/`needs-owner` terminal status on
the `seoContentBrief` schema would make this visible on the dashboard without depending on the
suggestion feed, but adding it means extending the status enum in
`studio/schemas/seo/seoContentBrief.js`, which the Sanity additive-only schema rule reserves for an
owner-authored schema decision, not a routine edit; the enum extension half of #94 stays open for
that.)

## Step 6b: Inbound suggestions (read your own mail)

Other agents file findings *at* this team, and before 2026-07-29 no routine read them: the playbooks
only ever wrote suggestions, so routed findings aged in `approved` forever.

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"list","targetTeam":"content","status":"approved","orderBy":"age"}'
```

Act on up to **3 per run**, oldest first, and only what this run can actually execute within the
gates it already obeys. Close each one you did execute so tomorrow's run does not re-read it:

```bash
-d '{"op":"transition","id":<id>,"to":"applied","actor":"agent:content-writer","note":"<what changed>"}'
```
Only `process` and `strategy` rows can be closed this way (`RUN_CLOSE_KINDS`). A `campaign`,
`promo`, `instructions`, or `code` row returns 409 — those have their own executor, or the owner's,
and are not yours to end. Note them instead.


Looked but deliberately did not act (out of scope, no longer true, needs code)? Post a note with
which and why, and leave the status alone:

```bash
-d '{"op":"note","id":<id>,"ref":"<which row, and why this run did not act>"}'
```

The `note` op carries its text in **`ref`**, not `note`. The `transition` example above uses `note`
for its text, so reusing that key here is the natural guess and it returns
`400 Bad Request: ref required`.

Never close a row you did not execute: a false `applied` looks handled and is worse than an aging
row.

## Step 6c: Post-publish embed-stock sweep (mandatory, every run)

Step 4 stock-verifies an embed exactly once, before it is embedded. Nothing revisits it after
publish, so a post sits live pointing readers at whatever the product later became: out of stock,
de-listed, or 404'd. inventory-sentinel watches hero/rail/featured slots and never looks at blog
embeds. This is that missing re-check, and it runs here so it cannot rot (ticket #2753).

Run the deterministic sweep over every published post's embeds:

```bash
npx tsx scripts/audit-blog-embed-stock.ts --json
```

It resolves each distinct embed handle's buyability from Shopify Admin (`status`, `totalInventory`)
and a storefront PDP probe, then prints the posts whose embeds are dead, worst first. Use the real
signals it uses and never Admin `publishedAt` — on this headless catalog `publishedAt` is null for
essentially the whole catalog and would flag every handle. A handle is dead when it is `gone` (no
Admin product, status `ARCHIVED`, or PDP 404), `inactive` (Admin status set and not `ACTIVE`), or
`out-of-stock` (`totalInventory <= 0`).

The JSON output also includes `groupedByHandle`: the same dead embeds grouped by product handle
instead of by post, sorted by how many posts each handle breaks (`app/lib/blog-embed-stock-audit.ts`,
`groupByDeadHandle`). Read this before filing suggestions or remediating. Tickets #2828 and #2832
(2026-08-15) turned out to be the same root cause: `magic-wand-mini-hv-135-rechargeable-massager`
went out of stock and broke two unrelated posts at once, and nothing before this surfaced that
connection, so it read as two separate investigations instead of one swap applied twice. When a
group's `slugs` has more than one entry, treat it as one fix, not N.

For each post the sweep reports, file **one deduped suggestion** at the content team so the
remediation is tracked and the row refreshes every run instead of aging:

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"create","team":"content","targetTeam":"content","category":"bug","kind":"process",
       "priority":<2 if hasNoBuyablePath else 3>,"dedupeKey":"dead-embed:<slug>",
       "suggestion":"Published post /notebook/<slug> has dead embeds: <handle> (<reason>) ... Swap each for an in-stock, buyable product (charter-voice pairing copy) or remove it. <slug> has NO buyable path and is remediated first.","cxRisk":"low"}'
```

Then remediate through Step 6b's execute-what-you-can rule (up to 3 rows per run). Order the
work from `groupedByHandle`, worst impact first: posts with no buyable path come first, then the
highest-impact shared handle (`slugs.length > 1`), then everything else. When a dead handle breaks
more than one post, remediate all of them in the same run with the same replacement product,
instead of picking off one post per day and leaving its siblings to rot on the same root cause
(exactly the shape of #2828 and #2832: one handle, `magic-wand-mini-hv-135-rechargeable-massager`,
broke both posts at once, and the per-post view gave no signal that fixing one also cleared the
other). A `kind:process` row is closeable by this routine, so swap the dead embed for an in-stock
product with fresh charter-voice pairing copy (or remove the embed when no honest substitute fits),
re-run the Step 6c sweep on every post touched to confirm it is clean, and close each remediated row
`applied`. Do not close a row you did not actually remediate.

## Step 7: Retro + finish

Compare against the plan and last run's post (published? still draft? which gate verdict?). One
`decision` event (`phase:'retro'`) always. A lesson becomes a suggestion row only when the **same**
failure has now happened twice and you can name both runs, and at most 2 rows per run: see the
intake doctrine in `improvement-loop.md`. Zero rows is the expected outcome of a clean run.

Note the `kind` below. This example said `process` until 2026-08-02 and was copy-pasted straight
into the queue with no executor eleven times in two weeks. A playbook or agent-definition edit is
`instructions`; something needing engineering is `code`; `process` is only for a decision that
genuinely nobody but the owner can make.

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"create","team":"content","targetTeam":"<team-or-omit>","category":"other","kind":"instructions","priority":3,"dedupeKey":"<stable-slug>","suggestion":"<lesson, naming both runs>","cxRisk":"low"}'
```

Blog-surface component/layout ideas → suggestion with `targetTeam:'homepage'` (code is always a
reviewed PR, never this routine's). Log spend
(`POST /api/homepage-team/spend {"kind":"tokens","source":"agent-sdk","feature":"content-blog",...}`),
then finish:

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"update","id":'$RUN_ID',"update":{"finished":true,"status":"succeeded","summary":"<slug + gate verdict + published|draft + retro note>"}}'
```

## Appendix: Enablement runbook

The routine ships inert. To turn it on, in order:

1. **Apply migration 054 in prod:** `npx tsx scripts/apply-migrations.ts --from 054` (seeds the
   `content_team_*` keys in `pipeline_settings`).
2. **Flip the kill switch:** `content_team_enabled` → on, in the Content tab of
   `/admin/homepage-team`.
3. **Open the autopublish valve:** `content_team_autopublish` → on (owner approved day-one
   auto-publish for this team; leave off if you want a draft-review period instead).
4. **One supervised manual run:** fire the routine by hand, watch the run row and events on
   `/admin/homepage-team?team=content`, verify the post lands in Sanity (and live, if the valve is
   on) and the revalidate call returned ok.
5. **Confirm the schedule** (routine #9 in `docs/store-team/routine-schedule.md`): the desktop
   scheduled task `xdipx-daily-content-writer` already exists on the owner's machine and fires
   daily at 8am local Pacific (approx 15:00 UTC) from the `~/Claude/xdipx-deploy` checkout. It
   runs only while the Claude app is open, unlike the cloud triggers for routines 1-8, and until
   steps 1-2 are done every fire no-ops honestly at the gate.

**Kill-switch drill:** flipping `content_team_enabled` off stops runs at the gate (Step 1 skips
honestly). Flipping `content_team_autopublish` off degrades to draft-only without stopping the
routine: posts keep landing in Sanity as drafts for the owner to publish.

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

**Stale-claim reclaim (before selecting a fresh brief).** A crashed run leaves its brief in
`drafted` with no published post, and the weekly curator sweep can hold that topic hostage for days.
Do not wait for the sweep: if the top brief in the queue is already `status:'drafted'` but has no
corresponding published `blogPost` (`*[_type == "blogPost" && slug.current == $slug && status == "published"][0]`
returns nothing) and no run is currently in flight for it, treat it as **reclaimable** and pick it
up as today's topic, recording a `step` event that says you reclaimed a stale drafted brief and
which run stranded it. A brief that is `drafted` **and** already has a published post is genuinely
done; leave it.

When a brief is chosen: patch it `status:'drafted'` immediately **and `publish_documents` on it**
(idempotent claim; a crashed run leaves it drafted, and the curator re-queues stale drafted briefs
weekly), and carry its `targetQuery`, keyword refs, `embedHints`, and `internalLinks` into Step 4.

> **Every Sanity write is `patch` THEN `publish_documents`.** A Sanity MCP `patch` writes to
> `drafts.<id>` only; the change is invisible to the live site and to any published-perspective GROQ
> read until `publish_documents` is called on that id. A claim, a status flip, or a closeout that was
> patched but never published is a no-op that will keep resurfacing. This applies to every Sanity
> write in Steps 3, 4, and 6.

Before drafting anything, GROQ-check the slug:

```groq
*[_type == "blogPost" && slug.current == "<slug>"][0]._id
```

If it exists, take the next queued topic and re-check. One `step` event with the chosen topic,
slug, and source (brief / plan / strategy-brief fallback).

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
  real Shopify photo as ref image); real-talk/podcast-notes posts get the §0-H **human hero**
  (expressive adult figure — Emma or a fictional friend — reflecting how the reader might feel at
  the headline; faces visible; warm light; adults-only hard rules). Pass the headline and its
  feeling with the request on §0-H posts. Never a domestic metaphor object in either archetype.
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
access and cannot see cross-post reuse, so this check runs here, not at the gate.

1. GROQ prior posts in the same topic cluster (same `category`, or the brief's keyword cluster
   when the topic came from a brief):

```groq
*[_type == "blogPost" && category._ref == $categoryId && slug.current != $slug]
  | order(publishedAt desc)[0...10]{title, "slug": slug.current, body}
```

2. Diff the draft sentence-level against those posts' `body` text.
3. Rewrite any recycled sentence or phrase BEFORE submitting the draft to the voice gate in Step 5.

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
   - **The voice gate never supplies replacement wording for a claim-carrying string.** For any string
     carrying a factual, comparative, frequency, or causal claim, the voice reviewer names the defect
     and the constraints but does **not** hand over literal replacement prose: it does not web-verify
     and cannot judge claim strength, so gate-supplied wording can inject an overclaim that carries a
     gate verdict's authority (twice in one day, runs 201/204 — a supply-side claim drifted to a
     population claim, and a thesis drifted to majority causation). The writer drafts the replacement
     and the accuracy gate rules on it. Any claim-carrying string rewritten for a **style** reason
     **always** re-runs the accuracy gate, regardless of the selective re-run carve-out below.
   - **Selective re-run carve-out:** if one gate PASSed clean and the shared rewrite provably
     touches no string that gate verified, re-run only the gate that returned REVISE and carry the
     clean gate's verdict and citations forward unchanged. The mandatory dual re-run above still
     applies whenever the rewrite touches any accuracy-verified or frozen safety string.
4. **BLOCK** (from either gate, either cycle) → the post stays `status:'draft'`, and you file a
   suggestion row (`team:'content'`, kind `process`) with the reviewer's reasons. The blocked draft
   still occupies its slug: the next run that picks this brief must **resume that draft**, not treat
   the slug as taken and skip to another topic, or the finished work is silently orphaned. (The Step 3
   slug pre-check currently matches the draft under the raw perspective; teaching it to read the
   published perspective is a separate code fix.)
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

Two `step` events: `phase:'voice-gate'` and `phase:'accuracy-gate'`, each with the verdict and
cycle count (the accuracy event also records citation count and `web: ok|degraded`).

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

Valve off, either verdict not PASS, or no hero image could be produced → leave the post as a Sanity
draft, post an event saying exactly that, re-queue the brief if one was claimed
(`seoContentBrief` → `'queued'`, `podcastReviewBrief` → `'pending'`), and finish the run as
succeeded. Draft-only is a valid, honest outcome, not a failure; publishing a post with no hero
image is not.

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

For each post the sweep reports, file **one deduped suggestion** at the content team so the
remediation is tracked and the row refreshes every run instead of aging:

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"create","team":"content","targetTeam":"content","category":"bug","kind":"process",
       "priority":<2 if hasNoBuyablePath else 3>,"dedupeKey":"dead-embed:<slug>",
       "suggestion":"Published post /notebook/<slug> has dead embeds: <handle> (<reason>) ... Swap each for an in-stock, buyable product (charter-voice pairing copy) or remove it. <slug> has NO buyable path and is remediated first.","cxRisk":"low"}'
```

Then remediate the highest-priority post this run can reach through Step 6b's execute-what-you-can
rule: a `kind:process` row is closeable by this routine, so swap the dead embed for an in-stock
product with fresh charter-voice pairing copy (or remove the embed when no honest substitute fits),
re-run the Step 6c sweep on that post to confirm it is clean, and close the row `applied`. Posts with
no buyable path come first. Do not close a row you did not actually remediate.

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

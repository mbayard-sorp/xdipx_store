# Social Studio v2: /admin/socials as a full social management system

Owner direction, 2026-08-22, all-hands. Status: PLAN, approved for ticketing. Tracker:
`docs/store-team/trackers/social-studio-v2.md`. Architecture decision:
`docs/adr/ADR-013-social-studio-v2.md`.

## 0. What the owner said

> "I need /admin/socials to be a fully functional social media management system." Nineteen
> numbered asks, summarised: see every generated image per post (the AI does not always pick the
> best one), upload my own image, create a post from scratch, see the prompt behind an image, edit
> it and regenerate the image or the set, multi-slide posts, delete a post, a link to the live
> post, pull an approved post back to edit, product search while building a post, pick cast
> members, every generated image in Sanity and browsable in the interface with product tags,
> search by tag, add tags, select images into a draft, schedule by date and time in PDT, and
> likes, comments and views per post. "A full featured SPA for managing social media for all
> channels." Design pass with `taste-skill` and `ui-ux-pro-max`.

## 1. Where it stands today (verified 2026-08-22)

`app/routes/admin.socials.tsx` is one 960-line route with five client-side tabs over the last 100
`social_posts` rows. What exists, what is missing, per ask:

| # | Ask | Today |
|---|---|---|
| 1 | All generated images per post | `cast` op generates 2 candidates (`app/lib/social-media.server.ts:433`); the agent discards the loser; only the pick lands in `media_urls`. `PostPreviewCard.tsx:52` renders `mediaUrls[0]` only. |
| 2 | Upload own image | No upload path. Worse: `isGeneratedSocialAsset` (`social-media.server.ts:216`) accepts only `social-`/`ig-` filename prefixes, so an owner upload is BLOCKED by the `image-provenance` gate check (`social-publish-gate.server.ts:355-364`). |
| 3 | Create from scratch | Compose tab is X-only, needs a live `deal_history` row, posts immediately, never creates a reviewable draft. |
| 4, 5 | See and edit the prompt, regenerate | Prompt is never persisted anywhere. Regeneration exists only as a team-token CLI path. |
| 6 | Multi-slide | Backend done: IG publisher takes 2-10 slides (`instagram.server.ts:266-301`), X takes 4, carousel inferred from `media_urls.length > 1`. No UI can view, add, remove or reorder slides. |
| 7 | Delete | `delete-tweet` works only on posted X rows. No way to delete a draft, and no IG delete. |
| 8 | Link to live post | X link hardcoded to `x.com/xdipx/...` (`admin.socials.tsx:873`; account is `@hello_xdipx`, works only via redirect). Instagram stores a media id and no permalink. |
| 9 | Approved back to edit | `reviewSocialPost` refuses `pending_review`. `reworkSocialPost` only accepts `needs_changes` rows. |
| 10 | Product search | `/api/product-search` + `ProductPicker.tsx` exist; not wired. `shopify_product_id` is write-only from the team API. |
| 11 | Cast picker | `getApprovedCastMembers()` exists (7 approved). No UI, and no column records which cast is in a post. |
| 12-15 | Image library in Sanity, tags, search, select into draft | Images go to Shopify Files, not Sanity. No library, no index, no tags, no listing API. |
| 16 | Schedule by PDT time | `scheduled_for` is a bare `date`. Time of day is whichever hourly tick (`MAX_PER_TICK=2`) picks the row up. No timezone code in the social path. |
| 18 | Likes, comments, views | `social-engagement.server.ts` fetches IG insights and X `public_metrics` into `metrics_json`, but only when an agent calls `op:'engagement'`. No cron, no UI reads it. |

Two defects found on the way, folded into Phase 1: `retryFailedPost` reposts `tweet_text` and drops
`edited_text` and all media (`twitter.server.ts:494`), so a retry publishes content nobody
reviewed; and `feedback` is a four-way overloaded column (owner note, gate PASS stamp, live
verdict, stock-guard note), so any new writer risks clobbering the stamp both publish paths require.

## 2. What a social management platform is (research, 2026-08-22)

Buffer, Hootsuite, Later, Sprout, Planoly, Metricool, Publer and SocialBee converge on the same
table stakes for a single-brand operator: per-platform caption variants with counters; a carousel
builder with reorder and per-slide alt text; first comment on Instagram; a media library with
tags, search, per-platform crop presets and "used in N posts"; a drag-and-drop calendar in an
explicit timezone with a slot queue; a seven-state workflow (draft, pending, approved, scheduled,
publishing, published, failed, plus rejected) where editing an approved post resets approval and
an unapproved post past its slot expires rather than ships; direct publish with retry, a surfaced
failure reason and permalink capture; post-level likes, comments, saves, reach, views, a
best-performing view and CSV export.

Deliberately out of scope for xdipx: engagement inbox and DMs (needs `instagram_manage_messages`
app review), listening (social-trend-scout covers it), evergreen recycling (the charter forbids
repeating tics), bulk CSV (agents write straight to the DB), and AI caption assist (Emma is the AI).

Platform facts that shape the build: Instagram carousels are child containers with
`is_carousel_item=true` under a `CAROUSEL` parent (2-10, JPEG only, `alt_text` per image);
`media_publish` returns only an id, the permalink is a second `GET /{id}?fields=permalink`;
insights need a Business or Creator account with `instagram_manage_insights` and expose
`comments, likes, reach, saved, shares, total_interactions, views`. X exposes `public_metrics`
(likes, replies, reposts, quotes, impressions, bookmarks) via `GET /2/tweets?ids=` at roughly
$0.005 per read on pay-per-use, about $4.50 a month for a daily sweep of 30 posts.

## 3. Decisions (ADR-013)

1. **Sanity is the binary store; Neon is the index.** Every generated candidate and every owner
   upload goes through `uploadBufferToSanity` (`app/lib/sanity.server.ts:564`) and gets a row in a
   new `social_media_assets` table carrying prompt, negative prompt, provider, model, archetype,
   aspect, product handle and Shopify id, cast slugs, tags, `generation_batch_id`, source
   (`generated | upload | video_poster`), `is_picked`, and usage. No new Sanity doc type in v1:
   search, tags and usage need joins against `social_posts`, and this keeps the Sanity schema
   seam untouched. Media-manager argued for a `socialAsset` doc type as the primary; that is
   recorded as the alternative and can be added later as a mirror if Studio browsing is wanted.
2. **Slides are rows.** `social_post_slides (post_id, position, asset_id, alt_text)`. `media_urls`
   stays as the publish-time snapshot derived from ordered slides, so the publish job and both
   publishers change nothing.
3. **Gate state leaves `feedback`.** New `gate_status`, `gate_checked_at`, `gate_findings` columns.
   Eligibility switches from string-matching `feedback` to `gate_status = 'pass'`.
4. **Approved to draft always burns the stamp.** Extend `reworkSocialPost` to accept `approved` as
   a source status, unconditionally resetting `review_status`, `gate_status`, `gate_findings`,
   `reviewed_by`, `reviewed_at`. Non-edit cannot be proven, so the stamp is always cleared (gate
   read: this is incident #3640 / post #49 through a different door if skipped).
5. **Provenance becomes library membership, not a filename prefix.** A media URL passes
   `image-provenance` if it has a `social_media_assets` row (generated or upload). Strictly
   stronger than today: a pasted external URL that happens to match `social-` cannot pass. Ships
   with a dual-check burn-in (old prefix OR new membership) for one cycle before the prefix check
   is removed. Passing provenance is not passing review; an owner upload still owes the full
   imagery judgment, the packshot rule and the §3.7 cast mandate.
6. **Owner-composed posts get a real gate run, never a self-stamp.** A `requireAdmin` route
   (`api.admin.social-gate`) calls `applyPublishGateVerdict` in-process. This also closes bus row
   #4902 (Post-now cannot obtain a PASS stamp from the Studio).
7. **Owner-initiated generation spends against the social budget.** New `api.admin.social-image`
   route, calling `generateAndUploadSocialImage` / `generateCastComposite` with `logCost:true`
   behind `gate('social')`, not the product-image `api.admin.imagen.*` path which bills
   `admin-images`. Cost today: ~$0.036 per single image, ~$0.07 per 2-candidate cast composite on
   Atlas.
8. **Crops are transforms, not regenerations.** Per-platform 4:5 / 16:9 / 9:16 / 1:1 via Sanity
   image URL parameters on one master; regenerate only when a crop would clip product or cast.
9. **Scheduling is `scheduled_at timestamptz`**, input in `America/Los_Angeles`, stored UTC,
   displayed with an explicit PDT/PST label. Legacy rows read through
   `COALESCE(scheduled_at, scheduled_for::timestamptz)`; no backfill UPDATE (a mixed migration
   file escalates the whole file to the owner lane per `migration-classify.server.ts:208`).
10. **Permalink is a column**, written in `markPosted`: IG via the second GET, X as
    `https://x.com/hello_xdipx/status/{id}`. Historic rows backfill lazily from the metrics sweep.
11. **Metrics sweep is a cron with its own spend valve.** `/cron/social-metrics-sweep` every 6h,
    posted rows from the last 30 days, writes `metrics_json` and `permalink`, appends to a new
    `social_follower_history` table. The X read spend valve and cap are owner-lane.
12. **Routes, not tabs.** `admin.socials.tsx` becomes a shell with a workspace bar and `<Outlet/>`;
    children `calendar` (default), `queue`, `compose/new`, `compose/:id`, `library`,
    `library/:assetId`, `analytics`, `settings`, each with its own loader and action. RR7 nested
    navigation is the SPA feel; no client router, no `useEffect` fetching.

## 4. Design direction (taste-skill `dashboards`, ui-ux-pro-max)

Style: the taste router selects `dashboards` (queue plus detail, live state, metrics; variance 4,
motion 4, density 7). The page opens on work, not a headline. One editorial borrow only: the
Instagram/X mock renders like the real feed, and is the single saturated object on an otherwise
neutral instrument surface. Tokens: `paper` panels on the admin `cream-2` ground, `paper-2` rails,
`paper-3` wells; borders do the grouping, no shadow ladder, no boxes in boxes; JetBrains Mono for
every id, timestamp, counter, metric and PDT slot; Newsreader only for panel titles; exactly one
coral primary action per screen; status pills carry glyph plus word (draft `ink-4`, pending
`plum-soft`, approved `sage`, scheduled `plum`, publishing animated, published `sage` solid,
failed red, rejected `ink-3` strikethrough). Motion: four jobs only (drawer, calendar drag ghost
and snap, list reorder via Motion `layout`, row highlight on status change), 150-240ms,
transform and opacity, all off under reduced motion.

Screens:

- **Calendar.** Desktop week grid, hour-banded, PDT label in the toolbar, posts as draggable chips,
  unscheduled drafts in a right rail, per-day cap indicators ("IG 2/3"). Mobile: day-strip plus
  agenda list, explicit Reschedule sheet instead of drag.
- **Queue.** List plus detail. Existing review controls kept whole. Approved rows gain "Revert to
  draft". Mobile pushes to `/queue/:id`.
- **Composer.** Three columns desktop: platform variant tabs with per-platform counters; live mock
  with a slide strip below it (2-10 thumbs, drag reorder, per-slide alt text with counter, `+`
  opens the Library in select mode); inspector with Product picker, Cast picker, Schedule (date,
  time, PDT, "next open slot"), and a Gate verdict panel that lists named checks with fix links.
  Mobile: single column, sticky bottom action bar.
- **Library.** Masonry grid, sticky toolbar (search, tag chips, filters by product, cast,
  archetype, source), persistent selection bar ("6 selected: Add to draft, Tag, New post"), asset
  drawer with full-res, read-only prompt, editable tags, usage list, and Edit prompt then
  Regenerate reusing `ImageManager`'s improvement modal.
- **Analytics.** Instrument band (7/30/90 toggle, follower sparklines), then the post table
  inside `ResponsiveTable` (thumb, platform, date, caption, likes, comments, saves, views,
  permalink), best-performing as the default sort, CSV export.

Components: reuse `ResponsiveTable`, `ProductPicker`, `FrequencyPanel`, caption helpers; split
`PostPreviewCard` into per-platform mocks accepting `media[]` plus `ReviewControls`; extract
`ImageManager`'s tile, candidate card, improvement modal, upload queue and confirm-delete popover
into `app/components/admin/media/`; new `WorkspaceBar`, `CalendarGrid`, `PostChip`, `SlideStrip`,
`AltTextField`, `CastPicker`, `GateVerdictPanel`, `StatusPill`, `TagChipInput`, `LibraryMasonry`,
`SelectionBar`, `AssetDrawer`, `MetricSparkline`, `PermalinkLink`.

Acceptance (the build must pass these before `design-critic` and QA): 4.5:1 contrast on every pill
and on `ink-4` metadata; colour never the only signal; keyboard equivalents for every drag
(`n`, `/`, `j/k`, `a/r`, `⌘Enter`, `Esc`, arrow-key reorder with announcements); 44px targets
and 8px spacing; page body never scrolls sideways; every thumb and skeleton declares its aspect;
virtualised lists beyond ~50 rows; every empty and failure state names cause and fix; delete
confirms and offers undo; one coral CTA per screen; stroke SVG icons matching `AdminNav`, no emoji.

## 5. Phases and tickets

Sizes: S under a day of agent work, M one to two, L more. Lanes: ordinary = release engine merges
after QA; owner = protected path, owner merges.

| Phase | Size | Scope | Depends on | Lane |
|---|---|---|---|---|
| 0 Defects | S | `retryFailedPost` resends `edited_text` + media; delete works on draft/rejected rows and on IG posted rows; X permalink uses `hello_xdipx`; `PostPreviewCard` renders all slides | none | ordinary |
| 1 Schema | S | migration 084: `social_media_assets`, `social_post_slides`, `social_follower_history`; `social_posts` adds `scheduled_at`, `permalink`, `gate_status`, `gate_checked_at`, `gate_findings`, `cast_slugs`, `updated_at`; `db/schema.ts` mirrors. Pure `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, one file, no UPDATE | none | ordinary once `migration-dry-run` is green |
| 2 Library + provenance | M | dual-write every candidate to Sanity + index row from `generateAndUploadSocialImage` / `generateCastComposite` (non-fatal on Sanity failure); `api.admin.social-upload` route (owner uploads through the same ingest, source `upload`); `social-asset-library.server.ts` membership seam; provenance dual-check; tag add/remove action; library loader with search and filters | 1 | ordinary |
| 3 Route split + composer | L | shell + nested routes; Composer with slides, alt text, ProductPicker, CastPicker, platform variants, library select mode; `api.admin.social-gate`; `api.admin.social-image` regenerate with prompt editing (social budget gate); revert-to-draft via extended `reworkSocialPost` | 1, 2 (stub library OK) | ordinary |
| 4 Scheduling + permalink | S | `scheduled_at` cutover, eligibility against `now()`, PDT picker, calendar drag reschedule, auto-expire unapproved past slot, permalink capture in `markPosted` | 1 | ordinary, high QA scrutiny (live publish path) |
| 5 Gate stamp cutover | S | gate writers and readers move to `gate_status`; `feedback` returns to owner notes only; stamp regexes removed after a burn-in | 1, 3, 4 | ordinary |
| 6a Analytics UI | M | metrics table, sparklines, CSV, follower history reader | 1 | ordinary |
| 6b Metrics cron + valve | S | `/cron/social-metrics-sweep` in `vercel.json`, `social_metrics_sweep_enabled` valve + `x_metrics_max_reads_month` cap | 1 | **owner** (spend control) |
| 7 Design pass | S | `design-critic` review of Composer, Library, Calendar at 375px and desktop against §4 acceptance; fixes | 3, 4, 6a | ordinary |

Bus rows are filed per phase with `Depends-on:` links and `dedupeKey: social-studio-v2-phase-N`.
The owner lane has one item (6b). Valves `instagram_autopublish_enabled` and
`x_autopublish_enabled` are untouched by this plan.

## 6. Doctrine this plan binds to

- Every Instagram product post still carries an approved cast member in a scene
  (`instagram-campaigns.md` §3.7); the Cast picker surfaces the roster, the gate still judges.
- The packshot rule, the stock guard as `block`, zero BLOCK override, server-side re-verification
  of every PASS, and `GATE_PLATFORMS` equal to what the publisher can ship are unchanged.
- Register and copy rules are the charter's; the Composer shows counters and the gate verdict, it
  does not write copy.
- Money valves stay owner-gated. Owner-initiated generation counts against the social budget.

# Nalpac Import Monitor — Daily Run Runbook

*Last updated: 2026-05-20. Operating doc for the in-app Nalpac import automation: the daily run, the data it produces, the /admin surfaces, the controls, and the phased automation path.*

> **Scope note.** This is the **in-app** system (Vercel cron + React Router v7 + Neon). It is fully self-contained and **independent of the standalone Python "Nalpac Reports" pipeline** in `~/Documents/xdipx.com/Nalpac Reports/`. That pipeline keeps running on its own for local deep-dive review; nothing here reads from or writes to it.

---

## 1. What it does

Every scheduled day it diffs the **4 Nalpac feeds** against the products we already carry, **collapses the flat feed SKUs into master products** (grouping color/size/volume variants of one product into a single master with variant axes), tiers and `gap_score`-ranks the master-level gaps, price-previews each, and writes the top candidates to the `import_candidates` table (one row per master) for review at `/admin/imports`. Selection is **fully deterministic — zero LLM cost**. AI spend happens only later, when an *approved* product is enriched.

Feeds monitored (base `https://productfeeds.wyomind.com/feeds/1s6o37vbh23/`):

| Feed | Slug | Role in tiering |
|---|---|---|
| Main catalog | `nal-product-attributes-main.csv` | Universe + attributes |
| New products | `nal-new-products.csv` | Tier C (fresh releases) |
| On sale | `nal-on-sale.csv` | Sale signal for pricing |
| Top 100 | `nal-top-100.csv` | Tier A (proven sellers) |

Fetch + 4-feed merge is the existing `fetchAllNalpacFeeds()` (`app/lib/nalpac-feeds.server.ts`), KV-cached.

---

## 2. The daily run (`runImportMonitor()` — `app/lib/import-monitor.server.ts`)

1. Open an `import_monitor_runs` audit row (`started_at`, `source` = `cron` | `manual`).
2. Fetch all 4 feeds; `feeds_ok` = no fetch errors.
3. Build the **carried set** from `deal_history` (`DISTINCT sku`, `DISTINCT brand`). This matches `isSkuAlreadyImported()`, so candidate dedup and the import guard agree. (Future refinement: supplement with Shopify `nalpac-sku-*` tags for manually-added products.)
4. **New-product diff:** compare today's feed SKU set against the prior set in KV (`monitor:feed-skus`); store today's back (25h TTL).
5. **Collapse into masters.** Group the flat feed SKUs into master products by `(brand, base_title)` — color/size/volume variants of one product become one master — and detect variant axes (Color/Size/Volume). See §Masters & Variants.
6. **Filter.** Drop masters already carried (any variant SKU in the carried set) and those failing eligibility (display/tester, total qty < `NALPAC_QTY_FLOOR` (20), no image, missing pricing).
7. **Tier + score + price.** Per master: tier label (A top-100 / B carried-brand ≥45% / C new-products feed, any margin / D uncarried opportunity) for the "why"; `gap_score` (rewards margin × variant count × stock depth, stored in `deal_score`); MAP-safe price preview via `computeTargetPrice()` on median pricing.
8. **Rank + cap.** **Nalpac top-100 AND new-products masters always surface** — proven sellers and new items both belong on the site, so they bypass the cap (regardless of margin). Remaining slots go to the highest `gap_score` of the rest (carried-brand depth + brand opportunities), up to `import_monitor_max_candidates` (default 300). A live run collapsed ~15,500 masters → ~3,400 eligible. The full strategic view stays in the Catalog Opportunities report.
9. **Upsert** into `import_candidates` (`ON CONFLICT(master_key)`):
   - new master → insert `pending`;
   - existing `pending`/`approved` → refresh metrics, keep status;
   - `rejected`/`imported` → only bump `last_seen_at` (never reopen);
   - `watching` → reopen to `pending` only if score improved by ≥ `import_monitor_watch_score_delta` (default 0.10) **or** price dropped by ≥ `import_monitor_watch_price_drop_pct` (default 0.10).
10. **Phase gate** (`import_monitor_phase`): Phase 1 = all `pending`, no auto-import. Phases 2–3 deferred (see §6).
11. Finalize the audit row; write `import_monitor_last_run_at`.

Errors never throw out of the cron — they're logged to the run row's `error_message` and the handler returns 200.

---

## 2a. Masters & Variants (`app/lib/master-collapse.server.ts`)

Nalpac's feed is flat (one row per sellable SKU); our store needs one product with variants. The collapse logic ports `MASTERS_AND_VARIANTS.md` (the Co-Work spec).

**Stage 1 — group into masters.** Master key = `(brand, base_title)` lowercased. The **base title** is the product title with variant-distinguishing tokens stripped in order: volume/packaging → Color cell values → Size cell values → written-out size words → common color words → normalize. Lean v1 also drops dangling structural words (`size`, `style`, `color`, `assorted`) and splits multi-value `Color`/`Size` cells on `,` and `/`. `UPC/barcode` is used as a tiebreaker. Each master aggregates **median** wholesale/MSRP/MAP across its variants, total qty, colors/sizes/volumes, sample image, and feed flags.

**Stage 2 — detect axes (`detectAxes`).** Up to 2 Shopify option axes (Color / Size / Volume), added only when values actually vary. Includes Twist A (blank Size siblings → `Regular`) and Twist B (derived hidden-color axis from the title when explicit axes collide), and the canonical size sort order.

**Eligibility (`isEligible`)** drops display/tester, qty < `NALPAC_QTY_FLOOR` (20), no image, and missing-pricing masters. **`gap_score`** = `(margin_pct/50) × (1+ln(1+variant_count)) × (1+0.2·ln(1+total_qty))` — the ranking signal.

**Idempotency:** candidates are keyed on the stable `master_key`, so re-runs update in place rather than duplicating. Masters with **> 30 variants** are flagged `needs_review` (usually a grouping error or a display assortment) and badged in the dashboard.

**On approve**, `approveAndImport` re-collapses today's feed for that `master_key`, runs `detectAxes`, and builds a `MasterProductGroup` (master row + `BulkVariantRow[]` with option axes) for `importProductGroupRaw` → one Shopify draft product with all variants. Singletons take the single-variant path.

**Deferred (not in v1):** Main-Category co-occurrence inference (uses most-common Sub-Category / `(uncategorized)` for now), config-driven strip lists, and fuzzy-title family merging — see `MASTERS_AND_VARIANTS.md` §6.

---

## 3. Schedule & triggers

- **Cron:** `POST /cron/import-monitor`, `vercel.json` schedule `0 8 * * *` (08:00 UTC — after the 07:00 pricing cron, so the warm feed cache is reused). Protected by the shared `x-cron-secret` / `CRON_SECRET` guard.
- **In-handler gates** (Vercel schedules are static): skips if `import_monitor_enabled = 'false'` (kill switch) or if today's `getUTCDay()` isn't in `import_monitor_run_days` (CSV of UTC day numbers, default all 7).
- **Manual:** the **Trigger now** button on `/admin/imports` → `POST /api/import-monitor/run` → `runImportMonitor({ source: 'manual' })`.

---

## 4. The dashboard (`/admin/imports`)

- **Run-status header** — last run time, candidates found, auto-imported, feeds-ok; the Trigger-now button.
- **Settings panel** — 7 day-of-week checkboxes, enabled toggle, Phase 1/2/3 selector (all persist to `pipeline_settings`).
- **Pending candidates** — title, brand, tier, deal score, margin %, proposed price, qty, gap reason; per-row **Approve / Reject / Watch**.
- **Watching** — collapsible; rows resurfaced automatically on material improvement.
- **Catalog Opportunities** (`/admin/imports/opportunities`) — brand coverage, category coverage, and brand-opportunity tables (where to deepen or expand).

**Approve** → `approveAndImport()` → `importProductGroupRaw()` creates a Shopify **draft** + a `deal_history` `queued` row ($0, no enrichment), links `deal_history_id`, sets the candidate `imported`. Enrichment (Batch API, 50% off) and pricing happen downstream — the product stays a draft until enriched, so there's no half-built customer exposure.

---

## 5. PM chat agent (`/admin/chat/pm`)

A conversational, tool-using product manager for ad-hoc merchandising questions. It mirrors the Emma admin-chat streaming engine (`streamAgentReply` in `app/lib/emma-chat.server.ts`) with a PM persona and a **propose-only** tool set — it never imports, reprices, pins, or publishes live; everything lands pending for approval.

Signature flow — *"Nalpac put the whole 'Me You Us' brand on sale, how do we feature it?"*: `search_nalpac_feed` (brand, on-sale) → `get_catalog_coverage` → `price_preview` → a positioning plan, then offers to `stage_import_candidates`, `propose_pricing_changes` (→ `pricing_changes` pending, carried products only, MAP-enforced), `propose_discovery_pins` (→ `discovery_rules` `pin_fallback`, inactive), `draft_brand_collection`, and recommend homepage placement (`get_homepage_levers`). Approvals happen in `/admin/imports`, `/admin/pricing`, `/admin/discovery-rules`.

Threads share `emma_chat_threads`/`emma_chat_messages` via an `agent_type` discriminator (`'pm'`).

---

## 6. Phased automation

| Phase | `import_monitor_phase` | Behavior |
|---|---|---|
| 1 | `1` (default) | Monitor + manual approval. No auto-import. **Current.** |
| 2 | `2` | Auto-approve masters clearing strict gates (tier A/B, high `gap_score`, margin ≥ 45%, qty ≥ 100, price ≥ MAP, not `needs_review`), capped per day; rest manual. **Deferred — gate scaffolding + TODO in `runImportMonitor()`.** |
| 3 | `3` | Relaxed gates incl. tier C, higher cap, per-day revenue guard; exception-only review. **Deferred.** |

Both auto phases require the enabled kill switch + a per-day import cap. Do not enable until Phase 1 is proven in production.

---

## 7. Cost

| Step | Mechanism | Cost |
|---|---|---|
| Daily monitor (fetch, diff, tier, score, price preview) | Pure TS + KV + Neon | ~$0 |
| Approve → raw import | 1 Shopify mutation + 1 Neon write | ~$0 |
| Enrichment of approved product | Anthropic Batch API (50% off) | ~$0.05–0.15 ea |
| PM chat | Sonnet stream, admin-only, propose-only | cents/session |

Never call the synchronous full enrichment orchestrator from the monitor or approve path.

---

## 8. Settings reference (`pipeline_settings` keys)

| Key | Default | Meaning |
|---|---|---|
| `import_monitor_enabled` | `true` | Kill switch |
| `import_monitor_run_days` | `0,1,2,3,4,5,6` | UTC day numbers to run (0 = Sun) |
| `import_monitor_phase` | `1` | Automation phase |
| `import_monitor_max_candidates` | `300` | Max master candidates written per run (ranked by `gap_score`) |
| `import_monitor_watch_score_delta` | `0.10` | Score jump to resurface a watched candidate |
| `import_monitor_watch_price_drop_pct` | `0.10` | Price drop to resurface a watched candidate |
| `import_monitor_last_run_at` | — | ISO timestamp, written each run |

Env var (not a `pipeline_settings` key): `NALPAC_QTY_FLOOR` (default `20`) — minimum total qty for a master to be eligible.

---

## 9. Operations

- **Apply the schema:** `DATABASE_URL=… npx tsx scripts/apply-migrations.ts --from 038` (038 creates `import_candidates`, `import_monitor_runs`, adds `emma_chat_threads.agent_type`; 039 reshapes `import_candidates` to master-level; both idempotent).
- **Pause:** set `import_monitor_enabled = false` (Settings panel toggle) — cron returns `{ skipped: true }`.
- **Change run days:** Settings panel checkboxes (UTC).
- **Manual run:** Trigger-now button, or `POST /cron/import-monitor` with the `x-cron-secret` header.
- **Audit:** `import_monitor_runs` (one row per run) + the dashboard run-status header.

---

## 10. Key files

```
app/lib/import-monitor.server.ts          run + queries + approveAndImport + stageMasterCandidatesBySkus
app/lib/master-collapse.server.ts         Stage 1/2 collapse + axis detection + eligibility + gap_score
app/routes/admin.imports.tsx              dashboard + settings
app/routes/admin.imports.opportunities.tsx catalog coverage
app/routes/api.import-monitor.run.tsx     manual trigger
app/routes/api.import-monitor.candidate-action.tsx  approve/reject/watch
server/cron.ts                            /cron/import-monitor handler
vercel.json                               cron schedule (0 8 * * *)
db/migrations/038_import_candidates.sql   schema (initial)
db/migrations/039_import_candidates_masters.sql  master-level reshape
app/lib/pm-chat-prompt.server.ts          PM persona
app/lib/pm-chat-tools.server.ts           PM tools
app/routes/admin.pm-chat.tsx              PM chat page
app/routes/api.admin.pm-chat.stream.$threadId.tsx  PM chat SSE
app/lib/emma-chat.server.ts               streamAgentReply (shared engine)
```

/**
 * What a restore has to bring back, and what it deliberately does not.
 *
 * ## Why a manifest and not `pg_dump`
 *
 * There is no `pg_dump` on a Vercel Node runtime, and the second scheduler
 * plane (GitHub Actions, which does have one) lives under `.github/**`, a
 * protected path. So the dump is written in JS over the Neon HTTP driver, which
 * means it dumps a *chosen* set of tables rather than everything. Choosing is
 * therefore not an optimisation here; it is unavoidable, and an unavoidable
 * choice made implicitly is how a table ends up silently unbacked-up.
 *
 * ## Why the tiers are shaped this way
 *
 * The database is 231 MB across 105 public tables, and `pricing_audit_log`
 * alone is 188 MB of it — 81%. Dumping everything would spend the whole 300s
 * budget re-serialising an audit log that already has a retention policy, and
 * would still not fit. Dumping the irreplaceable set costs a few MB.
 *
 * Four tiers, each of which must say *why* out loud:
 *
 *   critical    Loss is unrecoverable and operationally material. Dumped.
 *   derived     Reconstructable from a named external source of truth. The
 *               rebuild path is recorded, so "derived" is a claim someone can
 *               check rather than a shrug.
 *   disposable  Loss is tolerable: a high-volume log under retention, or a
 *               record of something the store no longer does.
 *   foreign     Not xdipx's data. This database is shared (see below).
 *
 * ## The rule for anything uncertain
 *
 * **When it is not obvious whether a table is reconstructable, it goes in
 * `critical`.** The whole critical tier is under 20 MB, so over-including costs
 * nothing measurable, while over-excluding is discovered at restore time — the
 * one moment when being wrong is unrecoverable. Every `derived` entry below
 * names the specific mechanism that rebuilds it; if a rebuild path cannot be
 * named, the tier is wrong.
 *
 * ## This database is shared, and a restore is not xdipx-only
 *
 * Measured 2026-09-02: 19 tables in the `public` schema belong to a dormant
 * video-studio application (`characters`, `scenes`, `shots`, `takes`, `scripts`,
 * `productions`, `loras`, `pods`, `assets`, `cost_ledger`, ...), all at 0-1
 * rows. Nothing in the repo recorded this. It matters for exactly one reason and the runbook
 * says it in bold: a Neon point-in-time restore rewinds the whole database, so
 * rolling xdipx back also rolls that application back. The logical dump here is
 * the surgical alternative for a single-table clobber.
 *
 * ## `db/schema.ts` is not the inventory
 *
 * It declares 76 tables. The live `public` schema has 105. `reviews`,
 * `review_settings`, `gsc_url_inspections`, `gsc_snapshots`, `gsc_index_daily`
 * and `schema_migrations_applied` are all real, written by real code, and in no
 * Drizzle schema file — including the migrations ledger, without which a
 * restored database cannot say what version it is. A manifest keyed to
 * `db/schema.ts` would have missed all six. So coverage is asserted against the
 * live database at runtime by `/cron/db-backup`, not against a source file at
 * test time.
 *
 * ## Scope is the `public` schema, and only that
 *
 * `neon_auth` (9 tables, Neon's own auth store) and `drizzle`
 * (`__drizzle_migrations`) are separate Postgres schemas. They are out of scope
 * here rather than tiered as `foreign`, because a manifest entry with no live
 * table in the schema being scanned is indistinguishable from a dropped table,
 * and `missingFromDatabase` would alarm on them forever.
 */

export type BackupTier = 'critical' | 'derived' | 'disposable' | 'foreign'

export interface TableClass {
  table: string
  tier: BackupTier
  /**
   * For `critical`, why loss is unrecoverable. For `derived`, the mechanism
   * that rebuilds it. For `disposable`, why loss is tolerable. For `foreign`,
   * whose it is. Never optional: a tier with no reason is a guess.
   */
  why: string
}

const CRITICAL: ReadonlyArray<[string, string]> = [
  // --- money, orders, and anything a customer gave us -----------------------
  ['daily_profit_summary', 'The only ledger of what the store earned. Not derivable from Shopify once an order ages out of the API window.'],
  ['order_line_items', 'Wholesale cost per line, written by the order webhook. Shopify does not store our cost.'],
  ['draft_orders', 'Support-created orders mid-flight.'],
  ['returns', 'Return and exchange state a customer is waiting on.'],
  ['referrals', 'Commission owed. Money we owe someone, recorded nowhere else.'],
  ['consent_log', 'CCPA/GDPR consent records. Legally load-bearing and unreconstructable by definition.'],
  ['tos_acceptance', 'Who accepted which terms, when. Same reason as consent_log.'],
  ['tos_versions', 'The text that was accepted. An acceptance row pointing at a missing version proves nothing.'],
  ['customer_anniversaries', 'Customer-supplied dates.'],
  ['customer_profile_extras', 'Customer-supplied preferences.'],
  ['wishlists', 'Customer-created.'],
  ['wishlist_items', 'Customer-created.'],
  ['reviews', 'Customer-written. Unreconstructable, and in no Drizzle schema file.'],
  ['review_aggregates', 'Rolls up reviews; cheap to keep alongside them and awkward to recompute mid-incident.'],
  ['review_attribute_ratings', 'Customer-submitted.'],
  ['review_invites', 'Outstanding invitations; losing them double-mails customers.'],
  ['review_media', 'Customer-uploaded.'],
  ['review_settings', 'Hand-tuned configuration.'],
  ['pdp_dial_votes', 'Visitor-submitted.'],
  ['pdp_product_votes', 'Visitor-submitted.'],

  // --- conversations. Every one of these is a real person's words ----------
  ['sms_age_consent', 'Age-verification consent per number. Legally load-bearing.'],
  ['sms_conversations', 'Live support threads.'],
  ['sms_messages', 'A real person’s words.'],
  ['sms_optouts', 'An opt-out we lose is an opt-out we violate.'],
  ['sms_turns', 'A real person’s words.'],
  ['emma_chat_events', 'Chat telemetry tied to the threads below.'],
  ['emma_chat_messages', 'A real person’s words.'],
  ['emma_chat_sessions', 'Thread identity for the messages.'],
  ['emma_chat_threads', 'Thread identity for the messages.'],
  ['emma_chat_turns', 'A real person’s words.'],
  ['web_conversations', 'A real person’s words.'],
  ['call_log', 'IVR call records.'],
  ['voicemails', 'A real person’s voice. Nothing regenerates these.'],
  ['outreach_messages', 'Sent outreach; losing it re-pitches the same prospect.'],
  ['outreach_prospects', 'Hand-built prospect list.'],

  // --- the bus and the governance record -----------------------------------
  ['homepage_team_suggestions', 'The ticket bus. Every decision the fleet has made and every one still open.'],
  ['suggestion_links', 'The evidence attached to those decisions. A retire edge cites these; without them the audit trail is prose.'],
  ['homepage_team_runs', 'The run record. This estate deliberately treats scheduler status as a non-signal, so this table IS the liveness history.'],
  ['homepage_team_events', 'What each run did.'],
  ['owner_blockers', 'The owner’s queue, and the probe state that auto-clears it.'],
  ['pipeline_settings', '2,182 keys, including every valve and kill switch. Losing this un-gates or un-runs the entire fleet at once.'],
  ['settings_audit_log', 'Who flipped which valve. Attribution after the fact exists nowhere else.'],
  ['admin_roles', 'Admin access.'],
  ['schema_migrations_applied', 'Which migrations a database has actually had applied. A restored database that cannot answer this cannot be safely migrated forward. In no Drizzle schema file.'],

  // --- editorial and hand-tuned configuration ------------------------------
  ['strategy_briefs', 'The weekly brief every routine reads at Step 0. Regenerable only by re-running a week that has already passed.'],
  ['marketing_calendar', 'Hand-planned promos and themes, dated into the future.'],
  ['ad_campaigns', 'Proposed campaigns and their policy notes.'],
  ['ad_creatives', 'Creative tied to those campaigns.'],
  ['social_posts', 'Published and scheduled posts, with their gate verdicts.'],
  ['social_post_slides', 'Carousel content for those posts.'],
  ['social_media_assets', 'Generated imagery that cost real money, with its review state.'],
  ['social_follower_history', 'A time series. Cannot be back-filled: platforms report today, not last month.'],
  ['video_episodes', 'The serial ledger. Episode numbers, arcs and open loops; renumbering an aired episode is explicitly forbidden, which requires remembering the numbers.'],
  ['video_series', 'Series identity for those episodes.'],
  ['video_jobs', 'In-flight renders that cost real GPU money.'],
  ['media_assets', 'Asset registry.'],
  ['ivr_voices', 'Hand-configured voice settings.'],
  ['discovery_rules', 'Hand-tuned Compass rules.'],
  ['pricing_rules', '98 hand-tuned rules that decide what every SKU costs. Nothing regenerates these and their loss silently misprices the catalog.'],
  ['pricing_groups', 'Grouping the pricing rules apply through.'],
  ['pricing_sub_groups', 'Grouping the pricing rules apply through.'],
  ['pricing_product_type_map', 'Maps product types onto pricing groups. Hand-maintained.'],
]

const DERIVED: ReadonlyArray<[string, string]> = [
  ['import_candidates', 'Rebuilt from the Nalpac CSV feed by the feed processor.'],
  ['nalpac_price_history', 'Rebuilt from the Nalpac feed forward; the history is a convenience, the feed is the source.'],
  ['product_enrichment_cache', 'A cache, keyed on (productId, fieldName, voiceHash, promptVersion), of orchestrator output whose authoritative copy is the Shopify metafield. Rebuilt by scripts/backfill-product-enrichment.ts at the cost of the Claude calls it saves.'],
  ['color_swatch_cache', 'Cache. Recomputed from product images on demand.'],
  ['product_copurchase', 'Recomputed from order history.'],
  ['discovery_index_payload', 'Precomputed Compass index, rebuilt by /cron/warm-discovery-index. 3.3 MB of the largest non-log table for 3 rows.'],
  ['homepage_payload', 'Precomputed homepage blob, rebuilt on rotation and by /cron/warm.'],
  ['gsc_url_inspections', 'A cache of Google’s own answers. Re-fetchable from Search Console.'],
  ['gsc_snapshots', 'Re-fetchable from Search Console.'],
  ['gsc_index_daily', 'Re-fetchable from Search Console.'],
  ['seo_coverage_daily', 'Recomputed from the sitemap and the keyword bank.'],
  ['indexnow_pings', 'A send log. Re-pinging is free and idempotent.'],
  ['enrichment_batches', 'Batch bookkeeping for a job that re-runs.'],
  ['batch_jobs', 'Batch bookkeeping for a job that re-runs.'],
  ['import_monitor_runs', 'Monitoring history for the import lane; the next monitor run re-establishes the current answer.'],
  ['checkout_probe_runs', 'Probe history. The next probe re-establishes the current answer within 6 hours.'],
  ['cron_runs', 'Liveness history under its own 14/90-day retention. The next cycle re-establishes liveness.'],
  ['cron_expectations', 'Upserted from app/lib/cron-expectations.ts on every janitor sweep. The file is the source of truth, deliberately.'],
  ['pricing_changes', 'Recomputed by the pricing pass from pricing_rules, which is critical.'],
  ['ga4_purchase_outbox', 'An outbox. Undelivered rows re-send; delivered rows are history GA4 already holds.'],
  ['meta_capi_outbox', 'An outbox: undelivered rows re-send, delivered rows are history Meta already holds.'],
]

const DISPOSABLE: ReadonlyArray<[string, string]> = [
  ['pricing_audit_log', '432,000 rows and 188 MB, 81% of the entire database, under a 14/90-day retention policy since /cron/pricing-audit-prune split out. It records what a price WAS; pricing_rules records what it should be, and that is the critical one.'],
  ['api_token_log', 'Fleet spend telemetry. Losing it costs a month of cost history, not an operation.'],
  ['deal_history', 'Daily deals were retired 2026-08-03. This is a record of something the store no longer does.'],
]

/**
 * Not ours. Named individually rather than pattern-matched so that a genuinely
 * new xdipx table can never be waved through by a prefix rule, and so the
 * unclassified-table alarm in /cron/db-backup stays quiet about these forever
 * without being quiet about anything else.
 */
const FOREIGN: ReadonlyArray<[string, string]> = [
  ['_studio_marker', 'Dormant video-studio application sharing this database.'],
  ['activity_events', 'Dormant video-studio application.'],
  ['assets', 'Dormant video-studio application.'],
  ['call_qualification_scripts', 'Dormant video-studio application.'],
  ['character_refs', 'Dormant video-studio application.'],
  ['characters', 'Dormant video-studio application.'],
  ['cost_ledger', 'Dormant video-studio application. xdipx spend is api_token_log.'],
  ['jobs', 'Dormant video-studio application. xdipx renders are video_jobs.'],
  ['loras', 'Dormant video-studio application.'],
  ['pod_sessions', 'Dormant video-studio application.'],
  ['pods', 'Dormant video-studio application.'],
  ['productions', 'Dormant video-studio application.'],
  ['scene_characters', 'Dormant video-studio application.'],
  ['scenes', 'Dormant video-studio application.'],
  ['script_messages', 'Dormant video-studio application.'],
  ['scripts', 'Dormant video-studio application.'],
  ['settings', 'Dormant video-studio application. xdipx settings are pipeline_settings.'],
  ['shots', 'Dormant video-studio application.'],
  ['takes', 'Dormant video-studio application.'],
]

function classify(pairs: ReadonlyArray<[string, string]>, tier: BackupTier): TableClass[] {
  return pairs.map(([table, why]) => ({ table, tier, why }))
}

export const BACKUP_MANIFEST: readonly TableClass[] = [
  ...classify(CRITICAL, 'critical'),
  ...classify(DERIVED, 'derived'),
  ...classify(DISPOSABLE, 'disposable'),
  ...classify(FOREIGN, 'foreign'),
]

const BY_TABLE = new Map(BACKUP_MANIFEST.map(c => [c.table, c]))

export function classOf(table: string): TableClass | null {
  return BY_TABLE.get(table) ?? null
}

export function tierOf(table: string): BackupTier | null {
  return BY_TABLE.get(table)?.tier ?? null
}

/** The tables the nightly dump writes, in a stable order. */
export function criticalTables(): string[] {
  return BACKUP_MANIFEST.filter(c => c.tier === 'critical').map(c => c.table).sort()
}

/**
 * Live tables this file has never heard of.
 *
 * This is the whole reason coverage is checked at runtime. A migration that
 * adds a table is merged by the release engine unattended; nothing in that path
 * asks whether the new table needs backing up. An unclassified table is
 * therefore the normal steady-state outcome of the system working as designed,
 * and it must be loud rather than assumed absent.
 */
export function unclassified(liveTables: readonly string[]): string[] {
  return liveTables.filter(t => !BY_TABLE.has(t)).sort()
}

/** Manifest entries with no matching live table: a drop, a rename, or a typo. */
export function missingFromDatabase(liveTables: readonly string[]): string[] {
  const live = new Set(liveTables)
  return BACKUP_MANIFEST.filter(c => !live.has(c.table)).map(c => c.table).sort()
}

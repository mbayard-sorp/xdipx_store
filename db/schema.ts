import {
  bigint,
  bigserial,
  boolean,
  date,
  decimal,
  index,
  integer,
  json,
  jsonb,
  pgTable,
  real,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
// Type-only import — fully erased at build, so no runtime coupling / cycle
// despite homepage-payload.server.ts importing the `homepagePayload` table back.
import type { HomepagePayloadA, HomepagePayloadB } from '~/lib/homepage-payload.server'
// Type-only import for the vision-gate verdict shape (ticket #6763).
import type { VisionVerdict } from '~/lib/social-vision-gate.server'

export const dealHistory = pgTable('deal_history', {
  id:               serial('id').primaryKey(),
  sku:              varchar('sku', { length: 20 }).notNull(),
  seoTitle:         text('seo_title'),
  brand:            varchar('brand', { length: 100 }),
  categories:       json('categories').$type<string[]>(),
  dealDate:         date('deal_date').notNull(),
  wholesaleCost:    decimal('wholesale_cost', { precision: 10, scale: 2 }),
  dealPrice:        decimal('deal_price',    { precision: 10, scale: 2 }),
  msrp:             decimal('msrp',          { precision: 10, scale: 2 }),
  mapPrice:         decimal('map_price',     { precision: 10, scale: 2 }),
  unitsAvailable:   integer('units_available'),
  unitsSold:        integer('units_sold').default(0).notNull(),
  totalRevenue:     decimal('total_revenue', { precision: 10, scale: 2 }).default('0').notNull(),
  totalProfit:      decimal('total_profit',  { precision: 10, scale: 2 }).default('0').notNull(),
  dealScore:        decimal('deal_score',    { precision: 5,  scale: 3 }),
  vaultPrice:       decimal('vault_price',   { precision: 10, scale: 2 }),
  pctOffMsrp:       decimal('pct_off_msrp',  { precision: 5,  scale: 2 }),
  sortOrder:        integer('sort_order').default(0).notNull(),
  status:           varchar('status', { length: 20 }).default('pending').notNull(),
  shopifyProductId: varchar('shopify_product_id', { length: 30 }),
  createdAt:        timestamp('created_at').defaultNow().notNull(),
  activatedAt:      timestamp('activated_at'),
  completedAt:      timestamp('completed_at'),
}, t => ({
  statusIdx:   index('deal_history_status_idx').on(t.status),
  dealDateIdx: index('deal_history_deal_date_idx').on(t.dealDate),
}))

export const consentLog = pgTable('consent_log', {
  id:            serial('id').primaryKey(),
  sessionId:     varchar('session_id', { length: 64 }),
  customerId:    varchar('customer_id', { length: 30 }),
  ipHash:        varchar('ip_hash',     { length: 64 }),
  consentGiven:  boolean('consent_given').notNull(),
  consentType:   varchar('consent_type', { length: 20 }),
  policyVersion: varchar('policy_version', { length: 10 }).notNull(),
  consentedAt:   timestamp('consented_at').defaultNow().notNull(),
}, t => ({
  sessionIdx: index('consent_log_session_idx').on(t.sessionId, t.consentedAt),
}))

export const tosAcceptance = pgTable('tos_acceptance', {
  id:               serial('id').primaryKey(),
  customerId:       varchar('customer_id', { length: 30 }).notNull(),
  email:            varchar('email', { length: 255 }),
  tosVersion:       varchar('tos_version', { length: 10 }).notNull(),
  acceptedAt:       timestamp('accepted_at').defaultNow().notNull(),
  ipHash:           varchar('ip_hash', { length: 64 }),
  acceptanceMethod: varchar('acceptance_method', { length: 20 }),
})

export const tosVersions = pgTable('tos_versions', {
  version:          varchar('version', { length: 10 }).primaryKey(),
  publishedAt:      timestamp('published_at').notNull(),
  summaryOfChanges: text('summary_of_changes'),
  fullTextUrl:      text('full_text_url'),
})

export const referrals = pgTable('referrals', {
  id:                 serial('id').primaryKey(),
  refCode:            varchar('ref_code', { length: 50 }).notNull(),
  referrerType:       varchar('referrer_type', { length: 20 }).default('affiliate'),
  referrerId:         varchar('referrer_id',   { length: 50 }),
  referredCustomerId: varchar('referred_customer_id', { length: 30 }),
  firstOrderId:       varchar('first_order_id', { length: 30 }),
  firstOrderValue:    decimal('first_order_value', { precision: 10, scale: 2 }),
  commissionPct:      decimal('commission_pct',   { precision: 5,  scale: 2 }).default('10.0'),
  commissionOwed:     decimal('commission_owed',  { precision: 10, scale: 2 }),
  commissionPaid:     boolean('commission_paid').default(false),
  createdAt:          timestamp('created_at').defaultNow().notNull(),
})

/**
 * Fixed monthly SaaS costs (migration 094).
 *
 * Hand-maintained, because there is no billing API wired here and nine numbers
 * a month is cheaper than inventing one. A ledger rather than a mutable row:
 * `effectiveTo` NULL means current, so a price change is recorded instead of
 * overwriting the history a past month's ratio was computed against.
 */
export const fixedMonthlyCosts = pgTable('fixed_monthly_costs', {
  id:            serial('id').primaryKey(),
  vendor:        varchar('vendor', { length: 48 }).notNull(),
  note:          text('note'),
  monthlyUsd:    decimal('monthly_usd', { precision: 10, scale: 2 }).notNull(),
  effectiveFrom: date('effective_from').notNull().defaultNow(),
  effectiveTo:   date('effective_to'),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const dailyProfitSummary = pgTable('daily_profit_summary', {
  summaryDate:   date('summary_date').primaryKey(),
  totalOrders:   integer('total_orders'),
  totalRevenue:  decimal('total_revenue',  { precision: 10, scale: 2 }),
  totalCogs:     decimal('total_cogs',     { precision: 10, scale: 2 }),
  totalProfit:   decimal('total_profit',   { precision: 10, scale: 2 }),
  avgOrderValue: decimal('avg_order_value',{ precision: 10, scale: 2 }),
  featuredSku:   varchar('featured_sku', { length: 20 }),
  adSpend:       decimal('ad_spend', { precision: 10, scale: 2 }).default('0').notNull(),
  // Migration 073: units whose wholesale cost could not be resolved from any
  // source. Excluded from totalCogs rather than counted as free stock.
  cogsMissingUnits: integer('cogs_missing_units').default(0).notNull(),
})

export const pipelineSettings = pgTable('pipeline_settings', {
  key:       varchar('key', { length: 50 }).primaryKey(),
  value:     text('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

// Migration 072: append-only attribution trail for pipeline_settings writes.
// Written by setPipelineSettingAudited() in app/lib/settings.server.ts.
export const settingsAuditLog = pgTable('settings_audit_log', {
  id:        bigserial('id', { mode: 'number' }).primaryKey(),
  key:       varchar('key', { length: 50 }).notNull(),
  oldValue:  text('old_value'),
  newValue:  text('new_value').notNull(),
  actor:     varchar('actor', { length: 32 }).notNull(),
  source:    varchar('source', { length: 64 }).notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
})

// Migration 066: synthetic checkout probe results. One row per probe run.
export const checkoutProbeRuns = pgTable('checkout_probe_runs', {
  id:         bigserial('id', { mode: 'number' }).primaryKey(),
  ranAt:      timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
  tier:       text('tier').notNull(),           // 'http' | 'browser'
  ok:         boolean('ok').notNull(),
  failedStep: text('failed_step'),
  steps:      jsonb('steps').$type<{ step: string; ok: boolean; status?: number; ms: number; detail?: string }[]>().notNull().default([]),
  durationMs: integer('duration_ms'),
  alerted:    boolean('alerted').notNull().default(false),
})

export const customerProfileExtras = pgTable('customer_profile_extras', {
  customerGid:        varchar('customer_gid', { length: 60 }).primaryKey(),
  genderIdentity:     varchar('gender_identity', { length: 30 }),
  relationshipStatus: varchar('relationship_status', { length: 30 }),
  dateOfBirth:        date('date_of_birth'),
  updatedAt:          timestamp('updated_at').defaultNow().notNull(),
})

export const customerAnniversaries = pgTable('customer_anniversaries', {
  id:          serial('id').primaryKey(),
  customerGid: varchar('customer_gid', { length: 60 }).notNull(),
  name:        varchar('name', { length: 60 }).notNull(),
  date:        date('date').notNull(),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
})

export const socialPosts = pgTable('social_posts', {
  id:              serial('id').primaryKey(),
  platform:        varchar('platform', { length: 20 }).notNull(),
  postType:        varchar('post_type', { length: 20 }).notNull(),
  externalPostId:  varchar('external_post_id', { length: 50 }),
  parentPostId:    integer('parent_post_id'),
  dealHistoryId:   integer('deal_history_id'),
  tweetText:       text('tweet_text').notNull(),
  mediaUrls:       json('media_urls').$type<string[]>(),
  mediaIds:        json('media_ids').$type<string[]>(),
  status:          varchar('status', { length: 20 }).default('draft').notNull(),
  errorMessage:    text('error_message'),
  postedAt:        timestamp('posted_at'),
  createdAt:       timestamp('created_at').defaultNow().notNull(),
  createdBy:       varchar('created_by', { length: 20 }).default('system'),
  // Editorial review lifecycle (migration 058) — layered on top of `status`,
  // which stays the publication lifecycle. pending_review|approved|needs_changes|rejected.
  reviewStatus:    varchar('review_status', { length: 20 }).default('pending_review').notNull(),
  feedback:        text('feedback'),
  editedText:      text('edited_text'),
  reviewedBy:      varchar('reviewed_by', { length: 60 }),
  reviewedAt:      timestamp('reviewed_at'),
  scheduledFor:    date('scheduled_for'),
  reworkedFrom:    integer('reworked_from'),
  // Video pipeline linkage (migration 065). A finished video_jobs row fans out
  // to one social_posts row per target platform; posterUrl renders before playback.
  videoJobId:      integer('video_job_id'),
  posterUrl:       text('poster_url'),
  // Engagement metrics (migration 079, ticket #3536). Per-row numbers for the
  // row's own platform (reach/likes/comments/saved on IG), merged field-level
  // like video_jobs.metrics_json; never estimated, only fetched.
  metricsJson:     jsonb('metrics_json').$type<Record<string, number>>(),
  // Durable product linkage (migration 080, ticket #2212). Nullable: not every
  // post features a product, and this is additive on rows that predate it.
  // Set once by the drafting writer when the post features a specific product;
  // read fresh at every publish attempt (manual and scheduled) so a product
  // that goes out of stock after approval still blocks the post, independent
  // of the pre-publish gate's own caller-supplied productHandle snapshot.
  shopifyProductId: varchar('shopify_product_id', { length: 60 }),
  // Accessibility description + generation brief (migration 085, owner direction
  // 2026-08-22; renumbered from 084 to 085 to avoid colliding with the Social
  // Studio v2 migration below). altText is what the Instagram publisher sends
  // as alt_text on the media container; it must never leak into the caption
  // (tweetText). imageBrief and subject are the durable "what is this image
  // supposed to depict" record that regeneration/rework reads instead of
  // reverse-engineering it from the caption text.
  altText:          text('alt_text'),
  imageBrief:       text('image_brief'),
  subject:          text('subject'),
  // Social Studio v2 (migration 084, ADR-013). All nullable, all additive.
  // scheduledAt supersedes scheduledFor (date-only): owner input is a PDT
  // wall-clock time, stored UTC; legacy rows read through COALESCE.
  scheduledAt:     timestamp('scheduled_at', { withTimezone: true }),
  // Live post URL, written at publish, backfilled by the metrics sweep.
  permalink:       text('permalink'),
  // Gate verdict in its own columns (pass|revise|block|hold); the tagged
  // stamp inside `feedback` is dual-written until Phase 5 cuts readers over.
  gateStatus:      varchar('gate_status', { length: 12 }),
  gateCheckedAt:   timestamp('gate_checked_at', { withTimezone: true }),
  gateFindings:    jsonb('gate_findings').$type<{ check: string; verdict: string; note?: string }[]>(),
  // Approved cast members appearing in this post (Sanity castMember slugs).
  castSlugs:       jsonb('cast_slugs').$type<string[]>(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }),
  // Serialized video program (migration 086). episodeId is the learn-mode
  // attribution seam: post -> episode -> series/formula/hook/cast. mediaKind
  // is the STORED media type ('image'|'video'|'none') that collapses the five
  // duplicated `.mp4`-suffix inference predicates; readers fall back to
  // inference for pre-086 rows, so it is nullable and never backfilled in SQL.
  episodeId:       integer('episode_id'),
  mediaKind:       varchar('media_kind', { length: 8 }),
  // Removal attribution (migration 087, ticket #6758). The removal watchers
  // (social-removal-watch.server.ts / x-removal-watch.server.ts) can tell a
  // post is gone but not WHY: an owner deleting a post looks identical, over
  // the platform APIs, to a platform takedown. 'unknown' is the honest
  // default a watcher-detected removal gets; 'owner' is set only by the
  // admin "I removed this" action, and excludes the row from the takedown
  // pattern count; 'platform' is reserved for a removal with independent
  // confirmation (today, only the historical backfill in migration 088).
  removalSource:   varchar('removal_source', { length: 10 }).default('unknown'),
  // Scene variety tracking (migration 093, ticket #4345, owner ruling
  // 2026-08-19 in instagram-campaigns.md §3.8: no location repeat inside 8
  // consecutive Instagram product posts, no cast member on more than 2 of any
  // 5). `castSlugs` above already exists (migration 084) but was never
  // threaded through the draft op; `sceneLocation` is new. Both are set at
  // draft time and read back through the existing {op:'list'} response so a
  // routine can compute the two variety windows from one list call instead of
  // re-deriving rotation by reading captions.
  sceneLocation:   varchar('scene_location', { length: 80 }),
})

/**
 * The social image library index (migration 084). Binaries are Sanity image
 * assets; this row is everything the Studio needs to search, filter, tag and
 * reuse them, and it is what the image-provenance gate check consults.
 * `source`: generated | upload | video_poster. `isPicked`: the candidate the
 * agent chose for the post in `postId` (losers keep is_picked=false and stay
 * browsable, which is the whole point of the library).
 */
export const socialMediaAssets = pgTable('social_media_assets', {
  id:                serial('id').primaryKey(),
  sanityAssetId:     varchar('sanity_asset_id', { length: 120 }),
  url:               text('url').notNull(),
  width:             integer('width'),
  height:            integer('height'),
  aspect:            varchar('aspect', { length: 12 }),
  mimeType:          varchar('mime_type', { length: 40 }),
  bytes:             integer('bytes'),
  source:            varchar('source', { length: 20 }).notNull().default('generated'),
  provider:          varchar('provider', { length: 40 }),
  model:             varchar('model', { length: 120 }),
  prompt:            text('prompt'),
  negativePrompt:    text('negative_prompt'),
  archetype:         varchar('archetype', { length: 40 }),
  productHandle:     varchar('product_handle', { length: 255 }),
  shopifyProductId:  varchar('shopify_product_id', { length: 60 }),
  castSlugs:         jsonb('cast_slugs').$type<string[]>(),
  tags:              jsonb('tags').$type<string[]>(),
  generationBatchId: varchar('generation_batch_id', { length: 80 }),
  isPicked:          boolean('is_picked').notNull().default(false),
  postId:            integer('post_id'),
  createdBy:         varchar('created_by', { length: 60 }).notNull().default('system'),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }),
  // Archive lifecycle (migration 085, ticket #5426). archivedAt = NULL means
  // "in the active library"; the library grid and the Composer picker both
  // default their query to archivedAt IS NULL. Rows are NEVER deleted (the
  // publish gate's provenance check reads by row existence), so purgedAt
  // exists only for a future purge job (#5427, not built here) to record
  // that a binary is gone while the row and its provenance survive.
  archivedAt:        timestamp('archived_at', { withTimezone: true }),
  archivedBy:        varchar('archived_by', { length: 60 }),
  purgedAt:          timestamp('purged_at', { withTimezone: true }),
  // The Shopify Files GID for `url`, when rehosted there. Populated going
  // forward (uploadMoodImageToShopifyFilesWithId); historic rows stay null.
  shopifyFileId:     varchar('shopify_file_id', { length: 120 }),
  // Vision-gate hard check (migration 087, ticket #6763). NULL means never
  // checked; the publish gate treats that as a BLOCK for any library asset,
  // never a silent skip. See app/lib/social-vision-gate.server.ts.
  visionVerdict:     jsonb('vision_verdict').$type<VisionVerdict>(),
  visionVerdictAt:   timestamp('vision_verdict_at', { withTimezone: true }),
}, t => ({
  createdIdx:  index('idx_social_media_assets_created').on(t.createdAt),
  productIdx:  index('idx_social_media_assets_product').on(t.productHandle),
  batchIdx:    index('idx_social_media_assets_batch').on(t.generationBatchId),
  postIdx:     index('idx_social_media_assets_post').on(t.postId),
  urlIdx:      index('idx_social_media_assets_url').on(t.url),
  archivedIdx: index('idx_social_media_assets_archived_at').on(t.archivedAt),
}))

/**
 * Ordered slides of a carousel draft (migration 084). `social_posts.media_urls`
 * stays the publish-time snapshot derived from these rows, so the publish job
 * and the platform adapters never read this table. `url` is denormalised from
 * the asset so a slide survives an asset row being absent (owner paste, legacy).
 */
export const socialPostSlides = pgTable('social_post_slides', {
  id:        serial('id').primaryKey(),
  postId:    integer('post_id').notNull(),
  position:  integer('position').notNull().default(0),
  assetId:   integer('asset_id'),
  url:       text('url').notNull(),
  altText:   varchar('alt_text', { length: 1000 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  postIdx: index('idx_social_post_slides_post').on(t.postId, t.position),
}))

/** Account follower readings appended by the metrics sweep (migration 084). */
export const socialFollowerHistory = pgTable('social_follower_history', {
  id:         serial('id').primaryKey(),
  platform:   varchar('platform', { length: 20 }).notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  followers:  integer('followers'),
  follows:    integer('follows'),
  mediaCount: integer('media_count'),
}, t => ({
  platformIdx: index('idx_social_follower_history_platform').on(t.platform, t.capturedAt),
}))

// Instagram comment support lane, phase 1 (migration 093, ticket #2027).
// Ingested hourly from the Graph API into `inbound`; an admin edits
// `replyText` in the /admin/socials/comments queue and approves it, which
// posts via POST /{comment_id}/replies and records `externalReplyId`.
// Auto-reply is a separate, later ticket -- every row here needs a human
// click to leave this table.
export const socialComments = pgTable('social_comments', {
  id:                 serial('id').primaryKey(),
  externalCommentId:  varchar('external_comment_id', { length: 60 }).notNull(),
  externalPostId:     varchar('external_post_id', { length: 60 }).notNull(),
  platform:           varchar('platform', { length: 20 }).default('instagram').notNull(),
  username:           varchar('username', { length: 120 }),
  text:               text('text').notNull(),
  commentedAt:        timestamp('commented_at'),
  fetchedAt:          timestamp('fetched_at').defaultNow().notNull(),
  // inbound|drafted|replied|ignored|escalated
  status:             varchar('status', { length: 20 }).default('inbound').notNull(),
  replyText:          text('reply_text'),
  repliedAt:          timestamp('replied_at'),
  repliedBy:          varchar('replied_by', { length: 60 }),
  externalReplyId:    varchar('external_reply_id', { length: 60 }),
  createdAt:          timestamp('created_at').defaultNow().notNull(),
  updatedAt:          timestamp('updated_at').defaultNow().notNull(),
}, t => ({
  externalIdUq: uniqueIndex('uq_social_comments_external_id').on(t.externalCommentId),
  statusIdx:    index('idx_social_comments_status').on(t.status),
}))

export const adminRoles = pgTable('admin_roles', {
  id:              serial('id').primaryKey(),
  neonAuthUserId:  varchar('neon_auth_user_id', { length: 60 }).notNull().unique(),
  email:           varchar('email', { length: 255 }).notNull(),
  name:            varchar('name', { length: 100 }).notNull(),
  role:            varchar('role', { length: 20 }).notNull().default('admin'),
  createdAt:       timestamp('created_at').defaultNow().notNull(),
  lastLoginAt:     timestamp('last_login_at'),
})

export const orderLineItems = pgTable('order_line_items', {
  id:               serial('id').primaryKey(),
  shopifyOrderId:   varchar('shopify_order_id', { length: 30 }).notNull(),
  shopifyProductId: varchar('shopify_product_id', { length: 30 }).notNull(),
  handle:           varchar('handle', { length: 255 }),
  sku:              varchar('sku', { length: 50 }),
  quantity:         integer('quantity').notNull(),
  unitPrice:        decimal('unit_price', { precision: 10, scale: 2 }),
  createdAt:        timestamp('created_at').defaultNow().notNull(),
}, t => ({
  orderIdx:   index('oli_order_idx').on(t.shopifyOrderId),
  handleIdx:  index('oli_handle_idx').on(t.handle),
  productIdx: index('oli_product_idx').on(t.shopifyProductId),
}))

export const wishlists = pgTable('wishlists', {
  id:          serial('id').primaryKey(),
  customerGid: varchar('customer_gid', { length: 60 }).notNull(),
  name:        varchar('name', { length: 100 }).notNull(),
  note:        text('note'),
  privacy:     varchar('privacy', { length: 20 }).default('private').notNull(),
  giftMode:    boolean('gift_mode').default(false).notNull(),
  shareToken:  varchar('share_token', { length: 48 }),
  isDefault:   boolean('is_default').default(false).notNull(),
  publicSlug:  varchar('public_slug', { length: 20 }),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  updatedAt:   timestamp('updated_at').defaultNow().notNull(),
}, t => ({
  slugUnique:      uniqueIndex('wishlists_slug_uniq').on(t.publicSlug),
  shareTokenUq:    uniqueIndex('wishlists_share_token_uniq').on(t.shareToken),
  customerIdx:     index('wishlists_customer_idx').on(t.customerGid),
  customerNameUq:  uniqueIndex('wishlists_customer_name').on(t.customerGid, t.name),
}))

export const wishlistItems = pgTable('wishlist_items', {
  id:               serial('id').primaryKey(),
  wishlistId:       integer('wishlist_id').notNull().references(() => wishlists.id, { onDelete: 'cascade' }),
  shopifyProductId: varchar('shopify_product_id', { length: 64 }).notNull(),
  handle:           varchar('handle', { length: 255 }).notNull(),
  variantSelection: json('variant_selection').$type<Record<string, string>>(),
  addedAt:          timestamp('added_at').defaultNow().notNull(),
}, t => ({
  itemUnique: uniqueIndex('wishlist_items_unique').on(t.wishlistId, t.shopifyProductId),
  listIdx:    index('wishlist_items_list_idx').on(t.wishlistId),
}))

export const pdpDialVotes = pgTable('pdp_dial_votes', {
  id:               serial('id').primaryKey(),
  shopifyProductId: varchar('shopify_product_id', { length: 64 }).notNull(),
  dimension:        varchar('dimension', { length: 40 }).notNull(),
  customerGid:      varchar('customer_gid', { length: 60 }).notNull(),
  vote:             integer('vote').notNull(),
  createdAt:        timestamp('created_at').defaultNow().notNull(),
}, t => ({
  voteUnique:    uniqueIndex('pdp_dial_votes_uniq').on(t.shopifyProductId, t.dimension, t.customerGid),
  productIdx:    index('pdp_dial_votes_product_idx').on(t.shopifyProductId),
}))

export const pdpProductVotes = pgTable('pdp_product_votes', {
  id:               serial('id').primaryKey(),
  shopifyProductId: varchar('shopify_product_id', { length: 64 }).notNull(),
  customerGid:      varchar('customer_gid', { length: 60 }).notNull(),
  vote:             integer('vote').notNull(),
  createdAt:        timestamp('created_at').defaultNow().notNull(),
}, t => ({
  voteUnique: uniqueIndex('pdp_product_votes_uniq').on(t.shopifyProductId, t.customerGid),
  productIdx: index('pdp_product_votes_product_idx').on(t.shopifyProductId),
}))

export const callLog = pgTable('call_log', {
  id:              serial('id').primaryKey(),
  callSid:         varchar('call_sid', { length: 64 }).notNull().unique(),
  fromNumber:      varchar('from_number', { length: 20 }).notNull(),
  toNumber:        varchar('to_number', { length: 20 }),
  direction:       varchar('direction', { length: 10 }),
  endReason:       varchar('end_reason', { length: 20 }),
  durationSec:     integer('duration_sec'),
  tokensTotal:     integer('tokens_total'),
  voicemailId:     integer('voicemail_id'),
  createdAt:       timestamp('created_at').defaultNow().notNull(),
}, t => ({
  fromIdx:    index('call_log_from_idx').on(t.fromNumber, t.createdAt),
  createdIdx: index('call_log_created_idx').on(t.createdAt),
}))

export const voicemails = pgTable('voicemails', {
  id:                  serial('id').primaryKey(),
  callSid:             varchar('call_sid', { length: 64 }).notNull().unique(),
  fromNumber:          varchar('from_number', { length: 20 }).notNull(),
  callbackNumber:      varchar('callback_number', { length: 20 }),
  summary:             text('summary').notNull(),
  transcript:          text('transcript').notNull(),
  recordingUrl:        text('recording_url'),
  contextOrderNumber:  varchar('context_order_number', { length: 20 }),
  status:              varchar('status', { length: 20 }).default('new').notNull(),
  createdAt:           timestamp('created_at').defaultNow().notNull(),
}, t => ({
  statusIdx:  index('voicemails_status_idx').on(t.status),
  createdIdx: index('voicemails_created_idx').on(t.createdAt),
}))

export const smsOptouts = pgTable('sms_optouts', {
  id:         serial('id').primaryKey(),
  phone:      varchar('phone', { length: 20 }).notNull().unique(),
  reason:     varchar('reason', { length: 20 }).default('stop').notNull(),
  createdAt:  timestamp('created_at').defaultNow().notNull(),
})

export const smsMessages = pgTable('sms_messages', {
  id:          serial('id').primaryKey(),
  phone:       varchar('phone', { length: 20 }).notNull(),
  direction:   varchar('direction', { length: 10 }).notNull(),
  body:        text('body').notNull(),
  twilioSid:   varchar('twilio_sid', { length: 64 }),
  // Marks rows generated by the /admin/sms-tester simulator so the production
  // history loader can exclude them from real customer threads.
  simulated:   boolean('simulated').default(false).notNull(),
  // Optional MMS media URL (Shopify CDN product image) attached to outbound
  // bubbles. Null for plain-text SMS and for inbound rows.
  mediaUrl:    text('media_url'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
}, t => ({
  phoneIdx:   index('sms_messages_phone_idx').on(t.phone, t.createdAt),
  createdIdx: index('sms_messages_created_idx').on(t.createdAt),
  simulatedIdx: index('sms_messages_simulated_idx').on(t.simulated, t.phone, t.createdAt),
}))

export const smsAgeConsent = pgTable('sms_age_consent', {
  phone:        varchar('phone', { length: 20 }).primaryKey(),
  consentedAt:  timestamp('consented_at').defaultNow().notNull(),
  method:       varchar('method', { length: 20 }).default('sms_yes').notNull(),
})

export interface DraftOrderLineItem {
  variantId: string
  title: string
  quantity: number
  unitPriceCents: number
}

export const draftOrders = pgTable('draft_orders', {
  id:                serial('id').primaryKey(),
  shopifyDraftId:    varchar('shopify_draft_id', { length: 64 }).notNull().unique(),
  shopifyInvoiceUrl: text('shopify_invoice_url'),
  channel:           varchar('channel', { length: 10 }).notNull(), // voice | sms
  phone:             varchar('phone', { length: 20 }).notNull(),
  email:             varchar('email', { length: 255 }),
  customerName:      varchar('customer_name', { length: 255 }),
  subtotalCents:     integer('subtotal_cents').notNull(),
  itemCount:         integer('item_count').notNull(),
  lineItems:         json('line_items').$type<DraftOrderLineItem[]>().notNull(),
  status:            varchar('status', { length: 20 }).default('sent').notNull(), // sent | paid | expired | cancelled
  createdAt:         timestamp('created_at').defaultNow().notNull(),
}, t => ({
  phoneIdx:   index('draft_orders_phone_idx').on(t.phone, t.createdAt),
  createdIdx: index('draft_orders_created_idx').on(t.createdAt),
}))
export const returns = pgTable('returns', {
  id:                       serial('id').primaryKey(),
  shopifyReturnId:          varchar('shopify_return_id', { length: 60 }).notNull(),
  shopifyOrderId:           varchar('shopify_order_id', { length: 60 }).notNull(),
  customerGid:              varchar('customer_gid', { length: 60 }).notNull(),
  status:                   varchar('status', { length: 20 }).default('requested').notNull(),
  reason:                   varchar('reason', { length: 40 }),
  reasonNote:               text('reason_note'),
  lineItems:                json('line_items').$type<Array<{
    fulfillmentLineItemId:  string
    orderLineItemId:        string
    title:                  string
    variantTitle:           string | null
    quantity:               number
    unitPriceCents:         number
  }>>().notNull(),
  shopifyReverseDeliveryId: varchar('shopify_reverse_delivery_id', { length: 60 }),
  labelUrl:                 text('label_url'),
  labelCostCents:           integer('label_cost_cents'),
  labelCostEstimatedCents:  integer('label_cost_estimated_cents'),
  trackingNumber:           varchar('tracking_number', { length: 60 }),
  trackingStatus:           varchar('tracking_status', { length: 40 }),
  refundAmountCents:        integer('refund_amount_cents'),
  shopifyRefundId:          varchar('shopify_refund_id', { length: 60 }),
  createdAt:                timestamp('created_at').defaultNow().notNull(),
  updatedAt:                timestamp('updated_at').defaultNow().notNull(),
  labelPurchasedAt:         timestamp('label_purchased_at'),
  receivedAt:               timestamp('received_at'),
  refundedAt:               timestamp('refunded_at'),
  closedAt:                 timestamp('closed_at'),
}, t => ({
  shopifyReturnUq: uniqueIndex('returns_shopify_return_uniq').on(t.shopifyReturnId),
  customerIdx:     index('returns_customer_idx').on(t.customerGid, t.createdAt),
  orderIdx:        index('returns_order_idx').on(t.shopifyOrderId),
  statusIdx:       index('returns_status_idx').on(t.status),
}))

export type ReturnStatus =
  | 'requested'
  | 'approved'
  | 'label_sent'
  | 'in_transit'
  | 'received'
  | 'refunded'
  | 'closed'
  | 'denied'
  | 'canceled'

export const emmaChatSessions = pgTable('emma_chat_sessions', {
  id:                  serial('id').primaryKey(),
  cookieId:            varchar('cookie_id', { length: 40 }).notNull(),
  customerGid:         varchar('customer_gid', { length: 60 }),
  ipHash:              varchar('ip_hash', { length: 64 }),
  userAgent:           varchar('user_agent', { length: 255 }),
  turnCount:           integer('turn_count').default(0).notNull(),
  firstProductHandle:  varchar('first_product_handle', { length: 255 }),
  checkoutUrlShared:   text('checkout_url_shared'),
  checkoutSharedAt:    timestamp('checkout_shared_at'),
  createdAt:           timestamp('created_at').defaultNow().notNull(),
  lastActivityAt:      timestamp('last_activity_at').defaultNow().notNull(),
}, t => ({
  cookieUq:    uniqueIndex('emma_sessions_cookie_uniq').on(t.cookieId),
  customerIdx: index('emma_sessions_customer_idx').on(t.customerGid),
  createdIdx:  index('emma_sessions_created_idx').on(t.createdAt),
}))

export interface EmmaQuickReplyLog {
  question: string
  options: string[]
  mode: string
}

export const emmaChatTurns = pgTable('emma_chat_turns', {
  id:         serial('id').primaryKey(),
  sessionId:  integer('session_id').notNull().references(() => emmaChatSessions.id, { onDelete: 'cascade' }),
  role:       varchar('role', { length: 10 }).notNull(),
  text:       text('text').notNull(),
  hidden:     boolean('hidden').default(false).notNull(),
  products:   json('products').$type<string[]>(),
  quickReply: json('quick_reply').$type<EmmaQuickReplyLog | null>(),
  latencyMs:  integer('latency_ms'),
  createdAt:  timestamp('created_at').defaultNow().notNull(),
}, t => ({
  sessionIdx: index('emma_turns_session_idx').on(t.sessionId, t.createdAt),
}))

export const emmaChatEvents = pgTable('emma_chat_events', {
  id:         serial('id').primaryKey(),
  sessionId:  integer('session_id').notNull().references(() => emmaChatSessions.id, { onDelete: 'cascade' }),
  turnId:     integer('turn_id'),
  kind:       varchar('kind', { length: 30 }).notNull(),
  payload:    json('payload'),
  createdAt:  timestamp('created_at').defaultNow().notNull(),
}, t => ({
  sessionIdx: index('emma_events_session_idx').on(t.sessionId, t.createdAt),
  kindIdx:    index('emma_events_kind_idx').on(t.kind, t.createdAt),
}))

export const ivrVoices = pgTable('ivr_voices', {
  id:        serial('id').primaryKey(),
  name:      varchar('name', { length: 100 }).notNull(),
  voiceId:   varchar('voice_id', { length: 100 }).notNull(),
  notes:     text('notes').default('').notNull(),
  active:    boolean('active').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, t => ({
  voiceIdUq: uniqueIndex('ivr_voices_voice_id_uniq').on(t.voiceId),
  activeIdx: index('ivr_voices_active_idx').on(t.active),
}))

export const colorSwatchCache = pgTable('color_swatch_cache', {
  colorKey:  varchar('color_key', { length: 80 }).primaryKey(),
  label:     varchar('label', { length: 120 }).notNull(),
  hex:       varchar('hex', { length: 7 }),
  source:    varchar('source', { length: 16 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const productCopurchase = pgTable('product_copurchase', {
  id:         serial('id').primaryKey(),
  handleA:    varchar('handle_a', { length: 255 }).notNull(),
  handleB:    varchar('handle_b', { length: 255 }).notNull(),
  count:      integer('count').default(0).notNull(),
  lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
}, t => ({
  pairUnique: uniqueIndex('copurchase_pair_uniq').on(t.handleA, t.handleB),
  handleAIdx: index('copurchase_a_idx').on(t.handleA),
  handleBIdx: index('copurchase_b_idx').on(t.handleB),
}))

// Per-product per-field enrichment cache (Phase 1 rebuild — cost discipline).
// Keyed by (productId, fieldName, voiceHash, promptVersion). On cache hit,
// the import orchestrator skips the generator call entirely. `--mode=full`
// bypasses cache and writes a new row (latest wins on lookup).
export const productEnrichmentCache = pgTable('product_enrichment_cache', {
  id:            serial('id').primaryKey(),
  productId:     varchar('product_id',     { length: 64 }).notNull(),  // Shopify GID
  fieldName:     varchar('field_name',     { length: 64 }).notNull(),  // e.g. tagline, descriptionHtml
  voiceHash:     varchar('voice_hash',     { length: 32 }).notNull(),  // sha1 slice of system+brand voice
  promptVersion: varchar('prompt_version', { length: 16 }).notNull(),  // bumped on prompt-structure changes
  content:       json('content').notNull(),                            // generated payload (shape varies by field)
  model:         varchar('model',          { length: 32 }).notNull(),  // "claude-haiku-4-5-..." / "claude-sonnet-4-..."
  inputTokens:   integer('input_tokens').default(0).notNull(),
  outputTokens:  integer('output_tokens').default(0).notNull(),
  generatedAt:   timestamp('generated_at').defaultNow().notNull(),
}, t => ({
  cacheKeyUniq:    uniqueIndex('enrich_cache_key_uniq').on(t.productId, t.fieldName, t.voiceHash, t.promptVersion),
  productIdx:      index('enrich_cache_product_idx').on(t.productId),
  generatedAtIdx:  index('enrich_cache_generated_idx').on(t.generatedAt),
}))

// ---------------------------------------------------------------------------
// Phase 0 SMS Observability
// ---------------------------------------------------------------------------

/**
 * One row per phone. Created lazily on the first inbound message for that
 * number. Tracks the conversation stage so Phase 1 can route to the right
 * v2 handler without reading back the full turn log.
 */
export const smsConversations = pgTable('sms_conversations', {
  phone:               varchar('phone', { length: 20 }).primaryKey(),
  stage:               varchar('stage', { length: 32 }).notNull().default('GREETING'),
  currentPitchHandle:  text('current_pitch_handle'),
  currentUpsellHandle: text('current_upsell_handle'),
  lastQuoteUrl:        text('last_quote_url'),
  lastQuoteItems:      json('last_quote_items').$type<unknown>(),
  lastQuoteCreatedAt:  timestamp('last_quote_created_at'),
  customerGid:         text('customer_gid'),
  customerFirstName:   text('customer_first_name'),
  customerDefaultZip:  text('customer_default_zip'),
  stageSetAt:          timestamp('stage_set_at').notNull().defaultNow(),
  lastActiveAt:        timestamp('last_active_at').notNull().defaultNow(),
  conversationId:      uuid('conversation_id').notNull().defaultRandom(),
  // Migration 030: Emma discovery state machine + slot accumulator.
  discoveryState:      json('discovery_state').$type<unknown>(),
  discoveredSlots:     json('discovered_slots').$type<Record<string, unknown>>().notNull().default({}),
  // Migration 031: voice-channel pending pdp link awaiting caller permission.
  pendingPdpUrl:       text('pending_pdp_url'),
  // Migration 032: Phase 0 memory primitives.
  // conversation_summary — Haiku-generated 1-2 sentence rolling summary. Updated
  //   fire-and-forget after each turn. Injected into the system prompt so the
  //   agent retains context beyond the HISTORY_LIMIT window. Copied forward on
  //   24h rotation as "From a previous conversation: {summary}".
  conversationSummary: text('conversation_summary'),
  // pitched_handles_log — ordered array (most-recent last) of the last 10 pitched
  //   product handles. Enables "the first one you showed me" resolution.
  pitchedHandlesLog:   text('pitched_handles_log').array(),
}, t => ({
  // Phase 10: customer_gid indexes for cross-channel joins (additive).
  customerGidIdx:       index('sms_conversations_customer_gid_idx').on(t.customerGid),
  customerGidActiveIdx: index('sms_conversations_gid_active_idx').on(t.customerGid, t.lastActiveAt),
}))

/**
/**
 * Free-form telemetry payload attached to an sms_turns row.
 *
 * Extensible by design: new telemetry keys land here without a schema change.
 * Keep entries cheap and reversible — anything operationally critical earns
 * its own column.
 *
 * Current keys:
 *   - gateAdvance: discovery-gate transition signal for SMS skip-rate analytics
 *     (see docs/what-matters-final-signoff.md). Migration 036.
 */
export interface TurnMetadata {
  gateAdvance?: {
    /** Gate before the user's message advanced the machine. Null on the very first turn. */
    from: 'MOOD' | 'WHO' | 'MATTERS' | 'READY' | 'EXPLAIN' | null
    /** Gate after extraction + advanceGate(). */
    to:   'MOOD' | 'WHO' | 'MATTERS' | 'READY' | 'EXPLAIN'
    /** True when the user hit the "Just show me" skip sentinel at any gate. */
    skipped: boolean
    /** Which slot, if any, was newly filled this turn (mood | who | matters). Null if no slot changed. */
    slotFilled: 'mood' | 'who' | 'matters' | null
  }
}

/**
 * One row per SMS turn (inbound + outbound) across both pipelines.
 * The unique index on twilio_message_sid enables idempotent dedup of Twilio
 * retries: the webhook inserts a sentinel inbound row before calling Claude
 * and updates it after; if the SID already exists the insert is a no-op and
 * the caller returns the cached TwiML immediately.
 */
export const smsTurns = pgTable('sms_turns', {
  id:               serial('id').primaryKey(),
  phone:            varchar('phone', { length: 20 }).notNull(),
  conversationId:   uuid('conversation_id').notNull(),
  twilioMessageSid: varchar('twilio_message_sid', { length: 64 }),
  direction:        varchar('direction', { length: 10 }).notNull(),
  stageIn:          varchar('stage_in', { length: 32 }),
  stageOut:         varchar('stage_out', { length: 32 }),
  intent:           varchar('intent', { length: 32 }),
  intentConfidence: real('intent_confidence'),
  customerMsg:      text('customer_msg'),
  emmaMsg:          text('emma_msg'),
  toolCalls:        json('tool_calls').$type<unknown[]>(),
  inputTokens:      integer('input_tokens'),
  outputTokens:     integer('output_tokens'),
  latencyMs:        integer('latency_ms'),
  errors:           json('errors').$type<unknown[]>(),
  fabricationCaught: varchar('fabrication_caught', { length: 32 }),
  pipelineVersion:  varchar('pipeline_version', { length: 8 }).notNull(),
  // Migration 028: channel='sms' (default) or 'web'. Existing rows backfilled to 'sms'.
  channel:          varchar('channel', { length: 8 }).notNull().default('sms'),
  // Migration 030: turn flagged when the engine recognized a vulnerability
  // disclosure and suspended the gate / suppressed the product pitch.
  softBeat:         boolean('soft_beat').notNull().default(false),
  // Migration 032: set true when the Sonnet loop exhausted MAX_TOOL_HOPS with a
  // pending tool_use stop_reason — no final text was generated, safeFallback ran.
  // Powers the "tool budget exhausted rate" dashboard query in Phase 3.
  toolBudgetExhausted: boolean('tool_budget_exhausted').notNull().default(false),
  // Migration 033: set true when the dedup filter returned all_results_previously_pitched
  // (every search result was already in pitchedHandlesLog). Distinct from toolBudgetExhausted.
  // Powers the "repeat-pitch rate" dashboard query in Phase 3.
  searchRepeatedPitch: boolean('search_repeated_pitch').notNull().default(false),
  // Migration 036: free-form telemetry payload. Initial usage carries the SMS
  // discovery-gate advance signal (from, to, skipped, slotFilled) for skip-rate
  // analytics. Extensible — future per-turn telemetry can land here without
  // schema changes. See docs/what-matters-final-signoff.md.
  metadata:         json('metadata').$type<TurnMetadata>(),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
}, t => ({
  twilioSidUniq:    uniqueIndex('sms_turns_twilio_sid_uniq').on(t.twilioMessageSid),
  phoneCreatedIdx:  index('sms_turns_phone_created_idx').on(t.phone, t.createdAt),
  channelCreatedIdx: index('sms_turns_channel_idx').on(t.channel, t.createdAt),
}))

// ---------------------------------------------------------------------------
// Phase 8: Web chat v2 engine
// ---------------------------------------------------------------------------

/**
 * One row per web chat session (cookie-based). Mirrors sms_conversations but
 * keyed by session_id (UUID cookie) instead of phone number.
 * Migration 027.
 */
export const webConversations = pgTable('web_conversations', {
  sessionId:           varchar('session_id', { length: 64 }).primaryKey(),
  stage:               varchar('stage', { length: 32 }).notNull().default('GREETING'),
  currentPitchHandle:  text('current_pitch_handle'),
  currentUpsellHandle: text('current_upsell_handle'),
  lastQuoteUrl:        text('last_quote_url'),
  lastQuoteItems:      json('last_quote_items').$type<unknown>(),
  lastQuoteCreatedAt:  timestamp('last_quote_created_at'),
  customerGid:         text('customer_gid'),
  customerFirstName:   text('customer_first_name'),
  customerDefaultZip:  text('customer_default_zip'),
  pageHandle:          text('page_handle'),
  pageRoute:           text('page_route'),
  stageSetAt:          timestamp('stage_set_at').notNull().defaultNow(),
  lastActiveAt:        timestamp('last_active_at').notNull().defaultNow(),
  conversationId:      uuid('conversation_id').notNull().defaultRandom(),
  // Migration 030: Emma discovery state machine + slot accumulator (web parity).
  discoveryState:      json('discovery_state').$type<unknown>(),
  discoveredSlots:     json('discovered_slots').$type<Record<string, unknown>>().notNull().default({}),
  // Migration 031: pending pdp link awaiting caller permission (voice; reserved for web).
  pendingPdpUrl:       text('pending_pdp_url'),
  // Migration 032: Phase 0 memory primitives — mirror of sms_conversations columns.
  // Added now to avoid Phase 2 schema reconciliation cost when the participants
  // table aligns SMS and web identity.
  conversationSummary: text('conversation_summary'),
  pitchedHandlesLog:   text('pitched_handles_log').array(),
}, t => ({
  // Phase 10: customer_gid indexes for cross-channel joins (additive).
  customerGidIdx:       index('web_conversations_customer_gid_idx').on(t.customerGid),
  customerGidActiveIdx: index('web_conversations_gid_active_idx').on(t.customerGid, t.lastActiveAt),
}))

// Migration 032: internal /admin/emma-chat — Emma as product SME for drafting Reddit replies.
// Append-only message log; assistant rows carry tool_use blocks Claude emitted,
// tool rows carry the tool_result payloads we returned in the next turn.

export type EmmaChatToolCall = {
  id: string
  name: string
  input: Record<string, unknown>
}

export type EmmaChatToolResult = {
  tool_use_id: string
  content: string
  is_error?: boolean
}

export const emmaChatThreads = pgTable('emma_chat_threads', {
  id:                serial('id').primaryKey(),
  title:             varchar('title', { length: 200 }).notNull().default('New thread'),
  redditPostUrl:     text('reddit_post_url'),
  redditPostExcerpt: text('reddit_post_excerpt'),
  archived:          boolean('archived').notNull().default(false),
  // Migration 038: discriminator so a second admin chat persona (product
  // manager) can share this table. Existing rows default to 'emma'.
  agentType:         varchar('agent_type', { length: 20 }).notNull().default('emma'),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
}, t => ({
  updatedIdx: index('emma_chat_threads_updated_idx').on(t.updatedAt),
  activeIdx:  index('emma_chat_threads_active_idx').on(t.archived, t.updatedAt),
}))

export const emmaChatMessages = pgTable('emma_chat_messages', {
  id:           serial('id').primaryKey(),
  threadId:     integer('thread_id').notNull().references(() => emmaChatThreads.id, { onDelete: 'cascade' }),
  role:         varchar('role', { length: 10 }).notNull(), // 'user' | 'assistant' | 'tool'
  content:      text('content').notNull().default(''),
  toolCalls:    json('tool_calls').$type<EmmaChatToolCall[]>(),
  toolResults:  json('tool_results').$type<EmmaChatToolResult[]>(),
  stopReason:   varchar('stop_reason', { length: 20 }),
  inputTokens:  integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  latencyMs:    integer('latency_ms'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, t => ({
  threadIdx: index('emma_chat_messages_thread_idx').on(t.threadId, t.createdAt),
}))

// ---------------------------------------------------------------------------
// Pricing Agent v2 — group hierarchy, rules, and audit log (migration 035)
// ---------------------------------------------------------------------------

export const pricingGroups = pgTable('pricing_groups', {
  id:                 text('id').primaryKey(),
  name:               text('name').notNull(),
  usesClearanceLadder: boolean('uses_clearance_ladder').notNull().default(false),
  sortOrder:          integer('sort_order').notNull().default(0),
})

export const pricingSubGroups = pgTable('pricing_sub_groups', {
  id:        text('id').primaryKey(),
  groupId:   text('group_id').notNull().references(() => pricingGroups.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
}, t => ({
  groupIdx: index('pricing_sub_groups_group_idx').on(t.groupId),
}))

export const pricingProductTypeMap = pgTable('pricing_product_type_map', {
  productType: text('product_type').primaryKey(),
  subGroupId:  text('sub_group_id').notNull().references(() => pricingSubGroups.id, { onDelete: 'cascade' }),
}, t => ({
  subGroupIdx: index('pricing_product_type_map_sub_group_idx').on(t.subGroupId),
}))

// NULL on any margin/behavior column means "inherit from parent scope."
export const pricingRules = pgTable('pricing_rules', {
  scopeLevel:              text('scope_level').notNull(),
  scopeId:                 text('scope_id').notNull(),
  targetMarginPct:         decimal('target_margin_pct', { precision: 5, scale: 4 }),
  marginFloorPct:          decimal('margin_floor_pct',  { precision: 5, scale: 4 }),
  mapBehavior:             text('map_behavior'),
  compareAtStrategy:       text('compare_at_strategy'),
  velocityModifierEnabled: boolean('velocity_modifier_enabled'),
  updatedAt:               timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy:               text('updated_by'),
}, t => ({
  pk: uniqueIndex('pricing_rules_pk').on(t.scopeLevel, t.scopeId),
}))

export const pricingAuditLog = pgTable('pricing_audit_log', {
  id:           bigserial('id', { mode: 'number' }).primaryKey(),
  occurredAt:   timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  variantId:    text('variant_id').notNull(),
  sku:          text('sku'),
  productType:  text('product_type'),
  groupId:      text('group_id'),
  subGroupId:   text('sub_group_id'),
  trigger:      text('trigger').notNull(),
  oldCost:      decimal('old_cost',       { precision: 10, scale: 2 }),
  newCost:      decimal('new_cost',       { precision: 10, scale: 2 }),
  oldMap:       decimal('old_map',        { precision: 10, scale: 2 }),
  newMap:       decimal('new_map',        { precision: 10, scale: 2 }),
  oldMsrp:      decimal('old_msrp',       { precision: 10, scale: 2 }),
  newMsrp:      decimal('new_msrp',       { precision: 10, scale: 2 }),
  oldSell:      decimal('old_sell',       { precision: 10, scale: 2 }),
  newSell:      decimal('new_sell',       { precision: 10, scale: 2 }),
  oldCompareAt: decimal('old_compare_at', { precision: 10, scale: 2 }),
  newCompareAt: decimal('new_compare_at', { precision: 10, scale: 2 }),
  marginBefore: decimal('margin_before',  { precision: 6, scale: 4 }),
  marginAfter:  decimal('margin_after',   { precision: 6, scale: 4 }),
  status:       text('status').notNull(),
  rationale:    text('rationale'),
}, t => ({
  variantIdx:  index('pricing_audit_log_variant_idx').on(t.variantId, t.occurredAt),
  occurredIdx: index('pricing_audit_log_occurred_idx').on(t.occurredAt),
}))

// ---------------------------------------------------------------------------
// Discovery rules — curator-controlled exclusions and fallback pins (migration 037)
// ---------------------------------------------------------------------------

/**
 * One row per curator-defined rule. rule_type is a TS union, not a DB enum,
 * to keep future rule additions migration-free.
 *
 * Valid rule_type values (enforced in app/types/discovery.ts):
 *   exclude_product       -- rule_value = product handle
 *   exclude_product_type  -- rule_value = ProductTypeDial value (e.g. "vibrator")
 *   exclude_keyword       -- rule_value = case-insensitive title substring
 *   exclude_price_min     -- rule_value = "25" (hide products priced BELOW this)
 *   exclude_price_max     -- rule_value = "300" (hide products priced ABOVE this)
 *   pin_fallback          -- rule_value = product handle; category is required
 */
export const discoveryRules = pgTable('discovery_rules', {
  id:         serial('id').primaryKey(),
  ruleType:   varchar('rule_type', { length: 40 }).notNull(),
  ruleValue:  text('rule_value').notNull(),
  category:   varchar('category', { length: 20 }),  // null = all categories
  sortOrder:  integer('sort_order').default(0).notNull(),
  notes:      text('notes'),
  active:     boolean('active').default(true).notNull(),
  createdAt:  timestamp('created_at').defaultNow().notNull(),
  updatedAt:  timestamp('updated_at').defaultNow().notNull(),
}, t => ({
  activeTypeIdx: index('idx_discovery_rules_active_type').on(t.active, t.ruleType),
}))

export const pricingChanges = pgTable('pricing_changes', {
  id:           bigserial('id', { mode: 'number' }).primaryKey(),
  proposedAt:   timestamp('proposed_at', { withTimezone: true }).notNull().defaultNow(),
  runDate:      date('run_date').notNull(),
  sku:          text('sku').notNull(),
  productId:    text('product_id').notNull(),
  productHandle: text('product_handle'),
  productTitle: text('product_title'),
  variantId:    text('variant_id').notNull(),
  variantTitle: text('variant_title'),
  vendor:       text('vendor'),
  tier:         text('tier').notNull(),
  oldPrice:     decimal('old_price', { precision: 10, scale: 2 }),
  newPrice:     decimal('new_price', { precision: 10, scale: 2 }).notNull(),
  oldCompareAt: decimal('old_compare_at', { precision: 10, scale: 2 }),
  newCompareAt: decimal('new_compare_at', { precision: 10, scale: 2 }),
  oldWholesale: decimal('old_wholesale', { precision: 10, scale: 2 }),
  newWholesale: decimal('new_wholesale', { precision: 10, scale: 2 }),
  mapPrice:     decimal('map_price', { precision: 10, scale: 2 }),
  marginPct:    decimal('margin_pct', { precision: 6, scale: 4 }),
  reason:       text('reason').notNull(),
  mapRespected: boolean('map_respected').notNull().default(true),
  status:       text('status').notNull().default('pending'),
  appliedAt:    timestamp('applied_at', { withTimezone: true }),
  approvedBy:   text('approved_by'),
  applyError:   text('apply_error'),
}, t => ({
  runDateIdx:  index('pricing_changes_run_date_idx').on(t.runDate),
  statusIdx:   index('pricing_changes_status_idx').on(t.status),
  variantIdx:  index('pricing_changes_variant_idx').on(t.variantId, t.proposedAt),
  skuIdx:      index('pricing_changes_sku_idx').on(t.sku, t.proposedAt),
}))

// ---------------------------------------------------------------------------
// Nalpac price history — WS3a cost-sync loop (migration 061, ADR-007)
// ---------------------------------------------------------------------------

/**
 * Last-observed Nalpac feed snapshot per CARRIED sku. Upsert-keyed by sku --
 * NOT an append-per-day history table. cost-sync.server.ts (runNalpacCostSync)
 * diffs today's feed snapshot against this row to detect a material
 * wholesale/MAP drop and decide whether to sync + reprice through the v2
 * pricing engine. Bound to the carried catalog only (never all ~15,500 feed
 * SKUs). synced_at is the last time a cost-sync actually fired for this sku
 * (day-scoped idempotency, gated by the pricing_costsync_enabled kill switch).
 * See docs/adr/ADR-007-pricing-engine-convergence.md.
 */
export const nalpacPriceHistory = pgTable('nalpac_price_history', {
  sku:               varchar('sku', { length: 64 }).primaryKey(),
  wholesale:         decimal('wholesale', { precision: 10, scale: 2 }),
  msrp:              decimal('msrp', { precision: 10, scale: 2 }),
  mapPrice:          decimal('map_price', { precision: 10, scale: 2 }),
  salePrice:         decimal('sale_price', { precision: 10, scale: 2 }),
  qty:               integer('qty'),
  nalpacDiscountPct: decimal('nalpac_discount_pct', { precision: 5, scale: 2 }),
  inTop100:          boolean('in_top100').notNull().default(false),
  inNew:             boolean('in_new').notNull().default(false),
  inSale:            boolean('in_sale').notNull().default(false),
  observedAt:        timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
  syncedAt:          timestamp('synced_at', { withTimezone: true }),
}, t => ({
  syncedIdx: index('nalpac_price_history_synced_idx').on(t.syncedAt),
}))

// ---------------------------------------------------------------------------
// Nalpac import automation — daily candidate queue + run audit (migration 038)
// ---------------------------------------------------------------------------

/**
 * One LIVE row per Nalpac SKU we don't yet carry. The daily monitor upserts on
 * sku; the /admin/imports dashboard works the pending/watching rows.
 * status: pending | approved | rejected | watching | imported | skipped
 * (TS union, not a DB enum — see app/types or call sites).
 */
export const importCandidates = pgTable('import_candidates', {
  id:              serial('id').primaryKey(),
  sku:             varchar('sku', { length: 20 }).notNull().unique(),
  brand:           varchar('brand', { length: 100 }),
  productTitle:    text('product_title'),
  categories:      json('categories').$type<string[]>(),
  tier:            varchar('tier', { length: 10 }).notNull(),  // 'A'|'B'|'C'|'D'
  gapReason:       text('gap_reason'),
  dealScore:       decimal('deal_score',      { precision: 5,  scale: 3 }),
  msrp:            decimal('msrp',            { precision: 10, scale: 2 }),
  wholesaleCost:   decimal('wholesale_cost',  { precision: 10, scale: 2 }),
  mapPrice:        decimal('map_price',       { precision: 10, scale: 2 }),
  proposedPrice:   decimal('proposed_price',  { precision: 10, scale: 2 }),
  marginPct:       decimal('margin_pct',      { precision: 5,  scale: 2 }),
  profitPerUnit:   decimal('profit_per_unit', { precision: 10, scale: 2 }),
  qtyAvailable:    integer('qty_available'),
  imageCount:      integer('image_count'),
  inTop100Feed:    boolean('in_top100_feed').notNull().default(false),
  inNewFeed:       boolean('in_new_feed').notNull().default(false),
  inSaleFeed:      boolean('in_sale_feed').notNull().default(false),
  status:          varchar('status', { length: 20 }).notNull().default('pending'),
  rejectionReason: text('rejection_reason'),
  watchScore:      decimal('watch_score', { precision: 5,  scale: 3 }),
  watchPrice:      decimal('watch_price', { precision: 10, scale: 2 }),
  dealHistoryId:   integer('deal_history_id'),
  runDate:         date('run_date').notNull(),
  firstSeenAt:     timestamp('first_seen_at').notNull().defaultNow(),
  lastSeenAt:      timestamp('last_seen_at').notNull().defaultNow(),
  reviewedAt:      timestamp('reviewed_at'),
  reviewedBy:      varchar('reviewed_by', { length: 100 }),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
  // Migration 039: master-level columns (one row per brand+base_title group).
  masterKey:       varchar('master_key', { length: 200 }),
  baseTitle:       text('base_title'),
  variantSkus:     json('variant_skus').$type<string[]>(),
  variantCount:    integer('variant_count'),
  inStockVariants: integer('in_stock_variants'),
  colors:          json('colors').$type<string[]>(),
  sizes:           json('sizes').$type<string[]>(),
  volumes:         json('volumes').$type<string[]>(),
  axes:            json('axes').$type<{ name: string; values: string[] }[]>(),
  totalQty:        integer('total_qty'),
  needsReview:     boolean('needs_review').notNull().default(false),
  upc:             varchar('upc', { length: 40 }),
  sampleImage:     text('sample_image'),
  // Migration 040: post-import lifecycle (enrich -> publish). `status='imported'`
  // stays terminal; these timestamps track the stages after import.
  enrichedAt:      timestamp('enriched_at'),
  publishedAt:     timestamp('published_at'),
  enrichBatchId:   varchar('enrich_batch_id', { length: 100 }),
  // Migration 060: bounded-retry quality gate. enrichAttempts counts gate
  // failures; enrichFailedAt is set once the retry cap (2) is hit, parking the
  // row (enrichBatchId is left set so it is neither re-submitted nor published).
  enrichAttempts:  integer('enrich_attempts').notNull().default(0),
  enrichFailedAt:  timestamp('enrich_failed_at'),
}, t => ({
  statusRunIdx:   index('idx_import_candidates_status_run').on(t.status, t.runDate),
  tierScoreIdx:   index('idx_import_candidates_tier_score').on(t.tier, t.dealScore),
  masterKeyIdx:   uniqueIndex('idx_import_candidates_master_key').on(t.masterKey),
  enrichIdx:      index('idx_import_candidates_enrich').on(t.status, t.enrichedAt),
}))

/** One row per monitor run (cron or manual) — audit trail for the dashboard header. */
export const importMonitorRuns = pgTable('import_monitor_runs', {
  id:                   serial('id').primaryKey(),
  runDate:              date('run_date').notNull(),
  startedAt:            timestamp('started_at').notNull().defaultNow(),
  finishedAt:           timestamp('finished_at'),
  source:               varchar('source', { length: 20 }).notNull().default('cron'),  // 'cron'|'manual'
  feedsOk:              boolean('feeds_ok').notNull().default(false),
  candidatesFound:      integer('candidates_found').notNull().default(0),
  candidatesNew:        integer('candidates_new').notNull().default(0),
  candidatesResurfaced: integer('candidates_resurfaced').notNull().default(0),
  autoImported:         integer('auto_imported').notNull().default(0),
  errorMessage:         text('error_message'),
}, t => ({
  runDateIdx: index('idx_import_monitor_runs_date').on(t.runDate),
}))

/**
 * One row per submitted Anthropic Message Batch for post-import enrichment.
 * Vercel functions cap at 60s, so the enrich cron submits a batch on one tick
 * and collects it on a later tick — this table is the durable handoff.
 */
export const enrichmentBatches = pgTable('enrichment_batches', {
  id:           serial('id').primaryKey(),
  batchId:      varchar('batch_id', { length: 100 }).notNull().unique(),
  status:       varchar('status', { length: 20 }).notNull().default('pending'),  // 'pending'|'collected'|'failed'
  candidateIds: json('candidate_ids').$type<number[]>().notNull(),
  productIds:   json('product_ids').$type<string[]>().notNull(),
  succeeded:    integer('succeeded').notNull().default(0),
  failed:       integer('failed').notNull().default(0),
  error:        text('error'),
  submittedAt:  timestamp('submitted_at').notNull().defaultNow(),
  collectedAt:  timestamp('collected_at'),
}, t => ({
  statusIdx: index('idx_enrichment_batches_status').on(t.status, t.submittedAt),
}))

// ---------------------------------------------------------------------------
// Enrichment batch jobs + API token spend logging (migrations 042/043)
// ---------------------------------------------------------------------------

/**
 * Per-product runner state stored in batch_jobs.runner_state[productId].
 * The messages array mirrors the turn loop in emma-orchestrator.server.ts.
 * llmClient is NEVER serialized here (it is a class instance; strip before insert).
 */
export interface ProductRunnerState {
  productId:            string           // Shopify GID
  sku:                  string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages:             Array<{ role: 'user' | 'assistant'; content: any }>
  calledTools:          string[]         // dedupe set
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  writes:               Record<string, any>  // Partial<ProductWrites> — typed at call site
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  telemetry:            Record<string, any>  // OrchestratorTelemetry — typed at call site
  finished:             boolean
  turns:                number           // requests submitted (pre-increment, mirrors real loop)
  status:               'running' | 'done' | 'error'
  error?:               string
  lastBatchCustomId?:   string           // `${jobId}__${productId}` — crash-recovery skip guard
  lastProcessedBatchId?: string          // matches current_batch_id on a completed product
  requestRetries:       number           // per-request batch error retry counter (cap 2)
  applyRetries:         number           // Shopify-push failure counter in 'applying' (cap 3)
}

/**
 * Brief stored in batch_jobs.products[]. Does NOT include llmClient (stripped
 * before insert in enqueueBatchJob — llmClient is a class instance, not JSON-serializable).
 */
export interface BatchJobProduct {
  productId:  string    // Shopify GID
  sku:        string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input:      Record<string, any>  // OrchestratorInput minus llmClient; typed at call site
  via:        'batch'              // always 'batch' for runner jobs
}

/** Terminal per-product result stored in batch_jobs.results[]. */
export interface BatchJobProductResult {
  productId:      string
  sku:            string
  ok:             boolean
  writesApplied?: boolean
  applyRetries?:  number
  error?:         string
}

/**
 * Registry of async enrichment jobs. One row per enqueued enrichment request
 * (single product or bulk). The lockstep batched runner advances each job
 * one Anthropic batch per poller tick.
 */
export const batchJobs = pgTable('batch_jobs', {
  id:              serial('id').primaryKey(),
  jobId:           varchar('job_id', { length: 64 }).notNull(),
  jobType:         varchar('job_type', { length: 32 }).notNull(),   // 'full-enrichment' | 'emma-take' | 'emma-hero' | 'regenerate'
  status:          varchar('status', { length: 20 }).default('queued').notNull(), // queued | submitted | processing | applying | done | failed
  source:          varchar('source', { length: 32 }).notNull(),     // entry point: 'bulk-import' | 'import-product' | 'deal-manager' | 'backfill' | ...
  skuList:         json('sku_list').$type<string[]>().notNull(),
  products:        json('products').$type<BatchJobProduct[]>().notNull(),
  turn:            integer('turn').default(0).notNull(),
  maxTurns:        integer('max_turns').default(24).notNull(),
  batchIds:        json('batch_ids').$type<string[]>().default([]).notNull(),
  currentBatchId:  varchar('current_batch_id', { length: 64 }),
  // Keyed by productId (Shopify GID). The runner persists each product
  // incrementally for crash-recovery within a turn (see C3a in spec).
  runnerState:     json('runner_state').$type<Record<string, ProductRunnerState>>().default({}).notNull(),
  results:         json('results').$type<BatchJobProductResult[]>(),
  error:           text('error'),
  gatesDealId:     integer('gates_deal_id'),    // dealHistory.id this job gates (nullable)
  appliedSkus:     json('applied_skus').$type<string[]>().default([]).notNull(),
  createdAt:       timestamp('created_at').defaultNow().notNull(),
  submittedAt:     timestamp('submitted_at'),
  updatedAt:       timestamp('updated_at').defaultNow().notNull(),
  completedAt:     timestamp('completed_at'),
  failedAt:        timestamp('failed_at'),
}, t => ({
  jobIdIdx:      uniqueIndex('uq_batch_jobs_job_id').on(t.jobId),
  statusIdx:     index('idx_batch_jobs_status').on(t.status, t.createdAt),
  // Partial index mirrors the SQL migration for the poller drain query.
  // Drizzle does not support partial indexes via the builder; the SQL migration
  // creates idx_batch_jobs_inflight directly. Listed here for documentation only.
  gatesDealIdx:  index('idx_batch_jobs_gates_deal').on(t.gatesDealId),
}))

/**
 * Central per-call token-spend log for every Anthropic API-key call.
 * Written best-effort from logApiTokens(); a write failure must never
 * throw into or unwind a real API call.
 *
 * The view api_token_daily (created in migration 043) is queried with raw SQL
 * via getDailyTokenRollup() in token-log.server.ts -- Drizzle has no view model.
 */
export const apiTokenLog = pgTable('api_token_log', {
  id:                   serial('id').primaryKey(),
  ts:                   timestamp('ts').defaultNow().notNull(),
  feature:              varchar('feature', { length: 48 }).notNull(),   // 'enrichment' | 'emma-chat' | 'sms' | 'ivr' | 'copy-gen' | ...
  model:                varchar('model', { length: 64 }).notNull(),
  source:               varchar('source', { length: 16 }).notNull(),    // 'batch' | 'sync' | 'agent-sdk'
  batchId:              varchar('batch_id', { length: 64 }),
  productId:            varchar('product_id', { length: 64 }),
  sku:                  varchar('sku', { length: 32 }),
  caller:               varchar('caller', { length: 96 }),
  inputTokens:          integer('input_tokens').default(0).notNull(),
  outputTokens:         integer('output_tokens').default(0).notNull(),
  cacheCreationTokens:  integer('cache_creation_tokens').default(0).notNull(),
  cacheReadTokens:      integer('cache_read_tokens').default(0).notNull(),
  requestCount:         integer('request_count').default(1).notNull(),  // >1 when one row aggregates a batch turn
  estCostUsd:           decimal('est_cost_usd', { precision: 10, scale: 5 }).default('0').notNull(),
  requestId:            varchar('request_id', { length: 64 }),          // IVR idempotency key (option B); null otherwise
  refId:                varchar('ref_id', { length: 64 }),              // correlation key (video_jobs.job_id, ad batch id); null otherwise (065)
}, t => ({
  tsIdx:        index('idx_api_token_log_ts').on(t.ts),
  featureTsIdx: index('idx_api_token_log_feature_ts').on(t.feature, t.ts),
  // Partial unique index for IVR idempotency (uq_api_token_log_request_id) and
  // the batch_id index are created in the SQL migration (Drizzle partial index
  // limitation). Listed here for documentation.
}))

/**
 * Durable write-before-send outbox for Meta Conversions API (CAPI) Purchase
 * events (renamed from meta_capi_failures, suggestion #592). Purchase is the
 * revenue-critical conversion signal; a CAPI POST must not be silently dropped.
 * purchase-capi.server.ts inserts a row BEFORE every send and stamps resolved_at
 * when it lands, so an unresolved row means "in flight or failed", not "failed" —
 * which is why "failures" misled and this is now an outbox. The profit-summary
 * cron drains unresolved rows (bounded attempts). One row per order (unique
 * order_id) keeps drains and webhook retries idempotent.
 */
export const metaCapiOutbox = pgTable('meta_capi_outbox', {
  id:         serial('id').primaryKey(),
  orderId:    varchar('order_id', { length: 64 }).notNull().unique(),
  eventId:    varchar('event_id', { length: 128 }).notNull(),
  payload:    jsonb('payload').notNull(),
  attempts:   integer('attempts').notNull().default(0),
  lastError:  text('last_error'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at'),
}, t => ({
  unresolvedIdx: index('idx_meta_capi_failures_unresolved').on(t.createdAt),
}))

// GA4 Measurement Protocol purchase-send outbox (renamed from
// ga4_purchase_failures, suggestion #592), drained by the profit-summary cron.
// Mirrors meta_capi_outbox.
export const ga4PurchaseOutbox = pgTable('ga4_purchase_outbox', {
  id:         serial('id').primaryKey(),
  orderId:    varchar('order_id', { length: 64 }).notNull().unique(),
  payload:    jsonb('payload').notNull(),
  attempts:   integer('attempts').notNull().default(0),
  lastError:  text('last_error'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at'),
}, t => ({
  unresolvedIdx: index('idx_ga4_purchase_failures_unresolved').on(t.createdAt),
}))

/**
 * Durable backstop for the precomputed Variant A homepage payload. KV is the
 * fast path; this table survives KV eviction so a Googlebot crawl on a cold
 * instance reads ONE indexed row instead of fanning out to 5+ upstreams.
 * Exactly one current row per (variant, version) — upserted on the unique
 * index. The `payload` JSON column holds the JSON-safe HomepagePayloadA blob
 * (no Map/Set/Date inside); `built_at` is separate row metadata.
 * See app/lib/homepage-payload.server.ts.
 */
export const homepagePayload = pgTable('homepage_payload', {
  id:        serial('id').primaryKey(),
  variant:   varchar('variant', { length: 8 }).notNull(),   // 'a' | 'b' (room for 'legacy')
  version:   varchar('version', { length: 16 }).notNull(),  // HOMEPAGE_PAYLOAD_VERSION / _B_VERSION
  // Discriminated by `variant` — readers narrow on the row's variant column.
  payload:   json('payload').$type<HomepagePayloadA | HomepagePayloadB>().notNull(),
  degraded:  boolean('degraded').notNull().default(false),
  builtAt:   timestamp('built_at').notNull().defaultNow(),
}, t => ({
  variantVersionUniq: uniqueIndex('homepage_payload_variant_version_uniq').on(t.variant, t.version),
}))

/**
 * Durable backstop for the discovery product index (~3K SKUs). KV is the fast
 * path; this table survives KV eviction so a cold instance reads one indexed
 * row instead of getDiscoveryIndex() returning [] and rendering an empty
 * storefront (which then gets edge-cached). Exactly one current row per
 * version, upserted on the unique index. `index_json` holds the JSON-safe
 * DiscoveryProduct[] array; `vocab_json` holds the derived DiscoveryVocab so
 * a Neon-fallback read can re-seed both KV keys in one round trip.
 * See app/lib/discovery.server.ts.
 */
export const discoveryIndexPayload = pgTable('discovery_index_payload', {
  id:        serial('id').primaryKey(),
  version:   varchar('version', { length: 16 }).notNull().unique(),  // INDEX_VERSION
  indexJson: json('index_json').notNull(),                            // DiscoveryProduct[]
  vocabJson: json('vocab_json').notNull(),                            // DiscoveryVocab
  count:     integer('count').notNull().default(0),
  builtAt:   timestamp('built_at').notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Autonomous homepage merchandising team (migration 049)
// Control plane only. Spend lives in api_token_log, not here.
// ---------------------------------------------------------------------------

/**
 * One row per team run. Originally homepage-only (049); migration 051 adds a
 * `team` column so every store team (homepage|social|ads|email|strategy)
 * shares the same run/event/gate machinery.
 */
export const homepageTeamRuns = pgTable('homepage_team_runs', {
  id:           serial('id').primaryKey(),
  team:         varchar('team', { length: 24 }).notNull().default('homepage'),
  runType:      varchar('run_type', { length: 24 }).notNull(),        // merchandise|design|manual|social|ads|email|strategy|apply
  status:       varchar('status', { length: 16 }).notNull().default('running'),
  currentPhase: varchar('current_phase', { length: 48 }),
  currentAgent: varchar('current_agent', { length: 48 }),
  summary:      text('summary'),
  prUrl:        text('pr_url'),
  error:        text('error'),
  attemptCount: integer('attempt_count').notNull().default(1),
  startedAt:    timestamp('started_at').notNull().defaultNow(),
  finishedAt:   timestamp('finished_at'),
}, t => ({
  startedIdx: index('idx_homepage_team_runs_started').on(t.startedAt),
  statusIdx:  index('idx_homepage_team_runs_status').on(t.status, t.startedAt),
  teamIdx:    index('idx_team_runs_team').on(t.team, t.startedAt),
}))

/** Per-step/agent activity feed — dashboard timeline + conversation viewer. */
export const homepageTeamEvents = pgTable('homepage_team_events', {
  id:            serial('id').primaryKey(),
  runId:         integer('run_id').notNull().references(() => homepageTeamRuns.id, { onDelete: 'cascade' }),
  ts:            timestamp('ts').notNull().defaultNow(),
  agentRole:     varchar('agent_role', { length: 48 }),
  phase:         varchar('phase', { length: 48 }),
  eventType:     varchar('event_type', { length: 16 }).notNull(),     // step|message|tool|decision|error
  summary:       text('summary').notNull(),
  transcriptRef: text('transcript_ref'),                              // Vercel Blob key
}, t => ({
  runIdx: index('idx_homepage_team_events_run').on(t.runId, t.ts),
}))

/**
 * The store-wide improvement bus (051). Agents write `proposed` rows; the owner
 * approves/dismisses from the dashboard; agent-editor turns approved
 * instruction-kind rows into PRs (`pr_open`) which the owner merges (`applied`).
 * `target_team` routes a suggestion at another team; NULL means "own team".
 *
 * The proposed->approved triage step can be automated per acting-team via the
 * `{team}_team_auto_approve_suggestions` valve (062): when on, createSuggestion
 * writes the row straight to `approved` with `decided_by = 'auto'`. Downstream
 * execution gates (agent-editor PR merge, manual campaign/promo/code steps) are
 * unchanged. `decided_by`: 'auto' (valve) | 'owner' (dashboard) | NULL (legacy).
 *
 * Migration 070 extends the bus into a ticket system: assignment + expiring
 * claims, `priority` (1 = highest), `dedupe_key` (partial-unique while the
 * ticket is live, so a recurring signal reopens one ticket instead of filing
 * a new one every run), dependency links, retry accounting, and verification.
 * Only `priority` and `dedupe_key` are written today, by the daily SEO
 * diagnosis; the claim/transition engine ships separately.
 */
export const homepageTeamSuggestions = pgTable('homepage_team_suggestions', {
  id:            serial('id').primaryKey(),
  runId:         integer('run_id').references(() => homepageTeamRuns.id, { onDelete: 'set null' }),
  team:          varchar('team', { length: 24 }).notNull().default('homepage'),
  targetTeam:    varchar('target_team', { length: 24 }),
  category:      varchar('category', { length: 32 }).notNull(),       // model|turns|caching|prompt|agents|other
  kind:          varchar('kind', { length: 16 }).notNull().default('process'), // process|strategy|instructions|agent-def|config|code|campaign|promo|program
  suggestion:    text('suggestion').notNull(),
  estSavingsUsd: decimal('est_savings_usd', { precision: 10, scale: 4 }).notNull().default('0'),
  cxRisk:        varchar('cx_risk', { length: 8 }).notNull().default('low'), // low|med|high
  status:        varchar('status', { length: 16 }).notNull().default('proposed'), // proposed|approved|pr_open|applied|dismissed
  applyRef:      text('apply_ref'),                                   // PR URL / applied artifact
  decidedBy:     varchar('decided_by', { length: 24 }),               // auto|owner|NULL — who moved it off 'proposed'
  decidedAt:     timestamp('decided_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  // ── ticket system (070) ──────────────────────────────────────────────────
  assignee:       varchar('assignee', { length: 32 }),                // agent id or 'owner'
  claimedAt:      timestamp('claimed_at', { withTimezone: true }),
  claimExpiresAt: timestamp('claim_expires_at', { withTimezone: true }),
  priority:       smallint('priority').notNull().default(3),          // 1 highest .. 5 lowest
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  dueAt:          timestamp('due_at', { withTimezone: true }),
  dedupeKey:      varchar('dedupe_key', { length: 64 }),              // partial-unique while live
  supersedesId:   integer('supersedes_id'),
  blockedById:    integer('blocked_by_id'),
  attemptCount:   integer('attempt_count').notNull().default(0),
  lastError:      text('last_error'),
  /**
   * Why a ticket is `blocked`, as a queryable class rather than prose (089).
   * R-DEV already names it in the transition note; this is the half a router
   * can read. See TICKET_BLOCK_CLASSES in app/lib/team.server.ts.
   */
  blockClass:     varchar('block_class', { length: 24 }),
  verifiedBy:     varchar('verified_by', { length: 32 }),
  verifiedAt:     timestamp('verified_at', { withTimezone: true }),
}, t => ({
  statusIdx:   index('idx_homepage_team_suggestions_status').on(t.status, t.createdAt),
  teamIdx:     index('idx_team_sugg_team').on(t.team, t.status, t.createdAt),
  assigneeIdx: index('idx_team_sugg_assignee_queue').on(t.assignee, t.status, t.priority, t.createdAt),
  priorityIdx: index('idx_team_sugg_priority_queue').on(t.status, t.priority, t.createdAt),
}))

/**
 * Outbound links from a ticket (070): the PR that implements it, the run that
 * filed it, the URL it is about. A side table rather than more columns because
 * the relationship is genuinely one-to-many (a ticket can accumulate several
 * PRs across retries) and `kind` will keep growing.
 */
export const suggestionLinks = pgTable('suggestion_links', {
  id:           serial('id').primaryKey(),
  suggestionId: integer('suggestion_id').notNull()
                  .references(() => homepageTeamSuggestions.id, { onDelete: 'cascade' }),
  kind:         varchar('kind', { length: 12 }),   // pr|issue|run|url|doc|commit
  ref:          text('ref').notNull(),
  state:        varchar('state', { length: 16 }),  // open|merged|closed|passed|failed
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  suggKindIdx: index('idx_suggestion_links_sugg_kind').on(t.suggestionId, t.kind),
  // 092: the per-cycle writers (addTicketLinks/addTicketLink in team.server.ts
  // and release-engine.server.ts) re-add the same (suggestionId, kind, ref)
  // link on every poll instead of upserting; this index plus onConflictDoNothing
  // at both call sites makes a repeat write a no-op. See migration 092 for the
  // one-time dedupe of rows this constraint would otherwise reject.
  uniqSuggKindRef: uniqueIndex('uq_suggestion_links_sugg_kind_ref').on(t.suggestionId, t.kind, t.ref),
}))

/**
 * IndexNow push ledger (071). The bulk pusher reads this to skip URLs pushed
 * inside the suppression window; re-submitting the same URL set daily is the
 * spam pattern IndexNow penalises. `url` is the primary key so the window
 * check is one indexed lookup per URL.
 */
export const indexnowPings = pgTable('indexnow_pings', {
  url:        text('url').primaryKey(),
  pingedAt:   timestamp('pinged_at', { withTimezone: true }).notNull().defaultNow(),
  batchId:    varchar('batch_id', { length: 48 }),   // 'bulk-YYYY-MM-DD'
  engine:     varchar('engine', { length: 16 }).default('indexnow'),
  statusCode: integer('status_code'),
})

/**
 * Daily SEO diagnosis (071). gsc_index_daily holds the raw counts; this holds
 * the interpretation built on them (week-over-week deltas, coverage-state
 * transitions, live regression-probe results, tickets filed) plus catalog-side
 * coverage counters that explain thin-content rejections. One row per day.
 */
export const seoCoverageDaily = pgTable('seo_coverage_daily', {
  day:                      date('day').primaryKey(),
  discoveryTotal:           integer('discovery_total'),
  hasTypeDial:              integer('has_type_dial'),
  hasMood:                  integer('has_mood'),
  hasImage:                 integer('has_image'),
  enrichedDistinctProducts: integer('enriched_distinct_products'),
  notes:                    jsonb('notes'),
  createdAt:                timestamp('created_at', { withTimezone: true }).defaultNow(),
})

/**
 * Nightly per-channel conversation quality rollup (ticket #625), the
 * conversation-surfaces twin of seo_coverage_daily above. One row per
 * (day, channel), channel one of 'web' | 'sms' | 'voice', sourced entirely
 * from `sms_turns` — the unified per-turn log all three channels write to
 * (see app/lib/sms-v2/turn-logger.server.ts, web-turn-logger.server.ts,
 * adapters/voice.server.ts). Filled by /cron/conversation-quality-daily
 * (app/lib/conversation-quality-daily.server.ts), which documents exactly
 * which of these come from real, already-instrumented columns versus which
 * of the ticket's originally-requested signals (refusal rate, agent_failed
 * 500s, cost per session) have no persisted source today and are left for a
 * follow-up ticket rather than fabricated.
 */
export const conversationQualityDaily = pgTable('conversation_quality_daily', {
  id:                  serial('id').primaryKey(),
  day:                 date('day').notNull(),
  channel:             varchar('channel', { length: 8 }).notNull(),   // 'web' | 'sms' | 'voice'
  sessions:            integer('sessions').notNull().default(0),      // distinct conversation_id
  turns:               integer('turns').notNull().default(0),
  fabricationTrips:    integer('fabrication_trips').notNull().default(0),
  toolBudgetExhausted: integer('tool_budget_exhausted').notNull().default(0),
  errorTurns:          integer('error_turns').notNull().default(0),
  // web only today (pipeline_version='v1-web-fallback', #3915); always 0 for
  // sms/voice, which have no v1 to fall back to.
  v2FallbackCount:     integer('v2_fallback_count').notNull().default(0),
  p50LatencyMs:        integer('p50_latency_ms'),
  p95LatencyMs:        integer('p95_latency_ms'),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  dayChannelUniq: uniqueIndex('conversation_quality_daily_day_channel_uniq').on(t.day, t.channel),
  dayIdx:         index('idx_conversation_quality_daily_day').on(t.day),
}))

/**
 * Weekly store-wide strategy brief (051) — written by store-strategist, read by
 * every team routine at run start. Publishing a new brief supersedes the
 * previous active one; exactly one row is 'active' at a time.
 */
export const strategyBriefs = pgTable('strategy_briefs', {
  id:          serial('id').primaryKey(),
  weekStart:   date('week_start').notNull(),
  brief:       text('brief').notNull(),          // markdown: focus, per-team directives, stop-doing list
  metricsJson: json('metrics_json'),             // revenue, GA4, spend, engagement behind the calls
  status:      varchar('status', { length: 12 }).notNull().default('active'), // active|superseded|draft
  createdBy:   varchar('created_by', { length: 48 }).notNull().default('store-strategist'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, t => ({
  statusIdx: index('idx_strategy_briefs_status').on(t.status, t.createdAt),
}))

/**
 * Ad campaign proposals (051) — the ads-manager stub is propose-only; nothing
 * here spends money. Launch is a human action in-platform; the external id and
 * actual spend get synced back for the strategist's retro.
 */
export const adCampaigns = pgTable('ad_campaigns', {
  id:                 serial('id').primaryKey(),
  platform:           varchar('platform', { length: 20 }).notNull(),   // meta|x|google|reddit|other
  name:               varchar('name', { length: 120 }).notNull(),
  objective:          varchar('objective', { length: 40 }).notNull(),
  status:             varchar('status', { length: 16 }).notNull().default('proposed'), // proposed|approved|launched|paused|ended|rejected
  plannedDailyCents:  integer('planned_daily_cents').notNull().default(0),
  plannedTotalCents:  integer('planned_total_cents'),
  actualSpendUsd:     decimal('actual_spend_usd', { precision: 10, scale: 2 }).notNull().default('0'),
  externalCampaignId: varchar('external_campaign_id', { length: 64 }),
  audienceJson:       json('audience_json'),
  creativeJson:       json('creative_json'),      // copy variants, media refs, landing UTMs
  policyCheck:        text('policy_check').notNull(), // REQUIRED docs/ads-policy.md compliance note
  runId:              integer('run_id').references(() => homepageTeamRuns.id, { onDelete: 'set null' }),
  createdAt:          timestamp('created_at').notNull().defaultNow(),
  updatedAt:          timestamp('updated_at').notNull().defaultNow(),
}, t => ({
  statusIdx: index('idx_ad_campaigns_status').on(t.status, t.createdAt),
}))

/** Marketing calendar — promos, holidays, campaign themes the team merchandises around. */
export const marketingCalendar = pgTable('marketing_calendar', {
  id:         serial('id').primaryKey(),
  eventDate:  date('event_date').notNull(),
  name:       varchar('name', { length: 120 }).notNull(),
  type:       varchar('type', { length: 16 }).notNull().default('promo'), // holiday|promo|campaign
  theme:      text('theme'),
  status:     varchar('status', { length: 12 }).notNull().default('planned'), // planned|active|done|skipped
  assetsJson: json('assets_json'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, t => ({
  dateIdx: index('idx_marketing_calendar_date').on(t.eventDate),
}))

// ---------------------------------------------------------------------------
// Social video pipeline (065) — fal.ai influencer product videos + ad studio.
// ---------------------------------------------------------------------------

/**
 * Shared byte/URL/cost ledger for everything the video pipeline and ad studio
 * generate. Bytes live in Vercel Blob (blob.server.ts); approved product videos
 * graduate to Shopify via the existing staged-upload path as a second hop.
 */
export const mediaAssets = pgTable('media_assets', {
  id:              serial('id').primaryKey(),
  kind:            varchar('kind', { length: 12 }).notNull(),   // video|image|audio
  purpose:         varchar('purpose', { length: 24 }).notNull(), // scene_frame|clip|final|poster|ad_static|ad_video
  blobUrl:         text('blob_url').notNull(),
  contentType:     varchar('content_type', { length: 64 }).notNull(),
  durationSeconds: decimal('duration_seconds', { precision: 6, scale: 2 }),
  width:           integer('width'),
  height:          integer('height'),
  costUsd:         decimal('cost_usd', { precision: 10, scale: 5 }).notNull().default('0'),
  sourceModel:     varchar('source_model', { length: 64 }),
  videoJobId:      integer('video_job_id').references((): AnyPgColumn => videoJobs.id, { onDelete: 'set null' }),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
}, t => ({
  jobIdx: index('idx_media_assets_job').on(t.videoJobId),
}))

/** One spoken word with real start/end seconds from ElevenLabs with-timestamps. */
export interface VideoWordTiming {
  word: string
  start: number
  end: number
}

/**
 * One scene of a multi-scene video job (Phase 3, 20-60s videos). `continuity`
 * decides where the clip stage sources the scene's opening frame from:
 * 'own-frame' composes a fresh scene-frame candidate set (same gate as a
 * single-scene job); 'last-frame' animates from the PREVIOUS scene's final
 * frame instead, so motion reads as one continuous shot across the cut.
 * Defaults (applied by video-pipeline.server.ts's validateScenes): scene 0 is
 * 'own-frame' (nothing precedes it), every later scene is 'last-frame'.
 */
export interface VideoSceneSpec {
  slug: string
  /** Required for own-frame scenes (composes the scene_frame candidates); unused and optional for last-frame scenes, whose opening frame comes from the previous scene's rendered clip. */
  framePrompt?: string
  motionPrompt: string
  durationSeconds: number
  continuity?: 'last-frame' | 'own-frame'
  /**
   * Explicit per-scene frame reuse (ticket #5714): adopt an already-approved
   * same-presenter scene-frame asset instead of composing. Talking jobs only;
   * verified against the approval history at the scene_frame stage. The
   * slug-keyed automatic reuse needs no field — this is the override.
   */
  reuseFrameAssetId?: number
  /**
   * Per-scene presenter (ADR-014, ticket #6586): same 'none' | 'emma' |
   * 'friend:{slug}' grammar as the job-level `presenter`. Absent means "this
   * scene uses the job's presenter" (today's behavior, byte-for-byte). Lets
   * an own-frame scene's identity (and, once a talking tier is eligible
   * again, its voice) differ from the job's, so an episode can cut between
   * two cast members shot/reverse-shot rather than being pinned to one face
   * for the whole render.
   */
  presenter?: string
  /**
   * Per-scene spoken line (ADR-014, ticket #6586). Named to match, not add
   * to, the field `spokenTextOf` (app/lib/video-episodes.ts) already reads at
   * `scene[i].spokenLine` for the approval-integrity comparator — that guard
   * predates this field and was written to wait for it. Required by
   * validateScenes on a talking tier (spec.lipsync); actually driving TTS
   * per-scene is the render-stage-graph change ADR-014 §4 defers until a
   * talking tier is eligible again.
   */
  spokenLine?: string
  /**
   * Additional cast members visible in this own-frame scene alongside
   * `presenter`, same grammar ('friend:{slug}' | 'emma'). Composes a two-shot
   * via composeSceneFrame's existing `extraImageUrls` (ADR-014 addendum: the
   * compositor already supports this for social stills; the video frame
   * stage never wired it). Purely visual — does not imply a co-presenter
   * speaks; only `presenter`'s voice/line renders for this scene.
   */
  coPresenters?: string[]
}

/**
 * Per-scene pipeline progress, parallel-indexed with video_jobs.scenes_json.
 *   pending                -> not started
 *   awaiting_frame_approval -> own-frame scene: candidates composed, parked
 *                              for the owner's pick (video_frame_review valve)
 *   frame                  -> own-frame scene: frame approved, clip not yet
 *                              submitted
 *   clip                   -> clip render submitted to the provider, polling
 *   done                   -> clipAssetId set, this scene's clip is finished
 * lastFrameUrl is populated once the clip finishes IF the next scene needs it
 * ('last-frame' continuity) — RunPod's worker returns it directly; fal
 * providers get it via video-assembly's extractLastFrame.
 */
export interface VideoSceneState {
  frameAssetId?: number
  clipAssetId?: number
  lastFrameUrl?: string
  status: 'pending' | 'frame' | 'awaiting_frame_approval' | 'clip' | 'done'
}

/** Per-scene script beat, plus per-platform captions, produced by video-producer. */
export interface VideoScriptJson {
  hook?: string
  beats?: { line: string; direction?: string; tone?: string }[]
  cta?: string
  /**
   * Multi-scene job (Phase 3, 20-60s videos): 2-8 scenes rendered as separate
   * clips and concatenated into one longer video. Validated + normalized at
   * enqueue (video-pipeline.server.ts's validateScenes) into video_jobs'
   * dedicated scenes_json column, which the pipeline stages read from — this
   * field is the raw agent-authored input, kept for the record. Absent or a
   * single entry means the existing single-clip MVP path (byte-for-byte
   * unchanged).
   */
  scenes?: VideoSceneSpec[]
  /** Narration text for silent tiers (Kling): TTS'd in the active IVR voice and muxed at the lipsync stage. Ignored on native-audio tiers. */
  voiceover?: string
  /** Spoken on-camera line for the avatar tier (OmniHuman): TTS'd first, then performed. Distinct from voiceover, which stays the silent-tier narration field. */
  presenterLine?: string
  /** Optional delivery tone from team-keys VIDEO_TONES; routes TTS to eleven_v3 with an audio tag and colors the avatar motion prompt. Absent = the store voice's neutral read. */
  presenterTone?: string
  /** Clip length for duration-validated tiers; enqueue-set writes it per variant and advanceClip reads it back. */
  durationSeconds?: number
  /** Real word timings captured at TTS time (with-timestamps), cumulative across split parts; assembly drives the caption burn from these when present. Overwritten wholesale on every clip-stage TTS pass. */
  wordTimings?: VideoWordTiming[]
  /** Talking-head job: the scene frame is composed WITHOUT the product image (no product ever appears in a talking-head frame). */
  talkingHead?: boolean
  /** Scene-kit slug (team-keys SCENE_KIT). Avatar/talking-head jobs with a sceneSlug automatically reuse the latest approved frame from a prior same-presenter job for that scene; first use composes fresh. */
  sceneSlug?: string
  /** media_assets id of an already-approved scene frame to REUSE instead of composing, as an explicit override of the sceneSlug lookup (avatar/talking-head jobs only, same presenter; skips composition and re-approval since recomposition causes identity drift). */
  reuseFrameAssetId?: number
  captions?: Record<string, string>       // platform -> caption text
  frameFeedback?: string[]                // owner feedback from retry-frames rounds
  regenFeedback?: string[]                // owner feedback from regenerate rounds
  [key: string]: unknown
}

/**
 * One row per video: brief metadata (what/who/why) + the stage machine the
 * /cron/video-job-poller advances. Stage flow:
 *   scene_frame -> clip -> lipsync -> assembly -> poster -> done
 * `awaiting_frame_approval` (video_frame_review valve ON) parks the job for the
 * owner's frame pick in /admin/video-studio before any video spend.
 */
export const videoJobs = pgTable('video_jobs', {
  id:                serial('id').primaryKey(),
  jobId:             varchar('job_id', { length: 36 }).notNull(),
  productHandle:     varchar('product_handle', { length: 255 }).notNull(),
  shopifyProductGid: varchar('shopify_product_gid', { length: 64 }),
  formula:           varchar('formula', { length: 32 }).notNull(),
  presenter:         varchar('presenter', { length: 64 }).notNull().default('none'), // none|emma|friend:{slug}
  scriptJson:        jsonb('script_json').$type<VideoScriptJson>().notNull(),
  aiDisclosure:      boolean('ai_disclosure').notNull().default(true),
  modelTier:         varchar('model_tier', { length: 16 }).notNull(),                // VideoModelId
  targetPlatforms:   jsonb('target_platforms').$type<string[]>().notNull().default([]),
  stage:             varchar('stage', { length: 16 }).notNull().default('scene_frame'), // scene_frame|clip|lipsync|assembly|poster|done|failed
  status:            varchar('status', { length: 24 }).notNull().default('queued'),  // queued|running|awaiting_provider|awaiting_frame_approval|applying|done|failed
  providerRequestIds: jsonb('provider_request_ids').$type<Record<string, { requestId: string; statusUrl: string; responseUrl: string }>>().notNull().default({}),
  sceneFrameAssetId: integer('scene_frame_asset_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
  // Multi-scene jobs (Phase 3, migration 084). Both null for every existing
  // row and every single-scene job — the poller branches on scenesJson's
  // presence/length, so the single-clip MVP path never sees these.
  scenesJson:        jsonb('scenes_json').$type<VideoSceneSpec[]>(),
  sceneStateJson:    jsonb('scene_state_json').$type<VideoSceneState[]>(),
  finalAssetId:      integer('final_asset_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
  posterAssetId:     integer('poster_asset_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
  costUsd:           decimal('cost_usd', { precision: 10, scale: 5 }).notNull().default('0'),
  metricsJson:       jsonb('metrics_json').$type<Record<string, Record<string, number>>>(), // platform -> {views, likes, ...} owner self-report
  variantGroupId:    varchar('variant_group_id', { length: 36 }),                     // shared by every job expanded from one enqueue-set call
  variantAxes:       jsonb('variant_axes').$type<{ hook: string; presenter?: string; sceneSlug?: string }>(), // which axis values this sibling got
  error:             text('error'),
  team:              varchar('team', { length: 24 }).notNull().default('video'),
  runId:             integer('run_id').references(() => homepageTeamRuns.id, { onDelete: 'set null' }),
  // Serialized video program (migration 086). episodeId back-references the
  // video_episodes row this job renders (plain integer, no FK: the FK lives on
  // video_episodes.video_job_id to avoid a circular pair). The runpod columns
  // are the per-video off-confirmation (ticket #5717): probeJson is ALWAYS
  // written by the terminal probe; confirmedAt only when both the serverless
  // endpoint and the pods list read zero. A failed read is "could not ask",
  // never a false all-clear.
  episodeId:             integer('episode_id'),
  runpodIdleConfirmedAt: timestamp('runpod_idle_confirmed_at', { withTimezone: true }),
  runpodIdleProbeJson:   jsonb('runpod_idle_probe_json').$type<RunpodIdleProbe>(),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
  completedAt:       timestamp('completed_at'),
}, t => ({
  jobIdIdx:  uniqueIndex('uq_video_jobs_job_id').on(t.jobId),
  statusIdx: index('idx_video_jobs_status').on(t.status, t.createdAt),
  // Partial in-flight index (idx_video_jobs_inflight) covering the poller drain
  // query is created in the SQL migration — Drizzle cannot express partial
  // indexes. `awaiting_frame_approval` is deliberately EXCLUDED from it so
  // parked jobs do not spin the poller.
}))

// ─── Serialized video program (migration 086, all-hands 2026-08-26) ──────────

/**
 * Result of the terminal RunPod idle probe (ticket #5717). `clear` is true
 * ONLY when both surfaces were successfully read AND both are zero; a thrown
 * read lands in `couldNotAsk` and is never conflated with clear:false.
 */
export interface RunpodIdleProbe {
  checkedAt: string
  endpoint: {
    workers: { idle: number; initializing: number; ready: number; running: number; throttled: number; unhealthy: number; active: number }
    jobs: { inQueue: number; inProgress: number }
  } | null
  pods: { id: string; name: string; hoursRunning: number; costPerHour: number }[] | null
  clear: boolean
  couldNotAsk: string[]
}

/**
 * One product placement inside an episode. The role and mentionType
 * vocabularies deliberately have NO 'owned' role and NO 'personal_experience'
 * type: shoppers-not-owners (the charter's invented-testimonial ban) is
 * enforced here by making the forbidden claim inexpressible, not by prose.
 */
export interface VideoEpisodePlacement {
  handle: string
  shopifyProductGid?: string
  role: 'considered' | 'compared' | 'gifted' | 'rejected'
  mentionType: 'spec_cited' | 'review_pattern' | 'price' | 'category'
}

/** Append-only owner review note on an episode (never overwritten). */
export interface VideoEpisodeReviewNote {
  at: string
  /**
   * Owner decisions, plus machine-written entries: 'released' when a claimed
   * episode was handed back unrendered, 'render_failed' when its job died at
   * the provider (ticket #5726), 'edited' when the owner saved a script edit
   * via editEpisodeScript (ticket #7558). None of the three is an owner
   * decision and none can be written through decideEpisode.
   */
  decision: 'approved' | 'needs_changes' | 'rejected' | 'released' | 'render_failed' | 'edited'
  tags?: string[]
  note?: string
  by?: string
}

/**
 * video_series — the show bible's database half: near-static identity rows
 * (the bible's canon lives in docs/store-team/series-bible-the-group-chat.md).
 * Deliberately holds NO continuity state: character beats and the open-loop
 * ledger are DERIVED queries over video_episodes so they cannot drift.
 */
export const videoSeries = pgTable('video_series', {
  id:        serial('id').primaryKey(),
  slug:      varchar('slug', { length: 48 }).notNull(),
  title:     varchar('title', { length: 120 }).notNull(),
  premise:   text('premise'),
  status:    varchar('status', { length: 12 }).notNull().default('active'), // active|paused|retired
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  slugIdx: uniqueIndex('uq_video_series_slug').on(t.slug),
}))

/**
 * video_episodes — the unit of production for the serialized program. One row
 * per intended video, created by the writers room at PROPOSE time, before any
 * spend. The owner's decision on this row is the money gate: the enqueue
 * guard (ticket #5712) requires production_status='approved' and refuses a
 * payload whose spoken text differs byte-for-byte from script_json here.
 *
 * production_status: idea|drafting|pending_approval|approved|needs_changes|
 * rejected|rendering|rendered|scheduled|posted|measured|shelved|failed.
 * The pipeline writes only the rendering/rendered/failed boundary values;
 * the owner-facing display label derives in app code (never stored).
 */
export const videoEpisodes = pgTable('video_episodes', {
  id:                serial('id').primaryKey(),
  episodeUid:        varchar('episode_uid', { length: 36 }).notNull(),
  seriesId:          integer('series_id').notNull().references(() => videoSeries.id, { onDelete: 'restrict' }),
  seasonNumber:      smallint('season_number').notNull().default(1),
  episodeNumber:     integer('episode_number').notNull(),

  concept:           text('concept'),
  logline:           varchar('logline', { length: 240 }).notNull(),
  formula:           varchar('formula', { length: 32 }).notNull(),
  arcPosition:       varchar('arc_position', { length: 16 }).notNull().default('standalone'),
  opensLoopKey:      varchar('opens_loop_key', { length: 48 }),
  paysOffLoopKey:    varchar('pays_off_loop_key', { length: 48 }),
  callbackToEpisode: integer('callback_to_episode'),
  part2Hook:         text('part2_hook'),

  storyboardJson:    jsonb('storyboard_json').$type<{ beat: string; shot: string; onScreen?: string; sceneSlug?: string; speaker?: string; note?: string }[]>(),
  hookText:          varchar('hook_text', { length: 240 }),
  hookPattern:       varchar('hook_pattern', { length: 32 }),
  castSlugs:         jsonb('cast_slugs').$type<string[]>().notNull().default([]),
  productPlacements: jsonb('product_placements').$type<VideoEpisodePlacement[]>().notNull().default([]),
  scriptJson:        jsonb('script_json').$type<VideoScriptJson>(),
  siteCutJson:       jsonb('site_cut_json').$type<{ title?: string; dek?: string; copy?: string }>(),
  modelTier:         varchar('model_tier', { length: 16 }),
  estCostUsd:        decimal('est_cost_usd', { precision: 10, scale: 5 }),
  gateVerdictsJson:  jsonb('gate_verdicts_json').$type<{ doctor?: string; voice?: string }>(),

  productionStatus:  varchar('production_status', { length: 16 }).notNull().default('idea'),
  approvedBy:        varchar('approved_by', { length: 60 }),
  approvedAt:        timestamp('approved_at', { withTimezone: true }),
  batchId:           varchar('batch_id', { length: 36 }),
  rejectReason:      text('reject_reason'),
  reviewNotesJson:   jsonb('review_notes_json').$type<VideoEpisodeReviewNote[]>(),
  isReserve:         boolean('is_reserve').notNull().default(false),

  videoJobId:        integer('video_job_id').references(() => videoJobs.id, { onDelete: 'set null' }),
  priorJobIdsJson:   jsonb('prior_job_ids_json').$type<number[]>(),
  renderStartedAt:   timestamp('render_started_at', { withTimezone: true }),
  renderedAt:        timestamp('rendered_at', { withTimezone: true }),
  actualCostUsd:     decimal('actual_cost_usd', { precision: 10, scale: 5 }),

  plannedSlotAt:     timestamp('planned_slot_at', { withTimezone: true }),
  postedAt:          timestamp('posted_at', { withTimezone: true }),
  measuredAt:        timestamp('measured_at', { withTimezone: true }),

  createdBy:         varchar('created_by', { length: 60 }).notNull().default('agent'),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  uidIdx:    uniqueIndex('uq_video_episodes_uid').on(t.episodeUid),
  numberIdx: uniqueIndex('uq_video_episodes_number').on(t.seriesId, t.seasonNumber, t.episodeNumber),
  statusIdx: index('idx_video_episodes_status').on(t.productionStatus, t.plannedSlotAt),
  batchIdx:  index('idx_video_episodes_batch').on(t.batchId),
  jobIdx:    index('idx_video_episodes_job').on(t.videoJobId),
  // GIN index on product_placements lives in the SQL migration (jsonb_path_ops).
}))

/**
 * video_script_edits (095) — per-field before/after diff captured on every
 * owner script save via editEpisodeScript (ticket #7567, B1 of #7559 —
 * Part B of #7557). One row per changed field per save (e.g. field
 * 'script.cta' or 'script.captions.instagram'), never overwritten. Read by
 * listOwnerScriptEdits as the writers room's line-level "what the owner
 * changes" signal; wiring series-showrunner/episode-writer to actually read
 * it is B2, agent-editor's lane, tracked separately.
 */
export const videoScriptEdits = pgTable('video_script_edits', {
  id:         serial('id').primaryKey(),
  episodeId:  integer('episode_id').notNull().references(() => videoEpisodes.id, { onDelete: 'cascade' }),
  field:      varchar('field', { length: 64 }).notNull(),
  before:     text('before'),
  after:      text('after').notNull(),
  editedBy:   varchar('edited_by', { length: 60 }).notNull(),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  episodeIdx: index('idx_video_script_edits_episode').on(t.episodeId, t.createdAt),
}))

/**
 * Ad studio creative variants (065) — batches generated under an ad_campaigns
 * proposal. policy_check is required per creative, mirroring ad_campaigns:
 * docs/ads-policy.md prohibits Meta/TikTok paid for the pleasure catalog, so
 * the push stubs hard-block those platforms outside the health carve-out.
 */
export const adCreatives = pgTable('ad_creatives', {
  id:           serial('id').primaryKey(),
  adCampaignId: integer('ad_campaign_id').notNull().references(() => adCampaigns.id, { onDelete: 'cascade' }),
  format:       varchar('format', { length: 8 }).notNull(),      // 1:1|4:5|9:16
  assetId:      integer('asset_id').notNull().references(() => mediaAssets.id, { onDelete: 'cascade' }),
  hookCopy:     text('hook_copy'),
  status:       varchar('status', { length: 16 }).notNull().default('draft'), // draft|approved|rejected|pushed
  policyCheck:  text('policy_check').notNull(),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, t => ({
  campaignIdx: index('idx_ad_creatives_campaign').on(t.adCampaignId, t.status),
}))

/**
 * Outreach pipeline (077): vetted guest-post / brand-partnership targets.
 * One row per domain. Seeded from docs/store-team/outreach-prospects.md by
 * scripts/seed-outreach-prospects.ts; the offsite-scout adds more through
 * POST /api/team/outreach. Sending is valve-gated (outreach_send_enabled,
 * ships OFF) and capped (outreach_daily_send_cap); see
 * docs/store-team/outreach-pipeline.md.
 */
export const outreachProspects = pgTable('outreach_prospects', {
  id:             serial('id').primaryKey(),
  domain:         varchar('domain', { length: 255 }).notNull(),
  name:           varchar('name', { length: 255 }),
  contactEmail:   varchar('contact_email', { length: 255 }),
  contactChannel: varchar('contact_channel', { length: 8 }).notNull().default('email'), // email|form|dm
  source:         varchar('source', { length: 64 }),      // prospects-doc | offsite-scout | ...
  status:         varchar('status', { length: 20 }).notNull().default('new'),
    // new|researching|queued|sent|replied_positive|replied_negative|bounced|on_hold|landed|rejected
  policyNote:     text('policy_note'),                    // caveat carried from vetting
  notes:          text('notes'),
  suggestionId:   integer('suggestion_id')
                    .references(() => homepageTeamSuggestions.id, { onDelete: 'set null' }),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  domainUq:  uniqueIndex('outreach_prospects_domain_key').on(t.domain),
  statusIdx: index('idx_outreach_prospects_status').on(t.status, t.updatedAt),
}))

/**
 * Outreach pipeline (077): every outreach email, both directions. Outbound
 * rows carry the SMTP Message-ID so the IMAP poller can match replies by
 * In-Reply-To/References and leave everything else in hello@ untouched;
 * inbound rows carry the classification the poller assigned.
 */
export const outreachMessages = pgTable('outreach_messages', {
  id:               serial('id').primaryKey(),
  prospectId:       integer('prospect_id').notNull()
                      .references(() => outreachProspects.id, { onDelete: 'cascade' }),
  direction:        varchar('direction', { length: 3 }).notNull(),  // in|out
  subject:          text('subject'),
  bodyText:         text('body_text'),
  messageId:        text('message_id'),  // RFC 5322 Message-ID; inbound rows missing one store the imap:<uidvalidity>:<uid> fallback dedupe key
  inReplyTo:        text('in_reply_to'),
  referencesHeader: text('references_header'),
  classification:   varchar('classification', { length: 12 }),      // positive|negative|neutral|auto_reply
  sentAt:           timestamp('sent_at', { withTimezone: true }),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  prospectIdx:  index('idx_outreach_messages_prospect').on(t.prospectId, t.direction, t.sentAt),
  messageIdIdx: index('idx_outreach_messages_message_id').on(t.messageId),
}))


/**
 * The owner blocker list (078): one row per thing only the owner can clear.
 *
 * Distinct from a ticket. A ticket is work an agent can do; a blocker is work
 * that structurally cannot be done by an agent (a console setting, a billing
 * account, a credential, a protected-path merge, a migration against prod).
 * Filed by blocker-scout, by any agent that hits a wall, and by interactive
 * sessions that discover one mid-conversation. Cleared automatically by the
 * named probe in owner-blockers.server.ts wherever a machine check exists.
 */
export const ownerBlockers = pgTable('owner_blockers', {
  id:             serial('id').primaryKey(),
  dedupeKey:      varchar('dedupe_key', { length: 80 }).notNull(),
  title:          varchar('title', { length: 200 }).notNull(),
  detail:         text('detail'),
  unblocks:       text('unblocks'),
  whereToGo:      text('where_to_go'),
  category:       varchar('category', { length: 24 }).notNull().default('other'),
    // migration|valve|console|credential|approval|merge|execute|other
  priority:       smallint('priority').notNull().default(3),
  status:         varchar('status', { length: 16 }).notNull().default('open'), // open|cleared|dismissed
  source:         varchar('source', { length: 32 }).notNull().default('agent'),
  sourceRef:      text('source_ref'),
  evidence:       text('evidence'),
  verifyProbe:    varchar('verify_probe', { length: 32 }),
  verifyArg:      text('verify_arg'),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  lastVerifyOk:   boolean('last_verify_ok'),
  firstSeenAt:    timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt:     timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  clearedAt:      timestamp('cleared_at', { withTimezone: true }),
  clearedBy:      varchar('cleared_by', { length: 24 }),
  clearNote:      text('clear_note'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  dedupeUq: uniqueIndex('owner_blockers_dedupe_key_key').on(t.dedupeKey),
  openIdx:  index('idx_owner_blockers_open').on(t.status, t.priority, t.firstSeenAt),
  verifyIdx: index('idx_owner_blockers_verify').on(t.status, t.lastVerifiedAt),
}))

/**
 * One row per recorded cron invocation (migration 090).
 *
 * Written in a `finally` so both timestamps and the terminal status land in a
 * single INSERT. An INSERT-then-UPDATE pair would double the writes and invent
 * a started-without-finish class indistinguishable from a real kill, which is
 * the thing this table is here to detect rather than to manufacture.
 *
 * Deliberately NOT every cron: see `app/lib/cron-expectations.ts`. The two
 * every-2-minute pollers have a KV negative cache built specifically so 1,440
 * daily invocations touch Neon zero times, and a blanket write here would undo
 * it and pin DB compute awake around the clock.
 */
export const cronRuns = pgTable('cron_runs', {
  id:          serial('id').primaryKey(),
  route:       varchar('route', { length: 120 }).notNull(),
  startedAt:   timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt:  timestamp('finished_at', { withTimezone: true }),
  status:      varchar('status', { length: 16 }).notNull(), // succeeded|skipped|failed
  error:       text('error'),
  result:      jsonb('result'),
  triggerKind: varchar('trigger_kind', { length: 16 }).notNull().default('schedule'), // schedule|manual
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  routeIdx:  index('idx_cron_runs_route_started').on(t.route, t.startedAt),
  statusIdx: index('idx_cron_runs_status_started').on(t.status, t.startedAt),
}))

/**
 * The floor each scheduled surface is held to (migration 090).
 *
 * Covers BOTH scheduler planes. `vercel.json` is not the whole truth: the
 * browser checkout probe runs from GitHub Actions, outside Vercel and outside
 * `cronRoute`, and it is the closest thing this estate has to "can a customer
 * actually reach checkout". A manifest that stopped at the Vercel crons would
 * certify that blindness as healthy.
 *
 * Upserted from `app/lib/cron-expectations.ts` rather than seeded by the
 * migration: an INSERT would fail the additive allowlist and cost an owner
 * merge for a table definition.
 */
export const cronExpectations = pgTable('cron_expectations', {
  route:         varchar('route', { length: 120 }).primaryKey(),
  plane:         varchar('plane', { length: 16 }).notNull().default('vercel'), // vercel|actions
  schedule:      varchar('schedule', { length: 64 }),
  periodMinutes: integer('period_minutes').notNull(),
  graceMinutes:  integer('grace_minutes').notNull().default(10),
  recorded:      boolean('recorded').notNull().default(false),
  moneyRelevant: boolean('money_relevant').notNull().default(false),
  ownerTeam:     varchar('owner_team', { length: 24 }),
  notes:         text('notes'),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Backup and restore-probe history (migration 092, Stage G1).
 *
 * Two kinds share one table so that "the dump ran" and "the dump was readable"
 * are two facts with two independent ages. A dump nobody has ever read back is
 * not a backup; it is a file.
 */
export const backupRuns = pgTable('backup_runs', {
  id:          serial('id').primaryKey(),
  kind:        varchar('kind', { length: 24 }).notNull(), // dump|restore-probe
  startedAt:   timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt:  timestamp('finished_at', { withTimezone: true }),
  status:      varchar('status', { length: 16 }).notNull(), // succeeded|partial|failed|skipped
  snapshotKey: varchar('snapshot_key', { length: 200 }),
  tables:      jsonb('tables'),
  totalBytes:  bigint('total_bytes', { mode: 'number' }),
  error:       text('error'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

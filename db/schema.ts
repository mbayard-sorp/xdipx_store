import {
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
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

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
  status:           varchar('status', { length: 20 }).default('queued').notNull(),
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

export const dailyProfitSummary = pgTable('daily_profit_summary', {
  summaryDate:   date('summary_date').primaryKey(),
  totalOrders:   integer('total_orders'),
  totalRevenue:  decimal('total_revenue',  { precision: 10, scale: 2 }),
  totalCogs:     decimal('total_cogs',     { precision: 10, scale: 2 }),
  totalProfit:   decimal('total_profit',   { precision: 10, scale: 2 }),
  avgOrderValue: decimal('avg_order_value',{ precision: 10, scale: 2 }),
  featuredSku:   varchar('featured_sku', { length: 20 }),
  adSpend:       decimal('ad_spend', { precision: 10, scale: 2 }).default('0').notNull(),
})

export const pipelineSettings = pgTable('pipeline_settings', {
  key:       varchar('key', { length: 50 }).primaryKey(),
  value:     text('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
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
})

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

/**
 * Durable retry queue for Meta Conversions API (CAPI) Purchase events.
 * Purchase is the revenue-critical conversion signal; a failed CAPI POST must
 * not be silently dropped. The order-created webhook inserts on failure and the
 * profit-summary cron drains unresolved rows (bounded attempts). One row per
 * order (unique order_id) keeps drains and webhook retries idempotent.
 */
export const metaCapiFailures = pgTable('meta_capi_failures', {
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


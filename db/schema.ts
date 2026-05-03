import {
  boolean,
  date,
  decimal,
  index,
  integer,
  json,
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
}, t => ({
  // Phase 10: customer_gid indexes for cross-channel joins (additive).
  customerGidIdx:       index('sms_conversations_customer_gid_idx').on(t.customerGid),
  customerGidActiveIdx: index('sms_conversations_gid_active_idx').on(t.customerGid, t.lastActiveAt),
}))

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
}, t => ({
  // Phase 10: customer_gid indexes for cross-channel joins (additive).
  customerGidIdx:       index('web_conversations_customer_gid_idx').on(t.customerGid),
  customerGidActiveIdx: index('web_conversations_gid_active_idx').on(t.customerGid, t.lastActiveAt),
}))


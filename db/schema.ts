import {
  boolean,
  date,
  decimal,
  integer,
  json,
  pgTable,
  serial,
  text,
  timestamp,
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
  sortOrder:        integer('sort_order').default(0).notNull(),
  status:           varchar('status', { length: 20 }).default('queued').notNull(),
  shopifyProductId: varchar('shopify_product_id', { length: 30 }),
  createdAt:        timestamp('created_at').defaultNow().notNull(),
  activatedAt:      timestamp('activated_at'),
  completedAt:      timestamp('completed_at'),
})

export const consentLog = pgTable('consent_log', {
  id:            serial('id').primaryKey(),
  sessionId:     varchar('session_id', { length: 64 }),
  customerId:    varchar('customer_id', { length: 30 }),
  ipHash:        varchar('ip_hash',     { length: 64 }),
  consentGiven:  boolean('consent_given').notNull(),
  consentType:   varchar('consent_type', { length: 20 }),
  policyVersion: varchar('policy_version', { length: 10 }).notNull(),
  consentedAt:   timestamp('consented_at').defaultNow().notNull(),
})

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

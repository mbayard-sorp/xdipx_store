var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// app/lib/sentry.server.ts
import * as Sentry from "@sentry/node";
function initSentryServer() {
  if (initialized) return;
  const dsn = process.env["SENTRY_DSN"];
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env["NODE_ENV"] ?? "development",
    tracesSampleRate: 0.1,
    sendDefaultPii: false
  });
  initialized = true;
}
var initialized;
var init_sentry_server = __esm({
  "app/lib/sentry.server.ts"() {
    "use strict";
    initialized = false;
  }
});

// db/schema.ts
var schema_exports = {};
__export(schema_exports, {
  adCampaigns: () => adCampaigns,
  adminRoles: () => adminRoles,
  apiTokenLog: () => apiTokenLog,
  batchJobs: () => batchJobs,
  callLog: () => callLog,
  colorSwatchCache: () => colorSwatchCache,
  consentLog: () => consentLog,
  customerAnniversaries: () => customerAnniversaries,
  customerProfileExtras: () => customerProfileExtras,
  dailyProfitSummary: () => dailyProfitSummary,
  dealHistory: () => dealHistory,
  discoveryIndexPayload: () => discoveryIndexPayload,
  discoveryRules: () => discoveryRules,
  draftOrders: () => draftOrders,
  emmaChatEvents: () => emmaChatEvents,
  emmaChatMessages: () => emmaChatMessages,
  emmaChatSessions: () => emmaChatSessions,
  emmaChatThreads: () => emmaChatThreads,
  emmaChatTurns: () => emmaChatTurns,
  enrichmentBatches: () => enrichmentBatches,
  homepagePayload: () => homepagePayload,
  homepageTeamEvents: () => homepageTeamEvents,
  homepageTeamRuns: () => homepageTeamRuns,
  homepageTeamSuggestions: () => homepageTeamSuggestions,
  importCandidates: () => importCandidates,
  importMonitorRuns: () => importMonitorRuns,
  ivrVoices: () => ivrVoices,
  marketingCalendar: () => marketingCalendar,
  metaCapiFailures: () => metaCapiFailures,
  orderLineItems: () => orderLineItems,
  pdpDialVotes: () => pdpDialVotes,
  pdpProductVotes: () => pdpProductVotes,
  pipelineSettings: () => pipelineSettings,
  pricingAuditLog: () => pricingAuditLog,
  pricingChanges: () => pricingChanges,
  pricingGroups: () => pricingGroups,
  pricingProductTypeMap: () => pricingProductTypeMap,
  pricingRules: () => pricingRules,
  pricingSubGroups: () => pricingSubGroups,
  productCopurchase: () => productCopurchase,
  productEnrichmentCache: () => productEnrichmentCache,
  referrals: () => referrals,
  returns: () => returns,
  smsAgeConsent: () => smsAgeConsent,
  smsConversations: () => smsConversations,
  smsMessages: () => smsMessages,
  smsOptouts: () => smsOptouts,
  smsTurns: () => smsTurns,
  socialPosts: () => socialPosts,
  strategyBriefs: () => strategyBriefs,
  tosAcceptance: () => tosAcceptance,
  tosVersions: () => tosVersions,
  voicemails: () => voicemails,
  webConversations: () => webConversations,
  wishlistItems: () => wishlistItems,
  wishlists: () => wishlists
});
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
  varchar
} from "drizzle-orm/pg-core";
var dealHistory, consentLog, tosAcceptance, tosVersions, referrals, dailyProfitSummary, pipelineSettings, customerProfileExtras, customerAnniversaries, socialPosts, adminRoles, orderLineItems, wishlists, wishlistItems, pdpDialVotes, pdpProductVotes, callLog, voicemails, smsOptouts, smsMessages, smsAgeConsent, draftOrders, returns, emmaChatSessions, emmaChatTurns, emmaChatEvents, ivrVoices, colorSwatchCache, productCopurchase, productEnrichmentCache, smsConversations, smsTurns, webConversations, emmaChatThreads, emmaChatMessages, pricingGroups, pricingSubGroups, pricingProductTypeMap, pricingRules, pricingAuditLog, discoveryRules, pricingChanges, importCandidates, importMonitorRuns, enrichmentBatches, batchJobs, apiTokenLog, metaCapiFailures, homepagePayload, discoveryIndexPayload, homepageTeamRuns, homepageTeamEvents, homepageTeamSuggestions, strategyBriefs, adCampaigns, marketingCalendar;
var init_schema = __esm({
  "db/schema.ts"() {
    "use strict";
    dealHistory = pgTable("deal_history", {
      id: serial("id").primaryKey(),
      sku: varchar("sku", { length: 20 }).notNull(),
      seoTitle: text("seo_title"),
      brand: varchar("brand", { length: 100 }),
      categories: json("categories").$type(),
      dealDate: date("deal_date").notNull(),
      wholesaleCost: decimal("wholesale_cost", { precision: 10, scale: 2 }),
      dealPrice: decimal("deal_price", { precision: 10, scale: 2 }),
      msrp: decimal("msrp", { precision: 10, scale: 2 }),
      mapPrice: decimal("map_price", { precision: 10, scale: 2 }),
      unitsAvailable: integer("units_available"),
      unitsSold: integer("units_sold").default(0).notNull(),
      totalRevenue: decimal("total_revenue", { precision: 10, scale: 2 }).default("0").notNull(),
      totalProfit: decimal("total_profit", { precision: 10, scale: 2 }).default("0").notNull(),
      dealScore: decimal("deal_score", { precision: 5, scale: 3 }),
      vaultPrice: decimal("vault_price", { precision: 10, scale: 2 }),
      pctOffMsrp: decimal("pct_off_msrp", { precision: 5, scale: 2 }),
      sortOrder: integer("sort_order").default(0).notNull(),
      status: varchar("status", { length: 20 }).default("pending").notNull(),
      shopifyProductId: varchar("shopify_product_id", { length: 30 }),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      activatedAt: timestamp("activated_at"),
      completedAt: timestamp("completed_at")
    }, (t) => ({
      statusIdx: index("deal_history_status_idx").on(t.status),
      dealDateIdx: index("deal_history_deal_date_idx").on(t.dealDate)
    }));
    consentLog = pgTable("consent_log", {
      id: serial("id").primaryKey(),
      sessionId: varchar("session_id", { length: 64 }),
      customerId: varchar("customer_id", { length: 30 }),
      ipHash: varchar("ip_hash", { length: 64 }),
      consentGiven: boolean("consent_given").notNull(),
      consentType: varchar("consent_type", { length: 20 }),
      policyVersion: varchar("policy_version", { length: 10 }).notNull(),
      consentedAt: timestamp("consented_at").defaultNow().notNull()
    }, (t) => ({
      sessionIdx: index("consent_log_session_idx").on(t.sessionId, t.consentedAt)
    }));
    tosAcceptance = pgTable("tos_acceptance", {
      id: serial("id").primaryKey(),
      customerId: varchar("customer_id", { length: 30 }).notNull(),
      email: varchar("email", { length: 255 }),
      tosVersion: varchar("tos_version", { length: 10 }).notNull(),
      acceptedAt: timestamp("accepted_at").defaultNow().notNull(),
      ipHash: varchar("ip_hash", { length: 64 }),
      acceptanceMethod: varchar("acceptance_method", { length: 20 })
    });
    tosVersions = pgTable("tos_versions", {
      version: varchar("version", { length: 10 }).primaryKey(),
      publishedAt: timestamp("published_at").notNull(),
      summaryOfChanges: text("summary_of_changes"),
      fullTextUrl: text("full_text_url")
    });
    referrals = pgTable("referrals", {
      id: serial("id").primaryKey(),
      refCode: varchar("ref_code", { length: 50 }).notNull(),
      referrerType: varchar("referrer_type", { length: 20 }).default("affiliate"),
      referrerId: varchar("referrer_id", { length: 50 }),
      referredCustomerId: varchar("referred_customer_id", { length: 30 }),
      firstOrderId: varchar("first_order_id", { length: 30 }),
      firstOrderValue: decimal("first_order_value", { precision: 10, scale: 2 }),
      commissionPct: decimal("commission_pct", { precision: 5, scale: 2 }).default("10.0"),
      commissionOwed: decimal("commission_owed", { precision: 10, scale: 2 }),
      commissionPaid: boolean("commission_paid").default(false),
      createdAt: timestamp("created_at").defaultNow().notNull()
    });
    dailyProfitSummary = pgTable("daily_profit_summary", {
      summaryDate: date("summary_date").primaryKey(),
      totalOrders: integer("total_orders"),
      totalRevenue: decimal("total_revenue", { precision: 10, scale: 2 }),
      totalCogs: decimal("total_cogs", { precision: 10, scale: 2 }),
      totalProfit: decimal("total_profit", { precision: 10, scale: 2 }),
      avgOrderValue: decimal("avg_order_value", { precision: 10, scale: 2 }),
      featuredSku: varchar("featured_sku", { length: 20 }),
      adSpend: decimal("ad_spend", { precision: 10, scale: 2 }).default("0").notNull()
    });
    pipelineSettings = pgTable("pipeline_settings", {
      key: varchar("key", { length: 50 }).primaryKey(),
      value: text("value").notNull(),
      updatedAt: timestamp("updated_at").defaultNow()
    });
    customerProfileExtras = pgTable("customer_profile_extras", {
      customerGid: varchar("customer_gid", { length: 60 }).primaryKey(),
      genderIdentity: varchar("gender_identity", { length: 30 }),
      relationshipStatus: varchar("relationship_status", { length: 30 }),
      dateOfBirth: date("date_of_birth"),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    customerAnniversaries = pgTable("customer_anniversaries", {
      id: serial("id").primaryKey(),
      customerGid: varchar("customer_gid", { length: 60 }).notNull(),
      name: varchar("name", { length: 60 }).notNull(),
      date: date("date").notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull()
    });
    socialPosts = pgTable("social_posts", {
      id: serial("id").primaryKey(),
      platform: varchar("platform", { length: 20 }).notNull(),
      postType: varchar("post_type", { length: 20 }).notNull(),
      externalPostId: varchar("external_post_id", { length: 50 }),
      parentPostId: integer("parent_post_id"),
      dealHistoryId: integer("deal_history_id"),
      tweetText: text("tweet_text").notNull(),
      mediaUrls: json("media_urls").$type(),
      mediaIds: json("media_ids").$type(),
      status: varchar("status", { length: 20 }).default("draft").notNull(),
      errorMessage: text("error_message"),
      postedAt: timestamp("posted_at"),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      createdBy: varchar("created_by", { length: 20 }).default("system")
    });
    adminRoles = pgTable("admin_roles", {
      id: serial("id").primaryKey(),
      neonAuthUserId: varchar("neon_auth_user_id", { length: 60 }).notNull().unique(),
      email: varchar("email", { length: 255 }).notNull(),
      name: varchar("name", { length: 100 }).notNull(),
      role: varchar("role", { length: 20 }).notNull().default("admin"),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      lastLoginAt: timestamp("last_login_at")
    });
    orderLineItems = pgTable("order_line_items", {
      id: serial("id").primaryKey(),
      shopifyOrderId: varchar("shopify_order_id", { length: 30 }).notNull(),
      shopifyProductId: varchar("shopify_product_id", { length: 30 }).notNull(),
      handle: varchar("handle", { length: 255 }),
      sku: varchar("sku", { length: 50 }),
      quantity: integer("quantity").notNull(),
      unitPrice: decimal("unit_price", { precision: 10, scale: 2 }),
      createdAt: timestamp("created_at").defaultNow().notNull()
    }, (t) => ({
      orderIdx: index("oli_order_idx").on(t.shopifyOrderId),
      handleIdx: index("oli_handle_idx").on(t.handle),
      productIdx: index("oli_product_idx").on(t.shopifyProductId)
    }));
    wishlists = pgTable("wishlists", {
      id: serial("id").primaryKey(),
      customerGid: varchar("customer_gid", { length: 60 }).notNull(),
      name: varchar("name", { length: 100 }).notNull(),
      note: text("note"),
      privacy: varchar("privacy", { length: 20 }).default("private").notNull(),
      giftMode: boolean("gift_mode").default(false).notNull(),
      shareToken: varchar("share_token", { length: 48 }),
      isDefault: boolean("is_default").default(false).notNull(),
      publicSlug: varchar("public_slug", { length: 20 }),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    }, (t) => ({
      slugUnique: uniqueIndex("wishlists_slug_uniq").on(t.publicSlug),
      shareTokenUq: uniqueIndex("wishlists_share_token_uniq").on(t.shareToken),
      customerIdx: index("wishlists_customer_idx").on(t.customerGid),
      customerNameUq: uniqueIndex("wishlists_customer_name").on(t.customerGid, t.name)
    }));
    wishlistItems = pgTable("wishlist_items", {
      id: serial("id").primaryKey(),
      wishlistId: integer("wishlist_id").notNull().references(() => wishlists.id, { onDelete: "cascade" }),
      shopifyProductId: varchar("shopify_product_id", { length: 64 }).notNull(),
      handle: varchar("handle", { length: 255 }).notNull(),
      variantSelection: json("variant_selection").$type(),
      addedAt: timestamp("added_at").defaultNow().notNull()
    }, (t) => ({
      itemUnique: uniqueIndex("wishlist_items_unique").on(t.wishlistId, t.shopifyProductId),
      listIdx: index("wishlist_items_list_idx").on(t.wishlistId)
    }));
    pdpDialVotes = pgTable("pdp_dial_votes", {
      id: serial("id").primaryKey(),
      shopifyProductId: varchar("shopify_product_id", { length: 64 }).notNull(),
      dimension: varchar("dimension", { length: 40 }).notNull(),
      customerGid: varchar("customer_gid", { length: 60 }).notNull(),
      vote: integer("vote").notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull()
    }, (t) => ({
      voteUnique: uniqueIndex("pdp_dial_votes_uniq").on(t.shopifyProductId, t.dimension, t.customerGid),
      productIdx: index("pdp_dial_votes_product_idx").on(t.shopifyProductId)
    }));
    pdpProductVotes = pgTable("pdp_product_votes", {
      id: serial("id").primaryKey(),
      shopifyProductId: varchar("shopify_product_id", { length: 64 }).notNull(),
      customerGid: varchar("customer_gid", { length: 60 }).notNull(),
      vote: integer("vote").notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull()
    }, (t) => ({
      voteUnique: uniqueIndex("pdp_product_votes_uniq").on(t.shopifyProductId, t.customerGid),
      productIdx: index("pdp_product_votes_product_idx").on(t.shopifyProductId)
    }));
    callLog = pgTable("call_log", {
      id: serial("id").primaryKey(),
      callSid: varchar("call_sid", { length: 64 }).notNull().unique(),
      fromNumber: varchar("from_number", { length: 20 }).notNull(),
      toNumber: varchar("to_number", { length: 20 }),
      direction: varchar("direction", { length: 10 }),
      endReason: varchar("end_reason", { length: 20 }),
      durationSec: integer("duration_sec"),
      tokensTotal: integer("tokens_total"),
      voicemailId: integer("voicemail_id"),
      createdAt: timestamp("created_at").defaultNow().notNull()
    }, (t) => ({
      fromIdx: index("call_log_from_idx").on(t.fromNumber, t.createdAt),
      createdIdx: index("call_log_created_idx").on(t.createdAt)
    }));
    voicemails = pgTable("voicemails", {
      id: serial("id").primaryKey(),
      callSid: varchar("call_sid", { length: 64 }).notNull().unique(),
      fromNumber: varchar("from_number", { length: 20 }).notNull(),
      callbackNumber: varchar("callback_number", { length: 20 }),
      summary: text("summary").notNull(),
      transcript: text("transcript").notNull(),
      recordingUrl: text("recording_url"),
      contextOrderNumber: varchar("context_order_number", { length: 20 }),
      status: varchar("status", { length: 20 }).default("new").notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull()
    }, (t) => ({
      statusIdx: index("voicemails_status_idx").on(t.status),
      createdIdx: index("voicemails_created_idx").on(t.createdAt)
    }));
    smsOptouts = pgTable("sms_optouts", {
      id: serial("id").primaryKey(),
      phone: varchar("phone", { length: 20 }).notNull().unique(),
      reason: varchar("reason", { length: 20 }).default("stop").notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull()
    });
    smsMessages = pgTable("sms_messages", {
      id: serial("id").primaryKey(),
      phone: varchar("phone", { length: 20 }).notNull(),
      direction: varchar("direction", { length: 10 }).notNull(),
      body: text("body").notNull(),
      twilioSid: varchar("twilio_sid", { length: 64 }),
      // Marks rows generated by the /admin/sms-tester simulator so the production
      // history loader can exclude them from real customer threads.
      simulated: boolean("simulated").default(false).notNull(),
      // Optional MMS media URL (Shopify CDN product image) attached to outbound
      // bubbles. Null for plain-text SMS and for inbound rows.
      mediaUrl: text("media_url"),
      createdAt: timestamp("created_at").defaultNow().notNull()
    }, (t) => ({
      phoneIdx: index("sms_messages_phone_idx").on(t.phone, t.createdAt),
      createdIdx: index("sms_messages_created_idx").on(t.createdAt),
      simulatedIdx: index("sms_messages_simulated_idx").on(t.simulated, t.phone, t.createdAt)
    }));
    smsAgeConsent = pgTable("sms_age_consent", {
      phone: varchar("phone", { length: 20 }).primaryKey(),
      consentedAt: timestamp("consented_at").defaultNow().notNull(),
      method: varchar("method", { length: 20 }).default("sms_yes").notNull()
    });
    draftOrders = pgTable("draft_orders", {
      id: serial("id").primaryKey(),
      shopifyDraftId: varchar("shopify_draft_id", { length: 64 }).notNull().unique(),
      shopifyInvoiceUrl: text("shopify_invoice_url"),
      channel: varchar("channel", { length: 10 }).notNull(),
      // voice | sms
      phone: varchar("phone", { length: 20 }).notNull(),
      email: varchar("email", { length: 255 }),
      customerName: varchar("customer_name", { length: 255 }),
      subtotalCents: integer("subtotal_cents").notNull(),
      itemCount: integer("item_count").notNull(),
      lineItems: json("line_items").$type().notNull(),
      status: varchar("status", { length: 20 }).default("sent").notNull(),
      // sent | paid | expired | cancelled
      createdAt: timestamp("created_at").defaultNow().notNull()
    }, (t) => ({
      phoneIdx: index("draft_orders_phone_idx").on(t.phone, t.createdAt),
      createdIdx: index("draft_orders_created_idx").on(t.createdAt)
    }));
    returns = pgTable("returns", {
      id: serial("id").primaryKey(),
      shopifyReturnId: varchar("shopify_return_id", { length: 60 }).notNull(),
      shopifyOrderId: varchar("shopify_order_id", { length: 60 }).notNull(),
      customerGid: varchar("customer_gid", { length: 60 }).notNull(),
      status: varchar("status", { length: 20 }).default("requested").notNull(),
      reason: varchar("reason", { length: 40 }),
      reasonNote: text("reason_note"),
      lineItems: json("line_items").$type().notNull(),
      shopifyReverseDeliveryId: varchar("shopify_reverse_delivery_id", { length: 60 }),
      labelUrl: text("label_url"),
      labelCostCents: integer("label_cost_cents"),
      labelCostEstimatedCents: integer("label_cost_estimated_cents"),
      trackingNumber: varchar("tracking_number", { length: 60 }),
      trackingStatus: varchar("tracking_status", { length: 40 }),
      refundAmountCents: integer("refund_amount_cents"),
      shopifyRefundId: varchar("shopify_refund_id", { length: 60 }),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull(),
      labelPurchasedAt: timestamp("label_purchased_at"),
      receivedAt: timestamp("received_at"),
      refundedAt: timestamp("refunded_at"),
      closedAt: timestamp("closed_at")
    }, (t) => ({
      shopifyReturnUq: uniqueIndex("returns_shopify_return_uniq").on(t.shopifyReturnId),
      customerIdx: index("returns_customer_idx").on(t.customerGid, t.createdAt),
      orderIdx: index("returns_order_idx").on(t.shopifyOrderId),
      statusIdx: index("returns_status_idx").on(t.status)
    }));
    emmaChatSessions = pgTable("emma_chat_sessions", {
      id: serial("id").primaryKey(),
      cookieId: varchar("cookie_id", { length: 40 }).notNull(),
      customerGid: varchar("customer_gid", { length: 60 }),
      ipHash: varchar("ip_hash", { length: 64 }),
      userAgent: varchar("user_agent", { length: 255 }),
      turnCount: integer("turn_count").default(0).notNull(),
      firstProductHandle: varchar("first_product_handle", { length: 255 }),
      checkoutUrlShared: text("checkout_url_shared"),
      checkoutSharedAt: timestamp("checkout_shared_at"),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      lastActivityAt: timestamp("last_activity_at").defaultNow().notNull()
    }, (t) => ({
      cookieUq: uniqueIndex("emma_sessions_cookie_uniq").on(t.cookieId),
      customerIdx: index("emma_sessions_customer_idx").on(t.customerGid),
      createdIdx: index("emma_sessions_created_idx").on(t.createdAt)
    }));
    emmaChatTurns = pgTable("emma_chat_turns", {
      id: serial("id").primaryKey(),
      sessionId: integer("session_id").notNull().references(() => emmaChatSessions.id, { onDelete: "cascade" }),
      role: varchar("role", { length: 10 }).notNull(),
      text: text("text").notNull(),
      hidden: boolean("hidden").default(false).notNull(),
      products: json("products").$type(),
      quickReply: json("quick_reply").$type(),
      latencyMs: integer("latency_ms"),
      createdAt: timestamp("created_at").defaultNow().notNull()
    }, (t) => ({
      sessionIdx: index("emma_turns_session_idx").on(t.sessionId, t.createdAt)
    }));
    emmaChatEvents = pgTable("emma_chat_events", {
      id: serial("id").primaryKey(),
      sessionId: integer("session_id").notNull().references(() => emmaChatSessions.id, { onDelete: "cascade" }),
      turnId: integer("turn_id"),
      kind: varchar("kind", { length: 30 }).notNull(),
      payload: json("payload"),
      createdAt: timestamp("created_at").defaultNow().notNull()
    }, (t) => ({
      sessionIdx: index("emma_events_session_idx").on(t.sessionId, t.createdAt),
      kindIdx: index("emma_events_kind_idx").on(t.kind, t.createdAt)
    }));
    ivrVoices = pgTable("ivr_voices", {
      id: serial("id").primaryKey(),
      name: varchar("name", { length: 100 }).notNull(),
      voiceId: varchar("voice_id", { length: 100 }).notNull(),
      notes: text("notes").default("").notNull(),
      active: boolean("active").default(false).notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    }, (t) => ({
      voiceIdUq: uniqueIndex("ivr_voices_voice_id_uniq").on(t.voiceId),
      activeIdx: index("ivr_voices_active_idx").on(t.active)
    }));
    colorSwatchCache = pgTable("color_swatch_cache", {
      colorKey: varchar("color_key", { length: 80 }).primaryKey(),
      label: varchar("label", { length: 120 }).notNull(),
      hex: varchar("hex", { length: 7 }),
      source: varchar("source", { length: 16 }).notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull()
    });
    productCopurchase = pgTable("product_copurchase", {
      id: serial("id").primaryKey(),
      handleA: varchar("handle_a", { length: 255 }).notNull(),
      handleB: varchar("handle_b", { length: 255 }).notNull(),
      count: integer("count").default(0).notNull(),
      lastSeenAt: timestamp("last_seen_at").defaultNow().notNull()
    }, (t) => ({
      pairUnique: uniqueIndex("copurchase_pair_uniq").on(t.handleA, t.handleB),
      handleAIdx: index("copurchase_a_idx").on(t.handleA),
      handleBIdx: index("copurchase_b_idx").on(t.handleB)
    }));
    productEnrichmentCache = pgTable("product_enrichment_cache", {
      id: serial("id").primaryKey(),
      productId: varchar("product_id", { length: 64 }).notNull(),
      // Shopify GID
      fieldName: varchar("field_name", { length: 64 }).notNull(),
      // e.g. tagline, descriptionHtml
      voiceHash: varchar("voice_hash", { length: 32 }).notNull(),
      // sha1 slice of system+brand voice
      promptVersion: varchar("prompt_version", { length: 16 }).notNull(),
      // bumped on prompt-structure changes
      content: json("content").notNull(),
      // generated payload (shape varies by field)
      model: varchar("model", { length: 32 }).notNull(),
      // "claude-haiku-4-5-..." / "claude-sonnet-4-..."
      inputTokens: integer("input_tokens").default(0).notNull(),
      outputTokens: integer("output_tokens").default(0).notNull(),
      generatedAt: timestamp("generated_at").defaultNow().notNull()
    }, (t) => ({
      cacheKeyUniq: uniqueIndex("enrich_cache_key_uniq").on(t.productId, t.fieldName, t.voiceHash, t.promptVersion),
      productIdx: index("enrich_cache_product_idx").on(t.productId),
      generatedAtIdx: index("enrich_cache_generated_idx").on(t.generatedAt)
    }));
    smsConversations = pgTable("sms_conversations", {
      phone: varchar("phone", { length: 20 }).primaryKey(),
      stage: varchar("stage", { length: 32 }).notNull().default("GREETING"),
      currentPitchHandle: text("current_pitch_handle"),
      currentUpsellHandle: text("current_upsell_handle"),
      lastQuoteUrl: text("last_quote_url"),
      lastQuoteItems: json("last_quote_items").$type(),
      lastQuoteCreatedAt: timestamp("last_quote_created_at"),
      customerGid: text("customer_gid"),
      customerFirstName: text("customer_first_name"),
      customerDefaultZip: text("customer_default_zip"),
      stageSetAt: timestamp("stage_set_at").notNull().defaultNow(),
      lastActiveAt: timestamp("last_active_at").notNull().defaultNow(),
      conversationId: uuid("conversation_id").notNull().defaultRandom(),
      // Migration 030: Emma discovery state machine + slot accumulator.
      discoveryState: json("discovery_state").$type(),
      discoveredSlots: json("discovered_slots").$type().notNull().default({}),
      // Migration 031: voice-channel pending pdp link awaiting caller permission.
      pendingPdpUrl: text("pending_pdp_url"),
      // Migration 032: Phase 0 memory primitives.
      // conversation_summary — Haiku-generated 1-2 sentence rolling summary. Updated
      //   fire-and-forget after each turn. Injected into the system prompt so the
      //   agent retains context beyond the HISTORY_LIMIT window. Copied forward on
      //   24h rotation as "From a previous conversation: {summary}".
      conversationSummary: text("conversation_summary"),
      // pitched_handles_log — ordered array (most-recent last) of the last 10 pitched
      //   product handles. Enables "the first one you showed me" resolution.
      pitchedHandlesLog: text("pitched_handles_log").array()
    }, (t) => ({
      // Phase 10: customer_gid indexes for cross-channel joins (additive).
      customerGidIdx: index("sms_conversations_customer_gid_idx").on(t.customerGid),
      customerGidActiveIdx: index("sms_conversations_gid_active_idx").on(t.customerGid, t.lastActiveAt)
    }));
    smsTurns = pgTable("sms_turns", {
      id: serial("id").primaryKey(),
      phone: varchar("phone", { length: 20 }).notNull(),
      conversationId: uuid("conversation_id").notNull(),
      twilioMessageSid: varchar("twilio_message_sid", { length: 64 }),
      direction: varchar("direction", { length: 10 }).notNull(),
      stageIn: varchar("stage_in", { length: 32 }),
      stageOut: varchar("stage_out", { length: 32 }),
      intent: varchar("intent", { length: 32 }),
      intentConfidence: real("intent_confidence"),
      customerMsg: text("customer_msg"),
      emmaMsg: text("emma_msg"),
      toolCalls: json("tool_calls").$type(),
      inputTokens: integer("input_tokens"),
      outputTokens: integer("output_tokens"),
      latencyMs: integer("latency_ms"),
      errors: json("errors").$type(),
      fabricationCaught: varchar("fabrication_caught", { length: 32 }),
      pipelineVersion: varchar("pipeline_version", { length: 8 }).notNull(),
      // Migration 028: channel='sms' (default) or 'web'. Existing rows backfilled to 'sms'.
      channel: varchar("channel", { length: 8 }).notNull().default("sms"),
      // Migration 030: turn flagged when the engine recognized a vulnerability
      // disclosure and suspended the gate / suppressed the product pitch.
      softBeat: boolean("soft_beat").notNull().default(false),
      // Migration 032: set true when the Sonnet loop exhausted MAX_TOOL_HOPS with a
      // pending tool_use stop_reason — no final text was generated, safeFallback ran.
      // Powers the "tool budget exhausted rate" dashboard query in Phase 3.
      toolBudgetExhausted: boolean("tool_budget_exhausted").notNull().default(false),
      // Migration 033: set true when the dedup filter returned all_results_previously_pitched
      // (every search result was already in pitchedHandlesLog). Distinct from toolBudgetExhausted.
      // Powers the "repeat-pitch rate" dashboard query in Phase 3.
      searchRepeatedPitch: boolean("search_repeated_pitch").notNull().default(false),
      // Migration 036: free-form telemetry payload. Initial usage carries the SMS
      // discovery-gate advance signal (from, to, skipped, slotFilled) for skip-rate
      // analytics. Extensible — future per-turn telemetry can land here without
      // schema changes. See docs/what-matters-final-signoff.md.
      metadata: json("metadata").$type(),
      createdAt: timestamp("created_at").notNull().defaultNow()
    }, (t) => ({
      twilioSidUniq: uniqueIndex("sms_turns_twilio_sid_uniq").on(t.twilioMessageSid),
      phoneCreatedIdx: index("sms_turns_phone_created_idx").on(t.phone, t.createdAt),
      channelCreatedIdx: index("sms_turns_channel_idx").on(t.channel, t.createdAt)
    }));
    webConversations = pgTable("web_conversations", {
      sessionId: varchar("session_id", { length: 64 }).primaryKey(),
      stage: varchar("stage", { length: 32 }).notNull().default("GREETING"),
      currentPitchHandle: text("current_pitch_handle"),
      currentUpsellHandle: text("current_upsell_handle"),
      lastQuoteUrl: text("last_quote_url"),
      lastQuoteItems: json("last_quote_items").$type(),
      lastQuoteCreatedAt: timestamp("last_quote_created_at"),
      customerGid: text("customer_gid"),
      customerFirstName: text("customer_first_name"),
      customerDefaultZip: text("customer_default_zip"),
      pageHandle: text("page_handle"),
      pageRoute: text("page_route"),
      stageSetAt: timestamp("stage_set_at").notNull().defaultNow(),
      lastActiveAt: timestamp("last_active_at").notNull().defaultNow(),
      conversationId: uuid("conversation_id").notNull().defaultRandom(),
      // Migration 030: Emma discovery state machine + slot accumulator (web parity).
      discoveryState: json("discovery_state").$type(),
      discoveredSlots: json("discovered_slots").$type().notNull().default({}),
      // Migration 031: pending pdp link awaiting caller permission (voice; reserved for web).
      pendingPdpUrl: text("pending_pdp_url"),
      // Migration 032: Phase 0 memory primitives — mirror of sms_conversations columns.
      // Added now to avoid Phase 2 schema reconciliation cost when the participants
      // table aligns SMS and web identity.
      conversationSummary: text("conversation_summary"),
      pitchedHandlesLog: text("pitched_handles_log").array()
    }, (t) => ({
      // Phase 10: customer_gid indexes for cross-channel joins (additive).
      customerGidIdx: index("web_conversations_customer_gid_idx").on(t.customerGid),
      customerGidActiveIdx: index("web_conversations_gid_active_idx").on(t.customerGid, t.lastActiveAt)
    }));
    emmaChatThreads = pgTable("emma_chat_threads", {
      id: serial("id").primaryKey(),
      title: varchar("title", { length: 200 }).notNull().default("New thread"),
      redditPostUrl: text("reddit_post_url"),
      redditPostExcerpt: text("reddit_post_excerpt"),
      archived: boolean("archived").notNull().default(false),
      // Migration 038: discriminator so a second admin chat persona (product
      // manager) can share this table. Existing rows default to 'emma'.
      agentType: varchar("agent_type", { length: 20 }).notNull().default("emma"),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow()
    }, (t) => ({
      updatedIdx: index("emma_chat_threads_updated_idx").on(t.updatedAt),
      activeIdx: index("emma_chat_threads_active_idx").on(t.archived, t.updatedAt)
    }));
    emmaChatMessages = pgTable("emma_chat_messages", {
      id: serial("id").primaryKey(),
      threadId: integer("thread_id").notNull().references(() => emmaChatThreads.id, { onDelete: "cascade" }),
      role: varchar("role", { length: 10 }).notNull(),
      // 'user' | 'assistant' | 'tool'
      content: text("content").notNull().default(""),
      toolCalls: json("tool_calls").$type(),
      toolResults: json("tool_results").$type(),
      stopReason: varchar("stop_reason", { length: 20 }),
      inputTokens: integer("input_tokens"),
      outputTokens: integer("output_tokens"),
      latencyMs: integer("latency_ms"),
      createdAt: timestamp("created_at").notNull().defaultNow()
    }, (t) => ({
      threadIdx: index("emma_chat_messages_thread_idx").on(t.threadId, t.createdAt)
    }));
    pricingGroups = pgTable("pricing_groups", {
      id: text("id").primaryKey(),
      name: text("name").notNull(),
      usesClearanceLadder: boolean("uses_clearance_ladder").notNull().default(false),
      sortOrder: integer("sort_order").notNull().default(0)
    });
    pricingSubGroups = pgTable("pricing_sub_groups", {
      id: text("id").primaryKey(),
      groupId: text("group_id").notNull().references(() => pricingGroups.id, { onDelete: "cascade" }),
      name: text("name").notNull(),
      sortOrder: integer("sort_order").notNull().default(0)
    }, (t) => ({
      groupIdx: index("pricing_sub_groups_group_idx").on(t.groupId)
    }));
    pricingProductTypeMap = pgTable("pricing_product_type_map", {
      productType: text("product_type").primaryKey(),
      subGroupId: text("sub_group_id").notNull().references(() => pricingSubGroups.id, { onDelete: "cascade" })
    }, (t) => ({
      subGroupIdx: index("pricing_product_type_map_sub_group_idx").on(t.subGroupId)
    }));
    pricingRules = pgTable("pricing_rules", {
      scopeLevel: text("scope_level").notNull(),
      scopeId: text("scope_id").notNull(),
      targetMarginPct: decimal("target_margin_pct", { precision: 5, scale: 4 }),
      marginFloorPct: decimal("margin_floor_pct", { precision: 5, scale: 4 }),
      mapBehavior: text("map_behavior"),
      compareAtStrategy: text("compare_at_strategy"),
      velocityModifierEnabled: boolean("velocity_modifier_enabled"),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
      updatedBy: text("updated_by")
    }, (t) => ({
      pk: uniqueIndex("pricing_rules_pk").on(t.scopeLevel, t.scopeId)
    }));
    pricingAuditLog = pgTable("pricing_audit_log", {
      id: bigserial("id", { mode: "number" }).primaryKey(),
      occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
      variantId: text("variant_id").notNull(),
      sku: text("sku"),
      productType: text("product_type"),
      groupId: text("group_id"),
      subGroupId: text("sub_group_id"),
      trigger: text("trigger").notNull(),
      oldCost: decimal("old_cost", { precision: 10, scale: 2 }),
      newCost: decimal("new_cost", { precision: 10, scale: 2 }),
      oldMap: decimal("old_map", { precision: 10, scale: 2 }),
      newMap: decimal("new_map", { precision: 10, scale: 2 }),
      oldMsrp: decimal("old_msrp", { precision: 10, scale: 2 }),
      newMsrp: decimal("new_msrp", { precision: 10, scale: 2 }),
      oldSell: decimal("old_sell", { precision: 10, scale: 2 }),
      newSell: decimal("new_sell", { precision: 10, scale: 2 }),
      oldCompareAt: decimal("old_compare_at", { precision: 10, scale: 2 }),
      newCompareAt: decimal("new_compare_at", { precision: 10, scale: 2 }),
      marginBefore: decimal("margin_before", { precision: 6, scale: 4 }),
      marginAfter: decimal("margin_after", { precision: 6, scale: 4 }),
      status: text("status").notNull(),
      rationale: text("rationale")
    }, (t) => ({
      variantIdx: index("pricing_audit_log_variant_idx").on(t.variantId, t.occurredAt),
      occurredIdx: index("pricing_audit_log_occurred_idx").on(t.occurredAt)
    }));
    discoveryRules = pgTable("discovery_rules", {
      id: serial("id").primaryKey(),
      ruleType: varchar("rule_type", { length: 40 }).notNull(),
      ruleValue: text("rule_value").notNull(),
      category: varchar("category", { length: 20 }),
      // null = all categories
      sortOrder: integer("sort_order").default(0).notNull(),
      notes: text("notes"),
      active: boolean("active").default(true).notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    }, (t) => ({
      activeTypeIdx: index("idx_discovery_rules_active_type").on(t.active, t.ruleType)
    }));
    pricingChanges = pgTable("pricing_changes", {
      id: bigserial("id", { mode: "number" }).primaryKey(),
      proposedAt: timestamp("proposed_at", { withTimezone: true }).notNull().defaultNow(),
      runDate: date("run_date").notNull(),
      sku: text("sku").notNull(),
      productId: text("product_id").notNull(),
      productHandle: text("product_handle"),
      productTitle: text("product_title"),
      variantId: text("variant_id").notNull(),
      variantTitle: text("variant_title"),
      vendor: text("vendor"),
      tier: text("tier").notNull(),
      oldPrice: decimal("old_price", { precision: 10, scale: 2 }),
      newPrice: decimal("new_price", { precision: 10, scale: 2 }).notNull(),
      oldCompareAt: decimal("old_compare_at", { precision: 10, scale: 2 }),
      newCompareAt: decimal("new_compare_at", { precision: 10, scale: 2 }),
      oldWholesale: decimal("old_wholesale", { precision: 10, scale: 2 }),
      newWholesale: decimal("new_wholesale", { precision: 10, scale: 2 }),
      mapPrice: decimal("map_price", { precision: 10, scale: 2 }),
      marginPct: decimal("margin_pct", { precision: 6, scale: 4 }),
      reason: text("reason").notNull(),
      mapRespected: boolean("map_respected").notNull().default(true),
      status: text("status").notNull().default("pending"),
      appliedAt: timestamp("applied_at", { withTimezone: true }),
      approvedBy: text("approved_by"),
      applyError: text("apply_error")
    }, (t) => ({
      runDateIdx: index("pricing_changes_run_date_idx").on(t.runDate),
      statusIdx: index("pricing_changes_status_idx").on(t.status),
      variantIdx: index("pricing_changes_variant_idx").on(t.variantId, t.proposedAt),
      skuIdx: index("pricing_changes_sku_idx").on(t.sku, t.proposedAt)
    }));
    importCandidates = pgTable("import_candidates", {
      id: serial("id").primaryKey(),
      sku: varchar("sku", { length: 20 }).notNull().unique(),
      brand: varchar("brand", { length: 100 }),
      productTitle: text("product_title"),
      categories: json("categories").$type(),
      tier: varchar("tier", { length: 10 }).notNull(),
      // 'A'|'B'|'C'|'D'
      gapReason: text("gap_reason"),
      dealScore: decimal("deal_score", { precision: 5, scale: 3 }),
      msrp: decimal("msrp", { precision: 10, scale: 2 }),
      wholesaleCost: decimal("wholesale_cost", { precision: 10, scale: 2 }),
      mapPrice: decimal("map_price", { precision: 10, scale: 2 }),
      proposedPrice: decimal("proposed_price", { precision: 10, scale: 2 }),
      marginPct: decimal("margin_pct", { precision: 5, scale: 2 }),
      profitPerUnit: decimal("profit_per_unit", { precision: 10, scale: 2 }),
      qtyAvailable: integer("qty_available"),
      imageCount: integer("image_count"),
      inTop100Feed: boolean("in_top100_feed").notNull().default(false),
      inNewFeed: boolean("in_new_feed").notNull().default(false),
      inSaleFeed: boolean("in_sale_feed").notNull().default(false),
      status: varchar("status", { length: 20 }).notNull().default("pending"),
      rejectionReason: text("rejection_reason"),
      watchScore: decimal("watch_score", { precision: 5, scale: 3 }),
      watchPrice: decimal("watch_price", { precision: 10, scale: 2 }),
      dealHistoryId: integer("deal_history_id"),
      runDate: date("run_date").notNull(),
      firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
      lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
      reviewedAt: timestamp("reviewed_at"),
      reviewedBy: varchar("reviewed_by", { length: 100 }),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
      // Migration 039: master-level columns (one row per brand+base_title group).
      masterKey: varchar("master_key", { length: 200 }),
      baseTitle: text("base_title"),
      variantSkus: json("variant_skus").$type(),
      variantCount: integer("variant_count"),
      inStockVariants: integer("in_stock_variants"),
      colors: json("colors").$type(),
      sizes: json("sizes").$type(),
      volumes: json("volumes").$type(),
      axes: json("axes").$type(),
      totalQty: integer("total_qty"),
      needsReview: boolean("needs_review").notNull().default(false),
      upc: varchar("upc", { length: 40 }),
      sampleImage: text("sample_image"),
      // Migration 040: post-import lifecycle (enrich -> publish). `status='imported'`
      // stays terminal; these timestamps track the stages after import.
      enrichedAt: timestamp("enriched_at"),
      publishedAt: timestamp("published_at"),
      enrichBatchId: varchar("enrich_batch_id", { length: 100 })
    }, (t) => ({
      statusRunIdx: index("idx_import_candidates_status_run").on(t.status, t.runDate),
      tierScoreIdx: index("idx_import_candidates_tier_score").on(t.tier, t.dealScore),
      masterKeyIdx: uniqueIndex("idx_import_candidates_master_key").on(t.masterKey),
      enrichIdx: index("idx_import_candidates_enrich").on(t.status, t.enrichedAt)
    }));
    importMonitorRuns = pgTable("import_monitor_runs", {
      id: serial("id").primaryKey(),
      runDate: date("run_date").notNull(),
      startedAt: timestamp("started_at").notNull().defaultNow(),
      finishedAt: timestamp("finished_at"),
      source: varchar("source", { length: 20 }).notNull().default("cron"),
      // 'cron'|'manual'
      feedsOk: boolean("feeds_ok").notNull().default(false),
      candidatesFound: integer("candidates_found").notNull().default(0),
      candidatesNew: integer("candidates_new").notNull().default(0),
      candidatesResurfaced: integer("candidates_resurfaced").notNull().default(0),
      autoImported: integer("auto_imported").notNull().default(0),
      errorMessage: text("error_message")
    }, (t) => ({
      runDateIdx: index("idx_import_monitor_runs_date").on(t.runDate)
    }));
    enrichmentBatches = pgTable("enrichment_batches", {
      id: serial("id").primaryKey(),
      batchId: varchar("batch_id", { length: 100 }).notNull().unique(),
      status: varchar("status", { length: 20 }).notNull().default("pending"),
      // 'pending'|'collected'|'failed'
      candidateIds: json("candidate_ids").$type().notNull(),
      productIds: json("product_ids").$type().notNull(),
      succeeded: integer("succeeded").notNull().default(0),
      failed: integer("failed").notNull().default(0),
      error: text("error"),
      submittedAt: timestamp("submitted_at").notNull().defaultNow(),
      collectedAt: timestamp("collected_at")
    }, (t) => ({
      statusIdx: index("idx_enrichment_batches_status").on(t.status, t.submittedAt)
    }));
    batchJobs = pgTable("batch_jobs", {
      id: serial("id").primaryKey(),
      jobId: varchar("job_id", { length: 64 }).notNull(),
      jobType: varchar("job_type", { length: 32 }).notNull(),
      // 'full-enrichment' | 'emma-take' | 'emma-hero' | 'regenerate'
      status: varchar("status", { length: 20 }).default("queued").notNull(),
      // queued | submitted | processing | applying | done | failed
      source: varchar("source", { length: 32 }).notNull(),
      // entry point: 'bulk-import' | 'import-product' | 'deal-manager' | 'backfill' | ...
      skuList: json("sku_list").$type().notNull(),
      products: json("products").$type().notNull(),
      turn: integer("turn").default(0).notNull(),
      maxTurns: integer("max_turns").default(24).notNull(),
      batchIds: json("batch_ids").$type().default([]).notNull(),
      currentBatchId: varchar("current_batch_id", { length: 64 }),
      // Keyed by productId (Shopify GID). The runner persists each product
      // incrementally for crash-recovery within a turn (see C3a in spec).
      runnerState: json("runner_state").$type().default({}).notNull(),
      results: json("results").$type(),
      error: text("error"),
      gatesDealId: integer("gates_deal_id"),
      // dealHistory.id this job gates (nullable)
      appliedSkus: json("applied_skus").$type().default([]).notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      submittedAt: timestamp("submitted_at"),
      updatedAt: timestamp("updated_at").defaultNow().notNull(),
      completedAt: timestamp("completed_at"),
      failedAt: timestamp("failed_at")
    }, (t) => ({
      jobIdIdx: uniqueIndex("uq_batch_jobs_job_id").on(t.jobId),
      statusIdx: index("idx_batch_jobs_status").on(t.status, t.createdAt),
      // Partial index mirrors the SQL migration for the poller drain query.
      // Drizzle does not support partial indexes via the builder; the SQL migration
      // creates idx_batch_jobs_inflight directly. Listed here for documentation only.
      gatesDealIdx: index("idx_batch_jobs_gates_deal").on(t.gatesDealId)
    }));
    apiTokenLog = pgTable("api_token_log", {
      id: serial("id").primaryKey(),
      ts: timestamp("ts").defaultNow().notNull(),
      feature: varchar("feature", { length: 48 }).notNull(),
      // 'enrichment' | 'emma-chat' | 'sms' | 'ivr' | 'copy-gen' | ...
      model: varchar("model", { length: 64 }).notNull(),
      source: varchar("source", { length: 16 }).notNull(),
      // 'batch' | 'sync' | 'agent-sdk'
      batchId: varchar("batch_id", { length: 64 }),
      productId: varchar("product_id", { length: 64 }),
      sku: varchar("sku", { length: 32 }),
      caller: varchar("caller", { length: 96 }),
      inputTokens: integer("input_tokens").default(0).notNull(),
      outputTokens: integer("output_tokens").default(0).notNull(),
      cacheCreationTokens: integer("cache_creation_tokens").default(0).notNull(),
      cacheReadTokens: integer("cache_read_tokens").default(0).notNull(),
      requestCount: integer("request_count").default(1).notNull(),
      // >1 when one row aggregates a batch turn
      estCostUsd: decimal("est_cost_usd", { precision: 10, scale: 5 }).default("0").notNull(),
      requestId: varchar("request_id", { length: 64 })
      // IVR idempotency key (option B); null otherwise
    }, (t) => ({
      tsIdx: index("idx_api_token_log_ts").on(t.ts),
      featureTsIdx: index("idx_api_token_log_feature_ts").on(t.feature, t.ts)
      // Partial unique index for IVR idempotency (uq_api_token_log_request_id) and
      // the batch_id index are created in the SQL migration (Drizzle partial index
      // limitation). Listed here for documentation.
    }));
    metaCapiFailures = pgTable("meta_capi_failures", {
      id: serial("id").primaryKey(),
      orderId: varchar("order_id", { length: 64 }).notNull().unique(),
      eventId: varchar("event_id", { length: 128 }).notNull(),
      payload: jsonb("payload").notNull(),
      attempts: integer("attempts").notNull().default(0),
      lastError: text("last_error"),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      resolvedAt: timestamp("resolved_at")
    }, (t) => ({
      unresolvedIdx: index("idx_meta_capi_failures_unresolved").on(t.createdAt)
    }));
    homepagePayload = pgTable("homepage_payload", {
      id: serial("id").primaryKey(),
      variant: varchar("variant", { length: 8 }).notNull(),
      // 'a' (room for 'b'/'legacy')
      version: varchar("version", { length: 16 }).notNull(),
      // HOMEPAGE_PAYLOAD_VERSION
      payload: json("payload").$type().notNull(),
      degraded: boolean("degraded").notNull().default(false),
      builtAt: timestamp("built_at").notNull().defaultNow()
    }, (t) => ({
      variantVersionUniq: uniqueIndex("homepage_payload_variant_version_uniq").on(t.variant, t.version)
    }));
    discoveryIndexPayload = pgTable("discovery_index_payload", {
      id: serial("id").primaryKey(),
      version: varchar("version", { length: 16 }).notNull().unique(),
      // INDEX_VERSION
      indexJson: json("index_json").notNull(),
      // DiscoveryProduct[]
      vocabJson: json("vocab_json").notNull(),
      // DiscoveryVocab
      count: integer("count").notNull().default(0),
      builtAt: timestamp("built_at").notNull().defaultNow()
    });
    homepageTeamRuns = pgTable("homepage_team_runs", {
      id: serial("id").primaryKey(),
      team: varchar("team", { length: 24 }).notNull().default("homepage"),
      runType: varchar("run_type", { length: 24 }).notNull(),
      // merchandise|design|manual|social|ads|email|strategy|apply
      status: varchar("status", { length: 16 }).notNull().default("running"),
      currentPhase: varchar("current_phase", { length: 48 }),
      currentAgent: varchar("current_agent", { length: 48 }),
      summary: text("summary"),
      prUrl: text("pr_url"),
      error: text("error"),
      attemptCount: integer("attempt_count").notNull().default(1),
      startedAt: timestamp("started_at").notNull().defaultNow(),
      finishedAt: timestamp("finished_at")
    }, (t) => ({
      startedIdx: index("idx_homepage_team_runs_started").on(t.startedAt),
      statusIdx: index("idx_homepage_team_runs_status").on(t.status, t.startedAt),
      teamIdx: index("idx_team_runs_team").on(t.team, t.startedAt)
    }));
    homepageTeamEvents = pgTable("homepage_team_events", {
      id: serial("id").primaryKey(),
      runId: integer("run_id").notNull().references(() => homepageTeamRuns.id, { onDelete: "cascade" }),
      ts: timestamp("ts").notNull().defaultNow(),
      agentRole: varchar("agent_role", { length: 48 }),
      phase: varchar("phase", { length: 48 }),
      eventType: varchar("event_type", { length: 16 }).notNull(),
      // step|message|tool|decision|error
      summary: text("summary").notNull(),
      transcriptRef: text("transcript_ref")
      // Vercel Blob key
    }, (t) => ({
      runIdx: index("idx_homepage_team_events_run").on(t.runId, t.ts)
    }));
    homepageTeamSuggestions = pgTable("homepage_team_suggestions", {
      id: serial("id").primaryKey(),
      runId: integer("run_id").references(() => homepageTeamRuns.id, { onDelete: "set null" }),
      team: varchar("team", { length: 24 }).notNull().default("homepage"),
      targetTeam: varchar("target_team", { length: 24 }),
      category: varchar("category", { length: 32 }).notNull(),
      // model|turns|caching|prompt|agents|other
      kind: varchar("kind", { length: 16 }).notNull().default("process"),
      // process|strategy|instructions|agent-def|config|code|campaign|promo|program
      suggestion: text("suggestion").notNull(),
      estSavingsUsd: decimal("est_savings_usd", { precision: 10, scale: 4 }).notNull().default("0"),
      cxRisk: varchar("cx_risk", { length: 8 }).notNull().default("low"),
      // low|med|high
      status: varchar("status", { length: 12 }).notNull().default("proposed"),
      // proposed|approved|pr_open|applied|dismissed
      applyRef: text("apply_ref"),
      // PR URL / applied artifact
      decidedAt: timestamp("decided_at"),
      createdAt: timestamp("created_at").notNull().defaultNow()
    }, (t) => ({
      statusIdx: index("idx_homepage_team_suggestions_status").on(t.status, t.createdAt),
      teamIdx: index("idx_team_sugg_team").on(t.team, t.status, t.createdAt)
    }));
    strategyBriefs = pgTable("strategy_briefs", {
      id: serial("id").primaryKey(),
      weekStart: date("week_start").notNull(),
      brief: text("brief").notNull(),
      // markdown: focus, per-team directives, stop-doing list
      metricsJson: json("metrics_json"),
      // revenue, GA4, spend, engagement behind the calls
      status: varchar("status", { length: 12 }).notNull().default("active"),
      // active|superseded|draft
      createdBy: varchar("created_by", { length: 48 }).notNull().default("store-strategist"),
      createdAt: timestamp("created_at").notNull().defaultNow()
    }, (t) => ({
      statusIdx: index("idx_strategy_briefs_status").on(t.status, t.createdAt)
    }));
    adCampaigns = pgTable("ad_campaigns", {
      id: serial("id").primaryKey(),
      platform: varchar("platform", { length: 20 }).notNull(),
      // meta|x|google|reddit|other
      name: varchar("name", { length: 120 }).notNull(),
      objective: varchar("objective", { length: 40 }).notNull(),
      status: varchar("status", { length: 16 }).notNull().default("proposed"),
      // proposed|approved|launched|paused|ended|rejected
      plannedDailyCents: integer("planned_daily_cents").notNull().default(0),
      plannedTotalCents: integer("planned_total_cents"),
      actualSpendUsd: decimal("actual_spend_usd", { precision: 10, scale: 2 }).notNull().default("0"),
      externalCampaignId: varchar("external_campaign_id", { length: 64 }),
      audienceJson: json("audience_json"),
      creativeJson: json("creative_json"),
      // copy variants, media refs, landing UTMs
      policyCheck: text("policy_check").notNull(),
      // REQUIRED docs/ads-policy.md compliance note
      runId: integer("run_id").references(() => homepageTeamRuns.id, { onDelete: "set null" }),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow()
    }, (t) => ({
      statusIdx: index("idx_ad_campaigns_status").on(t.status, t.createdAt)
    }));
    marketingCalendar = pgTable("marketing_calendar", {
      id: serial("id").primaryKey(),
      eventDate: date("event_date").notNull(),
      name: varchar("name", { length: 120 }).notNull(),
      type: varchar("type", { length: 16 }).notNull().default("promo"),
      // holiday|promo|campaign
      theme: text("theme"),
      status: varchar("status", { length: 12 }).notNull().default("planned"),
      // planned|active|done|skipped
      assetsJson: json("assets_json"),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow()
    }, (t) => ({
      dateIdx: index("idx_marketing_calendar_date").on(t.eventDate)
    }));
  }
});

// app/lib/db.server.ts
var db_server_exports = {};
__export(db_server_exports, {
  db: () => db
});
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
var sql, db;
var init_db_server = __esm({
  "app/lib/db.server.ts"() {
    "use strict";
    init_schema();
    sql = neon(process.env["DATABASE_URL"]);
    db = drizzle(sql, { schema: schema_exports });
  }
});

// app/lib/pricing-engine-v2.server.ts
function round2(n) {
  return Math.round(n * 100) / 100;
}
function roundPsychological(n, ending = ".99") {
  if (n < 1) return round2(n);
  const suffix = parseFloat(ending);
  const floored = Math.floor(n);
  const candidate = floored - (1 - suffix);
  return candidate > 0 ? round2(candidate) : round2(n);
}
function applyVelocityModifier(cfg, bucket) {
  const shift = VELOCITY_SHIFT[bucket];
  return {
    ...cfg,
    target_margin_pct: cfg.target_margin_pct + shift
  };
}
function computePrice(params) {
  const { cost, map, msrp, cfg } = params;
  const absolutePriceFloor = params.absolutePriceFloor ?? ABSOLUTE_PRICE_FLOOR_DEFAULT;
  if (cost == null) return null;
  const target = cost / (1 - cfg.target_margin_pct);
  const floor = cost / (1 - cfg.margin_floor_pct);
  let sell = target;
  if (cfg.map_behavior !== "ignore_map" && map != null) {
    sell = Math.max(sell, map);
    if (cfg.map_behavior === "above_map_only" && sell === map) {
      sell += 0.01;
    }
  }
  sell = Math.max(sell, floor);
  if (msrp != null) {
    sell = Math.min(sell, msrp);
  }
  sell = roundPsychological(sell);
  const compare_at = cfg.compare_at_strategy === "msrp" && msrp != null && sell < msrp ? msrp : null;
  return { sell, compare_at, belowAbsoluteFloor: sell < absolutePriceFloor };
}
function computeDiscontinuedPrice(params) {
  const { cost, msrp, daysDiscontinued, cfg } = params;
  if (msrp == null || cost == null) return null;
  const entry = CLEARANCE_LADDER.find(([maxDays]) => daysDiscontinued <= maxDays);
  const discountPct = entry ? entry[1] : 0.5;
  let sell = msrp * (1 - discountPct);
  const floor = cost / (1 - cfg.margin_floor_pct);
  sell = Math.max(sell, floor);
  return { sell: roundPsychological(sell), compare_at: msrp };
}
var ABSOLUTE_PRICE_FLOOR_DEFAULT, VELOCITY_SHIFT, CLEARANCE_LADDER;
var init_pricing_engine_v2_server = __esm({
  "app/lib/pricing-engine-v2.server.ts"() {
    "use strict";
    ABSOLUTE_PRICE_FLOOR_DEFAULT = 2.99;
    VELOCITY_SHIFT = {
      top: 0.05,
      normal: 0,
      slow: -0.05,
      dead: -0.1
    };
    CLEARANCE_LADDER = [
      [30, 0.15],
      [60, 0.25],
      [90, 0.35],
      [1e4, 0.5]
    ];
  }
});

// app/lib/pricing-rules.server.ts
import { eq, inArray } from "drizzle-orm";
function cacheGet(map, key) {
  const entry = map.get(key);
  if (!entry) return void 0;
  if (Date.now() > entry.expiresAt) {
    map.delete(key);
    return void 0;
  }
  return entry.value;
}
function cacheSet(map, key, value) {
  map.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}
function toPartial(raw) {
  const out = {};
  if (raw.targetMarginPct != null) out.target_margin_pct = parseFloat(raw.targetMarginPct);
  if (raw.marginFloorPct != null) out.margin_floor_pct = parseFloat(raw.marginFloorPct);
  if (raw.mapBehavior != null) out.map_behavior = raw.mapBehavior;
  if (raw.compareAtStrategy != null) out.compare_at_strategy = raw.compareAtStrategy;
  if (raw.velocityModifierEnabled != null) out.velocity_modifier_enabled = raw.velocityModifierEnabled;
  return out;
}
async function fetchRules(scopePairs) {
  if (scopePairs.length === 0) return /* @__PURE__ */ new Map();
  const ids = scopePairs.map(([, id]) => id);
  const rows = await db.select().from(pricingRules).where(inArray(pricingRules.scopeId, ids));
  const map = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const key = `${row.scopeLevel}:${row.scopeId}`;
    map.set(key, {
      targetMarginPct: row.targetMarginPct ?? null,
      marginFloorPct: row.marginFloorPct ?? null,
      mapBehavior: row.mapBehavior ?? null,
      compareAtStrategy: row.compareAtStrategy ?? null,
      velocityModifierEnabled: row.velocityModifierEnabled ?? null
    });
  }
  return map;
}
async function getGroupForProductType(productType) {
  const cacheKey3 = productType ?? "__null__";
  const cached2 = cacheGet(GROUP_CACHE, cacheKey3);
  if (cached2 !== void 0) return cached2;
  if (!productType) {
    cacheSet(GROUP_CACHE, cacheKey3, null);
    return null;
  }
  const rows = await db.select({
    subGroupId: pricingProductTypeMap.subGroupId,
    groupId: pricingSubGroups.groupId
  }).from(pricingProductTypeMap).innerJoin(
    pricingSubGroups,
    eq(pricingProductTypeMap.subGroupId, pricingSubGroups.id)
  ).where(eq(pricingProductTypeMap.productType, productType)).limit(1);
  if (rows.length === 0) {
    cacheSet(GROUP_CACHE, cacheKey3, null);
    return null;
  }
  const { pricingGroups: pricingGroups2 } = await Promise.resolve().then(() => (init_schema(), schema_exports));
  const groupRows = await db.select({ usesClearanceLadder: pricingGroups2.usesClearanceLadder }).from(pricingGroups2).where(eq(pricingGroups2.id, rows[0].groupId)).limit(1);
  const result = {
    groupId: rows[0].groupId,
    subGroupId: rows[0].subGroupId,
    usesClearanceLadder: groupRows[0]?.usesClearanceLadder ?? false
  };
  cacheSet(GROUP_CACHE, cacheKey3, result);
  return result;
}
async function resolvePricingConfig(productType) {
  const cacheKey3 = productType ?? "__null__";
  const cached2 = cacheGet(CONFIG_CACHE, cacheKey3);
  if (cached2 !== void 0) return cached2;
  const group = await getGroupForProductType(productType);
  const groupId = group?.groupId ?? "unknown";
  const subGroupId = group?.subGroupId ?? "unknown";
  const scopePairs = [["global", "global"]];
  if (groupId !== "unknown") {
    scopePairs.push(["group", groupId]);
  }
  if (subGroupId !== "unknown" && subGroupId !== groupId) {
    scopePairs.push(["sub_group", subGroupId]);
  }
  if (productType) {
    scopePairs.push(["product_type", productType]);
  }
  const ruleMap = await fetchRules(scopePairs);
  let merged = { ...GLOBAL_DEFAULTS };
  for (const [level, id] of scopePairs) {
    const raw = ruleMap.get(`${level}:${id}`);
    if (raw) {
      merged = { ...merged, ...toPartial(raw) };
    }
  }
  const result = { ...merged, groupId, subGroupId };
  cacheSet(CONFIG_CACHE, cacheKey3, result);
  return result;
}
function buildRationale(p) {
  const margin = p.marginAfter != null ? `${Math.round(p.marginAfter * 100)}%` : "?%";
  if (p.status === "skipped_no_change") {
    return "Cost unchanged; recompute matched current price; no action.";
  }
  if (p.daysDisc != null) {
    const tier = p.daysDisc <= 30 ? "15%" : p.daysDisc <= 60 ? "25%" : p.daysDisc <= 90 ? "35%" : "50%";
    const sell = p.newSell != null ? `$${p.newSell.toFixed(2)}` : "?";
    return `Discontinued day ${p.daysDisc} -> clearance tier ${tier} off MSRP -> ${sell}.`;
  }
  if (p.velocityBucket && p.velocityBucket !== "normal") {
    const dir = p.velocityBucket === "top" ? "+5pp" : p.velocityBucket === "slow" ? "-5pp" : "-10pp";
    const label = p.velocityBucket === "top" ? "fast" : p.velocityBucket === "slow" ? "slow" : "dead";
    const oldFmt = p.oldSell != null ? `$${p.oldSell.toFixed(2)}` : "?";
    const newFmt = p.newSell != null ? `$${p.newSell.toFixed(2)}` : "?";
    return `Velocity: ${label} -> target margin ${dir}; new sell ${newFmt} (was ${oldFmt}).`;
  }
  if (p.status === "pending" && p.deltaPct != null && p.approvalThreshold != null) {
    const pct = Math.round(Math.abs(p.deltaPct) * 100);
    const thr = Math.round(p.approvalThreshold * 100);
    return `Queued: ${pct}% price drop exceeds ${thr}% auto-approve threshold.`;
  }
  if (p.mapHeld && p.map != null) {
    const delta = p.oldCost != null && p.newCost != null ? p.newCost - p.oldCost : null;
    const deltaPct = delta != null && p.oldCost ? Math.round(delta / p.oldCost * 100) : null;
    if (delta != null && deltaPct != null) {
      const sign = delta >= 0 ? "+" : "";
      return `Cost ${sign}$${delta.toFixed(2)} (${sign}${deltaPct}%) -> held sell at MAP $${p.map.toFixed(2)}; margin now ${margin}.`;
    }
  }
  if (p.status === "auto_applied") {
    const oldFmt = p.oldSell != null ? `$${p.oldSell.toFixed(2)}` : "?";
    const newFmt = p.newSell != null ? `$${p.newSell.toFixed(2)}` : "?";
    return `Auto-applied: sell ${oldFmt} -> ${newFmt}; margin now ${margin}.`;
  }
  if (p.status === "rejected") {
    return `Rejected: margin ${margin} below floor or MAP not satisfied.`;
  }
  return `Recomputed via ${p.trigger}; margin ${margin}.`;
}
var CONFIG_CACHE, GROUP_CACHE, CACHE_TTL_MS, GLOBAL_DEFAULTS;
var init_pricing_rules_server = __esm({
  "app/lib/pricing-rules.server.ts"() {
    "use strict";
    init_db_server();
    init_schema();
    CONFIG_CACHE = /* @__PURE__ */ new Map();
    GROUP_CACHE = /* @__PURE__ */ new Map();
    CACHE_TTL_MS = 5 * 60 * 1e3;
    GLOBAL_DEFAULTS = {
      target_margin_pct: 0.5,
      margin_floor_pct: 0.25,
      map_behavior: "at_map",
      compare_at_strategy: "msrp",
      velocity_modifier_enabled: false
    };
  }
});

// app/lib/kv.server.ts
var kv_server_exports = {};
__export(kv_server_exports, {
  DEFAULT_VAULT_TABS: () => DEFAULT_VAULT_TABS,
  KV_KEYS: () => KV_KEYS,
  cached: () => cached,
  getPinnedAccessoryIds: () => getPinnedAccessoryIds,
  getVaultFilterTabs: () => getVaultFilterTabs,
  invalidateCache: () => invalidateCache,
  isKvConfigured: () => isKvConfigured,
  kvDel: () => kvDel,
  kvGet: () => kvGet,
  kvIncr: () => kvIncr,
  kvSet: () => kvSet,
  kvSetNX: () => kvSetNX,
  setPinnedAccessoryIds: () => setPinnedAccessoryIds
});
function resolveKvCreds() {
  const env = process.env;
  if (env["KV_DISABLE"] === "1" || env["KV_DISABLE"] === "true") return null;
  if (env["KV_REST_API_URL"] && env["KV_REST_API_TOKEN"]) {
    return { url: env["KV_REST_API_URL"], token: env["KV_REST_API_TOKEN"] };
  }
  for (const key of Object.keys(env)) {
    if (!key.endsWith("_KV_REST_API_URL")) continue;
    const prefix = key.slice(0, -"_KV_REST_API_URL".length);
    const url = env[key];
    const token = env[`${prefix}_KV_REST_API_TOKEN`];
    if (url && token) return { url, token };
  }
  return null;
}
async function getKV() {
  if (_kv) return _kv;
  const creds = resolveKvCreds();
  if (!creds) return null;
  const { createClient: createClient9 } = await import("@vercel/kv");
  _kv = createClient9(creds);
  return _kv;
}
function isKvConfigured() {
  return resolveKvCreds() !== null;
}
function warnKvFallback(op, err) {
  const now = Date.now();
  if (now - _lastKvWarn < 6e4) return;
  _lastKvWarn = now;
  console.warn(`[kv] ${op} failed, falling back to in-memory:`, err instanceof Error ? err.message : err);
}
function memGet(key) {
  return memStore.get(key) ?? null;
}
function memSet(key, value, exSeconds) {
  memStore.set(key, value);
  const existing = memTimers.get(key);
  if (existing) clearTimeout(existing);
  if (exSeconds && exSeconds > 0) {
    const t = setTimeout(() => {
      memStore.delete(key);
      memTimers.delete(key);
    }, exSeconds * 1e3);
    if (typeof t.unref === "function") {
      t.unref();
    }
    memTimers.set(key, t);
  } else {
    memTimers.delete(key);
  }
}
function memDel(key) {
  memStore.delete(key);
  const t = memTimers.get(key);
  if (t) {
    clearTimeout(t);
    memTimers.delete(key);
  }
}
async function kvGet(key) {
  const kv = await getKV();
  if (kv) {
    try {
      return await kv.get(key);
    } catch (err) {
      warnKvFallback("get", err);
    }
  }
  return memGet(key);
}
async function kvSet(key, value, _exSeconds) {
  const kv = await getKV();
  if (kv) {
    try {
      if (_exSeconds) await kv.set(key, value, { ex: _exSeconds });
      else await kv.set(key, value);
      return;
    } catch (err) {
      warnKvFallback("set", err);
    }
  }
  memSet(key, value, _exSeconds);
}
async function kvIncr(key) {
  const kv = await getKV();
  if (kv) {
    try {
      return await kv.incr(key);
    } catch (err) {
      warnKvFallback("incr", err);
    }
  }
  const current = memStore.get(key) ?? 0;
  memStore.set(key, current + 1);
  return current + 1;
}
async function kvDel(key) {
  const kv = await getKV();
  if (kv) {
    try {
      await kv.del(key);
      return;
    } catch (err) {
      warnKvFallback("del", err);
    }
  }
  memDel(key);
}
async function kvSetNX(key, value, exSeconds) {
  const kv = await getKV();
  if (kv) {
    try {
      const result = await kv.set(key, value, { nx: true, ex: exSeconds });
      return result === "OK";
    } catch (err) {
      warnKvFallback("setNX", err);
    }
  }
  if (memGet(key) !== null) return false;
  memSet(key, value, exSeconds);
  return true;
}
async function cached(key, ttlSeconds, fn) {
  const ttlMs = ttlSeconds * 1e3;
  const now = Date.now();
  const l1 = readCache.get(key);
  if (l1 && now - l1.ts < ttlMs) return l1.data;
  const l2 = await kvGet(key);
  if (l2 && now - l2.ts < ttlMs) {
    readCache.set(key, l2);
    return l2.data;
  }
  const data = await fn();
  const entry = { data, ts: now };
  readCache.set(key, entry);
  await kvSet(key, entry, ttlSeconds + 60);
  return data;
}
function invalidateCache(prefix) {
  for (const k of readCache.keys()) {
    if (k.startsWith(prefix)) readCache.delete(k);
  }
}
async function getVaultFilterTabs() {
  const stored = await kvGet(KV_KEYS.vaultFilterTabs);
  return stored ?? DEFAULT_VAULT_TABS;
}
async function getPinnedAccessoryIds() {
  const ids = await kvGet(KV_KEYS.pinnedAccessoryIds);
  return Array.isArray(ids) ? ids : [];
}
async function setPinnedAccessoryIds(ids) {
  await kvSet(KV_KEYS.pinnedAccessoryIds, ids);
}
var _kv, _g, memStore, _g3, memTimers, _lastKvWarn, _g2, readCache, KV_KEYS, DEFAULT_VAULT_TABS;
var init_kv_server = __esm({
  "app/lib/kv.server.ts"() {
    "use strict";
    _kv = null;
    _g = globalThis;
    if (!_g.__kvMemStore) _g.__kvMemStore = /* @__PURE__ */ new Map();
    memStore = _g.__kvMemStore;
    _g3 = globalThis;
    if (!_g3.__kvMemTimers) _g3.__kvMemTimers = /* @__PURE__ */ new Map();
    memTimers = _g3.__kvMemTimers;
    _lastKvWarn = 0;
    _g2 = globalThis;
    if (!_g2.__readCache) _g2.__readCache = /* @__PURE__ */ new Map();
    readCache = _g2.__readCache;
    KV_KEYS = {
      feedCache: "nalpac:feed:cache",
      feedCacheTimestamp: "nalpac:feed:timestamp",
      socialProof: (handle) => `social:proof:${handle}`,
      dealOfDay: "deal:today",
      viewerCount: (handle) => `viewers:${handle}`,
      pinnedAccessoryIds: "pinned:accessory_ids",
      vaultFilterTabs: "vault:filter_tabs",
      bulkImportJob: "bulk-import:job",
      veoOperation: (token) => `veo:op:${token}`,
      ltxOperation: (token) => `ltx:op:${token}`,
      liveDealHandle: "live-deal:handle",
      fbt: (handle) => `fbt:${handle}`,
      collectionCursor: (handle, page, sort = "manual") => `vault:cursor:${handle}:${sort}:p${page}`,
      // v2 redesign — dial vote aggregates (5-min TTL)
      dialAggregate: (shopifyProductId) => `dial:agg:${shopifyProductId}`,
      // PDP product-level aggregate vote (thumbs up/down on the whole dial)
      productVoteAggregate: (shopifyProductId) => `dial:product-agg:${shopifyProductId}`,
      // PDP contextual Emma aside (24h TTL; guest/empty inputs collapse to one key per product)
      emmaAside: (productId, userBucket, cartHash, browseHash) => `emmaAside:${productId}:${userBucket}:${cartHash}:${browseHash}`,
      emmaAsideLock: (productId) => `emmaAside:lock:${productId}`,
      emmaAsideDailyCount: (utcDate) => `emmaAside:dailyCount:${utcDate}`,
      // Cart drawer Emma aside (24h TTL; cart+profile+subtotal-band collapse to one key)
      emmaCartAside: (variant, userBucket, cartHash, searchHash, subtotalBand) => `emmaCartAside:${variant}:${userBucket}:${cartHash}:${searchHash}:${subtotalBand}`,
      emmaCartAsideLock: (cartHash) => `emmaCartAside:lock:${cartHash}`,
      emmaCartAsideDailyCount: (utcDate) => `emmaCartAside:dailyCount:${utcDate}`,
      // Discovery rail on /search + /collections (10-min TTL per query+filter+recentView hash)
      emmaDiscovery: (hash) => `emmaDiscovery:v1:${hash}`,
      emmaDiscoveryDailyCount: (utcDate) => `emmaDiscovery:dailyCount:${utcDate}`,
      // Encouragement strip above discovery grid (30-min TTL per filter combination)
      emmaEncouragement: (hash) => `emmaEncouragement:v2:${hash}`,
      emmaEncouragementDailyCount: (utcDate) => `emmaEncouragement:dailyCount:${utcDate}`,
      // Batch enrichment job summary mirrored from DB for fast admin poll surface (24h TTL)
      enrichmentJob: (jobId) => `batch-job:${jobId}`
    };
    DEFAULT_VAULT_TABS = [
      { id: "all", label: "All", slug: "all", filter: { type: "all" } },
      { id: "for-him", label: "For Him", slug: "for-him", filter: { type: "collection", handle: "for-him" } },
      { id: "for-her", label: "For Her", slug: "for-her", filter: { type: "collection", handle: "for-her" } },
      { id: "couples", label: "Couples", slug: "couples", filter: { type: "collection", handle: "couples" } },
      { id: "under-25", label: "Under $25", slug: "under-25", filter: { type: "price", max: 25 } },
      { id: "under-50", label: "Under $50", slug: "under-50", filter: { type: "price", max: 50 } }
    ];
  }
});

// app/lib/tag-normalize.ts
function normalizeTag(input) {
  let s = input.trim().toLowerCase();
  for (const p of PREFIXES) {
    if (s.startsWith(p)) {
      s = s.slice(p.length);
      break;
    }
  }
  s = s.replace(/'+/g, "");
  s = s.replace(/&/g, " and ");
  s = s.replace(/[^a-z0-9]+/g, "-");
  s = s.replace(/^-+|-+$/g, "");
  return s;
}
function normalizeTagList(input) {
  if (!input) return [];
  const seen = /* @__PURE__ */ new Set();
  for (const raw of input) {
    const n = normalizeTag(raw);
    if (n) seen.add(n);
  }
  return Array.from(seen);
}
function isOperationalTag(tag) {
  const t = tag.trim().toLowerCase();
  if (OPERATIONAL_TAG_EXACT.has(t)) return true;
  return OPERATIONAL_TAG_PREFIXES.some((p) => t.startsWith(p));
}
function editorialTagsOnly(input) {
  if (!input) return [];
  return input.filter((t) => t.trim() !== "" && !isOperationalTag(t));
}
var PREFIXES, OPERATIONAL_TAG_PREFIXES, OPERATIONAL_TAG_EXACT;
var init_tag_normalize = __esm({
  "app/lib/tag-normalize.ts"() {
    "use strict";
    PREFIXES = ["cat:", "brand:"];
    OPERATIONAL_TAG_PREFIXES = ["cat:", "brand:", "price:", "nalpac-sku-", "deal-status-"];
    OPERATIONAL_TAG_EXACT = /* @__PURE__ */ new Set(["for-him", "for-her", "for-couples"]);
  }
});

// app/lib/master-collapse.server.ts
function isEligible(master) {
  if (DISPLAY_TESTER_PATTERNS.test(master.category) || DISPLAY_TESTER_PATTERNS.test(master.displayTitle)) {
    return { ok: false, reason: "display_or_tester" };
  }
  if (master.totalQty < QTY_FLOOR) {
    return { ok: false, reason: "qty_below_20" };
  }
  if (!master.sampleImage) {
    return { ok: false, reason: "no_image" };
  }
  if (master.wholesale <= 0 || master.msrp <= 0) {
    return { ok: false, reason: "missing_pricing" };
  }
  return { ok: true };
}
function gapScore(master) {
  const marginPct2 = master.marginMsrpPct * 100;
  return marginPct2 / 50 * (1 + Math.log(1 + master.variantCount)) * (1 + 0.2 * Math.log(1 + master.totalQty));
}
function splitCell(val) {
  return val.split(/[,/]/).map((s) => s.trim()).filter(Boolean);
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function buildBaseTitle(productTitle, colorCell, sizeCell) {
  let t = productTitle;
  t = t.replace(VOLUME_PACKAGING_PATTERN, " ");
  for (const token of splitCell(colorCell)) {
    if (!token) continue;
    const pattern = /\s/.test(token) ? new RegExp(`(?<![a-z0-9])${escapeRegex(token)}(?![a-z0-9])`, "gi") : new RegExp(`\\b${escapeRegex(token)}\\b`, "gi");
    t = t.replace(pattern, " ");
  }
  for (const token of splitCell(sizeCell)) {
    if (!token) continue;
    const pattern = /\s/.test(token) ? new RegExp(`(?<![a-z0-9])${escapeRegex(token)}(?![a-z0-9])`, "gi") : new RegExp(`\\b${escapeRegex(token)}\\b`, "gi");
    t = t.replace(pattern, " ");
  }
  for (const sz of [...SIZE_WORD_TOKENS].sort((a, b) => b.length - a.length)) {
    const pattern = /\s/.test(sz) ? new RegExp(`(?<![a-z0-9])${escapeRegex(sz)}(?![a-z0-9])`, "gi") : new RegExp(`\\b${escapeRegex(sz)}\\b`, "gi");
    t = t.replace(pattern, " ");
  }
  for (const color of COMMON_COLOR_WORDS) {
    t = t.replace(new RegExp(`\\b${escapeRegex(color)}\\b`, "gi"), " ");
  }
  for (const word of STRUCTURAL_RESIDUE_WORDS) {
    t = t.replace(new RegExp(`\\b${escapeRegex(word)}\\b`, "gi"), " ");
  }
  t = t.replace(/\s+/g, " ").trim().replace(/^[-_/.,\s]+|[-_/.,\s]+$/g, "").trim();
  return t.toLowerCase();
}
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function collapseMasters(snapshots) {
  const buckets = /* @__PURE__ */ new Map();
  for (const snap of snapshots.values()) {
    const brand = (snap.vendor ?? "").trim();
    const title = (snap.productTitle ?? "").trim();
    if (!brand || !title) continue;
    const row = snap.raw.mainRow ?? snap.raw.saleRow;
    const colorCell = row?.["Color"] ?? "";
    const sizeCell = row?.["Size"] ?? "";
    const base = buildBaseTitle(title, colorCell, sizeCell);
    const effectiveBase = base || title.toLowerCase().replace(/\s+/g, " ").trim();
    const key = `${brand.toLowerCase()}|${effectiveBase}`;
    if (!buckets.has(key)) buckets.set(key, { snaps: [] });
    buckets.get(key).snaps.push(snap);
  }
  const records = [];
  for (const [masterKey, { snaps }] of buckets) {
    const [brandPart] = masterKey.split("|");
    const baseTitle = masterKey.slice(brandPart.length + 1);
    let totalQty = 0;
    let inStockCount = 0;
    const wholesales = [];
    const msrps = [];
    const maps = [];
    const colors = /* @__PURE__ */ new Set();
    const sizes = /* @__PURE__ */ new Set();
    const fluidOzSet = /* @__PURE__ */ new Set();
    const skus = [];
    const upcs = [];
    const subCatCount = /* @__PURE__ */ new Map();
    let sampleImage = "";
    let displayTitle = "";
    let inTop100Feed = false;
    let inNewFeed = false;
    let inSaleFeed = false;
    for (const snap of snaps) {
      skus.push(snap.sku);
      const row = snap.raw.mainRow ?? snap.raw.saleRow;
      const upc = row?.["UPC/barcode"] ?? "";
      if (upc) upcs.push(upc);
      if (snap.wholesale > 0) wholesales.push(snap.wholesale);
      if (snap.msrp > 0) msrps.push(snap.msrp);
      if (snap.mapPrice != null && snap.mapPrice > 0) maps.push(snap.mapPrice);
      const qty = snap.qty ?? 0;
      totalQty += qty;
      if (qty > 0) inStockCount++;
      const colorCell = row?.["Color"] ?? "";
      for (const c of splitCell(colorCell)) {
        if (c) colors.add(c);
      }
      const sizeCell = row?.["Size"] ?? "";
      for (const s of splitCell(sizeCell)) {
        if (s) sizes.add(s);
      }
      const oz = row?.["Fluid Oz"] ?? "";
      if (oz.trim()) fluidOzSet.add(oz.trim());
      const title = snap.productTitle ?? "";
      if (title.length > displayTitle.length) displayTitle = title;
      if (!sampleImage) {
        const img = row?.["Image 1"] ?? "";
        if (img) sampleImage = img;
      }
      const subCat = row?.["Sub-Category"] ?? "";
      if (subCat) {
        subCatCount.set(subCat, (subCatCount.get(subCat) ?? 0) + 1);
      }
      if (snap.inTop100Feed) inTop100Feed = true;
      if (snap.inNewFeed) inNewFeed = true;
      if (snap.inSaleFeed) inSaleFeed = true;
    }
    const medWholesale = median(wholesales);
    const medMsrp = median(msrps);
    const medMap = median(maps.length > 0 ? maps : [0]);
    const marginMsrpPct = medMsrp > 0 ? (medMsrp - medWholesale) / medMsrp : 0;
    const marginMapPct = medMap > 0 ? (medMap - medWholesale) / medMap : 0;
    let category = UNCATEGORIZED_SENTINEL;
    let maxCount = 0;
    for (const [cat, count] of subCatCount) {
      if (count > maxCount) {
        maxCount = count;
        category = cat;
      }
    }
    const brandDisplay = snaps[0]?.vendor ?? brandPart;
    records.push({
      masterKey,
      brand: brandDisplay,
      displayTitle,
      baseTitle,
      category,
      variantCount: snaps.length,
      inStockVariants: inStockCount,
      colors: [...colors],
      sizes: [...sizes],
      fluidOz: [...fluidOzSet],
      totalQty,
      wholesale: medWholesale,
      msrp: medMsrp,
      map: medMap,
      marginMsrpPct,
      marginMapPct,
      profitPerUnit: (medMsrp > 0 ? medMsrp : medMap) - medWholesale,
      skus,
      sampleImage,
      upcs,
      inTop100Feed,
      inNewFeed,
      inSaleFeed,
      snapshots: snaps
    });
  }
  return records;
}
function sizeRank(s) {
  const idx = SIZE_SORT_ORDER.indexOf(s);
  return idx === -1 ? SIZE_SORT_ORDER.length : idx;
}
function detectAxes(master) {
  const snaps = master.snapshots;
  const perSku = snaps.map((snap) => {
    const row = snap.raw.mainRow ?? snap.raw.saleRow;
    return {
      sku: snap.sku,
      snap,
      colors: splitCell(row?.["Color"] ?? "").filter((c) => c !== ""),
      sizes: splitCell(row?.["Size"] ?? "").filter((s) => s !== ""),
      fluidOz: (row?.["Fluid Oz"] ?? "").trim(),
      title: snap.productTitle ?? "",
      upc: row?.["UPC/barcode"] ?? ""
    };
  });
  const primaryColors = perSku.map((s) => s.colors[0] ?? "");
  const distinctColors = new Set(primaryColors.filter((c) => c !== ""));
  const hasRealColor = distinctColors.size > 1 && [...distinctColors].some((c) => !UNINFORMATIVE_COLORS.has(c.toLowerCase()));
  const primarySizes = perSku.map((s) => s.sizes[0] ?? "");
  const hasSomeSize = primarySizes.some((s) => s !== "");
  const hasSomeBlank = primarySizes.some((s) => s === "");
  let effectiveSizes = primarySizes;
  if (hasSomeSize && hasSomeBlank) {
    effectiveSizes = primarySizes.map((s) => s === "" ? "Regular" : s);
  }
  const distinctSizes = new Set(effectiveSizes.filter((s) => s !== ""));
  const hasSizeAxis = distinctSizes.size > 1;
  const distinctFlOz = new Set(perSku.map((s) => s.fluidOz).filter((oz) => oz !== ""));
  const hasVolumeAxis = distinctFlOz.size > 1;
  function buildOptionTuple(idx) {
    const tuple = [];
    if (hasRealColor) tuple.push(primaryColors[idx] ?? "");
    if (hasSizeAxis) tuple.push(effectiveSizes[idx] ?? "");
    if (hasVolumeAxis) tuple.push(perSku[idx]?.fluidOz ?? "");
    return tuple;
  }
  const initialTuples = perSku.map((_, i) => buildOptionTuple(i));
  const tupleStrings = initialTuples.map((t) => t.join("|"));
  const hasCollision = tupleStrings.length !== new Set(tupleStrings).size;
  let usesTwistB = false;
  let derivedColors = [];
  if (hasCollision && !hasRealColor) {
    derivedColors = perSku.map((sv) => {
      let t = sv.title;
      const baseWords = master.baseTitle.split(/\s+/);
      for (const word of baseWords) {
        if (!word) continue;
        t = t.replace(new RegExp(`\\b${escapeRegex(word)}\\b`, "gi"), " ");
      }
      if (hasSizeAxis) {
        for (const sz of [...distinctSizes]) {
          t = t.replace(new RegExp(`\\b${escapeRegex(sz)}\\b`, "gi"), " ");
        }
      }
      if (hasVolumeAxis) {
        for (const oz of [...distinctFlOz]) {
          t = t.replace(new RegExp(`\\b${escapeRegex(oz)}\\b`, "gi"), " ");
        }
      }
      t = t.replace(VOLUME_PACKAGING_PATTERN, " ");
      t = t.replace(/\s+/g, " ").trim().replace(/^[-_/.,\s]+|[-_/.,\s]+$/g, "").trim();
      return t || "Default";
    });
    const distinctDerived = new Set(derivedColors);
    const coverCount = derivedColors.filter((c) => c !== "Default").length;
    if (distinctDerived.size >= 2 && coverCount >= Math.floor(perSku.length / 2)) {
      const newTuples = perSku.map((sv, i) => {
        const t = [derivedColors[i] ?? "Default"];
        if (hasSizeAxis) t.push(effectiveSizes[i] ?? "");
        if (hasVolumeAxis) t.push(sv.fluidOz);
        return t.join("|");
      });
      if (new Set(newTuples).size === perSku.length) {
        usesTwistB = true;
      }
    }
  }
  const axes = [];
  if (hasRealColor || usesTwistB) {
    const vals = usesTwistB ? derivedColors : perSku.map((s) => s.colors[0] ?? "");
    const dedupedColors = [...new Set(vals.filter((c) => c !== ""))].sort((a, b) => a.localeCompare(b));
    axes.push({ name: "Color", values: dedupedColors });
  }
  if (hasSizeAxis && axes.length < 2) {
    const dedupedSizes = [...new Set([...effectiveSizes].filter((s) => s !== ""))].sort((a, b) => sizeRank(a) - sizeRank(b) || a.localeCompare(b));
    axes.push({ name: "Size", values: dedupedSizes });
  }
  if (hasVolumeAxis && axes.length < 2) {
    const dedupedVols = [.../* @__PURE__ */ new Set([...distinctFlOz])].sort((a, b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b));
    axes.push({ name: "Volume", values: dedupedVols });
  }
  const variantRows = perSku.map((sv, i) => {
    const optionValues = [];
    for (const axis of axes) {
      if (axis.name === "Color") {
        optionValues.push(
          usesTwistB ? derivedColors[i] ?? "Default" : sv.colors[0] ?? ""
        );
      } else if (axis.name === "Size") {
        optionValues.push(effectiveSizes[i] ?? "");
      } else if (axis.name === "Volume") {
        optionValues.push(sv.fluidOz);
      }
    }
    const wholesale = sv.snap.wholesale;
    const msrp = sv.snap.msrp;
    const map = sv.snap.mapPrice ?? 0;
    const qty = sv.snap.qty ?? 0;
    const row = sv.snap.raw.mainRow ?? sv.snap.raw.saleRow;
    const price = map === 0 ? Math.round(Math.max(wholesale * 1.4, msrp * 0.55) * 100) / 100 : map < msrp ? Math.round(map * 100) / 100 : Math.round(msrp * 100) / 100;
    const images = [];
    for (let n = 1; n <= 10; n++) {
      const url = row?.[`Image ${n}`] ?? "";
      if (url.trim()) images.push(url.trim());
    }
    return {
      sku: sv.sku,
      optionValues,
      price,
      compareAtPrice: msrp,
      qty,
      wholesale,
      images,
      upc: sv.upc
    };
  });
  return { axes, variantRows };
}
function needsReview(master) {
  return master.variantCount > NEEDS_REVIEW_THRESHOLD;
}
var UNCATEGORIZED_SENTINEL, VOLUME_PACKAGING_PATTERN, SIZE_WORD_TOKENS, COMMON_COLOR_WORDS, UNINFORMATIVE_COLORS, STRUCTURAL_RESIDUE_WORDS, SIZE_SORT_ORDER, QTY_FLOOR, DISPLAY_TESTER_PATTERNS, NEEDS_REVIEW_THRESHOLD;
var init_master_collapse_server = __esm({
  "app/lib/master-collapse.server.ts"() {
    "use strict";
    UNCATEGORIZED_SENTINEL = "(uncategorized)";
    VOLUME_PACKAGING_PATTERN = /\b(\d+(?:\.\d+)?\s*(?:fl\s*oz|oz|ml|gm|gram(?:s)?)|(?:\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*(?:oz|ml)))\b|\b(?:bottle|tube|pump|pillow\s*pack|sachet|packet|jar|can)\b/gi;
    SIZE_WORD_TOKENS = [
      "XXXS",
      "XXS",
      "XS",
      "Small",
      "Medium",
      "Large",
      "XLarge",
      "XXLarge",
      "XXXLarge",
      "XL",
      "XXL",
      "2XL",
      "3XL",
      "4XL",
      "5XL",
      "OneSize",
      "One Size"
    ];
    COMMON_COLOR_WORDS = [
      "black",
      "white",
      "red",
      "pink",
      "purple",
      "blue",
      "green",
      "gold",
      "silver",
      "teal",
      "aqua",
      "nude",
      "tan",
      "clear",
      "natural",
      "navy",
      "orange",
      "yellow",
      "brown",
      "gray",
      "grey",
      "magenta",
      "coral",
      "burgundy",
      "rose",
      "ivory",
      "lavender",
      "cream"
    ];
    UNINFORMATIVE_COLORS = /* @__PURE__ */ new Set([
      "multi-color",
      "multicolor",
      "multi color",
      "assorted",
      "various",
      "varies"
    ]);
    STRUCTURAL_RESIDUE_WORDS = ["size", "style", "color", "assorted"];
    SIZE_SORT_ORDER = [
      "XXXS",
      "XXS",
      "XS",
      "S",
      "S/M",
      "Regular",
      "Standard",
      "M",
      "M/L",
      "L",
      "L/XL",
      "XL",
      "XL/2XL",
      "XXL/2XL",
      "2XL/3XL",
      "XXXL/3XL",
      "3XL/4XL",
      "4XL",
      "4XL/5XL",
      "5XL",
      "OneSize"
    ];
    QTY_FLOOR = parseInt(process.env["NALPAC_QTY_FLOOR"] ?? "20", 10);
    DISPLAY_TESTER_PATTERNS = /\b(?:display|tester|testers|displays|merchandising|planogram|pos\s*kit)\b/i;
    NEEDS_REVIEW_THRESHOLD = 30;
  }
});

// app/lib/shopify.server.ts
var shopify_server_exports = {};
__export(shopify_server_exports, {
  XDIPX_LOCATION_IDS: () => XDIPX_LOCATION_IDS,
  activateProductInventoryAtLocations: () => activateProductInventoryAtLocations,
  activateShopifyProduct: () => activateShopifyProduct,
  addLinesToCart: () => addLinesToCart,
  addToCart: () => addToCart,
  addVariantsToProduct: () => addVariantsToProduct,
  adminCustomerDelete: () => adminCustomerDelete,
  adminGetCustomerSubscriptions: () => adminGetCustomerSubscriptions,
  adminGetSubscriptionContract: () => adminGetSubscriptionContract,
  adminGraphQL: () => adminGraphQL,
  appendProductTag: () => appendProductTag,
  archiveProduct: () => archiveProduct,
  archiveShopifyProduct: () => archiveShopifyProduct,
  associateImageWithVariant: () => associateImageWithVariant,
  attachVideoToProduct: () => attachVideoToProduct,
  buildShopifyQuery: () => buildShopifyQuery,
  bulkFetchProductsForPricing: () => bulkFetchProductsForPricing,
  cartBuyerIdentityUpdate: () => cartBuyerIdentityUpdate,
  closeReturn: () => closeReturn,
  copyMediaToProduct: () => copyMediaToProduct,
  createCart: () => createCart,
  createCartWithLines: () => createCartWithLines,
  createCustomerAccessToken: () => createCustomerAccessToken,
  createDraftOrder: () => createDraftOrder,
  createDraftProduct: () => createDraftProduct,
  createRefund: () => createRefund,
  createReturn: () => createReturn,
  createShopifyProductFromFeed: () => createShopifyProductFromFeed,
  createShopifyProductWithVariants: () => createShopifyProductWithVariants,
  createStagedVideoUpload: () => createStagedVideoUpload,
  createUrlRedirect: () => createUrlRedirect,
  customerActivate: () => customerActivate,
  customerActivateByUrl: () => customerActivateByUrl,
  customerAddressCreate: () => customerAddressCreate,
  customerAddressDelete: () => customerAddressDelete,
  customerAddressUpdate: () => customerAddressUpdate,
  customerCreate: () => customerCreate,
  customerDefaultAddressUpdate: () => customerDefaultAddressUpdate,
  customerRecover: () => customerRecover,
  customerReset: () => customerReset,
  customerResetByUrl: () => customerResetByUrl,
  customerUpdate: () => customerUpdate,
  deleteProductImage: () => deleteProductImage,
  deleteProductMedia: () => deleteProductMedia,
  ensureMetafieldDefinition: () => ensureMetafieldDefinition,
  fetchAllDealProducts: () => fetchAllDealProducts,
  findCollectionsByQuery: () => findCollectionsByQuery,
  findCustomerByPhone: () => findCustomerByPhone,
  findProductBySKU: () => findProductBySKU,
  findVariantBySKU: () => findVariantBySKU,
  findVariantsBySkus: () => findVariantsBySkus,
  getAccessoryProducts: () => getAccessoryProducts,
  getAccessoryProductsAdmin: () => getAccessoryProductsAdmin,
  getAdminProductData: () => getAdminProductData,
  getAdminProductPrices: () => getAdminProductPrices,
  getApprovedDeal: () => getApprovedDeal,
  getBonusDeal: () => getBonusDeal,
  getCart: () => getCart,
  getCollection: () => getCollection,
  getCollectionDeals: () => getCollectionDeals,
  getCollectionList: () => getCollectionList,
  getCollectionProducts: () => getCollectionProducts,
  getCollectionsForSitemap: () => getCollectionsForSitemap,
  getCountries: () => getCountries,
  getCustomerAddresses: () => getCustomerAddresses,
  getCustomerOrder: () => getCustomerOrder,
  getCustomerOrders: () => getCustomerOrders,
  getCustomerProfile: () => getCustomerProfile,
  getDailyDeal: () => getDailyDeal,
  getDealByHandle: () => getDealByHandle,
  getDealByShopifyId: () => getDealByShopifyId,
  getDistinctProductTypes: () => getDistinctProductTypes,
  getFeedDeals: () => getFeedDeals,
  getHandleByProductId: () => getHandleByProductId,
  getLiveDealHandle: () => getLiveDealHandle,
  getMainMenu: () => getMainMenu,
  getPairingCandidates: () => getPairingCandidates,
  getProductAdminImages: () => getProductAdminImages,
  getProductByHandle: () => getProductByHandle,
  getProductDetailForEmma: () => getProductDetailForEmma,
  getProductHandleById: () => getProductHandleById,
  getProductImagesForSitemap: () => getProductImagesForSitemap,
  getProductMetafieldDebug: () => getProductMetafieldDebug,
  getProductVariantGids: () => getProductVariantGids,
  getProductsByHandles: () => getProductsByHandles,
  getProductsByIds: () => getProductsByIds,
  getProductsByTag: () => getProductsByTag,
  getProductsByTypesOrTag: () => getProductsByTypesOrTag,
  getProductsForMerge: () => getProductsForMerge,
  getRecentVaultDeals: () => getRecentVaultDeals,
  getReturn: () => getReturn,
  getReturnableFulfillments: () => getReturnableFulfillments,
  getShopifyCollections: () => getShopifyCollections,
  getStorefrontCollections: () => getStorefrontCollections,
  getStorefrontCustomer: () => getStorefrontCustomer,
  getVariantCost: () => getVariantCost,
  getVaultDeals: () => getVaultDeals,
  getWholesaleCostBySKU: () => getWholesaleCostBySKU,
  loginWithSocialIdentity: () => loginWithSocialIdentity,
  paginateAllProductsForSanity: () => paginateAllProductsForSanity,
  parseMetafield: () => parseMetafield,
  parseMetafieldJSON: () => parseMetafieldJSON,
  pollMediaReady: () => pollMediaReady,
  predictiveSearch: () => predictiveSearch,
  publishProductToXdipxChannels: () => publishProductToXdipxChannels,
  pushProductToShopify: () => pushProductToShopify,
  registerReverseDelivery: () => registerReverseDelivery,
  removeFromCart: () => removeFromCart,
  reorderProductImages: () => reorderProductImages,
  searchAdminProducts: () => searchAdminProducts,
  searchCatalogForEmma: () => searchCatalogForEmma,
  searchProducts: () => searchProducts,
  sendDraftOrderInvoice: () => sendDraftOrderInvoice,
  setCartAttributes: () => setCartAttributes,
  setDealStatus: () => setDealStatus,
  setMediaAsPrimary: () => setMediaAsPrimary,
  setMetafield: () => setMetafield,
  setPairingWhy: () => setPairingWhy,
  shopifyAdmin: () => shopifyAdmin,
  slugifyHandle: () => slugifyHandle,
  updateCartLine: () => updateCartLine,
  updateCollectionDescription: () => updateCollectionDescription,
  updateCollectionImage: () => updateCollectionImage,
  updateProductDescriptionHtml: () => updateProductDescriptionHtml,
  updateProductMetafield: () => updateProductMetafield,
  updateProductTags: () => updateProductTags,
  updateProductTitle: () => updateProductTitle,
  updateVariantPricing: () => updateVariantPricing,
  uploadMoodImageToShopifyFiles: () => uploadMoodImageToShopifyFiles,
  uploadThumbnailToProduct: () => uploadThumbnailToProduct
});
import crypto from "node:crypto";
import { toHTML } from "@portabletext/to-html";
function ptToHtml(value) {
  if (!value) return void 0;
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) return toHTML(value);
  return void 0;
}
async function storefront(query, variables) {
  const res = await fetch(STOREFRONT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": process.env["SHOPIFY_STOREFRONT_ACCESS_TOKEN"]
    },
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error(`Shopify Storefront API error: ${res.status}`);
  const { data, errors } = await res.json();
  if (errors?.length) throw new Error(errors[0]?.message ?? "Shopify error");
  return data;
}
async function shopifyAdmin(path, method = "GET", body) {
  const res = await fetch(`${ADMIN_ENDPOINT}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": process.env["SHOPIFY_ADMIN_ACCESS_TOKEN"]
    },
    body: body ? JSON.stringify(body) : null
  });
  if (!res.ok) throw new Error(`Shopify Admin API error: ${res.status} ${path}`);
  return res.json();
}
async function adminGraphQL(query, variables) {
  const doFetch = () => fetch(ADMIN_GQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": process.env["SHOPIFY_ADMIN_ACCESS_TOKEN"]
    },
    body: JSON.stringify({ query, variables })
  });
  const MAX_ATTEMPTS2 = 4;
  for (let attempt = 1; ; attempt++) {
    const res = await doFetch();
    if (res.status === 429) {
      if (attempt >= MAX_ATTEMPTS2) throw new Error("Shopify Admin GraphQL error: 429");
      const retryAfter = Number(res.headers.get("retry-after")) || 1;
      await new Promise((r) => setTimeout(r, Math.min(retryAfter * 1e3, 5e3)));
      continue;
    }
    if (!res.ok) throw new Error(`Shopify Admin GraphQL error: ${res.status}`);
    const body = await res.json();
    const throttled = body.errors?.some(
      (e) => e.extensions?.code === "THROTTLED" || /throttled/i.test(e.message)
    );
    if (throttled && attempt < MAX_ATTEMPTS2) {
      const cost = body.extensions?.cost;
      const needed = (cost?.requestedQueryCost ?? 0) - (cost?.throttleStatus?.currentlyAvailable ?? 0);
      const restoreRate = cost?.throttleStatus?.restoreRate ?? 0;
      const refillMs = needed > 0 && restoreRate > 0 ? needed / restoreRate * 1e3 : 0;
      const backoffMs = refillMs || 2 ** (attempt - 1) * 500;
      await new Promise((r) => setTimeout(r, Math.min(backoffMs, 5e3)));
      continue;
    }
    if (body.errors?.length) throw new Error(body.errors[0]?.message ?? "Shopify Admin GraphQL error");
    return body.data;
  }
}
function nodeToVaultDeal(node) {
  const mf = node.metafields;
  const variantEdges = node.variants.edges;
  const variant = variantEdges[0]?.node;
  const dealPrice = parseFloat(variant?.price.amount ?? "0");
  const moodTags = parseMetafieldJSON(mf, "mood_tags", []);
  const audienceTags = parseMetafieldJSON(mf, "audience_tags", []);
  const mattersTags = parseMetafieldJSON(mf, "matters_tags", []);
  const heroVideo = parseMetafieldJSON(mf, "hero_video", {});
  const colorOpt = (node.options ?? []).find((o) => /^colou?r$/i.test(o.name));
  const sizeOpt = (node.options ?? []).find(
    (o) => /^(size|volume|capacity|length|fl\.?\s*oz)$/i.test(o.name)
  );
  const colorValues = colorOpt && colorOpt.values.length > 1 ? colorOpt.values : void 0;
  const sizeValues = sizeOpt && sizeOpt.values.length > 1 ? sizeOpt.values : void 0;
  const variantPrices = variantEdges.map((e) => parseFloat(e.node.price.amount)).filter((n) => Number.isFinite(n) && n > 0);
  const priceMin = variantPrices.length > 0 ? Math.min(...variantPrices) : dealPrice;
  const priceMax = variantPrices.length > 0 ? Math.max(...variantPrices) : dealPrice;
  const hasPriceRange = priceMax > priceMin;
  const variantSavings = variantEdges.map((e) => {
    const p = parseFloat(e.node.price.amount);
    const ca = parseFloat(e.node.compareAtPrice?.amount ?? "0");
    return ca > p && p > 0 ? { amount: ca - p, percent: Math.round((ca - p) / ca * 100) } : null;
  }).filter((s) => s !== null);
  const maxSavingsAmount = variantSavings.length > 0 ? Math.max(...variantSavings.map((s) => s.amount)) : 0;
  const maxSavingsPercent = variantSavings.length > 0 ? Math.max(...variantSavings.map((s) => s.percent)) : 0;
  return {
    id: node.id,
    handle: node.handle,
    seoTitle: node.title,
    dealDate: parseMetafield(mf, "deal_date"),
    dealPrice,
    msrp: parseFloat(parseMetafield(mf, "original_price") || (variant?.compareAtPrice?.amount ?? "0")),
    images: parseImages(node.images.edges),
    brand: node.vendor,
    category: parseCategory(parseMetafield(mf, "category")),
    dealStatus: "archived",
    qty: variant?.quantityAvailable ?? 0,
    defaultVariantId: variant?.id ?? null,
    hasMultipleVariants: variantEdges.length > 1,
    ...colorValues ? { colorValues } : {},
    ...sizeValues ? { sizeValues } : {},
    ...hasPriceRange ? { priceMin, priceMax } : {},
    ...maxSavingsAmount > 0 ? { maxSavingsAmount, maxSavingsPercent } : {},
    ...moodTags.length > 0 ? { moodTags } : {},
    ...audienceTags.length > 0 ? { audienceTags } : {},
    ...mattersTags.length > 0 ? { mattersTags } : {},
    ...heroVideo?.src && typeof heroVideo.duration === "number" ? { heroVideo: { src: heroVideo.src, duration: heroVideo.duration, ...heroVideo.poster ? { poster: heroVideo.poster } : {} } } : {}
  };
}
function parseMetafield(metafields, key) {
  return metafields.find((m) => m?.key === key)?.value ?? "";
}
function parseMetafieldJSON(metafields, key, fallback) {
  const raw = parseMetafield(metafields, key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function parseCategory(raw) {
  if (!raw) return [];
  const valid = /* @__PURE__ */ new Set(["for-him", "for-her", "couples"]);
  if (raw.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((s) => typeof s === "string" && valid.has(s)).map((s) => s);
      }
    } catch {
    }
  }
  const v = raw.trim().toLowerCase();
  if (v === "both") return ["for-him", "for-her"];
  if (v === "him") return ["for-him"];
  if (v === "her") return ["for-her"];
  if (valid.has(v)) return [v];
  return [];
}
function parseSpecificationsBullets(raw) {
  if (!raw) return [];
  if (raw.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim());
    } catch {
    }
  }
  const items = Array.from(raw.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi));
  if (items.length === 0) return [];
  return items.map((m) => (m[1] ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()).filter((s) => s.length > 0);
}
function parseImages(edges) {
  return edges.map((e) => ({ url: e.node.url, altText: e.node.altText ?? "" }));
}
function clampDialValue(n) {
  const v = Math.round(n);
  if (v <= 1) return 1;
  if (v >= 5) return 5;
  return v;
}
function projectLegacyDial(legacy) {
  if (!legacy) return void 0;
  const items = [];
  for (const [key, value] of Object.entries(legacy)) {
    if (typeof value !== "number") continue;
    const label = LEGACY_DIAL_LABELS[key] ?? key;
    items.push({ label, value: clampDialValue(value) });
  }
  return items.length > 0 ? { items } : void 0;
}
function normalizeSensationDialV2(raw) {
  if (!raw || typeof raw !== "object") return void 0;
  const r = raw;
  if (!Array.isArray(r.items)) return void 0;
  const items = [];
  for (const it of r.items) {
    if (!it || typeof it !== "object") continue;
    const o = it;
    if (typeof o.label !== "string" || typeof o.value !== "number") continue;
    const item = { label: o.label, value: clampDialValue(o.value) };
    if (o.proposed === true) item.proposed = true;
    items.push(item);
  }
  return items.length > 0 ? { items } : void 0;
}
function normalizeCareInstructions(raw) {
  if (!Array.isArray(raw)) return void 0;
  const out = raw.filter((s) => typeof s === "string" && s.trim().length > 0);
  return out.length > 0 ? out : void 0;
}
function fixVideoCdnUrl(url) {
  const m = url.match(/\/cdn\/shop\/(videos\/.*)/);
  return m ? `https://cdn.shopify.com/${m[1]}` : url;
}
function parseVideos(media) {
  if (!media) return [];
  return media.edges.filter((e) => e.node.mediaContentType === "VIDEO" && e.node.previewImage && e.node.sources?.length).map((e) => {
    const sources = e.node.sources ?? [];
    const dimSource = sources.find((s) => s.mimeType.includes("mp4") && s.height && s.width) ?? sources.find((s) => s.height && s.width);
    const width = dimSource?.width;
    const height = dimSource?.height;
    let aspect;
    if (width && height) {
      if (height > width * 1.15) aspect = "portrait";
      else if (width > height * 1.15) aspect = "landscape";
      else aspect = "square";
    }
    const video = {
      previewImageUrl: e.node.previewImage.url,
      sources: sources.map((s) => ({ url: fixVideoCdnUrl(s.url), mimeType: s.mimeType }))
    };
    if (aspect) video.aspect = aspect;
    if (width) video.width = width;
    if (height) video.height = height;
    return video;
  });
}
function parseSellingPlanGroups(raw) {
  if (!raw?.edges?.length) return void 0;
  const groups = raw.edges.map(({ node }) => ({
    name: node.name,
    appName: node.appName,
    options: node.options ?? [],
    sellingPlans: node.sellingPlans.edges.map(({ node: sp }) => {
      const plan = {
        id: sp.id,
        name: sp.name,
        options: sp.options ?? [],
        recurringDeliveries: sp.recurringDeliveries,
        priceAdjustments: sp.priceAdjustments.map((pa) => {
          const v = pa.adjustmentValue;
          if (v.__typename === "SellingPlanPercentagePriceAdjustment" && typeof v.adjustmentPercentage === "number") {
            return { adjustmentValue: { __typename: "SellingPlanPercentagePriceAdjustment", adjustmentPercentage: v.adjustmentPercentage } };
          }
          if (v.__typename === "SellingPlanFixedAmountPriceAdjustment" && v.adjustmentAmount) {
            return { adjustmentValue: { __typename: "SellingPlanFixedAmountPriceAdjustment", adjustmentAmount: v.adjustmentAmount } };
          }
          if (v.__typename === "SellingPlanFixedPriceAdjustment" && v.price) {
            return { adjustmentValue: { __typename: "SellingPlanFixedPriceAdjustment", price: v.price } };
          }
          return { adjustmentValue: { __typename: "SellingPlanPercentagePriceAdjustment", adjustmentPercentage: 0 } };
        })
      };
      if (sp.description) plan.description = sp.description;
      return plan;
    })
  }));
  return groups.filter((g) => g.sellingPlans.length > 0);
}
function nodeToProduct(node) {
  const variant = node.variants.edges[0]?.node;
  const mf = node.metafields;
  const moodTags = parseMetafieldJSON(mf, "mood_tags", []);
  const audienceTags = parseMetafieldJSON(mf, "audience_tags", []);
  const mattersTags = parseMetafieldJSON(mf, "matters_tags", []);
  const heroVideo = parseMetafieldJSON(mf, "hero_video", {});
  return {
    id: node.id,
    handle: node.handle,
    title: node.title,
    images: parseImages(node.images.edges),
    videos: parseVideos(node.media),
    variants: node.variants.edges.map((e) => ({
      id: e.node.id,
      title: e.node.title,
      selectedOptions: e.node.selectedOptions,
      ...e.node.image ? { image: { url: e.node.image.url, altText: e.node.image.altText ?? "" } } : {},
      price: e.node.price.amount,
      compareAtPrice: e.node.compareAtPrice?.amount ?? null,
      availableForSale: e.node.availableForSale,
      quantityAvailable: e.node.quantityAvailable,
      ...e.node.barcode ? { barcode: e.node.barcode } : {},
      ...e.node.metafields?.[0]?.value ? { originalDescription: e.node.metafields[0].value } : {}
    })),
    price: parseFloat(variant?.price.amount ?? "0"),
    ...variant?.compareAtPrice ? { compareAtPrice: parseFloat(variant.compareAtPrice.amount) } : {},
    brand: node.vendor,
    tags: node.tags,
    ...moodTags.length > 0 ? { moodTags } : {},
    ...audienceTags.length > 0 ? { audienceTags } : {},
    ...mattersTags.length > 0 ? { mattersTags } : {},
    ...heroVideo?.src && typeof heroVideo.duration === "number" ? { heroVideo: { src: heroVideo.src, duration: heroVideo.duration, ...heroVideo.poster ? { poster: heroVideo.poster } : {} } } : {}
  };
}
function nodeToDeal(node) {
  const mf = node.metafields;
  const variant = node.variants.edges[0]?.node;
  const mapRestrictedRaw = parseMetafield(mf, "map_restricted");
  const heroVideo = parseMetafieldJSON(mf, "hero_video", {});
  const productTypeDial = parseMetafield(mf, "product_type_dial");
  const sensationDial = parseMetafieldJSON(mf, "sensation_dial", {});
  const sensationDialV2 = normalizeSensationDialV2(parseMetafieldJSON(mf, "sensation_dial_v2", null)) ?? projectLegacyDial(sensationDial);
  const careInstructions = normalizeCareInstructions(parseMetafieldJSON(mf, "care_instructions", null));
  const pairingWhy = parseMetafieldJSON(mf, "pairing_why", {});
  const moodTags = parseMetafieldJSON(mf, "mood_tags", []);
  const audienceTags = parseMetafieldJSON(mf, "audience_tags", []);
  const mattersTags = parseMetafieldJSON(mf, "matters_tags", []);
  const emmaHero = parseMetafieldJSON(mf, "emma_hero", {});
  const quietEndorsementCopy = parseMetafieldJSON(mf, "quiet_endorsement_copy", {});
  const pairBundleCopy = parseMetafieldJSON(mf, "pair_bundle_copy", {});
  const endorsementCopy = parseMetafieldJSON(mf, "endorsement_copy", {});
  const sellingPlanGroups = parseSellingPlanGroups(node.sellingPlanGroups);
  return {
    id: node.id,
    shopifyProductId: node.id,
    sku: parseMetafield(mf, "nalpac_sku"),
    handle: node.handle,
    seoTitle: node.title,
    tagline: parseMetafield(mf, "tagline"),
    fullStory: parseMetafield(mf, "full_story") || node.description,
    worksForHim: parseMetafield(mf, "works_for_him"),
    worksForHer: parseMetafield(mf, "works_for_her"),
    boxContents: parseMetafieldJSON(mf, "box_contents", []),
    images: parseImages(node.images.edges),
    videos: parseVideos(node.media),
    ...parseMetafield(mf, "mood_image_url") ? { moodImageUrl: parseMetafield(mf, "mood_image_url") } : {},
    dealPrice: parseFloat(variant?.price.amount ?? "0"),
    msrp: parseFloat(parseMetafield(mf, "original_price") || (variant?.compareAtPrice?.amount ?? "0")),
    wholesaleCost: parseFloat(parseMetafield(mf, "wholesale_cost") || "0"),
    mapPrice: parseFloat(parseMetafield(mf, "map_price") || "0"),
    brand: node.vendor,
    category: parseCategory(parseMetafield(mf, "category")),
    dealStatus: parseMetafield(mf, "deal_status") || "live",
    dealDate: parseMetafield(mf, "deal_date"),
    qty: variant?.quantityAvailable ?? 0,
    tags: node.tags ?? [],
    accessoryProductIds: parseMetafieldJSON(mf, "accessory_product_ids", []),
    ...(() => {
      const bullets = parseSpecificationsBullets(parseMetafield(mf, "specifications"));
      return bullets.length > 0 ? { specifications: bullets } : {};
    })(),
    metaDescription: parseMetafield(mf, "seo_meta_description"),
    ...parseMetafield(mf, "original_description") ? { rawDescription: parseMetafield(mf, "original_description") } : {},
    ...parseMetafield(mf, "deal_score") ? { dealScore: parseFloat(parseMetafield(mf, "deal_score")) } : {},
    ...parseMetafield(mf, "nalpac_sku") ? { nalpacSku: parseMetafield(mf, "nalpac_sku") } : {},
    variantId: variant?.id ?? "",
    variants: node.variants.edges.map((e) => ({
      id: e.node.id,
      title: e.node.title,
      selectedOptions: e.node.selectedOptions,
      ...e.node.image ? { image: { url: e.node.image.url, altText: e.node.image.altText ?? "" } } : {},
      price: e.node.price.amount,
      compareAtPrice: e.node.compareAtPrice?.amount ?? null,
      availableForSale: e.node.availableForSale,
      quantityAvailable: e.node.quantityAvailable,
      ...e.node.barcode ? { barcode: e.node.barcode } : {},
      ...e.node.metafields?.[0]?.value ? { originalDescription: e.node.metafields[0].value } : {}
    })),
    options: node.options,
    // rating populated by Judge.me integration — omitted until available
    // v2 metafields
    ...mapRestrictedRaw === "true" ? { mapRestricted: true } : {},
    ...heroVideo?.src && typeof heroVideo.duration === "number" ? { heroVideo: { src: heroVideo.src, duration: heroVideo.duration, ...heroVideo.poster ? { poster: heroVideo.poster } : {} } } : {},
    ...moodTags.length > 0 ? { moodTags } : {},
    ...audienceTags.length > 0 ? { audienceTags } : {},
    ...mattersTags.length > 0 ? { mattersTags } : {},
    ...productTypeDial ? { productTypeDial } : {},
    ...sensationDial && Object.keys(sensationDial).length > 0 ? { sensationDial } : {},
    ...sensationDialV2 ? { sensationDialV2 } : {},
    ...careInstructions ? { careInstructions } : {},
    ...node.descriptionHtml ? { descriptionHtml: node.descriptionHtml } : {},
    ...pairingWhy && Object.keys(pairingWhy).length > 0 ? { pairingWhy } : {},
    ...emmaHero?.headline && emmaHero?.variant ? { emmaHero } : {},
    ...quietEndorsementCopy?.eyebrow && quietEndorsementCopy?.body && quietEndorsementCopy?.bannerHeadline ? { quietEndorsementCopy } : {},
    ...pairBundleCopy?.headline && pairBundleCopy?.pairedHandle ? { pairBundleCopy } : {},
    ...endorsementCopy?.quote && endorsementCopy?.emmaIntro ? { endorsementCopy } : {},
    ...sellingPlanGroups && sellingPlanGroups.length > 0 ? { sellingPlanGroups } : {},
    ...node.collections?.edges?.length ? { collections: node.collections.edges.map((e) => ({ handle: e.node.handle, title: e.node.title })) } : {},
    ...node.createdAt ? { createdAt: node.createdAt } : {},
    ...node.updatedAt ? { updatedAt: node.updatedAt } : {}
  };
}
async function getDailyDeal() {
  const search = await storefront(`
    query GetDailyDealHandle {
      products(first: 1, query: "tag:deal-status-live") {
        edges { node { handle } }
      }
    }
  `);
  const handle = search.products.edges[0]?.node.handle;
  if (!handle) return null;
  const data = await storefront(`
    query GetDailyDeal($handle: String!) {
      product(handle: $handle) { ${PRODUCT_CORE_FRAGMENT} }
    }
  `, { handle });
  if (!data.product) return null;
  return nodeToDeal(data.product);
}
async function getLiveDealHandle() {
  const search = await storefront(`
    query GetLiveDealHandle {
      products(first: 1, query: "tag:deal-status-live") {
        edges { node { handle } }
      }
    }
  `).catch(() => null);
  return search?.products.edges[0]?.node.handle ?? null;
}
async function getApprovedDeal() {
  const search = await storefront(`
    query GetApprovedDealHandle {
      products(first: 1, query: "tag:deal-status-approved") {
        edges { node { handle } }
      }
    }
  `);
  const handle = search.products.edges[0]?.node.handle;
  if (!handle) return null;
  const data = await storefront(`
    query GetApprovedDeal($handle: String!) {
      product(handle: $handle) { ${PRODUCT_CORE_FRAGMENT} }
    }
  `, { handle });
  if (!data.product) return null;
  return nodeToDeal(data.product);
}
async function getProductByHandle(handle) {
  return cached(`shopify:p:${handle}`, READ_TTL, async () => {
    const data = await storefront(`
      query GetProduct($handle: String!) {
        product(handle: $handle) { ${PRODUCT_CORE_FRAGMENT} }
      }
    `, { handle });
    if (!data.product) return null;
    return nodeToProduct(data.product);
  });
}
async function getProductHandleById(numericId) {
  const id = String(numericId).replace("gid://shopify/Product/", "");
  try {
    const { product } = await shopifyAdmin(
      `/products/${id}.json?fields=id,handle`
    );
    return product?.handle ?? null;
  } catch {
    return null;
  }
}
async function getDealByShopifyId(numericId) {
  const id = numericId.replace("gid://shopify/Product/", "");
  return cached(`shopify:deal:byid:${id}`, READ_TTL, () => getDealByShopifyIdUncached(id));
}
async function getDealByShopifyIdUncached(id) {
  const [{ product }, { metafields: xdipxMF }, { metafields: customMF }] = await Promise.all([
    shopifyAdmin(`/products/${id}.json`),
    shopifyAdmin(`/products/${id}/metafields.json?namespace=xdipx&limit=50`),
    shopifyAdmin(`/products/${id}/metafields.json?namespace=custom&limit=50`)
  ]);
  if (!product) return null;
  const storefrontMedia = await storefront(`
    query GetProductMedia($handle: String!) {
      product(handle: $handle) {
        media(first: 15) {
          edges {
            node {
              mediaContentType
              ... on Video {
                previewImage { url }
                sources { url mimeType height width }
              }
            }
          }
        }
      }
    }
  `, { handle: product.handle }).catch(() => ({ product: null }));
  const videos = (storefrontMedia.product?.media.edges ?? []).filter((e) => e.node.mediaContentType === "VIDEO" && e.node.previewImage && e.node.sources?.length).map((e) => ({
    previewImageUrl: e.node.previewImage.url,
    sources: e.node.sources.map((s) => ({ url: fixVideoCdnUrl(s.url), mimeType: s.mimeType }))
  }));
  const mf = [...xdipxMF ?? [], ...customMF ?? []];
  const mfVal = (key) => mf.find((m) => m.key === key)?.value ?? "";
  const mfJSON = (key, fallback) => {
    const raw = mfVal(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  };
  const emmaHeroRaw = mfJSON("emma_hero", {});
  const emmaHero = emmaHeroRaw?.headline && emmaHeroRaw?.variant ? emmaHeroRaw : null;
  const quietEndorsementCopyRaw = mfJSON("quiet_endorsement_copy", {});
  const quietEndorsementCopy = quietEndorsementCopyRaw?.eyebrow && quietEndorsementCopyRaw?.body && quietEndorsementCopyRaw?.bannerHeadline ? quietEndorsementCopyRaw : null;
  const pairBundleCopyRaw = mfJSON("pair_bundle_copy", {});
  const pairBundleCopy = pairBundleCopyRaw?.headline && pairBundleCopyRaw?.pairedHandle ? pairBundleCopyRaw : null;
  const endorsementCopyRaw = mfJSON("endorsement_copy", {});
  const endorsementCopy = endorsementCopyRaw?.quote && endorsementCopyRaw?.emmaIntro ? endorsementCopyRaw : null;
  const mapRestricted = mfVal("map_restricted") === "true";
  const productTypeDialAdmin = mfVal("product_type_dial");
  const legacyDialAdmin = mfJSON("sensation_dial", {});
  const sensationDialV2Admin = normalizeSensationDialV2(mfJSON("sensation_dial_v2", null)) ?? projectLegacyDial(Object.keys(legacyDialAdmin).length > 0 ? legacyDialAdmin : void 0);
  const careInstructionsAdmin = normalizeCareInstructions(mfJSON("care_instructions", null));
  const pairingWhyAdmin = mfJSON("pairing_why", {});
  const variant = product.variants[0];
  const gid = `gid://shopify/Product/${product.id}`;
  return {
    id: gid,
    shopifyProductId: gid,
    sku: mfVal("nalpac_sku"),
    handle: product.handle,
    seoTitle: product.title,
    tagline: mfVal("tagline"),
    fullStory: mfVal("full_story") || product.body_html,
    worksForHim: mfVal("works_for_him"),
    worksForHer: mfVal("works_for_her"),
    boxContents: mfJSON("box_contents", []),
    images: product.images.map((img) => ({ url: img.src, altText: img.alt ?? "" })),
    videos,
    ...mfVal("mood_image_url") ? { moodImageUrl: mfVal("mood_image_url") } : {},
    dealPrice: parseFloat(variant?.price ?? "0"),
    msrp: parseFloat(mfVal("original_price") || (variant?.compare_at_price ?? "0")),
    wholesaleCost: parseFloat(mfVal("wholesale_cost") || "0"),
    mapPrice: parseFloat(mfVal("map_price") || "0"),
    brand: product.vendor,
    category: parseCategory(mfVal("category")),
    dealStatus: mfVal("deal_status") || "pending",
    dealDate: mfVal("deal_date"),
    qty: variant?.inventory_quantity ?? 0,
    tags: product.tags ? product.tags.split(", ").filter(Boolean) : [],
    accessoryProductIds: mfJSON("accessory_product_ids", []),
    ...(() => {
      const bullets = parseSpecificationsBullets(mfVal("specifications"));
      return bullets.length > 0 ? { specifications: bullets } : {};
    })(),
    metaDescription: mfVal("seo_meta_description"),
    ...mfVal("original_description") ? { rawDescription: mfVal("original_description") } : {},
    ...mfVal("deal_score") ? { dealScore: parseFloat(mfVal("deal_score")) } : {},
    ...mfVal("nalpac_sku") ? { nalpacSku: mfVal("nalpac_sku") } : {},
    ...emmaHero ? { emmaHero } : {},
    ...quietEndorsementCopy ? { quietEndorsementCopy } : {},
    ...pairBundleCopy ? { pairBundleCopy } : {},
    ...endorsementCopy ? { endorsementCopy } : {},
    ...productTypeDialAdmin ? { productTypeDial: productTypeDialAdmin } : {},
    ...Object.keys(legacyDialAdmin).length > 0 ? { sensationDial: legacyDialAdmin } : {},
    ...sensationDialV2Admin ? { sensationDialV2: sensationDialV2Admin } : {},
    ...careInstructionsAdmin ? { careInstructions: careInstructionsAdmin } : {},
    ...pairingWhyAdmin && Object.keys(pairingWhyAdmin).length > 0 ? { pairingWhy: pairingWhyAdmin } : {},
    ...product.body_html ? { descriptionHtml: product.body_html } : {},
    mapRestricted,
    variantId: variant ? `gid://shopify/ProductVariant/${variant.id}` : "",
    variants: product.variants.map((v) => {
      const selectedOptions = [];
      const optionSlots = [v.option1, v.option2, v.option3];
      product.options.forEach((opt, i) => {
        const val = optionSlots[i];
        if (val) selectedOptions.push({ name: opt.name, value: val });
      });
      const variantImage = v.image_id ? product.images.find((img) => img.id === v.image_id) : void 0;
      return {
        id: `gid://shopify/ProductVariant/${v.id}`,
        title: v.title,
        selectedOptions,
        ...variantImage ? { image: { url: variantImage.src, altText: variantImage.alt ?? "" } } : {},
        price: v.price,
        compareAtPrice: v.compare_at_price,
        availableForSale: (v.inventory_quantity ?? 0) > 0,
        quantityAvailable: v.inventory_quantity ?? 0,
        ...v.barcode ? { barcode: v.barcode } : {}
      };
    }),
    options: product.options
  };
}
async function getDealByHandle(handle) {
  return cached(`shopify:deal:byhandle:${handle}`, READ_TTL, async () => {
    const timeout = new Promise(
      (resolve2) => setTimeout(() => resolve2(null), 5e3)
    );
    const fetch2 = storefront(`
      query GetDealByHandle($handle: String!) {
        product(handle: $handle) { ${PRODUCT_CORE_FRAGMENT} }
      }
    `, { handle });
    const result = await Promise.race([fetch2, timeout]);
    if (!result || !result.product) return null;
    return nodeToDeal(result.product);
  });
}
async function getProductsByIds(ids) {
  if (ids.length === 0) return [];
  const data = await storefront(`
    query GetProductsByIds($ids: [ID!]!) {
      nodes(ids: $ids) {
        __typename
        ... on Product { ${PRODUCT_CORE_FRAGMENT} }
      }
    }
  `, { ids });
  return (data.nodes ?? []).filter((n) => n.__typename === "Product").map((n) => nodeToProduct(n));
}
async function getProductsByTag(tag, limit = 6) {
  return cached(`shopify:tag:${tag}:${limit}`, READ_TTL, async () => {
    const data = await storefront(`
      query GetProductsByTag($query: String!, $first: Int!) {
        products(first: $first, query: $query) {
          edges { node { ${PRODUCT_CORE_FRAGMENT} } }
        }
      }
    `, { query: `tag:${tag}`, first: limit });
    return data.products.edges.map((e) => nodeToProduct(e.node));
  });
}
async function getProductsByTypesOrTag(types, tag, limit = 6) {
  const typesKey = [...types].sort().join("|");
  return cached(`shopify:types-or-tag:${typesKey}:${tag}:${limit}`, READ_TTL, async () => {
    const sanitize = (s) => s.replace(/[:()*"]/g, "").trim();
    const typeClauses = types.map(sanitize).filter(Boolean).map((t) => `product_type:"${t}"`);
    const tagClause = `tag:${sanitize(tag)}`;
    const query = `(${[...typeClauses, tagClause].join(" OR ")})`;
    const data = await storefront(`
      query GetProductsForBodyRoute($query: String!, $first: Int!) {
        products(first: $first, query: $query) {
          edges { node { ${PRODUCT_CORE_FRAGMENT} } }
        }
      }
    `, { query, first: limit });
    const seen = /* @__PURE__ */ new Set();
    const products = [];
    for (const edge of data.products.edges) {
      const p = nodeToProduct(edge.node);
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      products.push(p);
    }
    return products;
  });
}
async function getCollectionProducts(handle, limit = 8) {
  return cached(`shopify:col:${handle}:${limit}`, READ_TTL, async () => {
    const data = await storefront(`
      query GetCollectionProducts($handle: String!, $first: Int!) {
        collection(handle: $handle) {
          products(first: $first, sortKey: MANUAL) {
            edges { node { ${PRODUCT_CORE_FRAGMENT} } }
          }
        }
      }
    `, { handle, first: limit });
    return (data.collection?.products.edges ?? []).map((e) => nodeToProduct(e.node));
  });
}
async function getProductsByHandles(handles) {
  if (handles.length === 0) return [];
  const results = await Promise.all(handles.map((h) => getProductByHandle(h)));
  return results.filter((p) => p !== null);
}
async function getPairingCandidates(opts) {
  const limit = Math.max(1, Math.min(opts.limit ?? 3, 8));
  const selfId = opts.shopifyProductId.replace("gid://shopify/Product/", "");
  const seen = /* @__PURE__ */ new Set([selfId]);
  const toCandidate2 = (p) => {
    const numericId = p.id.replace("gid://shopify/Product/", "");
    if (seen.has(numericId)) return null;
    seen.add(numericId);
    const candidate = {
      productId: p.id,
      handle: p.handle,
      title: p.title,
      price: p.price
    };
    if (p.brand) candidate.brand = p.brand;
    if (p.category) candidate.category = p.category;
    if (p.images?.[0]?.url) candidate.image = p.images[0].url;
    return candidate;
  };
  const out = [];
  if (opts.primaryCollectionHandle) {
    try {
      const inCollection = await getCollectionProducts(opts.primaryCollectionHandle, 6);
      for (const p of inCollection) {
        const c = toCandidate2(p);
        if (c) out.push(c);
        if (out.length >= limit) return out;
      }
    } catch {
    }
  }
  const primaryCategoryTag = Array.isArray(opts.category) ? opts.category[0] : opts.category;
  if (out.length < limit && primaryCategoryTag) {
    try {
      const byCategory = await getProductsByTag(primaryCategoryTag, 8);
      for (const p of byCategory) {
        const c = toCandidate2(p);
        if (c) out.push(c);
        if (out.length >= limit) return out;
      }
    } catch {
    }
  }
  if (out.length < limit) {
    for (const sub of (opts.subCategories ?? []).slice(0, 3)) {
      try {
        const slug = sub.toLowerCase().replace(/\s+/g, "-");
        const bySub = await getProductsByTag(`cat:${slug}`, 6);
        for (const p of bySub) {
          const c = toCandidate2(p);
          if (c) out.push(c);
          if (out.length >= limit) return out;
        }
      } catch {
      }
    }
  }
  return out;
}
async function getProductImagesForSitemap() {
  const entries = await cached("shopify:sitemap:product-images:v2", 3600, async () => {
    const map = /* @__PURE__ */ new Map();
    let cursor = null;
    for (let page = 0; page < 4; page++) {
      const data = await storefront(`
        query SitemapProductImages($first: Int!, $after: String) {
          products(first: $first, after: $after) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                handle
                title
                images(first: 3) { edges { node { url altText } } }
              }
            }
          }
        }
      `, { first: 250, after: cursor });
      for (const edge of data.products.edges) {
        const images = edge.node.images.edges.map((e) => ({
          url: e.node.url,
          altText: e.node.altText ?? null
        }));
        map.set(edge.node.handle, { title: edge.node.title, images });
      }
      if (!data.products.pageInfo.hasNextPage) break;
      cursor = data.products.pageInfo.endCursor;
      if (!cursor) break;
    }
    return Array.from(map.entries());
  });
  return new Map(entries);
}
async function getCollection(handle) {
  return cached(`shopify:col-meta:${handle}`, READ_TTL, async () => {
    const data = await storefront(`
      query GetCollectionMeta($handle: String!) {
        collection(handle: $handle) {
          id
          handle
          title
          description
          descriptionHtml
          updatedAt
          seo { title description }
          image { url altText width height }
          products(first: 50) {
            pageInfo { hasNextPage }
            edges { node { id } }
          }
        }
      }
    `, { handle });
    const c = data.collection;
    if (!c) return null;
    const productsCount = c.products.pageInfo.hasNextPage ? null : c.products.edges.length;
    return {
      id: c.id,
      handle: c.handle,
      title: c.title,
      description: c.description ?? "",
      descriptionHtml: c.descriptionHtml ?? "",
      seoTitle: c.seo?.title ?? null,
      seoDescription: c.seo?.description ?? null,
      image: c.image,
      updatedAt: c.updatedAt,
      productsCount
    };
  });
}
async function getCollectionsForSitemap() {
  return cached("shopify:sitemap:collections", 3600, async () => {
    const out = [];
    let cursor = null;
    for (let page = 0; page < 4; page++) {
      const data = await storefront(`
        query SitemapCollections($first: Int!, $after: String) {
          collections(first: $first, after: $after) {
            pageInfo { hasNextPage endCursor }
            edges { node { handle updatedAt image { url altText } } }
          }
        }
      `, { first: 250, after: cursor });
      for (const edge of data.collections.edges) {
        out.push({
          handle: edge.node.handle,
          updatedAt: edge.node.updatedAt,
          image: edge.node.image
        });
      }
      if (!data.collections.pageInfo.hasNextPage) break;
      cursor = data.collections.pageInfo.endCursor;
      if (!cursor) break;
    }
    return out;
  });
}
async function getBonusDeal() {
  return cached("shopify:bonus-deal", READ_TTL, async () => {
    const data = await storefront(`
      query GetBonusDeal {
        collection(handle: "bonus-deal") {
          products(first: 1) {
            edges { node { ${PRODUCT_CORE_FRAGMENT} } }
          }
        }
      }
    `);
    const node = data.collection?.products.edges[0]?.node;
    if (!node) return null;
    return nodeToProduct(node);
  });
}
async function getRecentVaultDeals(limit = 7) {
  const data = await storefront(`
    query GetVaultDeals($first: Int!) {
      products(first: $first, query: "tag:deal-status-archived", sortKey: UPDATED_AT, reverse: true) {
        edges { node { ${PRODUCT_CARD_FRAGMENT} } }
      }
    }
  `, { first: limit });
  return data.products.edges.map((e) => nodeToVaultDeal(e.node));
}
async function getVaultDeals(page = 1, limit = 20) {
  const data = await storefront(`
    query GetVaultPage($first: Int!, $after: String) {
      products(first: $first, after: $after, query: "tag:deal-status-archived", sortKey: UPDATED_AT, reverse: true) {
        pageInfo { hasNextPage }
        edges {
          cursor
          node { ${PRODUCT_CARD_FRAGMENT} }
        }
      }
    }
  `, { first: limit, after: page > 1 ? btoa(`${(page - 1) * limit}`) : null });
  return {
    deals: data.products.edges.map((e) => nodeToVaultDeal(e.node)),
    hasNextPage: data.products.pageInfo.hasNextPage
  };
}
function parseMetafieldByNsKey(metafields, namespace, key) {
  return metafields.find((m) => m?.namespace === namespace && m?.key === key)?.value ?? null;
}
function nodeToFeedDeal(node) {
  const mf = node.metafields;
  const variantEdges = node.variants.edges;
  const variant = variantEdges[0]?.node;
  const dealPrice = parseFloat(variant?.price.amount ?? "0");
  const moodTags = parseMetafieldJSON(mf, "mood_tags", []);
  const audienceTags = parseMetafieldJSON(mf, "audience_tags", []);
  const mattersTags = parseMetafieldJSON(mf, "matters_tags", []);
  const heroVideo = parseMetafieldJSON(mf, "hero_video", {});
  const featureBullets = parseMetafieldJSON(mf, "feature_bullets", []);
  const specifications = parseMetafieldJSON(mf, "specifications", []);
  const variantSavings = variantEdges.map((e) => {
    const p = parseFloat(e.node.price.amount);
    const ca = parseFloat(e.node.compareAtPrice?.amount ?? "0");
    return ca > p && p > 0 ? { amount: ca - p, percent: Math.round((ca - p) / ca * 100) } : null;
  }).filter((s) => s !== null);
  const maxSavingsAmount = variantSavings.length > 0 ? Math.max(...variantSavings.map((s) => s.amount)) : 0;
  const maxSavingsPercent = variantSavings.length > 0 ? Math.max(...variantSavings.map((s) => s.percent)) : 0;
  const seoDesc = parseMetafieldByNsKey(mf, "xdipx", "seo_meta_description");
  const moodImageUrl = parseMetafieldByNsKey(mf, "xdipx", "mood_image_url");
  const originalPrice = parseMetafieldByNsKey(mf, "xdipx", "original_price");
  const productTypeDial = parseMetafieldByNsKey(mf, "xdipx", "product_type_dial");
  const dealScoreRaw = parseMetafieldByNsKey(mf, "xdipx", "deal_score");
  const isDailyDealRaw = parseMetafieldByNsKey(mf, "xdipx", "is_daily_deal");
  const dealScoreNum = dealScoreRaw ? parseFloat(dealScoreRaw) : null;
  const isDailyDeal = isDailyDealRaw === "true";
  const gmcCategory = parseMetafieldByNsKey(mf, "mm-google-shopping", "google_product_category");
  const gmcAgeGroup = parseMetafieldByNsKey(mf, "mm-google-shopping", "age_group");
  const gmcGender = parseMetafieldByNsKey(mf, "mm-google-shopping", "gender");
  const gmcMpn = parseMetafieldByNsKey(mf, "mm-google-shopping", "mpn");
  const gmcColor = parseMetafieldByNsKey(mf, "mm-google-shopping", "color");
  const gmcMaterial = parseMetafieldByNsKey(mf, "mm-google-shopping", "material");
  const gmcSize = parseMetafieldByNsKey(mf, "mm-google-shopping", "size");
  const gmcLabel0 = parseMetafieldByNsKey(mf, "mm-google-shopping", "custom_label_0");
  const gmcLabel1 = parseMetafieldByNsKey(mf, "mm-google-shopping", "custom_label_1");
  const gmcLabel2 = parseMetafieldByNsKey(mf, "mm-google-shopping", "custom_label_2");
  const gmcLabel3 = parseMetafieldByNsKey(mf, "mm-google-shopping", "custom_label_3");
  const gmcLabel4 = parseMetafieldByNsKey(mf, "mm-google-shopping", "custom_label_4");
  return {
    id: node.id,
    handle: node.handle,
    seoTitle: node.title,
    dealDate: parseMetafield(mf, "deal_date"),
    dealPrice,
    msrp: parseFloat(originalPrice || (variant?.compareAtPrice?.amount ?? "0")),
    images: parseImages(node.images.edges),
    brand: node.vendor,
    category: parseCategory(parseMetafield(mf, "category")),
    dealStatus: "archived",
    qty: variant?.quantityAvailable ?? 0,
    defaultVariantId: variant?.id ?? null,
    hasMultipleVariants: variantEdges.length > 1,
    ...maxSavingsAmount > 0 ? { maxSavingsAmount, maxSavingsPercent } : {},
    ...moodTags.length > 0 ? { moodTags } : {},
    ...audienceTags.length > 0 ? { audienceTags } : {},
    ...mattersTags.length > 0 ? { mattersTags } : {},
    ...heroVideo?.src && typeof heroVideo.duration === "number" ? { heroVideo: { src: heroVideo.src, duration: heroVideo.duration, ...heroVideo.poster ? { poster: heroVideo.poster } : {} } } : {},
    // GMC fields
    ...variant?.barcode != null ? { barcode: variant.barcode } : {},
    ...seoDesc != null ? { seoDesc } : {},
    ...moodImageUrl != null ? { moodImageUrl } : {},
    ...featureBullets.length > 0 ? { featureBullets } : {},
    ...specifications.length > 0 ? { specifications } : {},
    ...productTypeDial != null ? { productTypeDial } : {},
    ...originalPrice != null ? { originalPrice } : {},
    ...gmcCategory != null ? { gmcCategory } : {},
    ...gmcAgeGroup != null ? { gmcAgeGroup } : {},
    ...gmcGender != null ? { gmcGender } : {},
    ...gmcMpn != null ? { gmcMpn } : {},
    ...gmcColor != null ? { gmcColor } : {},
    ...gmcMaterial != null ? { gmcMaterial } : {},
    ...gmcSize != null ? { gmcSize } : {},
    ...gmcLabel0 != null ? { gmcLabel0 } : {},
    ...gmcLabel1 != null ? { gmcLabel1 } : {},
    ...gmcLabel2 != null ? { gmcLabel2 } : {},
    ...gmcLabel3 != null ? { gmcLabel3 } : {},
    ...gmcLabel4 != null ? { gmcLabel4 } : {},
    ...dealScoreNum !== null && !isNaN(dealScoreNum) ? { dealScore: dealScoreNum } : {},
    isDailyDeal
  };
}
async function getFeedDeals(page = 1, limit = 50) {
  const data = await storefront(`
    query GetFeedPage($first: Int!, $after: String) {
      products(first: $first, after: $after, query: "tag:deal-status-archived", sortKey: UPDATED_AT, reverse: true) {
        pageInfo { hasNextPage }
        edges {
          cursor
          node { ${GMC_FEED_CARD_FRAGMENT} }
        }
      }
    }
  `, { first: limit, after: page > 1 ? btoa(`${(page - 1) * limit}`) : null });
  return {
    deals: data.products.edges.map((e) => nodeToFeedDeal(e.node)),
    hasNextPage: data.products.pageInfo.hasNextPage
  };
}
function sortToStorefront(sort) {
  switch (sort) {
    case "newest":
      return { sortKey: "CREATED", reverse: true };
    case "price-asc":
      return { sortKey: "PRICE", reverse: false };
    case "price-desc":
      return { sortKey: "PRICE", reverse: true };
    case "manual":
    default:
      return { sortKey: "MANUAL", reverse: false };
  }
}
async function getCollectionDeals(handle, page = 1, limit = 20, sort = "manual") {
  const { sortKey, reverse } = sortToStorefront(sort);
  let after = null;
  if (page > 1) {
    const cached2 = await kvGet(KV_KEYS.collectionCursor(handle, page, sort));
    if (cached2) {
      after = cached2;
    } else {
      for (let p = 1; p < page; p++) {
        const skip = await storefront(`
          query SkipPage($handle: String!, $first: Int!, $after: String, $sortKey: ProductCollectionSortKeys!, $reverse: Boolean!) {
            collection(handle: $handle) {
              products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse) {
                edges { cursor }
              }
            }
          }
        `, { handle, first: limit, after, sortKey, reverse });
        const edges = skip.collection?.products.edges;
        if (!edges?.length) return { deals: [], hasNextPage: false };
        after = edges[edges.length - 1].cursor;
        await kvSet(KV_KEYS.collectionCursor(handle, p + 1, sort), after, COLLECTION_CURSOR_TTL);
      }
    }
  }
  const data = await storefront(`
    query GetCollectionDeals($handle: String!, $first: Int!, $after: String, $sortKey: ProductCollectionSortKeys!, $reverse: Boolean!) {
      collection(handle: $handle) {
        products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse) {
          pageInfo { hasNextPage }
          edges { cursor node { ${PRODUCT_CARD_FRAGMENT} } }
        }
      }
    }
  `, { handle, first: limit, after, sortKey, reverse });
  if (!data.collection) return { deals: [], hasNextPage: false };
  return {
    deals: data.collection.products.edges.map((e) => nodeToVaultDeal(e.node)),
    hasNextPage: data.collection.products.pageInfo.hasNextPage
  };
}
async function getMainMenu() {
  return cached("shopify:menu:main-menu", 300, async () => {
    const data = await storefront(`
      query GetMenu {
        menu(handle: "main-menu") {
          items {
            title
            url
            items {
              title
              url
              items {
                title
                url
              }
            }
          }
        }
      }
    `);
    return data.menu?.items ?? [];
  });
}
async function getCollectionList() {
  return cached("shopify:collection-list:public", 300, async () => {
    const out = [];
    let cursor = null;
    for (let page = 0; page < 4; page++) {
      const data = await storefront(`
        query CollectionList($first: Int!, $after: String) {
          collections(first: $first, after: $after, sortKey: TITLE) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                handle
                title
                description
                image { url altText }
                products(first: 1) {
                  pageInfo { hasNextPage }
                  edges { node { id } }
                }
              }
            }
          }
        }
      `, { first: 100, after: cursor });
      for (const edge of data.collections.edges) {
        const n = edge.node;
        const hasProducts = n.products.edges.length > 0 || n.products.pageInfo.hasNextPage;
        if (!hasProducts) continue;
        out.push({
          handle: n.handle,
          title: n.title,
          description: n.description ?? "",
          image: n.image,
          productsCount: n.products.pageInfo.hasNextPage ? null : n.products.edges.length
        });
      }
      if (!data.collections.pageInfo.hasNextPage) break;
      cursor = data.collections.pageInfo.endCursor;
      if (!cursor) break;
    }
    return out;
  });
}
async function getShopifyCollections() {
  const data = await adminGraphQL(`
    query GetCollections {
      collections(first: 100, sortKey: TITLE) {
        edges {
          node {
            id
            handle
            title
            descriptionHtml
            productsCount { count }
            image { url altText }
          }
        }
      }
    }
  `);
  return data.collections.edges.map((e) => ({
    id: e.node.id,
    handle: e.node.handle,
    title: e.node.title,
    descriptionHtml: e.node.descriptionHtml,
    productsCount: e.node.productsCount?.count ?? 0,
    image: e.node.image
  }));
}
async function getAccessoryProducts(ids) {
  if (!ids.length) return [];
  const sortedKey = [...ids].sort().join(",");
  return cached(`shopify:acc:${sortedKey}`, READ_TTL, async () => {
    const queries = ids.map((id, i) => `p${i}: product(id: "${id}") { ${PRODUCT_CORE_FRAGMENT} }`).join("\n");
    const data = await storefront(`query { ${queries} }`);
    return Object.values(data).filter((n) => n !== null).map((n) => nodeToProduct(n));
  });
}
async function searchAdminProducts(query, limit = 20) {
  const gqlQuery = query.trim() ? `title:*${query.trim()}*` : "status:active";
  const data = await adminGraphQL(`
    query SearchProducts($query: String!, $first: Int!) {
      products(query: $query, first: $first, sortKey: TITLE) {
        nodes {
          id title handle
          featuredImage { url }
          variants(first: 1) {
            nodes { price compareAtPrice inventoryQuantity sku }
          }
          wholesaleCostMf: metafield(namespace: "xdipx", key: "wholesale_cost") { value }
          mapPriceMf:      metafield(namespace: "xdipx", key: "map_price")      { value }
        }
      }
    }
  `, { query: gqlQuery, first: limit });
  return (data.products.nodes ?? []).map((node) => {
    const variant = node.variants.nodes[0];
    return {
      id: node.id,
      title: node.title,
      handle: node.handle,
      image: node.featuredImage?.url ?? null,
      price: parseFloat(variant?.price ?? "0"),
      compareAtPrice: variant?.compareAtPrice ? parseFloat(variant.compareAtPrice) : null,
      inventoryQuantity: variant?.inventoryQuantity ?? 0,
      sku: variant?.sku ?? "",
      wholesaleCost: node.wholesaleCostMf ? parseFloat(node.wholesaleCostMf.value) : null,
      mapPrice: node.mapPriceMf ? parseFloat(node.mapPriceMf.value) : null
    };
  });
}
async function getAdminProductPrices(numericIds) {
  if (numericIds.length === 0) return {};
  const gids = numericIds.map((id) => `gid://shopify/Product/${id}`);
  const data = await adminGraphQL(`
    query GetProductPrices($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          variants(first: 1) { nodes { price } }
        }
      }
    }
  `, { ids: gids });
  const result = {};
  for (const node of data.nodes ?? []) {
    if (!node) continue;
    const numericId = node.id.replace("gid://shopify/Product/", "");
    const price = node.variants.nodes[0]?.price;
    if (price != null) result[numericId] = parseFloat(price);
  }
  return result;
}
async function getAdminProductData(numericIds) {
  if (numericIds.length === 0) return {};
  const gids = numericIds.map((id) => `gid://shopify/Product/${id}`);
  const data = await adminGraphQL(`
    query GetProductData($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          variants(first: 1) { nodes { price } }
          images(first: 12) { nodes { url } }
        }
      }
    }
  `, { ids: gids });
  const result = {};
  for (const node of data.nodes ?? []) {
    if (!node) continue;
    const numericId = node.id.replace("gid://shopify/Product/", "");
    const price = node.variants.nodes[0]?.price;
    result[numericId] = {
      price: price != null ? parseFloat(price) : null,
      images: node.images.nodes.map((img) => img.url)
    };
  }
  return result;
}
function mapSellingPlanAllocation(raw) {
  if (!raw) return void 0;
  const adj = raw.priceAdjustments[0];
  const allocation = {
    sellingPlan: { id: raw.sellingPlan.id, name: raw.sellingPlan.name }
  };
  if (adj) {
    const compareAt = parseFloat(adj.compareAtPrice.amount);
    const price = parseFloat(adj.price.amount);
    if (compareAt > 0 && price < compareAt) {
      allocation.discountPct = Math.round((compareAt - price) / compareAt * 100);
    }
  }
  return allocation;
}
function rawCartToCart(raw) {
  return {
    id: raw.id,
    checkoutUrl: raw.checkoutUrl,
    totalQuantity: raw.totalQuantity,
    lines: raw.lines.edges.map((e) => {
      const allocation = mapSellingPlanAllocation(e.node.sellingPlanAllocation);
      const line = {
        id: e.node.id,
        quantity: e.node.quantity,
        merchandise: {
          id: e.node.merchandise.id,
          title: e.node.merchandise.title,
          price: e.node.merchandise.price,
          product: {
            id: e.node.merchandise.product.id,
            title: e.node.merchandise.product.title,
            handle: e.node.merchandise.product.handle,
            images: parseImages(e.node.merchandise.product.images.edges)
          }
        }
      };
      if (allocation) line.sellingPlanAllocation = allocation;
      return line;
    }),
    cost: raw.cost
  };
}
async function createCart() {
  const data = await storefront(`
    mutation CartCreate {
      cartCreate { cart { ${CART_FRAGMENT} } }
    }
  `);
  return rawCartToCart(data.cartCreate.cart);
}
async function createCartWithLines(lines) {
  const data = await storefront(
    `mutation CartCreateWithLines($lines: [CartLineInput!]!) {
       cartCreate(input: { lines: $lines }) {
         cart { ${CART_FRAGMENT} }
         userErrors { field message }
       }
     }`,
    {
      lines: lines.map((l) => ({ merchandiseId: l.variantId, quantity: l.quantity }))
    }
  );
  if (!data.cartCreate.cart) {
    const msg = data.cartCreate.userErrors?.[0]?.message || "cart_create_failed";
    throw new Error(msg);
  }
  return rawCartToCart(data.cartCreate.cart);
}
async function getCart(cartId) {
  const data = await storefront(`
    query GetCart($id: ID!) { cart(id: $id) { ${CART_FRAGMENT} } }
  `, { id: cartId });
  if (!data.cart) return null;
  return rawCartToCart(data.cart);
}
async function addToCart(cartId, variantId, quantity, sellingPlanId) {
  const line = { merchandiseId: variantId, quantity };
  if (sellingPlanId) line["sellingPlanId"] = sellingPlanId;
  const data = await storefront(`
    mutation AddToCart($cartId: ID!, $lines: [CartLineInput!]!) {
      cartLinesAdd(cartId: $cartId, lines: $lines) {
        cart { ${CART_FRAGMENT} }
        userErrors { field message }
      }
    }
  `, { cartId, lines: [line] });
  if (!data.cartLinesAdd.cart) throw new Error("Cart not found or line could not be added");
  return rawCartToCart(data.cartLinesAdd.cart);
}
async function addLinesToCart(cartId, lines) {
  const data = await storefront(`
    mutation AddLinesToCart($cartId: ID!, $lines: [CartLineInput!]!) {
      cartLinesAdd(cartId: $cartId, lines: $lines) {
        cart { ${CART_FRAGMENT} }
        userErrors { field message }
      }
    }
  `, {
    cartId,
    lines: lines.map((l) => ({ merchandiseId: l.variantId, quantity: l.quantity }))
  });
  if (!data.cartLinesAdd.cart) throw new Error("Cart not found or lines could not be added");
  return rawCartToCart(data.cartLinesAdd.cart);
}
async function setCartAttributes(cartId, attributes) {
  await storefront(`
    mutation CartAttributesUpdate($cartId: ID!, $attributes: [AttributeInput!]!) {
      cartAttributesUpdate(cartId: $cartId, attributes: $attributes) {
        cart { id }
        userErrors { field message }
      }
    }
  `, { cartId, attributes });
}
async function removeFromCart(cartId, lineIds) {
  const data = await storefront(`
    mutation RemoveFromCart($cartId: ID!, $lineIds: [ID!]!) {
      cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
        cart { ${CART_FRAGMENT} }
      }
    }
  `, { cartId, lineIds });
  return rawCartToCart(data.cartLinesRemove.cart);
}
async function updateCartLine(cartId, lineId, quantity) {
  const data = await storefront(`
    mutation UpdateCartLine($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
      cartLinesUpdate(cartId: $cartId, lines: $lines) {
        cart { ${CART_FRAGMENT} }
      }
    }
  `, { cartId, lines: [{ id: lineId, quantity }] });
  return rawCartToCart(data.cartLinesUpdate.cart);
}
async function updateProductMetafield(productId, key, value, type = "single_line_text_field", namespace = "xdipx") {
  const numericId = productId.replace("gid://shopify/Product/", "");
  await shopifyAdmin(`/products/${numericId}/metafields.json`, "POST", {
    metafield: { namespace, key, value, type }
  });
  invalidateCache(`shopify:deal:byid:${numericId}`);
  invalidateCache("shopify:deal:byhandle:");
  invalidateCache(`shopify:p:`);
}
async function updateProductDescriptionHtml(productId, bodyHtml) {
  const numericId = productId.replace("gid://shopify/Product/", "");
  await shopifyAdmin(`/products/${numericId}.json`, "PUT", {
    product: { id: Number(numericId), body_html: bodyHtml }
  });
  invalidateCache(`shopify:deal:byid:${numericId}`);
  invalidateCache("shopify:deal:byhandle:");
  invalidateCache(`shopify:p:`);
}
async function setPairingWhy(productId, blurbs, opts = { merge: true }) {
  const numericId = productId.replace("gid://shopify/Product/", "");
  let merged = blurbs;
  if (opts.merge !== false) {
    const { metafields } = await shopifyAdmin(`/products/${numericId}/metafields.json?namespace=xdipx&key=pairing_why`);
    const existing = metafields?.[0]?.value;
    if (existing) {
      try {
        const prev = JSON.parse(existing);
        merged = { ...prev, ...blurbs };
      } catch {
      }
    }
  }
  await updateProductMetafield(productId, "pairing_why", JSON.stringify(merged), "json");
}
async function getVariantCost(variantGid) {
  const id = variantGid.replace("gid://shopify/ProductVariant/", "");
  const { variant } = await shopifyAdmin(`/variants/${id}.json`);
  if (!variant?.inventory_item_id) return null;
  const { inventory_item } = await shopifyAdmin(
    `/inventory_items/${variant.inventory_item_id}.json`
  );
  const cost = parseFloat(inventory_item?.cost ?? "");
  return isNaN(cost) ? null : cost;
}
async function getProductVariantGids(shopifyProductId) {
  const numericId = shopifyProductId.replace("gid://shopify/Product/", "");
  const { product } = await shopifyAdmin(`/products/${numericId}.json?fields=variants`);
  return (product?.variants ?? []).map((v) => `gid://shopify/ProductVariant/${v.id}`);
}
async function updateVariantPricing(variantGid, price, compareAtPrice, wholesaleCost) {
  const id = variantGid.replace("gid://shopify/ProductVariant/", "");
  const { variant } = await shopifyAdmin(`/variants/${id}.json`, "PUT", {
    variant: { id, price, compare_at_price: compareAtPrice || null }
  });
  if (wholesaleCost && variant?.inventory_item_id) {
    await shopifyAdmin(`/inventory_items/${variant.inventory_item_id}.json`, "PUT", {
      inventory_item: { id: variant.inventory_item_id, cost: wholesaleCost }
    });
  }
}
async function setDealStatus(productId, status) {
  const numericId = productId.replace("gid://shopify/Product/", "");
  await updateProductMetafield(productId, "deal_status", status);
  const { product } = await shopifyAdmin(`/products/${numericId}.json`);
  if (!product) throw new Error(`Product ${numericId} not found when setting deal status`);
  const currentTags = product.tags.split(", ").filter((t) => !t.startsWith("deal-status-"));
  currentTags.push(`deal-status-${status}`);
  await shopifyAdmin(`/products/${numericId}.json`, "PUT", {
    product: { id: numericId, tags: currentTags.join(", ") }
  });
}
async function archiveShopifyProduct(productId, reason) {
  const numericId = productId.replace("gid://shopify/Product/", "");
  const gid = `gid://shopify/Product/${numericId}`;
  const updateResult = await adminGraphQL(`
    mutation ArchiveProduct($input: ProductInput!) {
      productUpdate(input: $input) {
        product { handle }
        userErrors { field message }
      }
    }
  `, { input: { id: gid, status: "ARCHIVED" } });
  if (updateResult.productUpdate.userErrors.length > 0) {
    const errs = updateResult.productUpdate.userErrors.map((e) => `${e.field.join(".")}: ${e.message}`).join("; ");
    throw new Error(`archiveShopifyProduct: ${errs}`);
  }
  const handle = updateResult.productUpdate.product?.handle ?? await getProductHandleById(numericId);
  await setDealStatus(productId, "archived");
  if (reason) {
    console.info(`[archiveShopifyProduct] ${numericId} archived: ${reason}`);
  }
  return { handle };
}
async function createDraftProduct(data) {
  const res = await shopifyAdmin("/products.json", "POST", {
    product: {
      title: data.title,
      handle: data.handle,
      body_html: data.bodyHtml,
      vendor: data.vendor,
      tags: data.tags.join(", "),
      status: "draft",
      variants: [{ price: data.variantPrice, compare_at_price: data.variantCompareAtPrice }],
      images: data.images.map((img) => ({ src: img.src, alt: img.alt })),
      metafields: data.metafields
    }
  });
  return res.product.id;
}
async function getHandleByProductId(productId) {
  try {
    const res = await shopifyAdmin(
      `/products/${productId}.json`,
      "GET"
    );
    return res?.product?.handle ?? null;
  } catch {
    return null;
  }
}
async function getWholesaleCostBySKU(sku) {
  const data = await storefront(`
    query GetWholesaleBySKU($query: String!) {
      products(first: 1, query: $query) {
        edges {
          node {
            metafields(identifiers: [{ namespace: "xdipx", key: "wholesale_cost" }]) {
              key value
            }
          }
        }
      }
    }
  `, { query: `tag:nalpac-sku-${sku}` });
  const raw = data.products.edges[0]?.node.metafields.find((m) => m.key === "wholesale_cost")?.value;
  return parseFloat(raw ?? "0");
}
async function pushProductToShopify(doc) {
  const gid = `gid://shopify/Product/${doc.shopifyProductId}`;
  let mergedTags;
  if (doc.tags !== void 0) {
    const numericId = doc.shopifyProductId.replace("gid://shopify/Product/", "");
    const { product } = await shopifyAdmin(`/products/${numericId}.json?fields=tags`);
    const currentTags = product?.tags ? product.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
    const operational = currentTags.filter(isOperationalTag);
    const editorial = editorialTagsOnly(doc.tags).filter((t) => t !== UNCATEGORIZED_SENTINEL);
    mergedTags = Array.from(/* @__PURE__ */ new Set([...operational, ...editorial]));
  }
  const updateResult = await adminGraphQL(`
    mutation ProductUpdate($input: ProductInput!) {
      productUpdate(input: $input) {
        userErrors { field message }
      }
    }
  `, {
    input: {
      id: gid,
      ...doc.title !== void 0 ? { title: doc.title } : {},
      ...doc.vendor !== void 0 ? { vendor: doc.vendor } : {},
      ...mergedTags !== void 0 ? { tags: mergedTags } : {},
      ...doc.descriptionHtml !== void 0 ? { descriptionHtml: doc.descriptionHtml } : doc.description !== void 0 ? { descriptionHtml: ptToHtml(doc.description) } : {},
      ...doc.seoTitle || doc.seoDescription ? {
        seo: {
          ...doc.seoTitle ? { title: doc.seoTitle } : {},
          ...doc.seoDescription ? { description: doc.seoDescription } : {}
        }
      } : {}
    }
  });
  if (updateResult.productUpdate.userErrors.length > 0) {
    const errs = updateResult.productUpdate.userErrors.map((e) => `${e.field.join(".")}: ${e.message}`).join("; ");
    console.error("[pushProductToShopify] productUpdate userErrors:", errs);
    throw new Error(`Shopify product update rejected: ${errs}`);
  }
  const metafields = [];
  const add = (key, value, type, required = false) => {
    let v = value;
    if (v && type === "single_line_text_field") v = v.replace(/[\r\n]+/g, " ").trim();
    if (!v || v === "") {
      if (required) throw new Error(`pushProductToShopify: required field "${key}" is empty`);
      return;
    }
    metafields.push({ namespace: "xdipx", key, value: v, type, ownerId: gid });
  };
  const addCustom = (key, value, type) => {
    let v = value;
    if (v && type === "single_line_text_field") v = v.replace(/[\r\n]+/g, " ").trim();
    if (!v || v === "") return;
    metafields.push({ namespace: "custom", key, value: v, type, ownerId: gid });
  };
  add("tagline", doc.tagline, "single_line_text_field", doc.requireTagline !== false);
  add("full_story", ptToHtml(doc.fullStory), "multi_line_text_field");
  add("works_for_him", ptToHtml(doc.worksForHim), "multi_line_text_field");
  add("works_for_her", ptToHtml(doc.worksForHer), "multi_line_text_field");
  add("mood_image_url", doc.moodImageUrl, "single_line_text_field");
  add("product_type_dial", doc.productTypeDial, "single_line_text_field");
  addCustom("product_subtype_dial", doc.productSubtypeDial ?? void 0, "single_line_text_field");
  add("original_title", doc.originalTitle, "single_line_text_field");
  if (doc.category && doc.category.length > 0) {
    metafields.push({
      namespace: "xdipx",
      key: "category",
      ownerId: gid,
      value: JSON.stringify(doc.category),
      type: "single_line_text_field"
    });
  }
  add("deal_status", doc.dealStatus, "single_line_text_field");
  add("deal_date", doc.dealDate, "date");
  add("nalpac_sku", doc.nalpacSku, "single_line_text_field");
  add("original_price", doc.originalPrice?.toString(), "number_decimal");
  add("wholesale_cost", doc.wholesaleCost?.toString(), "number_decimal");
  add("map_price", doc.mapPrice?.toString(), "number_decimal");
  if (doc.boxContents?.length) {
    metafields.push({
      namespace: "xdipx",
      key: "box_contents",
      ownerId: gid,
      value: JSON.stringify(doc.boxContents),
      type: "json"
    });
  }
  if (doc.accessoryProductIds !== void 0) {
    metafields.push({
      namespace: "xdipx",
      key: "accessory_product_ids",
      ownerId: gid,
      value: JSON.stringify(doc.accessoryProductIds),
      type: "json"
    });
  }
  add("deal_score", doc.dealScore?.toString(), "number_decimal");
  add("seo_meta_description", doc.seoMetaDescription, "multi_line_text_field");
  if (doc.specifications?.length) {
    metafields.push({
      namespace: "xdipx",
      key: "specifications",
      ownerId: gid,
      value: JSON.stringify(doc.specifications),
      type: "multi_line_text_field"
    });
  }
  if (doc.careInstructions?.length) {
    metafields.push({
      namespace: "xdipx",
      key: "care_instructions",
      ownerId: gid,
      value: JSON.stringify(doc.careInstructions),
      type: "json"
    });
  }
  if (doc.sensationDialV2?.items?.length) {
    metafields.push({
      namespace: "xdipx",
      key: "sensation_dial_v2",
      ownerId: gid,
      value: JSON.stringify(doc.sensationDialV2),
      type: "json"
    });
  }
  if (doc.moodTags?.length) {
    metafields.push({
      namespace: "xdipx",
      key: "mood_tags",
      ownerId: gid,
      value: JSON.stringify(doc.moodTags),
      type: "list.single_line_text_field"
    });
  }
  if (doc.audienceTags?.length) {
    metafields.push({
      namespace: "xdipx",
      key: "audience_tags",
      ownerId: gid,
      value: JSON.stringify(doc.audienceTags),
      type: "list.single_line_text_field"
    });
  }
  if (doc.mattersTags?.length) {
    metafields.push({
      namespace: "xdipx",
      key: "matters_tags",
      ownerId: gid,
      value: JSON.stringify(doc.mattersTags),
      type: "list.single_line_text_field"
    });
  }
  if (doc.sectionTags?.length) {
    metafields.push({
      namespace: "custom",
      key: "section_tags",
      ownerId: gid,
      value: JSON.stringify(doc.sectionTags),
      type: "list.single_line_text_field"
    });
  }
  if (doc.emmaHero) {
    metafields.push({
      namespace: "xdipx",
      key: "emma_hero",
      ownerId: gid,
      value: JSON.stringify(doc.emmaHero),
      type: "json"
    });
  }
  if (doc.pairingWhy && Object.keys(doc.pairingWhy).length > 0) {
    metafields.push({
      namespace: "xdipx",
      key: "pairing_why",
      ownerId: gid,
      value: JSON.stringify(doc.pairingWhy),
      type: "json"
    });
  }
  if (doc.rawDescription) {
    metafields.push({ namespace: "custom", key: "original_description", value: doc.rawDescription, type: "multi_line_text_field", ownerId: gid });
  }
  metafields.push({ namespace: "mm-google-shopping", key: "adult", value: "yes", type: "single_line_text_field", ownerId: gid });
  if (metafields.length > 0) {
    const mfResult = await adminGraphQL(`
      mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }
    `, { metafields });
    if (mfResult.metafieldsSet.userErrors.length > 0) {
      const errs = mfResult.metafieldsSet.userErrors.map((e) => `${e.field.join(".")}: ${e.message}`).join("; ");
      console.error("[pushProductToShopify] metafieldsSet userErrors:", errs);
      throw new Error(`Shopify metafields rejected: ${errs}`);
    }
  }
}
async function setMetafield(ownerGid, namespace, key, type, value) {
  if (!ownerGid.startsWith("gid://")) {
    throw new Error(`setMetafield requires a fully-qualified GID, got ${ownerGid}`);
  }
  const res = await adminGraphQL(`
    mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }
  `, { metafields: [{ namespace, key, type, value, ownerId: ownerGid }] });
  if (res.metafieldsSet.userErrors.length > 0) {
    const errs = res.metafieldsSet.userErrors.map((e) => `${e.field.join(".")}: ${e.message}`).join("; ");
    throw new Error(`metafieldsSet rejected ${namespace}.${key}: ${errs}`);
  }
}
async function findVariantBySKU(sku) {
  const data = await adminGraphQL(`
    query FindVariantBySKU($query: String!) {
      productVariants(first: 1, query: $query) {
        edges { node { id } }
      }
    }
  `, { query: `sku:${sku}` });
  return data.productVariants.edges[0]?.node.id ?? null;
}
async function ensureMetafieldDefinition(input) {
  const res = await adminGraphQL(`
    mutation CreateDef($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition { id }
        userErrors { field message code }
      }
    }
  `, {
    definition: {
      namespace: input.namespace,
      key: input.key,
      name: input.name,
      ...input.description ? { description: input.description } : {},
      type: input.type,
      ownerType: input.ownerType,
      access: input.storefrontAccess === false ? { storefront: "NONE" } : { storefront: "PUBLIC_READ" }
    }
  });
  if (res.metafieldDefinitionCreate.createdDefinition) return { created: true };
  const alreadyExists = res.metafieldDefinitionCreate.userErrors.some(
    (e) => e.code === "TAKEN" || /already exists|already taken/i.test(e.message)
  );
  if (alreadyExists) return { created: false };
  const errs = res.metafieldDefinitionCreate.userErrors.map((e) => `${e.field.join(".")}: ${e.message}`).join("; ");
  throw new Error(`metafieldDefinitionCreate failed for ${input.namespace}.${input.key}: ${errs}`);
}
async function activateShopifyProduct(numericId) {
  const id = numericId.replace("gid://shopify/Product/", "");
  await shopifyAdmin(`/products/${id}.json`, "PUT", {
    product: { id, status: "active" }
  });
  await publishProductToXdipxChannels(id);
}
async function activateProductInventoryAtLocations(numericId) {
  const id = numericId.replace("gid://shopify/Product/", "");
  const data = await adminGraphQL(`
    query ProductInventoryItems($id: ID!) {
      product(id: $id) {
        variants(first: 100) { edges { node { inventoryItem { id } } } }
      }
    }
  `, { id: `gid://shopify/Product/${id}` });
  const itemIds = (data.product?.variants.edges ?? []).map((e) => e.node.inventoryItem.id);
  for (const inventoryItemId of itemIds) {
    for (const locationId of XDIPX_LOCATION_IDS) {
      const res = await adminGraphQL(`
        mutation ActivateInventory($inventoryItemId: ID!, $locationId: ID!) {
          inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) {
            userErrors { field message }
          }
        }
      `, { inventoryItemId, locationId });
      const errs = res.inventoryActivate?.userErrors ?? [];
      if (errs.length) {
        console.warn(`[shopify] inventoryActivate ${inventoryItemId} @ ${locationId}:`, errs.map((e) => e.message).join("; "));
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}
async function publishProductToXdipxChannels(numericId) {
  const id = numericId.replace("gid://shopify/Product/", "");
  const gid = `gid://shopify/Product/${id}`;
  const { publications } = await adminGraphQL(`query GetPublications { publications(first: 30) { edges { node { id name } } } }`);
  const wanted = new Set(XDIPX_PUBLICATION_NAMES);
  const excluded = new Set(XDIPX_EXCLUDED_PUBLICATION_NAMES);
  const toPublish = publications.edges.filter((e) => wanted.has(e.node.name)).map((e) => e.node.id);
  const toUnpublish = publications.edges.filter((e) => excluded.has(e.node.name)).map((e) => e.node.id);
  if (toPublish.length > 0) {
    const res = await adminGraphQL(`
      mutation PublishProduct($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          userErrors { field message }
        }
      }
    `, { id: gid, input: toPublish.map((pid) => ({ publicationId: pid })) });
    const errs = res.publishablePublish?.userErrors ?? [];
    if (errs.length) console.warn("[shopify] publishablePublish:", errs.map((e) => e.message).join("; "));
  }
  if (toUnpublish.length > 0) {
    const res = await adminGraphQL(`
      mutation UnpublishProduct($id: ID!, $input: [PublicationInput!]!) {
        publishableUnpublish(id: $id, input: $input) {
          userErrors { field message }
        }
      }
    `, { id: gid, input: toUnpublish.map((pid) => ({ publicationId: pid })) });
    const errs = res.publishableUnpublish?.userErrors ?? [];
    if (errs.length) console.warn("[shopify] publishableUnpublish:", errs.map((e) => e.message).join("; "));
  }
}
async function findProductBySKU(sku) {
  const data = await adminGraphQL(`
    query FindProductBySKU($query: String!) {
      products(first: 1, query: $query) {
        edges { node { id } }
      }
    }
  `, { query: `sku:${sku}` });
  return data.products.edges[0]?.node.id ?? null;
}
function slugifyHandle(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 200);
}
async function createShopifyProductFromFeed(product, handle) {
  const tags = buildProductTags(product);
  const res = await shopifyAdmin("/products.json", "POST", {
    product: {
      title: product.title,
      handle,
      vendor: product.brand,
      tags: tags.join(", "),
      status: "draft",
      variants: [{
        sku: product.sku,
        price: product.dealPrice.toFixed(2),
        compare_at_price: product.msrp.toFixed(2),
        inventory_management: "shopify",
        inventory_quantity: product.qty
      }],
      images: product.images.slice(0, 10).map((src) => ({ src }))
    }
  });
  const inventoryItemId = res.product.variants[0]?.inventory_item_id;
  if (inventoryItemId) {
    await shopifyAdmin(`/inventory_items/${inventoryItemId}.json`, "PUT", {
      inventory_item: { id: inventoryItemId, cost: product.wholesaleCost.toFixed(2) }
    });
  }
  return String(res.product.id);
}
async function createShopifyProductWithVariants(master, variants, optionNames, handle) {
  if (optionNames.length === 0 || optionNames.length > 2) {
    throw new Error(`createShopifyProductWithVariants: optionNames must have 1 or 2 entries, got ${optionNames.length}`);
  }
  const tags = [
    `brand:${master.brand.toLowerCase().replace(/\s+/g, "-")}`,
    `nalpac-sku-${master.sku}`,
    "deal-status-pending",
    ...master.msrp < 25 ? ["price:under-25"] : master.msrp < 50 ? ["price:25-50"] : master.msrp < 100 ? ["price:50-100"] : ["price:100-plus"],
    ...master.categories.map((c) => `cat:${c.toLowerCase().replace(/\s+/g, "-")}`)
  ];
  const res = await shopifyAdmin("/products.json", "POST", {
    product: {
      title: master.title,
      handle,
      vendor: master.brand,
      tags: tags.join(", "),
      status: "draft",
      options: optionNames.map((name, i) => ({
        name,
        values: [...new Set(variants.map((v) => v.optionValues[i]).filter(Boolean))]
      })),
      variants: variants.map((v) => ({
        sku: v.sku,
        option1: v.optionValues[0],
        ...optionNames.length > 1 ? { option2: v.optionValues[1] } : {},
        price: v.price.toFixed(2),
        compare_at_price: v.compareAtPrice.toFixed(2),
        inventory_management: "shopify",
        inventory_quantity: v.qty
      })),
      images: master.images.slice(0, 10).map((src) => ({ src }))
    }
  });
  const galleryByUrl = /* @__PURE__ */ new Map();
  for (const img of res.product.images ?? []) galleryByUrl.set(img.src, img.id);
  for (let i = 0; i < res.product.variants.length; i++) {
    const sv = res.product.variants[i];
    const bv = variants[i];
    if (!sv || !bv || bv.images.length === 0) continue;
    const firstImage = bv.images[0];
    if (!firstImage) continue;
    try {
      const existingId = galleryByUrl.get(firstImage);
      if (existingId) {
        await shopifyAdmin(`/variants/${sv.id}.json`, "PUT", {
          variant: { id: Number(sv.id), image_id: Number(existingId) }
        });
      } else {
        const imgRes = await shopifyAdmin(
          `/products/${res.product.id}/images.json`,
          "POST",
          { image: { src: firstImage, variant_ids: [Number(sv.id)] } }
        );
        galleryByUrl.set(firstImage, imgRes.image.id);
      }
    } catch (err) {
      console.warn(`[shopify] variant image linkage failed for ${bv.sku}:`, err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  for (let i = 0; i < res.product.variants.length; i++) {
    const shopifyVariant = res.product.variants[i];
    const bulkVariant = variants[i];
    if (shopifyVariant?.inventory_item_id && bulkVariant) {
      await shopifyAdmin(`/inventory_items/${shopifyVariant.inventory_item_id}.json`, "PUT", {
        inventory_item: {
          id: shopifyVariant.inventory_item_id,
          cost: bulkVariant.wholesale.toFixed(2)
        }
      });
      if (i < res.product.variants.length - 1) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }
  return String(res.product.id);
}
async function createStagedVideoUpload(filename, fileSizeBytes) {
  const data = await adminGraphQL(`
    mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }
  `, {
    input: [{
      filename,
      mimeType: "video/mp4",
      httpMethod: "POST",
      resource: "VIDEO",
      fileSize: String(fileSizeBytes)
    }]
  });
  if (data.stagedUploadsCreate.userErrors.length > 0) {
    const errs = data.stagedUploadsCreate.userErrors.map((e) => e.message).join("; ");
    throw new Error(`Shopify stagedUploadsCreate error: ${errs}`);
  }
  const target = data.stagedUploadsCreate.stagedTargets[0];
  if (!target) throw new Error("Shopify returned no staged upload target");
  return target;
}
async function attachVideoToProduct(shopifyProductGid, resourceUrl, altText) {
  const data = await adminGraphQL(`
    mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media {
          ... on Video { id status }
          ... on ExternalVideo { id status }
          ... on MediaImage { id status }
        }
        mediaUserErrors { field message }
      }
    }
  `, {
    productId: shopifyProductGid,
    media: [{
      originalSource: resourceUrl,
      alt: altText,
      mediaContentType: "VIDEO"
    }]
  });
  if (data.productCreateMedia.mediaUserErrors.length > 0) {
    const errs = data.productCreateMedia.mediaUserErrors.map((e) => e.message).join("; ");
    throw new Error(`Shopify productCreateMedia error: ${errs}`);
  }
  const mediaId = data.productCreateMedia.media[0]?.id;
  if (!mediaId) throw new Error("Shopify returned no media ID after productCreateMedia");
  return mediaId;
}
async function pollMediaReady(shopifyProductGid, mediaId, maxWaitMs = 9e4) {
  const interval = 1e4;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const data = await adminGraphQL(`
      query PollMediaStatus($productId: ID!) {
        product(id: $productId) {
          media(first: 20) {
            edges {
              node {
                ... on Video { id status }
                ... on ExternalVideo { id status }
                ... on MediaImage { id status }
              }
            }
          }
        }
      }
    `, { productId: shopifyProductGid });
    const node = data.product?.media.edges.find((e) => e.node.id === mediaId)?.node;
    if (node?.status === "READY") return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}
async function setMediaAsPrimary(shopifyProductGid, mediaId) {
  await adminGraphQL(`
    mutation ReorderMedia($id: ID!, $moves: [MoveInput!]!) {
      productReorderMedia(id: $id, moves: $moves) {
        mediaUserErrors { field message }
      }
    }
  `, {
    id: shopifyProductGid,
    moves: [{ id: mediaId, newPosition: "0" }]
  });
}
async function uploadThumbnailToProduct(shopifyProductGid, imageBuffer, filename, altText, mimeType = "image/jpeg") {
  const staged = await adminGraphQL(`
    mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }
  `, {
    input: [{
      filename,
      mimeType,
      httpMethod: "POST",
      resource: "IMAGE",
      fileSize: String(imageBuffer.length)
    }]
  });
  if (staged.stagedUploadsCreate.userErrors.length > 0) {
    const errs = staged.stagedUploadsCreate.userErrors.map((e) => e.message).join("; ");
    throw new Error(`Shopify stagedUploadsCreate (image) error: ${errs}`);
  }
  const target = staged.stagedUploadsCreate.stagedTargets[0];
  if (!target) throw new Error("Shopify returned no staged upload target for image");
  const form = new FormData();
  for (const param of target.parameters) form.append(param.name, param.value);
  form.append("file", new Blob([new Uint8Array(imageBuffer)], { type: mimeType }), filename);
  const uploadRes = await fetch(target.url, { method: "POST", body: form });
  if (!uploadRes.ok) {
    throw new Error(`Staged image upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  }
  const data = await adminGraphQL(`
    mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { ... on MediaImage { id } }
        mediaUserErrors { field message }
      }
    }
  `, {
    productId: shopifyProductGid,
    media: [{
      originalSource: target.resourceUrl,
      alt: altText,
      mediaContentType: "IMAGE"
    }]
  });
  if (data.productCreateMedia.mediaUserErrors.length > 0) {
    const errs = data.productCreateMedia.mediaUserErrors.map((e) => e.message).join("; ");
    throw new Error(`Shopify productCreateMedia (image) error: ${errs}`);
  }
  const mediaId = data.productCreateMedia.media[0]?.id;
  if (!mediaId) throw new Error("Shopify returned no media ID after image upload");
  return mediaId;
}
async function uploadMoodImageToShopifyFiles(imageBuffer, filename) {
  const staged = await adminGraphQL(`
    mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }
  `, {
    input: [{
      filename,
      mimeType: "image/jpeg",
      httpMethod: "POST",
      resource: "FILE",
      fileSize: String(imageBuffer.length)
    }]
  });
  if (staged.stagedUploadsCreate.userErrors.length > 0) {
    const errs = staged.stagedUploadsCreate.userErrors.map((e) => e.message).join("; ");
    throw new Error(`Shopify stagedUploadsCreate (mood image file) error: ${errs}`);
  }
  const target = staged.stagedUploadsCreate.stagedTargets[0];
  if (!target) throw new Error("Shopify returned no staged upload target for mood image");
  const form = new FormData();
  for (const param of target.parameters) form.append(param.name, param.value);
  form.append("file", new Blob([new Uint8Array(imageBuffer)], { type: "image/jpeg" }), filename);
  const uploadRes = await fetch(target.url, { method: "POST", body: form });
  if (!uploadRes.ok) {
    throw new Error(`Staged mood-image upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  }
  const created = await adminGraphQL(`
    mutation FileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          fileStatus
          ... on GenericFile { url }
          ... on MediaImage { image { url } }
        }
        userErrors { field message }
      }
    }
  `, {
    files: [{
      originalSource: target.resourceUrl,
      contentType: "IMAGE",
      alt: filename
    }]
  });
  if (created.fileCreate.userErrors.length > 0) {
    const errs = created.fileCreate.userErrors.map((e) => e.message).join("; ");
    throw new Error(`Shopify fileCreate (mood image) error: ${errs}`);
  }
  const file = created.fileCreate.files[0];
  const url = file?.url ?? file?.image?.url;
  if (!url) {
    const fileId = file?.id;
    if (!fileId) throw new Error("Shopify fileCreate returned no file id");
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const polled = await adminGraphQL(`
        query PollFile($id: ID!) {
          node(id: $id) {
            ... on GenericFile { id url }
            ... on MediaImage  { id image { url } }
          }
        }
      `, { id: fileId });
      const u = polled.node?.url ?? polled.node?.image?.url;
      if (u) return u;
    }
    throw new Error("Shopify fileCreate: no URL after polling");
  }
  return url;
}
async function getProductAdminImages(numericId) {
  const id = numericId.replace("gid://shopify/Product/", "");
  const data = await shopifyAdmin(`/products/${id}/images.json?limit=250`);
  return data.images ?? [];
}
async function deleteProductImage(numericProductId, imageId) {
  const id = numericProductId.replace("gid://shopify/Product/", "");
  await shopifyAdmin(`/products/${id}/images/${imageId}.json`, "DELETE");
}
async function deleteProductMedia(shopifyProductGid, mediaGids) {
  if (mediaGids.length === 0) return;
  const data = await adminGraphQL(`
    mutation ProductDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
      productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
        deletedMediaIds
        mediaUserErrors { field message }
      }
    }
  `, { productId: shopifyProductGid, mediaIds: mediaGids });
  if (data.productDeleteMedia.mediaUserErrors.length > 0) {
    const errs = data.productDeleteMedia.mediaUserErrors.map((e) => e.message).join("; ");
    throw new Error(`Shopify productDeleteMedia error: ${errs}`);
  }
}
async function reorderProductImages(numericProductId, imagePositions) {
  const id = numericProductId.replace("gid://shopify/Product/", "");
  await Promise.all(
    imagePositions.map(
      (img) => shopifyAdmin(`/products/${id}/images/${img.id}.json`, "PUT", {
        image: { id: img.id, position: img.position }
      })
    )
  );
}
async function associateImageWithVariant(_numericProductId, numericVariantId, imageId) {
  const vid = numericVariantId.replace("gid://shopify/ProductVariant/", "");
  await shopifyAdmin(`/variants/${vid}.json`, "PUT", {
    variant: { id: parseInt(vid), image_id: imageId }
  });
}
async function createCustomerAccessToken(email, password) {
  const data = await storefront(`
    mutation CustomerAccessTokenCreate($input: CustomerAccessTokenCreateInput!) {
      customerAccessTokenCreate(input: $input) {
        customerAccessToken { accessToken expiresAt }
        customerUserErrors { message }
      }
    }
  `, { input: { email, password } });
  const { customerAccessToken, customerUserErrors } = data.customerAccessTokenCreate;
  if (customerUserErrors.length > 0) {
    return { error: customerUserErrors[0]?.message ?? "Login failed" };
  }
  if (!customerAccessToken) return { error: "Login failed" };
  return customerAccessToken;
}
async function getStorefrontCustomer(accessToken) {
  const data = await storefront(`
    query GetCustomer($customerAccessToken: String!) {
      customer(customerAccessToken: $customerAccessToken) {
        id firstName lastName email phone
        orders(first: 20, sortKey: PROCESSED_AT, reverse: true) {
          edges {
            node {
              id orderNumber processedAt financialStatus fulfillmentStatus
              currentTotalPrice { amount currencyCode }
              lineItems(first: 5) {
                edges {
                  node {
                    title quantity
                    variant {
                      image { url }
                      price { amount }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `, { customerAccessToken: accessToken }).catch(() => ({ customer: null }));
  const c = data?.customer;
  if (!c) return null;
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    orders: c.orders.edges.map(({ node: o }) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      processedAt: o.processedAt,
      financialStatus: o.financialStatus,
      fulfillmentStatus: o.fulfillmentStatus,
      totalPrice: o.currentTotalPrice,
      lineItems: o.lineItems.edges.map(({ node: li }) => ({
        title: li.title,
        quantity: li.quantity,
        imageUrl: li.variant?.image?.url ?? null,
        price: li.variant?.price.amount ?? "0"
      }))
    }))
  };
}
function mapCustomerAddress(a) {
  return {
    id: a.id,
    firstName: a.firstName,
    lastName: a.lastName,
    company: a.company,
    address1: a.address1,
    address2: a.address2,
    city: a.city,
    province: a.province,
    provinceCode: a.provinceCode,
    country: a.country,
    countryCodeV2: a.countryCodeV2,
    zip: a.zip,
    phone: a.phone,
    formatted: a.formatted
  };
}
function mapLeanOrder(o) {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    processedAt: o.processedAt,
    financialStatus: o.financialStatus,
    fulfillmentStatus: o.fulfillmentStatus,
    totalPrice: o.currentTotalPrice,
    lineItems: o.lineItems.edges.map(({ node: li }) => ({
      title: li.title,
      quantity: li.quantity,
      imageUrl: li.variant?.image?.url ?? null,
      price: li.variant?.price.amount ?? "0"
    }))
  };
}
async function getCustomerProfile(accessToken) {
  const data = await storefront(`
    query GetCustomerProfile($customerAccessToken: String!) {
      customer(customerAccessToken: $customerAccessToken) {
        id firstName lastName email phone acceptsMarketing createdAt
        defaultAddress { id }
        addresses(first: 20) {
          edges { node { ${CUSTOMER_ADDRESS_FRAGMENT} } }
        }
        orders(first: 10, sortKey: PROCESSED_AT, reverse: true) {
          edges { node { ${STOREFRONT_ORDER_LEAN_FRAGMENT} } }
        }
      }
    }
  `, { customerAccessToken: accessToken }).catch(() => ({ customer: null }));
  const c = data?.customer;
  if (!c) return null;
  return {
    id: c.id,
    firstName: c.firstName ?? "",
    lastName: c.lastName ?? "",
    email: c.email,
    phone: c.phone,
    acceptsMarketing: c.acceptsMarketing,
    createdAt: c.createdAt,
    defaultAddressId: c.defaultAddress?.id ?? null,
    addresses: c.addresses.edges.map((e) => mapCustomerAddress(e.node)),
    orders: c.orders.edges.map((e) => mapLeanOrder(e.node))
  };
}
async function getCustomerOrders(accessToken, opts = {}) {
  const first = opts.first ?? 10;
  const after = opts.after ?? null;
  const query = opts.query ?? null;
  const data = await storefront(`
    query GetCustomerOrders($customerAccessToken: String!, $first: Int!, $after: String, $query: String) {
      customer(customerAccessToken: $customerAccessToken) {
        orders(first: $first, after: $after, sortKey: PROCESSED_AT, reverse: true, query: $query) {
          pageInfo { hasNextPage endCursor }
          edges { node { ${STOREFRONT_ORDER_LEAN_FRAGMENT} } }
        }
      }
    }
  `, { customerAccessToken: accessToken, first, after, query });
  const c = data?.customer;
  if (!c) {
    return { orders: [], pageInfo: { hasNextPage: false, endCursor: null } };
  }
  return {
    orders: c.orders.edges.map((e) => mapLeanOrder(e.node)),
    pageInfo: c.orders.pageInfo
  };
}
function mapOrderDetail(o) {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    processedAt: o.processedAt,
    financialStatus: o.financialStatus,
    fulfillmentStatus: o.fulfillmentStatus,
    statusUrl: o.statusUrl,
    email: o.email,
    phone: o.phone,
    canceledAt: o.canceledAt,
    cancelReason: o.cancelReason,
    shippingAddress: o.shippingAddress ? mapCustomerAddress(o.shippingAddress) : null,
    subtotalPrice: o.subtotalPriceV2,
    totalShippingPrice: o.totalShippingPriceV2,
    totalTax: o.totalTaxV2,
    totalPrice: o.totalPriceV2,
    successfulFulfillments: o.successfulFulfillments.map((f) => ({
      trackingCompany: f.trackingCompany,
      trackingInfo: f.trackingInfo.map((t) => ({
        number: t.number,
        url: t.url,
        company: f.trackingCompany
      }))
    })),
    lineItems: o.lineItems.edges.map(({ node: li }) => ({
      title: li.title,
      quantity: li.quantity,
      variantId: li.variant?.id ?? null,
      variantTitle: li.variant?.title ?? null,
      imageUrl: li.variant?.image?.url ?? null,
      unitPrice: li.variant?.price ? { amount: li.variant.price.amount, currencyCode: li.variant.price.currencyCode } : null
    }))
  };
}
async function getCustomerOrder(accessToken, orderId) {
  const data = await storefront(`
    query GetCustomerOrder($customerAccessToken: String!) {
      customer(customerAccessToken: $customerAccessToken) {
        orders(first: 250, sortKey: PROCESSED_AT, reverse: true) {
          edges {
            node {
              id orderNumber processedAt financialStatus fulfillmentStatus
              statusUrl email phone canceledAt cancelReason
              shippingAddress { ${CUSTOMER_ADDRESS_FRAGMENT} }
              subtotalPriceV2 { amount currencyCode }
              totalShippingPriceV2 { amount currencyCode }
              totalTaxV2 { amount currencyCode }
              totalPriceV2 { amount currencyCode }
              successfulFulfillments(first: 10) {
                trackingCompany
                trackingInfo(first: 10) { number url }
              }
              lineItems(first: 50) {
                edges {
                  node {
                    title quantity
                    variant {
                      id
                      title
                      image { url }
                      price { amount currencyCode }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `, { customerAccessToken: accessToken }).catch(() => ({ customer: null }));
  const c = data?.customer;
  if (!c) return null;
  const match = c.orders.edges.find((e) => e.node.id === orderId);
  if (!match) return null;
  return mapOrderDetail(match.node);
}
async function getCustomerAddresses(accessToken) {
  const data = await storefront(`
    query GetCustomerAddresses($customerAccessToken: String!) {
      customer(customerAccessToken: $customerAccessToken) {
        addresses(first: 50) {
          edges { node { ${CUSTOMER_ADDRESS_FRAGMENT} } }
        }
      }
    }
  `, { customerAccessToken: accessToken }).catch(() => ({ customer: null }));
  const c = data?.customer;
  if (!c) return [];
  return c.addresses.edges.map((e) => mapCustomerAddress(e.node));
}
async function getCountries() {
  const data = await storefront(`
    query GetCountries {
      localization {
        availableCountries {
          isoCode
          name
          unitSystem
          currency { isoCode symbol name }
        }
      }
    }
  `);
  return [...data.localization.availableCountries].sort(
    (a, b) => a.name.localeCompare(b.name)
  );
}
async function customerCreate(input) {
  const data = await storefront(`
    mutation CustomerCreate($input: CustomerCreateInput!) {
      customerCreate(input: $input) {
        customer { id email }
        customerUserErrors { message }
      }
    }
  `, { input });
  const { customer, customerUserErrors } = data.customerCreate;
  if (customerUserErrors.length > 0) {
    return { error: customerUserErrors[0]?.message ?? "Account creation failed" };
  }
  if (!customer) return { error: "Account creation failed" };
  return { customer };
}
async function loginWithSocialIdentity(params) {
  const secret = process.env["OAUTH_PASSWORD_SECRET"] ?? "oauth-secret-change-me";
  const password = crypto.createHmac("sha256", secret).update(`${params.provider}:${params.providerId}`).digest("base64url").slice(0, 32);
  const tokenResult = await createCustomerAccessToken(params.email, password);
  if ("accessToken" in tokenResult) return tokenResult;
  const createResult = await customerCreate({
    email: params.email,
    password,
    firstName: params.firstName,
    lastName: params.lastName,
    acceptsMarketing: false
  });
  if ("error" in createResult) return { error: createResult.error };
  return createCustomerAccessToken(params.email, password);
}
async function customerRecover(email) {
  try {
    const data = await storefront(`
      mutation CustomerRecover($email: String!) {
        customerRecover(email: $email) {
          customerUserErrors { message }
        }
      }
    `, { email });
    if (data.customerRecover.customerUserErrors.length > 0) {
      console.error("[customerRecover] user errors:", data.customerRecover.customerUserErrors);
    }
  } catch (err) {
    console.error("[customerRecover] request failed:", err);
  }
  return { ok: true };
}
async function customerReset(id, resetToken, password) {
  const data = await storefront(`
    mutation CustomerReset($id: ID!, $input: CustomerResetInput!) {
      customerReset(id: $id, input: $input) {
        customerAccessToken { accessToken }
        customerUserErrors { message }
      }
    }
  `, { id, input: { resetToken, password } });
  const { customerAccessToken, customerUserErrors } = data.customerReset;
  if (customerUserErrors.length > 0) {
    return { error: customerUserErrors[0]?.message ?? "Password reset failed" };
  }
  if (!customerAccessToken) return { error: "Password reset failed" };
  return { accessToken: customerAccessToken.accessToken };
}
async function customerResetByUrl(resetUrl, password) {
  const data = await storefront(`
    mutation CustomerResetByUrl($resetUrl: URL!, $password: String!) {
      customerResetByUrl(resetUrl: $resetUrl, password: $password) {
        customerAccessToken { accessToken }
        customerUserErrors { message }
      }
    }
  `, { resetUrl, password });
  const { customerAccessToken, customerUserErrors } = data.customerResetByUrl;
  if (customerUserErrors.length > 0) {
    return { error: customerUserErrors[0]?.message ?? "Password reset failed" };
  }
  if (!customerAccessToken) return { error: "Password reset failed" };
  return { accessToken: customerAccessToken.accessToken };
}
async function customerActivate(id, activationToken, password) {
  const data = await storefront(`
    mutation CustomerActivate($id: ID!, $input: CustomerActivateInput!) {
      customerActivate(id: $id, input: $input) {
        customerAccessToken { accessToken }
        customerUserErrors { message }
      }
    }
  `, { id, input: { activationToken, password } });
  const { customerAccessToken, customerUserErrors } = data.customerActivate;
  if (customerUserErrors.length > 0) {
    return { error: customerUserErrors[0]?.message ?? "Activation failed" };
  }
  if (!customerAccessToken) return { error: "Activation failed" };
  return { accessToken: customerAccessToken.accessToken };
}
async function customerActivateByUrl(activationUrl, password) {
  const data = await storefront(`
    mutation CustomerActivateByUrl($activationUrl: URL!, $password: String!) {
      customerActivateByUrl(activationUrl: $activationUrl, password: $password) {
        customerAccessToken { accessToken }
        customerUserErrors { message }
      }
    }
  `, { activationUrl, password });
  const { customerAccessToken, customerUserErrors } = data.customerActivateByUrl;
  if (customerUserErrors.length > 0) {
    return { error: customerUserErrors[0]?.message ?? "Activation failed" };
  }
  if (!customerAccessToken) return { error: "Activation failed" };
  return { accessToken: customerAccessToken.accessToken };
}
async function customerUpdate(accessToken, input) {
  const data = await storefront(`
    mutation CustomerUpdate($customerAccessToken: String!, $customer: CustomerUpdateInput!) {
      customerUpdate(customerAccessToken: $customerAccessToken, customer: $customer) {
        customer { id }
        customerAccessToken { accessToken expiresAt }
        customerUserErrors { message }
      }
    }
  `, { customerAccessToken: accessToken, customer: input });
  const { customer, customerAccessToken, customerUserErrors } = data.customerUpdate;
  if (customerUserErrors.length > 0) {
    return { error: customerUserErrors[0]?.message ?? "Update failed" };
  }
  if (!customer) return { error: "Update failed" };
  const newToken = customerAccessToken?.accessToken ?? null;
  const tokenForRefetch = newToken ?? accessToken;
  const profile = await getCustomerProfile(tokenForRefetch);
  if (!profile) return { error: "Update succeeded but profile refetch failed" };
  return { customer: profile, accessToken: newToken };
}
async function customerAddressCreate(accessToken, address) {
  const data = await storefront(`
    mutation CustomerAddressCreate($customerAccessToken: String!, $address: MailingAddressInput!) {
      customerAddressCreate(customerAccessToken: $customerAccessToken, address: $address) {
        customerAddress { ${CUSTOMER_ADDRESS_FRAGMENT} }
        customerUserErrors { message }
      }
    }
  `, { customerAccessToken: accessToken, address });
  const { customerAddress, customerUserErrors } = data.customerAddressCreate;
  if (customerUserErrors.length > 0) {
    return { error: customerUserErrors[0]?.message ?? "Address create failed" };
  }
  if (!customerAddress) return { error: "Address create failed" };
  return { address: mapCustomerAddress(customerAddress) };
}
async function customerAddressUpdate(accessToken, id, address) {
  const data = await storefront(`
    mutation CustomerAddressUpdate($customerAccessToken: String!, $id: ID!, $address: MailingAddressInput!) {
      customerAddressUpdate(customerAccessToken: $customerAccessToken, id: $id, address: $address) {
        customerAddress { ${CUSTOMER_ADDRESS_FRAGMENT} }
        customerUserErrors { message }
      }
    }
  `, { customerAccessToken: accessToken, id, address });
  const { customerAddress, customerUserErrors } = data.customerAddressUpdate;
  if (customerUserErrors.length > 0) {
    return { error: customerUserErrors[0]?.message ?? "Address update failed" };
  }
  if (!customerAddress) return { error: "Address update failed" };
  return { address: mapCustomerAddress(customerAddress) };
}
async function customerAddressDelete(accessToken, id) {
  const data = await storefront(`
    mutation CustomerAddressDelete($customerAccessToken: String!, $id: ID!) {
      customerAddressDelete(customerAccessToken: $customerAccessToken, id: $id) {
        deletedCustomerAddressId
        customerUserErrors { message }
      }
    }
  `, { customerAccessToken: accessToken, id });
  const { deletedCustomerAddressId, customerUserErrors } = data.customerAddressDelete;
  if (customerUserErrors.length > 0) {
    return { error: customerUserErrors[0]?.message ?? "Address delete failed" };
  }
  if (!deletedCustomerAddressId) return { error: "Address delete failed" };
  return { ok: true };
}
async function customerDefaultAddressUpdate(accessToken, addressId) {
  const data = await storefront(`
    mutation CustomerDefaultAddressUpdate($customerAccessToken: String!, $addressId: ID!) {
      customerDefaultAddressUpdate(customerAccessToken: $customerAccessToken, addressId: $addressId) {
        customer { id }
        customerUserErrors { message }
      }
    }
  `, { customerAccessToken: accessToken, addressId });
  const { customer, customerUserErrors } = data.customerDefaultAddressUpdate;
  if (customerUserErrors.length > 0) {
    return { error: customerUserErrors[0]?.message ?? "Default address update failed" };
  }
  if (!customer) return { error: "Default address update failed" };
  return { ok: true };
}
async function cartBuyerIdentityUpdate(cartId, identity) {
  try {
    const data = await storefront(`
      mutation CartBuyerIdentityUpdate($cartId: ID!, $buyerIdentity: CartBuyerIdentityInput!) {
        cartBuyerIdentityUpdate(cartId: $cartId, buyerIdentity: $buyerIdentity) {
          cart { ${CART_FRAGMENT} }
          userErrors { message }
        }
      }
    `, {
      cartId,
      buyerIdentity: {
        customerAccessToken: identity.customerAccessToken ?? null,
        email: identity.email ?? null,
        countryCode: identity.countryCode ?? null
      }
    });
    const { cart, userErrors } = data.cartBuyerIdentityUpdate;
    if (userErrors.length > 0) {
      console.error("[cartBuyerIdentityUpdate] user errors:", userErrors);
      return await getCart(cartId);
    }
    return cart ? rawCartToCart(cart) : await getCart(cartId);
  } catch (err) {
    console.error("[cartBuyerIdentityUpdate] request failed:", err);
    return await getCart(cartId);
  }
}
async function adminCustomerDelete(customerGid) {
  const id = customerGid.replace("gid://shopify/Customer/", "");
  await shopifyAdmin(`/customers/${id}.json`, "DELETE");
}
function mapSubscriptionContract(raw) {
  const lines = raw.lines.edges.map((e) => ({
    id: e.node.id,
    title: e.node.title,
    variantTitle: e.node.variantTitle,
    quantity: e.node.quantity,
    currentPrice: e.node.currentPrice,
    imageUrl: e.node.variantImage?.url ?? null,
    productId: e.node.productId
  }));
  const currencyCode = raw.currencyCode;
  const subtotalNum = lines.reduce(
    (acc, line) => acc + parseFloat(line.currentPrice.amount) * line.quantity,
    0
  );
  const shippingAddr = raw.deliveryMethod?.__typename === "SubscriptionDeliveryMethodShipping" && raw.deliveryMethod.address ? raw.deliveryMethod.address : null;
  return {
    id: raw.id,
    status: raw.status,
    createdAt: raw.createdAt,
    nextBillingDate: raw.nextBillingDate,
    currencyCode,
    customerId: raw.customer.id,
    billingPolicy: raw.billingPolicy,
    deliveryPolicy: raw.deliveryPolicy,
    lines,
    subtotalAmount: lines.length > 0 ? { amount: subtotalNum.toFixed(2), currencyCode } : null,
    shippingAddress: shippingAddr ? {
      firstName: shippingAddr.firstName ?? null,
      lastName: shippingAddr.lastName ?? null,
      address1: shippingAddr.address1 ?? null,
      address2: shippingAddr.address2 ?? null,
      city: shippingAddr.city ?? null,
      province: shippingAddr.province ?? null,
      country: shippingAddr.country ?? null,
      zip: shippingAddr.zip ?? null,
      phone: shippingAddr.phone ?? null
    } : null
  };
}
async function adminGetCustomerSubscriptions(customerGid) {
  try {
    const data = await adminGraphQL(
      `query CustomerSubscriptions($id: ID!) {
        customer(id: $id) {
          subscriptionContracts(first: 20) {
            edges {
              node { ${SUBSCRIPTION_CONTRACT_FRAGMENT} }
            }
          }
        }
      }`,
      { id: customerGid }
    );
    if (!data.customer) return [];
    return data.customer.subscriptionContracts.edges.map(
      (e) => mapSubscriptionContract(e.node)
    );
  } catch (err) {
    console.error("[adminGetCustomerSubscriptions] failed:", err);
    return [];
  }
}
async function adminGetSubscriptionContract(contractGid) {
  try {
    const data = await adminGraphQL(
      `query SubscriptionContractDetail($id: ID!) {
        subscriptionContract(id: $id) {
          ${SUBSCRIPTION_CONTRACT_FRAGMENT}
        }
      }`,
      { id: contractGid }
    );
    if (!data.subscriptionContract) return null;
    return mapSubscriptionContract(data.subscriptionContract);
  } catch (err) {
    console.error("[adminGetSubscriptionContract] failed:", err);
    return null;
  }
}
function buildProductTags(product) {
  const tags = product.categories.map(
    (c) => `cat:${c.toLowerCase().replace(/\s+/g, "-")}`
  );
  const forHimCats = ["Vagina Strokers", "Body Molds", "Prostate Toys", "Masturbators", "Hands-Free Masturbators"];
  const forHerCats = ["Dual Action and Rabbits", "Finger and Clit", "Air Pulse and Suction", "Bullets and Eggs"];
  const coupleCats = ["Couples and Wearable", "Remote", "Top Couples Toys", "Restraints"];
  if (product.categories.some((c) => forHimCats.includes(c))) tags.push("for-him");
  if (product.categories.some((c) => forHerCats.includes(c))) tags.push("for-her");
  if (product.categories.some((c) => coupleCats.includes(c))) tags.push("for-couples");
  tags.push(`brand:${product.brand.toLowerCase().replace(/\s+/g, "-")}`);
  tags.push(`nalpac-sku-${product.sku}`);
  tags.push(
    product.msrp < 25 ? "price:under-25" : product.msrp < 50 ? "price:25-50" : product.msrp < 100 ? "price:50-100" : "price:100-plus"
  );
  return tags;
}
async function updateCollectionImage(_collectionId, _imageBuffer, _filename, _alt) {
  console.warn("updateCollectionImage: not yet implemented");
  return "";
}
async function getAccessoryProductsAdmin(productIds) {
  if (productIds.length === 0) return [];
  const gids = productIds.map(
    (id) => id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`
  );
  const data = await adminGraphQL(`
    query GetAccessoryProducts($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id handle title vendor tags
          images(first: 5) { nodes { url altText } }
          variants(first: 10) {
            nodes {
              id title price compareAtPrice
              inventoryQuantity
            }
          }
        }
      }
    }
  `, { ids: gids });
  return (data.nodes ?? []).flatMap((node) => {
    if (!node) return [];
    const variant = node.variants.nodes[0];
    const product = {
      id: node.id,
      handle: node.handle,
      title: node.title,
      images: node.images.nodes.map((img) => ({ url: img.url, altText: img.altText ?? "" })),
      videos: [],
      variants: node.variants.nodes.map((v) => ({
        id: v.id,
        title: v.title,
        selectedOptions: [],
        price: v.price,
        compareAtPrice: v.compareAtPrice,
        availableForSale: (v.inventoryQuantity ?? 0) > 0,
        quantityAvailable: v.inventoryQuantity ?? 0
      })),
      price: parseFloat(variant?.price ?? "0"),
      ...variant?.compareAtPrice ? { compareAtPrice: parseFloat(variant.compareAtPrice) } : {},
      brand: node.vendor,
      tags: node.tags
    };
    return [product];
  });
}
async function updateCollectionDescription(..._args) {
  console.warn("updateCollectionDescription: not yet implemented");
}
async function updateProductTags(productId, tags) {
  const id = productId.replace("gid://shopify/Product/", "");
  await shopifyAdmin(`/products/${id}.json`, "PUT", {
    product: { id, tags: tags.join(", ") }
  });
}
async function appendProductTag(productId, tag) {
  const id = productId.replace("gid://shopify/Product/", "");
  const { product } = await shopifyAdmin(`/products/${id}.json?fields=tags`);
  if (!product) return;
  const current = product.tags.split(",").map((t) => t.trim()).filter(Boolean);
  if (current.includes(tag)) return;
  current.push(tag);
  await shopifyAdmin(`/products/${id}.json`, "PUT", {
    product: { id, tags: current.join(", ") }
  });
}
async function fetchAllDealProducts() {
  const products = [];
  let totalScanned = 0;
  let cursor = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const data = await adminGraphQL(`
      query FetchDealProducts($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id title vendor
            variants(first: 1) { nodes { price inventoryQuantity } }
            metafields(namespace: "xdipx", first: 20) {
              nodes { key value }
            }
          }
        }
      }
    `, { first: 50, after: cursor });
    const page = data.products;
    hasNextPage = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
    totalScanned += page.nodes.length;
    for (const node of page.nodes) {
      const mf = node.metafields.nodes;
      const mfVal = (key) => mf.find((m) => m.key === key)?.value ?? "";
      if (!mfVal("deal_status") && !mfVal("nalpac_sku")) continue;
      const numericId = node.id.replace("gid://shopify/Product/", "");
      const variant = node.variants.nodes[0];
      const wholesaleCost = parseFloat(mfVal("wholesale_cost"));
      const msrp = parseFloat(mfVal("original_price"));
      const mapPrice = parseFloat(mfVal("map_price"));
      const dealScore = parseFloat(mfVal("deal_score"));
      products.push({
        shopifyProductId: numericId,
        sku: mfVal("nalpac_sku") || numericId,
        ...mfVal("nalpac_sku") ? { nalpacSku: mfVal("nalpac_sku") } : {},
        title: node.title,
        vendor: node.vendor,
        ...mfVal("category") ? { category: mfVal("category") } : {},
        ...mfVal("deal_date") ? { dealDate: mfVal("deal_date") } : {},
        ...!isNaN(wholesaleCost) ? { wholesaleCost } : {},
        dealPrice: parseFloat(variant?.price ?? "0"),
        ...!isNaN(msrp) ? { msrp } : {},
        ...!isNaN(mapPrice) ? { mapPrice } : {},
        inventoryQuantity: variant?.inventoryQuantity ?? 0,
        ...!isNaN(dealScore) ? { dealScore } : {}
      });
    }
  }
  return { products, totalScanned };
}
async function predictiveSearch(query) {
  const data = await storefront(`
    query PredictiveSearch($query: String!) {
      predictiveSearch(query: $query, limit: 6, types: [PRODUCT, COLLECTION]) {
        products { ${SEARCH_PRODUCT_FRAGMENT} }
        collections { id handle title }
      }
    }
  `, { query });
  return {
    products: data.predictiveSearch.products,
    collections: data.predictiveSearch.collections
  };
}
async function searchProducts(params) {
  const { query, first = 24, after, sortKey = "RELEVANCE", reverse = false, productFilters = [] } = params;
  const data = await storefront(`
    query SearchProducts(
      $query: String!
      $first: Int!
      $after: String
      $sortKey: SearchSortKeys
      $reverse: Boolean
      $productFilters: [ProductFilter!]
    ) {
      search(
        query: $query
        first: $first
        after: $after
        sortKey: $sortKey
        reverse: $reverse
        productFilters: $productFilters
        types: [PRODUCT]
      ) {
        totalCount
        productFilters {
          id label type
          values { id label count input }
        }
        edges {
          cursor
          node {
            ... on Product { ${SEARCH_PRODUCT_FRAGMENT} }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `, { query, first, after: after ?? null, sortKey, reverse, productFilters });
  return {
    products: data.search.edges.map((e) => e.node),
    totalCount: data.search.totalCount,
    filters: data.search.productFilters,
    pageInfo: data.search.pageInfo
  };
}
async function getReturnableFulfillments(orderId) {
  const data = await adminGraphQL(`
    query ReturnableFulfillments($orderId: ID!) {
      returnableFulfillments(first: 10, orderId: $orderId) {
        edges {
          node {
            id
            fulfillment { id }
            returnableFulfillmentLineItems(first: 50) {
              edges {
                node {
                  quantity
                  fulfillmentLineItem {
                    id
                    lineItem {
                      id
                      title
                      variantTitle
                      image { url }
                      originalUnitPriceSet { shopMoney { amount currencyCode } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `, { orderId });
  return data.returnableFulfillments.edges.map(({ node: rf }) => {
    const lineItems = rf.returnableFulfillmentLineItems.edges.map(
      ({ node: rfli }) => ({
        fulfillmentLineItemId: rfli.fulfillmentLineItem.id,
        orderLineItemId: rfli.fulfillmentLineItem.lineItem.id,
        quantity: rfli.quantity,
        title: rfli.fulfillmentLineItem.lineItem.title,
        variantTitle: rfli.fulfillmentLineItem.lineItem.variantTitle,
        imageUrl: rfli.fulfillmentLineItem.lineItem.image?.url ?? null,
        unitPrice: {
          amount: rfli.fulfillmentLineItem.lineItem.originalUnitPriceSet.shopMoney.amount,
          currencyCode: rfli.fulfillmentLineItem.lineItem.originalUnitPriceSet.shopMoney.currencyCode
        }
      })
    );
    return {
      id: rf.id,
      fulfillmentId: rf.fulfillment.id,
      lineItems,
      reverseFulfillmentOrderId: null
    };
  });
}
async function createReturn(input) {
  const data = await adminGraphQL(`
    mutation ReturnCreate($returnInput: ReturnInput!) {
      returnCreate(returnInput: $returnInput) {
        return {
          id
          reverseFulfillmentOrders(first: 1) {
            edges {
              node {
                id
                lineItems(first: 50) {
                  edges {
                    node {
                      id
                      fulfillmentLineItem { id }
                    }
                  }
                }
              }
            }
          }
        }
        userErrors { field message }
      }
    }
  `, {
    returnInput: {
      orderId: input.orderId,
      returnLineItems: input.lineItems.map((li) => ({
        fulfillmentLineItemId: li.fulfillmentLineItemId,
        quantity: li.quantity,
        returnReason: li.returnReason,
        returnReasonNote: li.returnReasonNote ?? ""
      })),
      notifyCustomer: input.notifyCustomer ?? false
    }
  });
  const err = data.returnCreate.userErrors[0];
  if (err) return { ok: false, error: err.message };
  if (!data.returnCreate.return) return { ok: false, error: "returnCreate returned no return" };
  const rfoNode = data.returnCreate.return.reverseFulfillmentOrders.edges[0]?.node;
  const fliToRfoLineItemId = {};
  for (const { node: li } of rfoNode?.lineItems.edges ?? []) {
    fliToRfoLineItemId[li.fulfillmentLineItem.id] = li.id;
  }
  return {
    ok: true,
    data: {
      returnId: data.returnCreate.return.id,
      reverseFulfillmentOrderId: rfoNode?.id ?? null,
      fliToRfoLineItemId
    }
  };
}
async function registerReverseDelivery(input) {
  const data = await adminGraphQL(`
    mutation ReverseDeliveryCreateWithShipping(
      $reverseFulfillmentOrderId: ID!
      $reverseDeliveryLineItems: [ReverseDeliveryLineItemInput!]!
      $labelInput: ReverseDeliveryLabelInput
      $trackingInput: ReverseDeliveryTrackingInput
      $notifyCustomer: Boolean
    ) {
      reverseDeliveryCreateWithShipping(
        reverseFulfillmentOrderId: $reverseFulfillmentOrderId
        reverseDeliveryLineItems: $reverseDeliveryLineItems
        labelInput: $labelInput
        trackingInput: $trackingInput
        notifyCustomer: $notifyCustomer
      ) {
        reverseDelivery { id }
        userErrors { field message }
      }
    }
  `, {
    reverseFulfillmentOrderId: input.reverseFulfillmentOrderId,
    reverseDeliveryLineItems: input.reverseDeliveryLineItems.map((li) => ({
      reverseFulfillmentOrderLineItemId: li.reverseFulfillmentOrderLineItemId,
      quantity: li.quantity
    })),
    labelInput: { fileUrl: input.labelFileUrl },
    trackingInput: {
      number: input.trackingNumber,
      ...input.trackingUrl ? { url: input.trackingUrl } : {},
      ...input.carrierIdentifier ? { carrierIdentifier: input.carrierIdentifier } : {}
    },
    notifyCustomer: input.notifyCustomer ?? false
  });
  const err = data.reverseDeliveryCreateWithShipping.userErrors[0];
  if (err) return { ok: false, error: err.message };
  const rd = data.reverseDeliveryCreateWithShipping.reverseDelivery;
  if (!rd) return { ok: false, error: "reverseDeliveryCreateWithShipping returned no delivery" };
  return { ok: true, data: { reverseDeliveryId: rd.id } };
}
async function createRefund(input) {
  const data = await adminGraphQL(`
    mutation RefundCreate($input: RefundInput!) {
      refundCreate(input: $input) {
        refund { id }
        userErrors { field message }
      }
    }
  `, {
    input: {
      orderId: input.orderId,
      note: input.note ?? "xdipx self-service return",
      notify: input.notify ?? true,
      currency: input.currencyCode,
      refundLineItems: input.refundLineItems.map((li) => ({
        lineItemId: li.lineItemId,
        quantity: li.quantity,
        restockType: li.restockType ?? "RETURN",
        ...li.locationId ? { locationId: li.locationId } : {}
      })),
      ...input.shippingAmount != null ? { shipping: { amount: input.shippingAmount.toFixed(2) } } : {}
    }
  });
  const err = data.refundCreate.userErrors[0];
  if (err) return { ok: false, error: err.message };
  if (!data.refundCreate.refund) return { ok: false, error: "refundCreate returned no refund" };
  return { ok: true, refundId: data.refundCreate.refund.id };
}
async function closeReturn(returnId) {
  const data = await adminGraphQL(`
    mutation ReturnClose($id: ID!) {
      returnClose(id: $id) {
        return { id status }
        userErrors { field message }
      }
    }
  `, { id: returnId });
  const err = data.returnClose.userErrors[0];
  if (err) return { ok: false, error: err.message };
  return { ok: true };
}
async function getReturn(returnId) {
  const data = await adminGraphQL(`
    query GetReturn($id: ID!) {
      return(id: $id) {
        id
        status
        reverseDeliveries(first: 5) {
          edges {
            node {
              id
              deliverable {
                __typename
                ... on ReverseDeliveryShippingDeliverable {
                  tracking { number url }
                }
              }
            }
          }
        }
      }
    }
  `, { id: returnId });
  if (!data.return) return null;
  return {
    id: data.return.id,
    status: data.return.status,
    reverseDeliveries: data.return.reverseDeliveries.edges.map(({ node }) => ({
      id: node.id,
      trackingNumber: node.deliverable?.tracking?.number ?? null,
      trackingUrl: node.deliverable?.tracking?.url ?? null,
      deliveredAt: null
      // Shopify exposes delivery state via webhook, not query
    }))
  };
}
async function getStorefrontCollections(first = 150) {
  return cached(`shopify:collections:${first}`, READ_TTL, async () => {
    const data = await storefront(`
      query GetStorefrontCollections($first: Int!) {
        collections(first: $first, sortKey: TITLE) {
          edges { node { id handle title } }
        }
      }
    `, { first });
    return data.collections.edges.map((e) => e.node);
  });
}
async function findCollectionsByQuery(query, limit = 5) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const all = await getStorefrontCollections(150);
  const matches = all.map((c) => {
    const handle = c.handle.toLowerCase();
    const title = c.title.toLowerCase();
    let score2 = 0;
    if (handle === q) score2 = 100;
    else if (handle.startsWith(q)) score2 = 70;
    else if (handle.includes(q)) score2 = 50;
    if (title === q) score2 = Math.max(score2, 95);
    else if (title.startsWith(q)) score2 = Math.max(score2, 65);
    else if (title.includes(q)) score2 = Math.max(score2, 45);
    return { c, score: score2 };
  }).filter((m) => m.score > 0).sort((a, b) => b.score - a.score).slice(0, limit * 2);
  const hydrated = [];
  for (const m of matches) {
    const products = await getCollectionProducts(m.c.handle, 1);
    if (products.length === 0) continue;
    hydrated.push({ handle: m.c.handle, title: m.c.title, productCount: products.length });
    if (hydrated.length >= limit) break;
  }
  return hydrated;
}
async function findCustomerByPhone(phone) {
  const data = await adminGraphQL(`
    query FindCustomer($q: String!) {
      customers(first: 1, query: $q) {
        nodes {
          id email firstName lastName
          defaultAddress { address1 city province zip country }
        }
      }
    }
  `, { q: `phone:${phone}` });
  const c = data.customers.nodes[0];
  if (!c) return null;
  const addr = c.defaultAddress;
  return {
    id: c.id,
    email: c.email,
    firstName: c.firstName,
    lastName: c.lastName,
    defaultAddress: addr && addr.address1 && addr.city && addr.province && addr.zip ? { address1: addr.address1, city: addr.city, province: addr.province, zip: addr.zip, country: addr.country ?? "US" } : null
  };
}
async function createDraftOrder(input) {
  const [firstName, ...rest] = input.customer.name.trim().split(/\s+/);
  const lastName = rest.join(" ") || firstName || "";
  const res = await adminGraphQL(`
    mutation CreateDraft($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder {
          id name invoiceUrl
          subtotalPriceSet { shopMoney { amount } }
          totalPriceSet    { shopMoney { amount } }
          lineItems(first: 20) {
            nodes {
              title quantity
              variant { id }
              originalUnitPriceSet { shopMoney { amount } }
            }
          }
        }
        userErrors { field message }
      }
    }
  `, {
    input: {
      email: input.customer.email,
      phone: input.customer.phone,
      note: input.note ?? `xdipx ${input.channel} order`,
      tags: [
        `channel:${input.channel}`,
        "phone-order",
        ...input.channel === "voice" ? ["emma-order-ivr"] : []
      ],
      lineItems: input.lineItems.map((li) => ({ variantId: li.variantId, quantity: li.quantity })),
      shippingAddress: {
        firstName: firstName ?? "",
        lastName,
        address1: input.shipping.address1,
        address2: input.shipping.address2 ?? "",
        city: input.shipping.city,
        province: input.shipping.province,
        zip: input.shipping.zip,
        country: input.shipping.country ?? "US",
        phone: input.customer.phone
      },
      useCustomerDefaultAddress: false
    }
  });
  if (res.draftOrderCreate.userErrors.length > 0) {
    throw new Error(`draftOrderCreate: ${res.draftOrderCreate.userErrors.map((e) => e.message).join("; ")}`);
  }
  const d = res.draftOrderCreate.draftOrder;
  if (!d) throw new Error("draftOrderCreate returned null");
  return {
    id: d.id,
    name: d.name,
    invoiceUrl: d.invoiceUrl,
    subtotalPriceCents: Math.round(parseFloat(d.subtotalPriceSet.shopMoney.amount) * 100),
    totalPriceCents: Math.round(parseFloat(d.totalPriceSet.shopMoney.amount) * 100),
    lineItems: d.lineItems.nodes.map((n) => ({
      variantId: n.variant?.id ?? "",
      title: n.title,
      quantity: n.quantity,
      unitPriceCents: Math.round(parseFloat(n.originalUnitPriceSet.shopMoney.amount) * 100)
    }))
  };
}
async function sendDraftOrderInvoice(draftOrderId, opts) {
  const emailInput = opts?.to || opts?.customMessage ? { to: opts?.to, customMessage: opts?.customMessage } : void 0;
  const res = await adminGraphQL(`
    mutation SendInvoice($id: ID!, $email: EmailInput) {
      draftOrderInvoiceSend(id: $id, email: $email) {
        draftOrder { invoiceUrl }
        userErrors { message }
      }
    }
  `, { id: draftOrderId, email: emailInput });
  if (res.draftOrderInvoiceSend.userErrors.length > 0) {
    throw new Error(`draftOrderInvoiceSend: ${res.draftOrderInvoiceSend.userErrors.map((e) => e.message).join("; ")}`);
  }
  return { invoiceUrl: res.draftOrderInvoiceSend.draftOrder?.invoiceUrl ?? null };
}
function buildShopifyQuery(input) {
  const sanitize = (s) => s.replace(/[:()*"]/g, "").trim().toLowerCase();
  const clauses = [];
  if (input.keyword) {
    const kw = sanitize(input.keyword);
    if (kw) clauses.push(`title:*${kw}*`);
  }
  if (input.tags && input.tags.length > 0) {
    for (const tag of input.tags) {
      const t = sanitize(tag);
      if (t) clauses.push(`tag:${t}`);
    }
  }
  if (input.productType) {
    const pt = sanitize(input.productType);
    if (pt) clauses.push(`product_type:${pt}`);
  }
  if (typeof input.priceMin === "number" && input.priceMin > 0) {
    clauses.push(`variants.price:>=${input.priceMin}`);
  }
  if (typeof input.priceMax === "number") {
    clauses.push(`variants.price:<=${input.priceMax}`);
  }
  if (input.excludeArchivedDeals) {
    clauses.push("-tag:deal-status-archived");
  }
  return clauses.join(" AND ");
}
function hashSearchInput(input) {
  const stable = JSON.stringify(input, Object.keys(input).sort());
  return crypto.createHash("sha1").update(stable).digest("hex").slice(0, 16);
}
function searchNodeToEmmaCard(node) {
  const priceUsd = parseFloat(node.priceRange.minVariantPrice.amount);
  const compareAtRaw = node.compareAtPriceRange.maxVariantPrice?.amount;
  return {
    handle: node.handle,
    url: `https://xdipx.com/products/${node.handle}`,
    title: node.title,
    productType: null,
    // not in SearchProduct fragment
    priceUsd: isNaN(priceUsd) ? 0 : priceUsd,
    compareAtUsd: compareAtRaw ? parseFloat(compareAtRaw) : null,
    available: node.availableForSale,
    mapRestricted: false,
    // not in SearchProduct fragment
    tagline: null,
    productTypeDial: null,
    audienceTags: [],
    moodTags: [],
    mattersTags: []
  };
}
function productNodeToEmmaCard(node) {
  const mf = node.metafields;
  const variant = node.variants.edges[0]?.node;
  const priceUsd = parseFloat(variant?.price.amount ?? "0");
  const compareAtRaw = variant?.compareAtPrice?.amount;
  const mapRestrictedRaw = parseMetafield(mf, "map_restricted");
  const available = node.variants.edges.some((e) => e.node.availableForSale);
  return {
    handle: node.handle,
    url: `https://xdipx.com/products/${node.handle}`,
    title: node.title,
    productType: null,
    // Shopify productType field is not in PRODUCT_CORE_FRAGMENT
    priceUsd: isNaN(priceUsd) ? 0 : priceUsd,
    compareAtUsd: compareAtRaw ? parseFloat(compareAtRaw) : null,
    available,
    mapRestricted: mapRestrictedRaw === "true",
    tagline: parseMetafield(mf, "tagline") || null,
    productTypeDial: parseMetafield(mf, "product_type_dial") || null,
    audienceTags: parseMetafieldJSON(mf, "audience_tags", []),
    moodTags: parseMetafieldJSON(mf, "mood_tags", []),
    mattersTags: parseMetafieldJSON(mf, "matters_tags", [])
  };
}
async function searchCatalogForEmma(input) {
  const limit = Math.min(Math.max(input.limit ?? 12, 1), 20);
  const cacheKey3 = `emma-search:${hashSearchInput({ ...input, limit })}`;
  return cached(cacheKey3, READ_TTL, async () => {
    const queryInput = {};
    if (input.keyword !== void 0) queryInput.keyword = input.keyword;
    if (input.productType !== void 0) queryInput.productType = input.productType;
    const query = buildShopifyQuery(queryInput) || (input.keyword ?? "wellness");
    const productFilters = [];
    for (const tag of input.tags ?? []) productFilters.push({ tag });
    if (input.priceMin !== void 0 || input.priceMax !== void 0) {
      const price = {};
      if (input.priceMin !== void 0) price.min = input.priceMin;
      if (input.priceMax !== void 0) price.max = input.priceMax;
      productFilters.push({ price });
    }
    const result = await searchProducts({ query, first: limit, productFilters });
    return result.products.map(searchNodeToEmmaCard);
  });
}
async function getProductDetailForEmma(handle) {
  const product = await getProductByHandle(handle);
  if (!product) return null;
  const data = await storefront(`
    query GetProductForEmma($handle: String!) {
      product(handle: $handle) { ${PRODUCT_CORE_FRAGMENT} }
    }
  `, { handle });
  const node = data.product;
  if (!node) return null;
  const mf = node.metafields;
  const baseCard = productNodeToEmmaCard(node);
  const sensationDialRaw = parseMetafieldJSON(mf, "sensation_dial", {});
  const sensationDial = (() => {
    const entries = Object.entries(sensationDialRaw).filter(([, v]) => typeof v === "number");
    return entries.length > 0 ? Object.fromEntries(entries) : null;
  })();
  const pairingWhyRaw = parseMetafieldJSON(mf, "pairing_why", {});
  const pairingWhy = Object.keys(pairingWhyRaw).length > 0 ? pairingWhyRaw : null;
  const accessoryIds = parseMetafieldJSON(mf, "accessory_product_ids", []);
  let accessoryHandles = [];
  if (accessoryIds.length > 0) {
    const accessories = await getProductsByIds(accessoryIds);
    accessoryHandles = accessories.map((p) => p.handle);
  }
  const featureBulletsRaw = parseMetafield(mf, "feature_bullets");
  const featureBullets = (() => {
    if (!featureBulletsRaw) return null;
    try {
      const parsed = JSON.parse(featureBulletsRaw);
      if (Array.isArray(parsed)) return parsed.filter((s) => typeof s === "string");
    } catch {
    }
    return null;
  })();
  const imageUrl = node.images.edges[0]?.node.url ?? null;
  const variants = node.variants.edges.map((e) => ({
    id: e.node.id,
    title: e.node.title,
    priceUsd: parseFloat(e.node.price.amount),
    available: e.node.availableForSale,
    ...e.node.metafields?.[0]?.value ? { originalDescription: e.node.metafields[0].value } : {}
  }));
  return {
    ...baseCard,
    fullStory: parseMetafield(mf, "full_story") || node.description || null,
    featureBullets,
    sensationDial,
    pairingWhy,
    accessoryHandles,
    imageUrl,
    variants
  };
}
async function getProductsForMerge(productIds) {
  const gids = productIds.map(
    (id) => id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`
  );
  const res = await adminGraphQL(`
    query GetProductsForMerge($ids: [ID!]!) {
      nodes(ids: $ids) {
        __typename
        ... on Product {
          id
          title
          handle
          status
          options { name values }
          variants(first: 1) {
            nodes { id price compareAtPrice sku barcode inventoryQuantity }
          }
          images(first: 20) {
            nodes { url altText }
          }
        }
      }
    }
  `, { ids: gids });
  const result = {};
  for (const node of res.nodes) {
    if (!node || node.__typename !== "Product") continue;
    const numericId = node.id.replace("gid://shopify/Product/", "");
    result[numericId] = {
      id: node.id,
      title: node.title,
      handle: node.handle,
      status: node.status,
      options: node.options,
      firstVariant: node.variants.nodes[0] ?? null,
      images: node.images.nodes
    };
  }
  return result;
}
function toProductGid(productId) {
  return productId.startsWith("gid://") ? productId : `gid://shopify/Product/${productId}`;
}
async function updateProductTitle(productId, newTitle) {
  const gid = toProductGid(productId);
  const res = await adminGraphQL(`
    mutation MergeUpdateTitle($input: ProductInput!) {
      productUpdate(input: $input) {
        userErrors { field message }
      }
    }
  `, { input: { id: gid, title: newTitle } });
  if (res.productUpdate.userErrors.length > 0) {
    const errs = res.productUpdate.userErrors.map((e) => `${e.field.join(".")}: ${e.message}`).join("; ");
    throw new Error(`updateProductTitle: ${errs}`);
  }
}
async function archiveProduct(productId) {
  const gid = toProductGid(productId);
  const res = await adminGraphQL(`
    mutation MergeArchiveProduct($input: ProductInput!) {
      productUpdate(input: $input) {
        userErrors { field message }
      }
    }
  `, { input: { id: gid, status: "ARCHIVED" } });
  if (res.productUpdate.userErrors.length > 0) {
    const errs = res.productUpdate.userErrors.map((e) => `${e.field.join(".")}: ${e.message}`).join("; ");
    throw new Error(`archiveProduct: ${errs}`);
  }
}
async function createUrlRedirect(fromPath, toPath) {
  const path = fromPath.startsWith("/") ? fromPath : `/${fromPath}`;
  const res = await adminGraphQL(`
    mutation MergeCreateRedirect($urlRedirect: UrlRedirectInput!) {
      urlRedirectCreate(urlRedirect: $urlRedirect) {
        urlRedirect { id path target }
        userErrors { field message }
      }
    }
  `, { urlRedirect: { path, target: toPath } });
  if (res.urlRedirectCreate.userErrors.length > 0) {
    const msgs = res.urlRedirectCreate.userErrors.map((e) => e.message);
    const isDuplicate = msgs.some((m) => /already exist|duplicate/i.test(m));
    if (isDuplicate) {
      console.warn(`[createUrlRedirect] redirect already exists for ${path}: ${msgs.join("; ")}`);
      return { id: "" };
    }
    const errs = res.urlRedirectCreate.userErrors.map((e) => `${e.field.join(".")}: ${e.message}`).join("; ");
    throw new Error(`createUrlRedirect: ${errs}`);
  }
  return { id: res.urlRedirectCreate.urlRedirect.id };
}
async function copyMediaToProduct(masterProductId, mediaSources) {
  if (mediaSources.length === 0) return [];
  const gid = toProductGid(masterProductId);
  const res = await adminGraphQL(`
    mutation MergeCopyMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { id status mediaErrors { message } }
        mediaUserErrors { field message }
      }
    }
  `, {
    productId: gid,
    media: mediaSources.map((s) => ({
      originalSource: s.originalSrc,
      mediaContentType: "IMAGE",
      alt: s.alt ?? ""
    }))
  });
  if (res.productCreateMedia.mediaUserErrors.length > 0) {
    const errs = res.productCreateMedia.mediaUserErrors.map((e) => `${e.field.join(".")}: ${e.message}`).join("; ");
    throw new Error(`copyMediaToProduct: ${errs}`);
  }
  const created = res.productCreateMedia.media;
  const results = [];
  for (let i = 0; i < created.length; i++) {
    const deadline = Date.now() + 3e4;
    let item = created[i];
    while (item.status !== "READY" && item.status !== "FAILED") {
      if (Date.now() > deadline) throw new Error(`copyMediaToProduct: timeout polling media ${item.id}`);
      await new Promise((r) => setTimeout(r, 1e3));
      const poll = await adminGraphQL(`
        query MergeMediaStatus($id: ID!) {
          node(id: $id) {
            ... on MediaImage { id status mediaErrors { message } }
          }
        }
      `, { id: item.id });
      if (poll.node) item = poll.node;
    }
    if (item.status === "FAILED") {
      const errMsg = item.mediaErrors?.[0]?.message ?? "unknown";
      throw new Error(`copyMediaToProduct: media ${item.id} failed \u2014 ${errMsg}`);
    }
    results.push({ mediaId: item.id, originalSrc: mediaSources[i].originalSrc });
  }
  return results;
}
async function getPrimaryLocationId() {
  if (_primaryLocationId) return _primaryLocationId;
  const res = await adminGraphQL(`
    query MergePrimaryLocation {
      locations(first: 1, query: "active:true") {
        edges { node { id } }
      }
    }
  `);
  const id = res.locations.edges[0]?.node.id;
  if (!id) throw new Error("addVariantsToProduct: no active Shopify location found");
  _primaryLocationId = id;
  return id;
}
async function addVariantsToProduct(masterProductId, optionName, variants) {
  const gid = toProductGid(masterProductId);
  const productRes = await adminGraphQL(`
    query MergeProductOptions($id: ID!) {
      product(id: $id) {
        options { id name optionValues { id name } }
      }
    }
  `, { id: gid });
  const existingOptions = productRes.product?.options ?? [];
  const isDefaultOnly = existingOptions.length === 1 && existingOptions[0].name === "Title" && existingOptions[0].optionValues.length === 1 && existingOptions[0].optionValues[0].name === "Default Title";
  const existingOption = existingOptions.find((o) => o.name === optionName);
  if (isDefaultOnly) {
    const createRes = await adminGraphQL(`
      mutation MergeOptionsCreate($productId: ID!, $options: [OptionCreateInput!]!, $variantStrategy: ProductOptionCreateVariantStrategy) {
        productOptionsCreate(productId: $productId, options: $options, variantStrategy: $variantStrategy) {
          userErrors { field message }
        }
      }
    `, {
      productId: gid,
      options: [{ name: optionName, values: variants.map((v) => ({ name: v.optionValue })) }],
      variantStrategy: "CREATE"
    });
    if (createRes.productOptionsCreate.userErrors.length > 0) {
      const errs = createRes.productOptionsCreate.userErrors.map((e) => `${e.field.join(".")}: ${e.message}`).join("; ");
      throw new Error(`addVariantsToProduct productOptionsCreate: ${errs}`);
    }
  } else if (existingOption) {
    const existingNames = new Set(existingOption.optionValues.map((v) => v.name));
    const newValues = variants.filter((v) => !existingNames.has(v.optionValue));
    if (newValues.length > 0) {
      const updateRes = await adminGraphQL(`
        mutation MergeOptionUpdate($productId: ID!, $option: OptionUpdateInput!, $optionValuesToAdd: [OptionValueCreateInput!]) {
          productOptionUpdate(productId: $productId, option: $option, optionValuesToAdd: $optionValuesToAdd) {
            userErrors { field message }
          }
        }
      `, {
        productId: gid,
        option: { id: existingOption.id },
        optionValuesToAdd: newValues.map((v) => ({ name: v.optionValue }))
      });
      if (updateRes.productOptionUpdate.userErrors.length > 0) {
        const errs = updateRes.productOptionUpdate.userErrors.map((e) => `${e.field.join(".")}: ${e.message}`).join("; ");
        throw new Error(`addVariantsToProduct productOptionUpdate: ${errs}`);
      }
    }
  }
  const existingVariantsRes = await adminGraphQL(`
    query MergeExistingVariants($id: ID!) {
      product(id: $id) {
        variants(first: 100) {
          nodes { id selectedOptions { name value } }
        }
      }
    }
  `, { id: gid });
  const existingOptionValues = new Set(
    (existingVariantsRes.product?.variants.nodes ?? []).flatMap((v) => v.selectedOptions).filter((o) => o.name === optionName).map((o) => o.value)
  );
  const variantsToCreate = variants.filter((v) => !existingOptionValues.has(v.optionValue));
  if (variantsToCreate.length === 0) return;
  const locationId = await getPrimaryLocationId();
  const bulkRes = await adminGraphQL(`
    mutation MergeBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $strategy: ProductVariantsBulkCreateStrategy) {
      productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: $strategy) {
        productVariants { id }
        userErrors { field message }
      }
    }
  `, {
    productId: gid,
    strategy: isDefaultOnly ? "REMOVE_STANDALONE_VARIANT" : "DEFAULT",
    variants: variantsToCreate.map((v) => ({
      price: v.price,
      ...v.compareAtPrice != null ? { compareAtPrice: v.compareAtPrice } : {},
      optionValues: [{ name: v.optionValue, optionName }],
      inventoryItem: { sku: v.sku ?? null },
      ...v.barcode != null ? { barcode: v.barcode } : {},
      ...v.mediaId != null ? { mediaId: v.mediaId } : {},
      ...(v.inventoryQuantity ?? 0) > 0 ? { inventoryQuantities: [{ availableQuantity: v.inventoryQuantity, locationId }] } : {}
    }))
  });
  if (bulkRes.productVariantsBulkCreate.userErrors.length > 0) {
    const errs = bulkRes.productVariantsBulkCreate.userErrors.map((e) => `${e.field.join(".")}: ${e.message}`).join("; ");
    throw new Error(`addVariantsToProduct productVariantsBulkCreate: ${errs}`);
  }
}
function parsePricingSnapshot(raw) {
  const mfMap = /* @__PURE__ */ new Map();
  for (const mf of raw.metafields.nodes) {
    mfMap.set(mf.key, mf.value);
  }
  const variants = raw.variants.nodes.map((v) => ({
    variantId: v.id,
    sku: v.sku ?? "",
    title: v.title,
    price: parseFloat(v.price),
    compareAtPrice: v.compareAtPrice != null ? parseFloat(v.compareAtPrice) : null,
    inventoryItemId: v.inventoryItem?.id ?? null,
    unitCost: v.inventoryItem?.unitCost?.amount != null ? parseFloat(v.inventoryItem.unitCost.amount) : null
  }));
  if (variants.every((v) => v.sku === "")) return null;
  const wholesaleCostRaw = mfMap.get("wholesale_cost");
  const mapPriceRaw = mfMap.get("map_price");
  const originalPriceRaw = mfMap.get("original_price");
  const discontinuedAtRaw = mfMap.get("discontinued_at");
  const discontinuedAt = discontinuedAtRaw ? new Date(discontinuedAtRaw) : null;
  return {
    productId: raw.id,
    productGid: raw.id,
    handle: raw.handle,
    title: raw.title,
    vendor: raw.vendor ?? null,
    productType: raw.productType ?? null,
    variants,
    metafields: {
      nalpacSku: mfMap.get("nalpac_sku") ?? null,
      wholesaleCost: wholesaleCostRaw != null ? parseFloat(wholesaleCostRaw) : null,
      mapPrice: mapPriceRaw != null ? parseFloat(mapPriceRaw) : null,
      originalPrice: originalPriceRaw != null ? parseFloat(originalPriceRaw) : null,
      mapRestricted: mfMap.get("map_restricted") === "true",
      discontinuedAt
    }
  };
}
async function bulkFetchProductsForPricing(opts) {
  const pageSize = opts?.limit ?? 100;
  let cursor = opts?.cursor ?? null;
  const results = [];
  do {
    const data = await adminGraphQL(PRICING_PRODUCTS_QUERY, {
      first: pageSize,
      after: cursor ?? null,
      query: "metafields.xdipx.nalpac_sku:*"
    });
    for (const node of data.products.nodes) {
      const snapshot = parsePricingSnapshot(node);
      if (snapshot) results.push(snapshot);
    }
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor ?? null : null;
  } while (cursor !== null);
  return results;
}
async function findVariantsBySkus(skus) {
  if (skus.length === 0) return [];
  const results = [];
  const BATCH = 50;
  for (let i = 0; i < skus.length; i += BATCH) {
    const batch = skus.slice(i, i + BATCH);
    const queryStr = batch.map((s) => `sku:'${s.replace(/'/g, "\\'")}'`).join(" OR ");
    const data = await adminGraphQL(VARIANTS_BY_SKU_QUERY, {
      query: queryStr,
      first: batch.length * 2
    });
    for (const node of data.productVariants.nodes) {
      const mfMap = /* @__PURE__ */ new Map();
      for (const mf of node.product.metafields) {
        if (mf) mfMap.set(mf.key, mf.value);
      }
      const wholesaleRaw = mfMap.get("wholesale_cost");
      const mapRaw = mfMap.get("map_price");
      const origRaw = mfMap.get("original_price");
      results.push({
        productId: node.product.id,
        productGid: node.product.id,
        handle: node.product.handle,
        title: node.product.title,
        vendor: node.product.vendor ?? null,
        productType: node.product.productType ?? null,
        variant: {
          variantId: node.id,
          sku: node.sku ?? "",
          title: node.title,
          price: parseFloat(node.price),
          compareAtPrice: node.compareAtPrice != null ? parseFloat(node.compareAtPrice) : null,
          inventoryItemId: node.inventoryItem?.id ?? null,
          // unitCost is not fetched by the SKU-lookup query; callers that need
          // it (pricing-apply-v2 recomputeVariant) fetch it via their own
          // inline query against productVariant(id).
          unitCost: null
        },
        metafields: {
          nalpacSku: mfMap.get("nalpac_sku") ?? null,
          wholesaleCost: wholesaleRaw != null ? parseFloat(wholesaleRaw) : null,
          mapPrice: mapRaw != null ? parseFloat(mapRaw) : null,
          originalPrice: origRaw != null ? parseFloat(origRaw) : null,
          mapRestricted: mfMap.get("map_restricted") === "true",
          // discontinued_at is not fetched by the SKU-lookup query; callers that
          // need it (pricing-apply-v2) fetch it via their own inline query.
          discontinuedAt: null
        }
      });
    }
  }
  return results;
}
async function getDistinctProductTypes(opts) {
  if (!opts?.force) {
    const cached2 = await kvGet(PRODUCT_TYPES_CACHE_KEY);
    if (cached2) return cached2;
  }
  const counts = /* @__PURE__ */ new Map();
  let cursor = null;
  let pages = 0;
  const MAX_PAGES = 20;
  do {
    const data = await adminGraphQL(PRODUCT_TYPES_QUERY, {
      first: 250,
      after: cursor ?? null
    });
    for (const node of data.products.nodes) {
      const pt = node.productType?.trim();
      if (pt) {
        counts.set(pt, (counts.get(pt) ?? 0) + 1);
      }
    }
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor ?? null : null;
    pages++;
  } while (cursor !== null && pages < MAX_PAGES);
  const result = Array.from(counts.entries()).map(([productType, count]) => ({ productType, count })).sort((a, b) => b.count - a.count);
  await kvSet(PRODUCT_TYPES_CACHE_KEY, result, PRODUCT_TYPES_CACHE_TTL);
  return result;
}
async function paginateAllProductsForSanity(onBatch) {
  let created = 0;
  let skipped = 0;
  for (const status of ["active", "draft", "archived"]) {
    let sinceId = 0;
    while (true) {
      const { products } = await shopifyAdmin(
        `/products.json?limit=250&since_id=${sinceId}&status=${status}&fields=id,handle,title,images`
      );
      console.log(`[sync-sanity] status=${status} page sinceId=${sinceId} count:`, products?.length ?? 0);
      if (!products?.length) break;
      await onBatch(products);
      if (products.length < 250) break;
      sinceId = products[products.length - 1].id;
    }
  }
  return { created, skipped };
}
async function getProductMetafieldDebug(numericProductId) {
  const result = await shopifyAdmin(
    `/products/${numericProductId}/metafields.json?namespace=xdipx`
  ).catch((err) => ({ error: err.message }));
  if ("error" in result) {
    return { allKeys: [], emmaHero: null };
  }
  return {
    allKeys: result.metafields.map((m) => `${m.namespace}.${m.key}`),
    emmaHero: result.metafields.find((m) => m.key === "emma_hero") ?? null
  };
}
var READ_TTL, COLLECTION_CURSOR_TTL, STOREFRONT_ENDPOINT, ADMIN_ENDPOINT, ADMIN_GQL_ENDPOINT, METAFIELDS_FRAGMENT, PRODUCT_CORE_FRAGMENT, CARD_METAFIELDS_FRAGMENT, PRODUCT_CARD_FRAGMENT, LEGACY_DIAL_LABELS, GMC_FEED_METAFIELDS_FRAGMENT, GMC_FEED_CARD_FRAGMENT, CART_FRAGMENT, XDIPX_LOCATION_IDS, XDIPX_PUBLICATION_NAMES, XDIPX_EXCLUDED_PUBLICATION_NAMES, CUSTOMER_ADDRESS_FRAGMENT, STOREFRONT_ORDER_LEAN_FRAGMENT, SUBSCRIPTION_CONTRACT_FRAGMENT, SEARCH_PRODUCT_FRAGMENT, _primaryLocationId, PRICING_PRODUCTS_QUERY, VARIANTS_BY_SKU_QUERY, PRODUCT_TYPES_QUERY, PRODUCT_TYPES_CACHE_KEY, PRODUCT_TYPES_CACHE_TTL;
var init_shopify_server = __esm({
  "app/lib/shopify.server.ts"() {
    "use strict";
    init_kv_server();
    init_tag_normalize();
    init_master_collapse_server();
    READ_TTL = 60;
    COLLECTION_CURSOR_TTL = 300;
    STOREFRONT_ENDPOINT = `https://${process.env["SHOPIFY_STORE_DOMAIN"]}/api/2024-10/graphql.json`;
    ADMIN_ENDPOINT = `https://${process.env["SHOPIFY_STORE_DOMAIN"]}/admin/api/2024-10`;
    ADMIN_GQL_ENDPOINT = `https://${process.env["SHOPIFY_STORE_DOMAIN"]}/admin/api/2024-10/graphql.json`;
    METAFIELDS_FRAGMENT = `
  metafields(identifiers: [
    { namespace: "xdipx", key: "tagline" }
    { namespace: "xdipx", key: "full_story" }
    { namespace: "xdipx", key: "works_for_him" }
    { namespace: "xdipx", key: "works_for_her" }
    { namespace: "xdipx", key: "box_contents" }
    { namespace: "xdipx", key: "deal_status" }
    { namespace: "xdipx", key: "deal_date" }
    { namespace: "xdipx", key: "deal_score" }
    { namespace: "xdipx", key: "wholesale_cost" }
    { namespace: "xdipx", key: "map_price" }
    { namespace: "xdipx", key: "original_price" }
    { namespace: "xdipx", key: "category" }
    { namespace: "xdipx", key: "nalpac_sku" }
    { namespace: "xdipx", key: "seo_meta_description" }
    { namespace: "xdipx", key: "mood_image_url" }
    { namespace: "xdipx", key: "accessory_product_ids" }
    { namespace: "xdipx", key: "specifications" }
    { namespace: "xdipx", key: "map_restricted" }
    { namespace: "xdipx", key: "hero_video" }
    { namespace: "xdipx", key: "mood_tags" }
    { namespace: "xdipx", key: "audience_tags" }
    { namespace: "xdipx", key: "matters_tags" }
    { namespace: "xdipx", key: "product_type_dial" }
    { namespace: "xdipx", key: "sensation_dial" }
    { namespace: "xdipx", key: "sensation_dial_v2" }
    { namespace: "xdipx", key: "care_instructions" }
    { namespace: "xdipx", key: "pairing_why" }
    { namespace: "xdipx", key: "emma_hero" }
    { namespace: "xdipx", key: "quiet_endorsement_copy" }
    { namespace: "xdipx", key: "pair_bundle_copy" }
    { namespace: "xdipx", key: "endorsement_copy" }
    { namespace: "custom", key: "original_description" }
  ]) {
    namespace key value
  }
`;
    PRODUCT_CORE_FRAGMENT = `
  id handle title vendor tags description descriptionHtml
  createdAt updatedAt
  collections(first: 10) {
    edges { node { handle title } }
  }
  images(first: 10) {
    edges { node { url altText } }
  }
  media(first: 15) {
    edges {
      node {
        mediaContentType
        ... on Video {
          previewImage { url }
          sources { url mimeType height width }
        }
      }
    }
  }
  options { name values }
  variants(first: 20) {
    edges {
      node {
        id
        title
        selectedOptions { name value }
        image { url altText }
        price { amount currencyCode }
        compareAtPrice { amount currencyCode }
        availableForSale
        quantityAvailable
        barcode
        metafields(identifiers: [{ namespace: "custom", key: "original_description" }]) {
          value
        }
      }
    }
  }
  sellingPlanGroups(first: 5) {
    edges {
      node {
        name
        appName
        options { name values }
        sellingPlans(first: 10) {
          edges {
            node {
              id
              name
              description
              recurringDeliveries
              options { name value }
              priceAdjustments {
                adjustmentValue {
                  __typename
                  ... on SellingPlanPercentagePriceAdjustment { adjustmentPercentage }
                  ... on SellingPlanFixedAmountPriceAdjustment { adjustmentAmount { amount currencyCode } }
                  ... on SellingPlanFixedPriceAdjustment       { price           { amount currencyCode } }
                }
              }
            }
          }
        }
      }
    }
  }
  ${METAFIELDS_FRAGMENT}
`;
    CARD_METAFIELDS_FRAGMENT = `
  metafields(identifiers: [
    { namespace: "xdipx", key: "deal_date" }
    { namespace: "xdipx", key: "original_price" }
    { namespace: "xdipx", key: "category" }
    { namespace: "xdipx", key: "deal_status" }
    { namespace: "xdipx", key: "mood_tags" }
    { namespace: "xdipx", key: "audience_tags" }
    { namespace: "xdipx", key: "matters_tags" }
    { namespace: "xdipx", key: "hero_video" }
  ]) {
    namespace key value
  }
`;
    PRODUCT_CARD_FRAGMENT = `
  id handle title vendor tags
  options { name values }
  images(first: 6) {
    edges { node { url altText } }
  }
  variants(first: 50) {
    edges {
      node {
        id
        price { amount }
        compareAtPrice { amount }
        quantityAvailable
        availableForSale
      }
    }
  }
  ${CARD_METAFIELDS_FRAGMENT}
`;
    LEGACY_DIAL_LABELS = {
      intensity: "Intensity",
      quietness: "Quietness",
      softness: "Softness",
      suction: "Suction strength",
      buildup: "Buildup speed",
      learningCurve: "Learning curve",
      patternVariety: "Pattern variety",
      reach: "Reach",
      slipperiness: "Slipperiness",
      longevity: "Longevity",
      fit: "Fit"
    };
    GMC_FEED_METAFIELDS_FRAGMENT = `
  metafields(identifiers: [
    { namespace: "xdipx", key: "deal_date" }
    { namespace: "xdipx", key: "original_price" }
    { namespace: "xdipx", key: "category" }
    { namespace: "xdipx", key: "mood_tags" }
    { namespace: "xdipx", key: "audience_tags" }
    { namespace: "xdipx", key: "matters_tags" }
    { namespace: "xdipx", key: "hero_video" }
    { namespace: "xdipx", key: "seo_meta_description" }
    { namespace: "xdipx", key: "mood_image_url" }
    { namespace: "xdipx", key: "feature_bullets" }
    { namespace: "xdipx", key: "specifications" }
    { namespace: "xdipx", key: "product_type_dial" }
    { namespace: "xdipx", key: "deal_score" }
    { namespace: "xdipx", key: "is_daily_deal" }
    { namespace: "mm-google-shopping", key: "google_product_category" }
    { namespace: "mm-google-shopping", key: "age_group" }
    { namespace: "mm-google-shopping", key: "gender" }
    { namespace: "mm-google-shopping", key: "mpn" }
    { namespace: "mm-google-shopping", key: "color" }
    { namespace: "mm-google-shopping", key: "material" }
    { namespace: "mm-google-shopping", key: "size" }
    { namespace: "mm-google-shopping", key: "custom_label_0" }
    { namespace: "mm-google-shopping", key: "custom_label_1" }
    { namespace: "mm-google-shopping", key: "custom_label_2" }
    { namespace: "mm-google-shopping", key: "custom_label_3" }
    { namespace: "mm-google-shopping", key: "custom_label_4" }
  ]) {
    namespace key value
  }
`;
    GMC_FEED_CARD_FRAGMENT = `
  id handle title vendor tags
  options { name values }
  images(first: 10) {
    edges { node { url altText } }
  }
  variants(first: 1) {
    edges {
      node {
        id
        price { amount }
        compareAtPrice { amount }
        quantityAvailable
        availableForSale
        barcode
      }
    }
  }
  ${GMC_FEED_METAFIELDS_FRAGMENT}
`;
    CART_FRAGMENT = `
  id checkoutUrl totalQuantity
  lines(first: 50) {
    edges {
      node {
        id quantity
        merchandise {
          ... on ProductVariant {
            id title
            price { amount currencyCode }
            product { id title handle images(first: 1) { edges { node { url altText } } } }
          }
        }
        sellingPlanAllocation {
          sellingPlan { id name }
          priceAdjustments {
            compareAtPrice { amount currencyCode }
            price          { amount currencyCode }
          }
        }
      }
    }
  }
  cost {
    subtotalAmount { amount currencyCode }
    totalAmount    { amount currencyCode }
  }
`;
    XDIPX_LOCATION_IDS = [
      "gid://shopify/Location/85557510315",
      // Entrenue
      "gid://shopify/Location/85557477547"
      // Nalpac
    ];
    XDIPX_PUBLICATION_NAMES = [
      "Online Store",
      "Shop",
      "Storefront Admin",
      "Shopify GraphiQL App",
      "Google & YouTube",
      "ChatGPT"
    ];
    XDIPX_EXCLUDED_PUBLICATION_NAMES = [
      "Point of Sale"
    ];
    CUSTOMER_ADDRESS_FRAGMENT = `
  id
  firstName
  lastName
  company
  address1
  address2
  city
  province
  provinceCode
  country
  countryCodeV2
  zip
  phone
  formatted
`;
    STOREFRONT_ORDER_LEAN_FRAGMENT = `
  id orderNumber processedAt financialStatus fulfillmentStatus
  currentTotalPrice { amount currencyCode }
  lineItems(first: 5) {
    edges {
      node {
        title quantity
        variant {
          image { url }
          price { amount }
        }
      }
    }
  }
`;
    SUBSCRIPTION_CONTRACT_FRAGMENT = `
  id
  status
  createdAt
  nextBillingDate
  currencyCode
  billingPolicy { interval intervalCount }
  deliveryPolicy { interval intervalCount }
  customer { id }
  deliveryMethod {
    __typename
    ... on SubscriptionDeliveryMethodShipping {
      address {
        firstName lastName address1 address2
        city province country zip phone
      }
    }
  }
  lines(first: 20) {
    edges {
      node {
        id title variantTitle quantity
        currentPrice { amount currencyCode }
        variantImage { url }
        productId
      }
    }
  }
`;
    SEARCH_PRODUCT_FRAGMENT = `
  id handle title vendor tags availableForSale
  featuredImage { url altText }
  priceRange { minVariantPrice { amount currencyCode } }
  compareAtPriceRange { maxVariantPrice { amount currencyCode } }
`;
    _primaryLocationId = null;
    PRICING_PRODUCTS_QUERY = `
  query PricingProducts($first: Int!, $after: String, $query: String!) {
    products(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        handle
        title
        vendor
        productType
        variants(first: 100) {
          nodes {
            id
            sku
            title
            price
            compareAtPrice
            inventoryItem {
              id
              unitCost { amount }
            }
          }
        }
        metafields(keys: ["xdipx.nalpac_sku", "xdipx.wholesale_cost", "xdipx.map_price", "xdipx.original_price", "xdipx.map_restricted", "xdipx.discontinued_at"], first: 10) {
          nodes {
            namespace
            key
            value
          }
        }
      }
    }
  }
`;
    VARIANTS_BY_SKU_QUERY = `
  query VariantsBySkus($query: String!, $first: Int!) {
    productVariants(first: $first, query: $query) {
      nodes {
        id
        sku
        title
        price
        compareAtPrice
        inventoryItem {
          id
        }
        product {
          id
          handle
          title
          vendor
          productType
          metafields(identifiers: [
            { namespace: "xdipx", key: "nalpac_sku" }
            { namespace: "xdipx", key: "wholesale_cost" }
            { namespace: "xdipx", key: "map_price" }
            { namespace: "xdipx", key: "original_price" }
            { namespace: "xdipx", key: "map_restricted" }
          ]) {
            namespace
            key
            value
          }
        }
      }
    }
  }
`;
    PRODUCT_TYPES_QUERY = `
  query ProductTypes($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        productType
      }
    }
  }
`;
    PRODUCT_TYPES_CACHE_KEY = "shopify:distinct-product-types";
    PRODUCT_TYPES_CACHE_TTL = 60 * 60;
  }
});

// app/lib/pricing-velocity.server.ts
import { eq as eq2 } from "drizzle-orm";
async function fetchUnits60d(variantGid) {
  const since = new Date(Date.now() - DEAD_WINDOW_DAYS * 24 * 60 * 60 * 1e3);
  const sinceStr = since.toISOString().slice(0, 10);
  const queryStr = `created_at:>='${sinceStr}' status:any`;
  let totalUnits = 0;
  let cursor = null;
  const PAGE = 50;
  do {
    const data = await adminGraphQL(ORDERS_QUERY, {
      query: queryStr,
      first: PAGE,
      after: cursor ?? null
    });
    for (const order of data.orders.nodes) {
      for (const item of order.lineItems.nodes) {
        if (item.variant?.id === variantGid) {
          totalUnits += item.quantity;
        }
      }
    }
    cursor = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor ?? null : null;
  } while (cursor !== null);
  return totalUnits;
}
async function fetchInventory(variantGid) {
  try {
    const data = await adminGraphQL(INVENTORY_QUERY, { id: variantGid });
    return data.productVariant?.inventoryQuantity ?? 0;
  } catch {
    return 0;
  }
}
function cacheKey(variantId) {
  return `velocity:${variantId.split("/").pop() ?? variantId}`;
}
async function readCache2(variantId) {
  try {
    const rows = await db.select({ value: pipelineSettings.value }).from(pipelineSettings).where(eq2(pipelineSettings.key, cacheKey(variantId))).limit(1);
    if (!rows[0]?.value) return null;
    const payload = JSON.parse(rows[0].value);
    const ageMs = Date.now() - new Date(payload.computedAt).getTime();
    if (ageMs > CACHE_TTL_SECS * 1e3) return null;
    return payload.bucket;
  } catch {
    return null;
  }
}
async function writeCache(variantId, bucket, units60d) {
  const payload = {
    bucket,
    units60d,
    computedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  try {
    await db.insert(pipelineSettings).values({ key: cacheKey(variantId), value: JSON.stringify(payload) }).onConflictDoUpdate({
      target: pipelineSettings.key,
      set: { value: JSON.stringify(payload), updatedAt: /* @__PURE__ */ new Date() }
    });
  } catch (err) {
    console.warn("[pricing-velocity] cache write failed:", err);
  }
}
async function computeVelocityBucket(variantGid) {
  const cached2 = await readCache2(variantGid);
  if (cached2 !== null) return cached2;
  try {
    const [units60d, stock] = await Promise.all([
      fetchUnits60d(variantGid),
      fetchInventory(variantGid)
    ]);
    const weeksInWindow = DEAD_WINDOW_DAYS / 7;
    const unitsPerWeek = units60d / weeksInWindow;
    let bucket;
    if (unitsPerWeek > FAST_UNITS_PER_WEEK) {
      bucket = "top";
    } else if (unitsPerWeek >= SLOW_UNITS_PER_WEEK) {
      bucket = "normal";
    } else if (units60d === 0 && stock >= MIN_STOCK_FOR_SLOW) {
      bucket = "dead";
    } else if (stock >= MIN_STOCK_FOR_SLOW) {
      bucket = "slow";
    } else {
      bucket = "normal";
    }
    await writeCache(variantGid, bucket, units60d);
    return bucket;
  } catch (err) {
    console.warn("[pricing-velocity] Shopify query failed, defaulting to normal:", err);
    return "normal";
  }
}
var FAST_UNITS_PER_WEEK, SLOW_UNITS_PER_WEEK, DEAD_WINDOW_DAYS, MIN_STOCK_FOR_SLOW, CACHE_TTL_SECS, ORDERS_QUERY, INVENTORY_QUERY;
var init_pricing_velocity_server = __esm({
  "app/lib/pricing-velocity.server.ts"() {
    "use strict";
    init_shopify_server();
    init_db_server();
    init_schema();
    FAST_UNITS_PER_WEEK = 2;
    SLOW_UNITS_PER_WEEK = 0.25;
    DEAD_WINDOW_DAYS = 60;
    MIN_STOCK_FOR_SLOW = 5;
    CACHE_TTL_SECS = 24 * 60 * 60;
    ORDERS_QUERY = `
  query OrdersForVariant($query: String!, $first: Int!, $after: String) {
    orders(first: $first, after: $after, query: $query) {
      nodes {
        lineItems(first: 50) {
          nodes {
            quantity
            currentQuantity
            variant { id }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
    INVENTORY_QUERY = `
  query VariantInventory($id: ID!) {
    productVariant(id: $id) {
      inventoryQuantity
    }
  }
`;
  }
});

// app/lib/pricing-apply-v2.server.ts
var pricing_apply_v2_server_exports = {};
__export(pricing_apply_v2_server_exports, {
  DEFAULT_MODE_THRESHOLD: () => DEFAULT_MODE_THRESHOLD,
  decideStatus: () => decideStatus,
  dryRunRuleChange: () => dryRunRuleChange,
  getModeThresholds: () => getModeThresholds,
  recomputeCatalog: () => recomputeCatalog,
  recomputeVariant: () => recomputeVariant
});
import { eq as eq3 } from "drizzle-orm";
async function getModeThresholds() {
  const merged = { ...DEFAULT_MODE_THRESHOLD };
  try {
    const rows = await db.select({ value: pipelineSettings.value }).from(pipelineSettings).where(eq3(pipelineSettings.key, "pricing_mode_thresholds")).limit(1);
    const raw = rows[0]?.value;
    if (raw) {
      const parsed = JSON.parse(raw);
      for (const mode of ["aggressive", "balanced", "conservative"]) {
        const v = parsed[mode];
        if (typeof v === "number" && isFinite(v) && v >= 0 && v <= 1) {
          merged[mode] = v;
        }
      }
    }
  } catch {
  }
  merged.review_all = 0;
  return merged;
}
function decideStatus(p) {
  const { oldPrice, newPrice, map, mapBehavior, marginFloor, marginAfter, mode } = p;
  if (oldPrice != null && Math.abs(newPrice - oldPrice) < 5e-3) {
    return "skipped_no_change";
  }
  if (marginAfter < marginFloor) return "rejected";
  const mapApplies = mapBehavior !== "ignore_map" && map != null;
  if (mapApplies && newPrice < map) return "rejected";
  if (mode === "review_all") return "pending";
  const threshold = p.threshold ?? MODE_THRESHOLD[mode];
  const deltaPct = oldPrice != null && oldPrice > 0 ? Math.abs(newPrice - oldPrice) / oldPrice : 1;
  if (deltaPct > threshold) return "pending";
  return "auto_applied";
}
async function getApprovalMode() {
  try {
    const rows = await db.select({ value: pipelineSettings.value }).from(pipelineSettings).where(eq3(pipelineSettings.key, "pricing_approval_mode")).limit(1);
    const val = rows[0]?.value;
    if (val === "aggressive" || val === "balanced" || val === "conservative" || val === "review_all") return val;
  } catch {
  }
  return "balanced";
}
async function recomputeVariant(params) {
  const { variantId, trigger } = params;
  let matchData = null;
  try {
    const gidNum = variantId.replace(/[^0-9]/g, "");
    const matches = await findVariantsBySkus([]);
    const data = await (async () => {
      const { adminGraphQL: adminGraphQL2 } = await Promise.resolve().then(() => (init_shopify_server(), shopify_server_exports));
      const result = await adminGraphQL2(
        `query V($id:ID!){productVariant(id:$id){id sku title price compareAtPrice
          inventoryItem{unitCost{amount}}
          product{id handle title vendor productType
            metafields(keys:["xdipx.nalpac_sku","xdipx.wholesale_cost","xdipx.map_price","xdipx.original_price","xdipx.map_restricted","xdipx.discontinued_at"],first:10){nodes{namespace key value}}}}}`,
        { id: variantId }
      );
      return result.productVariant;
    })();
    if (!data) return { status: "skipped_no_change", auditId: null, applied: false, error: "variant not found" };
    if (TEST_SKU_PREFIX.test(data.sku ?? "")) {
      return { status: "skipped_no_change", auditId: null, applied: false, error: "test SKU excluded" };
    }
    const mfMap = {};
    for (const mf of data.product.metafields.nodes) {
      mfMap[mf.key] = mf.value;
    }
    matchData = {
      productId: data.product.id.replace("gid://shopify/Product/", ""),
      productGid: data.product.id,
      handle: data.product.handle,
      title: data.product.title,
      vendor: data.product.vendor,
      productType: data.product.productType,
      variant: {
        variantId,
        sku: data.sku ?? "",
        title: data.title,
        price: parseFloat(data.price),
        compareAtPrice: data.compareAtPrice != null ? parseFloat(data.compareAtPrice) : null,
        inventoryItemId: null,
        unitCost: data.inventoryItem?.unitCost?.amount != null ? parseFloat(data.inventoryItem.unitCost.amount) : null
      },
      metafields: {
        nalpacSku: mfMap["nalpac_sku"] ?? null,
        wholesaleCost: mfMap["wholesale_cost"] ? parseFloat(mfMap["wholesale_cost"]) : null,
        mapPrice: mfMap["map_price"] ? parseFloat(mfMap["map_price"]) : null,
        originalPrice: mfMap["original_price"] ? parseFloat(mfMap["original_price"]) : null,
        mapRestricted: mfMap["map_restricted"] === "true",
        discontinuedAt: mfMap["discontinued_at"] ? new Date(mfMap["discontinued_at"]) : null
      }
    };
    void matches;
    void gidNum;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "skipped_no_change", auditId: null, applied: false, error: `shopify fetch: ${msg}` };
  }
  const cost = matchData.variant.unitCost ?? matchData.metafields.wholesaleCost;
  const map = matchData.metafields.mapPrice;
  const msrp = matchData.metafields.originalPrice;
  const oldSell = matchData.variant.price;
  const oldCompare = matchData.variant.compareAtPrice;
  const productType = matchData.productType ?? null;
  const sku = matchData.variant.sku;
  const cfg = await resolvePricingConfig(productType);
  const group = await getGroupForProductType(productType);
  const mode = await getApprovalMode();
  const thresholds = await getModeThresholds();
  let velocityBucket;
  let effectiveCfg = cfg;
  if (cfg.velocity_modifier_enabled) {
    velocityBucket = await computeVelocityBucket(variantId);
    const shifted = applyVelocityModifier(cfg, velocityBucket);
    effectiveCfg = { ...shifted, groupId: cfg.groupId, subGroupId: cfg.subGroupId };
  }
  const isDiscontinued2 = group?.usesClearanceLadder === true || productType === "Discontinued";
  let newSell = null;
  let newCompare = null;
  let daysDisc;
  if (isDiscontinued2) {
    const discontinuedAt = matchData.metafields.discontinuedAt ?? null;
    daysDisc = discontinuedAt ? Math.max(0, Math.floor((Date.now() - discontinuedAt.getTime()) / 864e5)) : 0;
    const result = computeDiscontinuedPrice({ cost, msrp, daysDiscontinued: daysDisc, cfg: effectiveCfg });
    if (result) {
      newSell = result.sell;
      newCompare = result.compare_at;
    }
  } else {
    const result = computePrice({ cost, map, msrp, cfg: effectiveCfg });
    if (result) {
      newSell = result.sell;
      newCompare = result.compare_at;
      if (result.belowAbsoluteFloor) {
        return {
          status: "pending",
          auditId: null,
          applied: false,
          error: `sell price $${result.sell.toFixed(2)} is below absolute floor`
        };
      }
    }
  }
  if (newSell == null) {
    return { status: "skipped_no_change", auditId: null, applied: false, error: "cannot compute price: missing cost" };
  }
  const marginAfter = cost != null && newSell > 0 ? (newSell - cost) / newSell : 0;
  const marginBefore = cost != null && oldSell > 0 ? (oldSell - cost) / oldSell : 0;
  const status = decideStatus({
    oldPrice: oldSell,
    newPrice: newSell,
    map,
    mapBehavior: cfg.map_behavior,
    marginFloor: cfg.margin_floor_pct,
    marginAfter,
    mode,
    threshold: thresholds[mode]
  });
  const deltaPct = oldSell > 0 ? (newSell - oldSell) / oldSell : null;
  const rationale = buildRationale({
    oldCost: cost,
    newCost: cost,
    oldSell,
    newSell,
    status,
    trigger,
    mapHeld: map != null && newSell <= map + 0.02,
    marginAfter,
    ...velocityBucket !== void 0 ? { velocityBucket } : {},
    ...daysDisc !== void 0 ? { daysDisc } : {},
    ...map != null ? { map } : {},
    ...deltaPct != null ? { deltaPct } : {},
    approvalThreshold: thresholds[mode]
  });
  let auditId = null;
  try {
    const rows = await db.insert(pricingAuditLog).values({
      variantId,
      sku: sku || null,
      productType,
      groupId: group?.groupId ?? null,
      subGroupId: group?.subGroupId ?? null,
      trigger,
      oldCost: cost != null ? String(cost) : null,
      newCost: cost != null ? String(cost) : null,
      oldMap: map != null ? String(map) : null,
      newMap: map != null ? String(map) : null,
      oldMsrp: msrp != null ? String(msrp) : null,
      newMsrp: msrp != null ? String(msrp) : null,
      oldSell: String(oldSell),
      newSell: String(newSell),
      oldCompareAt: oldCompare != null ? String(oldCompare) : null,
      newCompareAt: newCompare != null ? String(newCompare) : null,
      marginBefore: String(Math.round(marginBefore * 1e4) / 1e4),
      marginAfter: String(Math.round(marginAfter * 1e4) / 1e4),
      status,
      rationale
    }).returning({ id: pricingAuditLog.id });
    auditId = rows[0]?.id ?? null;
  } catch (err) {
    console.error("[pricing-apply-v2] audit log write failed:", err);
  }
  let applied = false;
  let applyError;
  if (status === "auto_applied") {
    try {
      await updateVariantPricing(
        variantId,
        String(newSell),
        newCompare != null ? String(newCompare) : String(newSell)
      );
      applied = true;
    } catch (err) {
      applyError = err instanceof Error ? err.message : String(err);
      console.error("[pricing-apply-v2] Shopify price update failed:", applyError);
      if (auditId != null) {
        try {
          await db.update(pricingAuditLog).set({ status: "pending", rationale: `${rationale} [apply error: ${applyError}]` }).where(eq3(pricingAuditLog.id, auditId));
        } catch {
        }
      }
    }
  }
  return { status, auditId, applied, ...applyError ? { error: applyError } : {} };
}
async function dryRunRuleChange(opts) {
  const { overrides } = opts;
  const overrideMap = /* @__PURE__ */ new Map();
  for (const o of overrides) {
    const key = `${o.scope_level}:${o.scope_id}`;
    overrideMap.set(key, {
      ...o.target_margin_pct != null ? { target_margin_pct: o.target_margin_pct } : {},
      ...o.margin_floor_pct != null ? { margin_floor_pct: o.margin_floor_pct } : {},
      ...o.map_behavior != null ? { map_behavior: o.map_behavior } : {},
      ...o.compare_at_strategy != null ? { compare_at_strategy: o.compare_at_strategy } : {},
      ...o.velocity_modifier_enabled != null ? { velocity_modifier_enabled: o.velocity_modifier_enabled } : {}
    });
  }
  const { bulkFetchProductsForPricing: bulkFetchProductsForPricing2 } = await Promise.resolve().then(() => (init_shopify_server(), shopify_server_exports));
  const mode = await getApprovalMode();
  const thresholds = await getModeThresholds();
  const result = {
    totalAffected: 0,
    withinThreshold: 0,
    willQueue: 0,
    breachMap: 0,
    breachFloor: 0,
    cappedAt: null,
    samples: []
  };
  let processed = 0;
  let capped = false;
  const products = await bulkFetchProductsForPricing2();
  for (const product of products) {
    if (capped) break;
    for (const variant of product.variants) {
      if (TEST_SKU_PREFIX.test(variant.sku ?? "")) continue;
      if (processed >= DRY_RUN_CAP) {
        capped = true;
        break;
      }
      processed++;
      try {
        const productType = product.productType ?? null;
        const group = await getGroupForProductType(productType);
        const base = await resolvePricingConfig(productType);
        let cfg = { ...base };
        const scopeKeys = [
          "global:global",
          group?.groupId ? `group:${group.groupId}` : null,
          group?.subGroupId ? `sub_group:${group.subGroupId}` : null,
          productType ? `product_type:${productType}` : null
        ].filter(Boolean);
        for (const key of scopeKeys) {
          const patch = overrideMap.get(key);
          if (patch) cfg = { ...cfg, ...patch };
        }
        const cost = variant.unitCost ?? product.metafields.wholesaleCost;
        const map = product.metafields.mapPrice;
        const msrp = product.metafields.originalPrice;
        const oldSell = variant.price;
        if (cost == null) continue;
        const isDiscontinued2 = group?.usesClearanceLadder === true || productType === "Discontinued";
        let newSell = null;
        if (isDiscontinued2) {
          const discontinuedAt = product.metafields.discontinuedAt ?? null;
          const daysDiscontinued = discontinuedAt ? Math.max(0, Math.floor((Date.now() - discontinuedAt.getTime()) / 864e5)) : 0;
          const r = computeDiscontinuedPrice({ cost, msrp, daysDiscontinued, cfg });
          if (r) newSell = r.sell;
        } else {
          const r = computePrice({ cost, map, msrp, cfg });
          if (r) {
            newSell = r.sell;
            if (r.belowAbsoluteFloor) {
              newSell = null;
            }
          }
        }
        if (newSell == null) continue;
        if (Math.abs(newSell - oldSell) < 5e-3) continue;
        result.totalAffected++;
        const marginAfter = newSell > 0 ? (newSell - cost) / newSell : 0;
        const mapApplies = cfg.map_behavior !== "ignore_map" && map != null;
        const breachesMap = mapApplies && newSell < map;
        const breachesFloor = marginAfter < cfg.margin_floor_pct;
        if (breachesMap) {
          result.breachMap++;
        } else if (breachesFloor) {
          result.breachFloor++;
        } else {
          const threshold = thresholds[mode];
          const deltaPct = oldSell > 0 ? Math.abs(newSell - oldSell) / oldSell : 1;
          if (mode === "review_all" || deltaPct > threshold) {
            result.willQueue++;
          } else {
            result.withinThreshold++;
          }
        }
        if (result.samples.length < DRY_RUN_SAMPLES) {
          const status = breachesMap || breachesFloor ? "rejected" : mode === "review_all" || oldSell > 0 && Math.abs(newSell - oldSell) / oldSell > thresholds[mode] ? "pending" : "auto_applied";
          result.samples.push({
            variantId: variant.variantId,
            sku: variant.sku || null,
            productType,
            oldSell,
            newSell,
            status,
            rationale: breachesMap ? `Would breach MAP $${map.toFixed(2)}` : breachesFloor ? `Would breach margin floor ${Math.round(cfg.margin_floor_pct * 100)}%` : `${oldSell.toFixed(2)} -> ${newSell.toFixed(2)}`
          });
        }
      } catch {
      }
    }
  }
  if (capped) result.cappedAt = DRY_RUN_CAP;
  return result;
}
async function recomputeCatalog(opts) {
  const { bulkFetchProductsForPricing: bulkFetchProductsForPricing2 } = await Promise.resolve().then(() => (init_shopify_server(), shopify_server_exports));
  const startedAt = Date.now();
  const counts = {
    total: 0,
    autoApplied: 0,
    pending: 0,
    skipped: 0,
    rejected: 0,
    errors: 0,
    durationMs: 0
  };
  const products = await bulkFetchProductsForPricing2();
  for (const product of products) {
    for (const variant of product.variants) {
      if (TEST_SKU_PREFIX.test(variant.sku ?? "")) continue;
      counts.total++;
      try {
        const result = await recomputeVariant({
          variantId: variant.variantId,
          trigger: opts.trigger
        });
        if (result.error) counts.errors++;
        else if (result.status === "auto_applied") counts.autoApplied++;
        else if (result.status === "pending") counts.pending++;
        else if (result.status === "rejected") counts.rejected++;
        else counts.skipped++;
      } catch (err) {
        counts.errors++;
        console.error("[pricing-batch] variant error", variant.variantId, err);
      }
    }
  }
  counts.durationMs = Date.now() - startedAt;
  return counts;
}
var DEFAULT_MODE_THRESHOLD, MODE_THRESHOLD, TEST_SKU_PREFIX, DRY_RUN_CAP, DRY_RUN_SAMPLES;
var init_pricing_apply_v2_server = __esm({
  "app/lib/pricing-apply-v2.server.ts"() {
    "use strict";
    init_db_server();
    init_schema();
    init_pricing_engine_v2_server();
    init_pricing_rules_server();
    init_pricing_rules_server();
    init_pricing_velocity_server();
    init_shopify_server();
    DEFAULT_MODE_THRESHOLD = {
      aggressive: 0.1,
      balanced: 0.05,
      conservative: 0.02,
      review_all: 0
    };
    MODE_THRESHOLD = DEFAULT_MODE_THRESHOLD;
    TEST_SKU_PREFIX = /^XDX-TEST-/i;
    DRY_RUN_CAP = 5e3;
    DRY_RUN_SAMPLES = 10;
  }
});

// app/lib/attribution.server.ts
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
function getFbCookies(request) {
  const cookies = parseCookie(request.headers.get("Cookie") ?? "");
  return {
    fbp: cookies["_fbp"] ?? null,
    fbc: cookies["_fbc"] ?? null
  };
}
function getClientIP(request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? "0.0.0.0";
}
function hashIP(ip) {
  let hash = 0;
  for (let i = 0; i < ip.length; i++) {
    hash = (hash << 5) - hash + ip.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}
var THIRTY_DAYS;
var init_attribution_server = __esm({
  "app/lib/attribution.server.ts"() {
    "use strict";
    THIRTY_DAYS = 60 * 60 * 24 * 30;
  }
});

// app/lib/consent.server.ts
var consent_server_exports = {};
__export(consent_server_exports, {
  MARKETING_CONSENT_COOKIE: () => MARKETING_CONSENT_COOKIE,
  getMarketingConsent: () => getMarketingConsent,
  logConsent: () => logConsent,
  logTosAcceptance: () => logTosAcceptance
});
import { parse as parseCookie2 } from "cookie";
function getMarketingConsent(request) {
  const cookies = parseCookie2(request.headers.get("Cookie") ?? "");
  const raw = cookies[MARKETING_CONSENT_COOKIE];
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    return parsed.marketing === true;
  } catch {
    return false;
  }
}
async function logConsent(request, opts) {
  await db.insert(consentLog).values({
    sessionId: opts.sessionId,
    customerId: opts.customerId ?? null,
    ipHash: hashIP(getClientIP(request)),
    consentGiven: true,
    consentType: opts.consentType,
    policyVersion: opts.policyVersion
  });
}
async function logTosAcceptance(request, opts) {
  await db.insert(tosAcceptance).values({
    customerId: opts.customerId,
    email: opts.email ?? null,
    tosVersion: opts.tosVersion,
    ipHash: hashIP(getClientIP(request)),
    acceptanceMethod: opts.method
  });
}
var MARKETING_CONSENT_COOKIE;
var init_consent_server = __esm({
  "app/lib/consent.server.ts"() {
    "use strict";
    init_db_server();
    init_schema();
    init_attribution_server();
    MARKETING_CONSENT_COOKIE = "__xdipx_consent";
  }
});

// app/lib/meta-capi.server.ts
var meta_capi_server_exports = {};
__export(meta_capi_server_exports, {
  fireCapiEvent: () => fireCapiEvent,
  generateEventId: () => generateEventId,
  hashPII: () => hashPII,
  sendCapiEvent: () => sendCapiEvent
});
import { createHash, randomUUID } from "node:crypto";
function generateEventId() {
  return randomUUID();
}
function hashPII(value) {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}
function fireCapiEvent(request, eventName, opts) {
  const eventId = generateEventId();
  const consentGranted = getMarketingConsent(request);
  const { fbp, fbc } = getFbCookies(request);
  void sendCapiEvent(
    {
      event_name: eventName,
      event_id: eventId,
      event_time: Math.floor(Date.now() / 1e3),
      action_source: "website",
      user_data: {
        client_ip_address: getClientIP(request),
        client_user_agent: request.headers.get("user-agent") ?? void 0,
        fbp,
        fbc
      },
      custom_data: {
        content_ids: opts.contentIds,
        content_type: "product",
        value: opts.value,
        currency: opts.currency ?? "USD",
        ...opts.numItems !== void 0 ? { num_items: opts.numItems } : {}
      }
    },
    { consentGranted }
  );
  return eventId;
}
async function sendCapiEvent(event, opts) {
  const pixelId = process.env["META_PIXEL_ID"];
  const token = process.env["META_CAPI_TOKEN"];
  if (!pixelId || !token) return { ok: true };
  const user_data = { ...event.user_data };
  if (!opts.consentGranted) {
    delete user_data.em;
  }
  const payload = {
    data: [
      {
        event_name: event.event_name,
        event_id: event.event_id,
        event_time: event.event_time,
        action_source: event.action_source,
        user_data,
        custom_data: event.custom_data
      }
    ],
    access_token: token
  };
  const testCode = process.env["META_TEST_EVENT_CODE"];
  if (testCode) payload["test_event_code"] = testCode;
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${pixelId}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );
    if (!res.ok) {
      const text2 = await res.text().catch(() => "");
      return { ok: false, error: `Meta CAPI ${res.status}: ${text2}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
var init_meta_capi_server = __esm({
  "app/lib/meta-capi.server.ts"() {
    "use strict";
    init_consent_server();
    init_attribution_server();
  }
});

// app/lib/sanity.server.ts
var sanity_server_exports = {};
__export(sanity_server_exports, {
  addCmsBlock: () => addCmsBlock,
  addRailRefToHomepage: () => addRailRefToHomepage,
  addRailRefToProductPage: () => addRailRefToProductPage,
  archiveHomepageRailsForDeal: () => archiveHomepageRailsForDeal,
  calculateReadingTime: () => calculateReadingTime,
  createEmmaRailDraft: () => createEmmaRailDraft,
  getBlogAuthor: () => getBlogAuthor,
  getBlogCategories: () => getBlogCategories,
  getBlogHomepage: () => getBlogHomepage,
  getBlogPost: () => getBlogPost,
  getBlogPosts: () => getBlogPosts,
  getBlogPostsForSitemap: () => getBlogPostsForSitemap,
  getCollectionPage: () => getCollectionPage,
  getCollectionTypeMap: () => getCollectionTypeMap,
  getCollectionsHub: () => getCollectionsHub,
  getEditor: () => getEditor,
  getEmmaHeroSettings: () => getEmmaHeroSettings,
  getEmmaPersona: () => getEmmaPersona,
  getEmmaPresets: () => getEmmaPresets,
  getHomeConfig: () => getHomeConfig,
  getHomepageDocRaw: () => getHomepageDocRaw,
  getHomepageSections: () => getHomepageSections,
  getPage: () => getPage,
  getPageList: () => getPageList,
  getPdpTrustBar: () => getPdpTrustBar,
  getPreviewImagesByHandles: () => getPreviewImagesByHandles,
  getProductFaqs: () => getProductFaqs,
  getProductHandlesForSitemap: () => getProductHandlesForSitemap,
  getProductPageBlocks: () => getProductPageBlocks,
  getRailDraftsForDeal: () => getRailDraftsForDeal,
  getRailsByDealId: () => getRailsByDealId,
  getSiteSettings: () => getSiteSettings,
  invalidateBlogCache: () => invalidateBlogCache,
  invalidateCmsCache: () => invalidateCmsCache,
  isPreviewRequest: () => isPreviewRequest,
  patchEmmaRail: () => patchEmmaRail,
  publishEmmaRailDraft: () => publishEmmaRailDraft,
  removeCmsBlock: () => removeCmsBlock,
  removeRailRefFromHomepage: () => removeRailRefFromHomepage,
  restoreHomepageDoc: () => restoreHomepageDoc,
  sanityImageRef: () => sanityImageRef,
  unarchiveHomepageRailsForDeal: () => unarchiveHomepageRailsForDeal,
  updateCmsBlock: () => updateCmsBlock,
  updateCmsPromoImage: () => updateCmsPromoImage,
  updateCmsTileImage: () => updateCmsTileImage,
  uploadBufferToSanity: () => uploadBufferToSanity,
  upsertAnnouncementBar: () => upsertAnnouncementBar,
  upsertEmmaPick: () => upsertEmmaPick,
  upsertProductPage: () => upsertProductPage
});
import { createClient } from "@sanity/client";
import { createHash as createHash2 } from "node:crypto";
import { toHTML as toHTML2 } from "@portabletext/to-html";
function withSanityKey(items, hashOf) {
  const seen = /* @__PURE__ */ new Set();
  return items.map((item, i) => {
    const base = createHash2("sha1").update(hashOf(item)).digest("hex").slice(0, 12);
    let key = base;
    if (seen.has(key)) key = `${base}${i.toString(36)}`;
    seen.add(key);
    return { ...item, _key: key };
  });
}
function getClient(withToken = false, preview = false, perspective) {
  if (!projectId) return null;
  const resolvedPerspective = perspective ?? (preview ? "previewDrafts" : "published");
  return createClient({ projectId, dataset, apiVersion, useCdn: !withToken && !preview, token: process.env["SANITY_API_TOKEN"], perspective: resolvedPerspective });
}
function isPreviewRequest(request) {
  const cookie = request.headers.get("cookie") ?? "";
  return cookie.includes("__sanity_preview=1");
}
async function getEmmaHeroSettings(preview = false) {
  if (!projectId) return null;
  const fetcher = async () => {
    try {
      const client4 = getClient(false, preview);
      if (!client4) return null;
      const raw = await client4.fetch(EMMA_HERO_GROQ);
      if (!raw?.settings && !raw?.cta) return null;
      return { ...raw.settings, ...raw.cta };
    } catch (err) {
      console.error("[sanity] getEmmaHeroSettings error:", err);
      return null;
    }
  };
  if (preview) return fetcher();
  return cached("sanity:emma-hero", 60, fetcher);
}
async function getEditor(preview = false) {
  if (!projectId) return null;
  const fetcher = async () => {
    try {
      const client4 = getClient(false, preview);
      if (!client4) return null;
      const raw = await client4.fetch(EDITOR_GROQ);
      if (!raw?.name) return null;
      return {
        name: raw.name,
        role: raw.role ?? "Editor",
        photoUrl: raw.photoUrl ?? null,
        photoAlt: raw.photoAlt ?? null,
        shortBio: raw.shortBio ?? null,
        longBio: raw.longBio ?? null,
        picksSince: raw.picksSince ?? null,
        instagram: raw.instagram ?? null,
        email: raw.email ?? null
      };
    } catch (err) {
      console.error("[sanity] getEditor error:", err);
      return null;
    }
  };
  if (preview) return fetcher();
  return cached("sanity:editor", 300, fetcher);
}
async function getEmmaPresets(preview = false) {
  if (!projectId) return [];
  const fetcher = async () => {
    try {
      const client4 = getClient(false, preview);
      if (!client4) return [];
      return await client4.fetch(EMMA_PRESETS_GROQ) ?? [];
    } catch (err) {
      console.error("[sanity] getEmmaPresets error:", err);
      return [];
    }
  };
  if (preview) return fetcher();
  return cached("sanity:emma-presets", 300, fetcher);
}
async function getHomepageSections(preview = false) {
  if (!projectId) return null;
  const fetcher = async () => {
    try {
      const client4 = getClient(false, preview);
      if (!client4) return null;
      return await client4.fetch(HOMEPAGE_GROQ) ?? null;
    } catch (err) {
      console.error("[sanity] getHomepageSections error:", err);
      return null;
    }
  };
  if (preview) return fetcher();
  return cached("sanity:homepage", 60, fetcher);
}
async function upsertAnnouncementBar(messages) {
  const client4 = getClient(true);
  if (!client4) throw new Error("Sanity not configured");
  await client4.createIfNotExists({ _id: "singleton.homepage", _type: "homepageSections", sections: [] });
  await client4.patch("singleton.homepage").setIfMissing({ sections: [] }).set({
    'sections[_type=="announcementBar"].messages': messages
  }).commit();
  invalidateCache("sanity:homepage");
}
async function addCmsBlock(block) {
  const client4 = getClient(true);
  if (!client4) throw new Error("Sanity not configured");
  const key = `${block._type}-${Date.now()}`;
  await client4.createIfNotExists({ _id: "singleton.homepage", _type: "homepageSections", sections: [] });
  await client4.patch("singleton.homepage").setIfMissing({ sections: [] }).append("sections", [{ ...block, _key: key }]).commit();
  invalidateCache("sanity:homepage");
}
async function updateCmsBlock(key, patch) {
  const client4 = getClient(true);
  if (!client4) throw new Error("Sanity not configured");
  await client4.patch("singleton.homepage").set(
    Object.fromEntries(
      Object.entries(patch).map(([field, value]) => [`sections[_key=="${key}"].${field}`, value])
    )
  ).commit();
  invalidateCache("sanity:homepage");
}
async function uploadBufferToSanity(buffer, filename, contentType) {
  const client4 = getClient(true);
  if (!client4) throw new Error("Sanity not configured");
  const asset = await client4.assets.upload("image", buffer, {
    filename,
    ...contentType ? { contentType } : {}
  });
  return { assetId: asset._id, url: asset.url };
}
function sanityImageRef(assetId, alt) {
  return { _type: "image", asset: { _type: "reference", _ref: assetId }, alt };
}
async function updateCmsTileImage(blockKey, tileKey, assetId, alt) {
  const client4 = getClient(true);
  if (!client4) throw new Error("Sanity not configured");
  await client4.patch("singleton.homepage").set({
    [`sections[_key=="${blockKey}"].tiles[_key=="${tileKey}"].image`]: sanityImageRef(assetId, alt)
  }).commit();
  invalidateCache("sanity:homepage");
}
async function updateCmsPromoImage(blockKey, assetId, alt) {
  const client4 = getClient(true);
  if (!client4) throw new Error("Sanity not configured");
  await client4.patch("singleton.homepage").set({
    [`sections[_key=="${blockKey}"].promo.image`]: sanityImageRef(assetId, alt)
  }).commit();
  invalidateCache("sanity:homepage");
}
async function removeCmsBlock(key) {
  const client4 = getClient(true);
  if (!client4) throw new Error("Sanity not configured");
  await client4.patch("singleton.homepage").unset([`sections[_key=="${key}"]`]).commit();
  invalidateCache("sanity:homepage");
}
function invalidateCmsCache() {
  invalidateCache("sanity:homepage");
}
async function getHomepageDocRaw() {
  const client4 = getClient(true, false, "raw");
  if (!client4) return null;
  const doc = await client4.getDocument(HOMEPAGE_DOC_ID);
  return doc ?? null;
}
async function restoreHomepageDoc(snapshot) {
  const client4 = getClient(true, false, "raw");
  if (!client4) throw new Error("Sanity not configured \u2014 cannot restore homepage doc");
  const rest = {};
  for (const [k, v] of Object.entries(snapshot)) {
    if (!k.startsWith("_")) rest[k] = v;
  }
  await client4.createOrReplace({ ...rest, _id: HOMEPAGE_DOC_ID, _type: "homepageSections" });
  invalidateCmsCache();
}
function stringToPortableText(text2) {
  const trimmed = text2.trim();
  if (!trimmed) return [];
  return [{
    _type: "block",
    _key: `d${Math.random().toString(36).slice(2, 10)}`,
    style: "normal",
    markDefs: [],
    children: [{
      _type: "span",
      _key: `s${Math.random().toString(36).slice(2, 10)}`,
      text: trimmed,
      marks: []
    }]
  }];
}
async function uploadImageToSanity(writeClient, imageUrl, filename) {
  if (!writeClient) return null;
  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(`image fetch ${res.status} ${imageUrl}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const asset = await writeClient.assets.upload("image", buffer, { filename });
  return asset.url ?? null;
}
async function upsertProductPage(params) {
  const writeClient = getClient(true, false, "raw");
  if (!writeClient) throw new Error("Sanity not configured \u2014 SANITY_API_TOKEN or SANITY_PROJECT_ID missing");
  const existing = await writeClient.fetch(
    `*[_type == "productPage" && shopifyHandle == $handle] | order(_id asc)[0]{ _id, previewImageUrl }`,
    { handle: params.handle }
  );
  let docId;
  let created;
  if (existing) {
    docId = existing._id;
    created = false;
  } else {
    if (!params.title) {
      console.warn(`[upsertProductPage] no productPage doc for handle "${params.handle}" \u2014 skipping (archive/upsert without title)`);
      return { created: false };
    }
    docId = `productPage-${params.handle}`;
    await writeClient.createIfNotExists({
      _id: docId,
      _type: "productPage",
      shopifyHandle: params.handle,
      shopifyProductId: params.shopifyProductId,
      title: params.title
    });
    created = true;
  }
  const searchFields = {};
  if (params.title !== void 0) searchFields.title = params.title;
  if (params.vendor !== void 0) searchFields.vendor = params.vendor;
  if (params.tags !== void 0) {
    searchFields.tags = params.tags;
    searchFields.normalizedTags = normalizeTagList(params.tags);
  }
  if (params.tagline !== void 0) searchFields.tagline = params.tagline;
  if (params.description !== void 0) searchFields.description = stringToPortableText(params.description);
  if (params.seoDescription !== void 0) searchFields.seoDescription = params.seoDescription;
  if (params.category !== void 0) searchFields.category = params.category;
  if (params.seoTitle !== void 0) searchFields.seoTitle = params.seoTitle;
  if (params.moodImageUrl !== void 0) searchFields.moodImageUrl = params.moodImageUrl;
  if (params.productTypeDial !== void 0) searchFields.productTypeDial = params.productTypeDial;
  if (params.moodTags !== void 0) searchFields.moodTags = params.moodTags;
  if (params.audienceTags !== void 0) searchFields.audienceTags = params.audienceTags;
  if (params.mattersTags !== void 0) searchFields.mattersTags = params.mattersTags;
  if (params.ivrExperience !== void 0) searchFields.ivrExperience = params.ivrExperience;
  if (params.ivrUseCase !== void 0) searchFields.ivrUseCase = params.ivrUseCase;
  if (params.ivrFeatures !== void 0) searchFields.ivrFeatures = params.ivrFeatures;
  if (params.productFaqs !== void 0) {
    searchFields.productFaqs = withSanityKey(params.productFaqs, (f) => `${f.question}|${f.category}`);
  }
  if (params.careInstructions !== void 0) searchFields.careInstructions = params.careInstructions;
  if (params.specifications !== void 0) searchFields.specifications = params.specifications;
  if (params.boxContents !== void 0) searchFields.boxContents = params.boxContents;
  if (params.sensationDialV2 !== void 0) {
    const items = params.sensationDialV2.items ?? [];
    searchFields.sensationDialV2 = {
      ...params.sensationDialV2,
      items: withSanityKey(items, (it) => it.label)
    };
  }
  if (params.productSubtypeDial !== void 0) searchFields.productSubtypeDial = params.productSubtypeDial;
  if (params.originalTitle !== void 0) searchFields.originalTitle = params.originalTitle;
  if (params.archived !== void 0) searchFields.archived = params.archived;
  if (Object.keys(searchFields).length > 0) {
    await writeClient.patch(docId).set(searchFields).commit();
  }
  if (params.imageUrl) {
    const publishedId = docId.replace(/^drafts\./, "");
    const draftId = `drafts.${publishedId}`;
    const states = await writeClient.fetch(
      `*[_id in [$pub, $dft]]{ _id, previewImageUrl }`,
      { pub: publishedId, dft: draftId }
    );
    const pub = states.find((s) => !s._id.startsWith("drafts."));
    const dft = states.find((s) => s._id.startsWith("drafts."));
    let sanityUrl = null;
    if (pub?.previewImageUrl?.includes("cdn.sanity.io")) {
      sanityUrl = pub.previewImageUrl;
    } else {
      sanityUrl = await uploadImageToSanity(writeClient, params.imageUrl, `${params.handle}-preview.jpg`);
    }
    if (sanityUrl) {
      if (pub && pub.previewImageUrl !== sanityUrl) {
        await writeClient.patch(publishedId).set({ previewImageUrl: sanityUrl }).commit();
      }
      if (dft && dft.previewImageUrl !== sanityUrl) {
        await writeClient.patch(draftId).set({ previewImageUrl: sanityUrl }).commit();
      }
    }
  }
  return { created };
}
async function upsertEmmaPick(params) {
  const writeClient = getClient(true);
  if (!writeClient) throw new Error("Sanity not configured \u2014 SANITY_API_TOKEN or SANITY_PROJECT_ID missing");
  const doc = {
    _id: `emmaPick-${params.productHandle}`,
    _type: "emmaPick",
    productId: params.productId,
    productHandle: params.productHandle,
    dealDate: params.dealDate,
    variant: params.variant,
    eyebrow: params.eyebrow,
    headline: params.headline,
    body: params.body,
    aside: params.aside,
    voiceHash: params.voiceHash,
    generatedAt: params.generatedAt
  };
  if (params.productTitle !== void 0) doc.productTitle = params.productTitle;
  if (params.brand !== void 0) doc.brand = params.brand;
  if (params.category !== void 0) doc.category = params.category;
  if (params.pullQuote !== void 0) doc.pullQuote = params.pullQuote;
  await writeClient.createOrReplace(doc);
}
async function getPdpTrustBar() {
  if (!projectId) return null;
  return cached("sanity:pdp-trust-bar", 300, async () => {
    try {
      const client4 = getClient();
      if (!client4) return null;
      const data = await client4.fetch(
        `*[_type == "pdpDefaults"] | order(_updatedAt desc)[0].trustBar{
          _type, _key, active, order, bgStyle,
          "trustItems": items[]->{ icon, headline, subheadline, active }
        }`
      );
      if (!data) return null;
      const trustItems = (data.trustItems ?? []).filter(
        (i) => !!i && i.active !== false
      );
      return { ...data, trustItems };
    } catch (err) {
      console.error("[sanity] getPdpTrustBar error:", err);
      return null;
    }
  });
}
async function getSiteSettings() {
  if (!projectId) return null;
  return cached("sanity:site-settings", 300, async () => {
    try {
      const client4 = getClient();
      if (!client4) return null;
      const data = await client4.fetch(
        `*[_id == "singleton.siteSettings"][0]{
          _id,
          "logoUrl": logo.asset->url,
          "logoAlt": logo.alt,
          buyButtonText,
          "siteBanner": siteBanner{ enabled, link, "imageUrl": image.asset->url, "imageAlt": coalesce(alt, image.alt) },
          megaMenuBanners[] { _key, menuLabel, position, link, "imageUrl": image.asset->url, "imageAlt": image.alt },
          socialLinks[],
          footerTagline, footerDiscreetHeading, footerDiscreetBody, footerCopyright, footerDisclaimer,
          footerColumns[] { _key, heading, links[] { _key, label, url } }
        }`
      );
      return data ?? null;
    } catch (err) {
      console.error("[sanity] getSiteSettings error:", err);
      return null;
    }
  });
}
async function getEmmaPersona() {
  if (!projectId) return null;
  return cached("sanity:emma-persona", 300, async () => {
    try {
      const client4 = getClient();
      if (!client4) return null;
      const data = await client4.fetch(
        `*[_id == "singleton.editor"][0]{
          "avatarUrl":   photo.asset->url,
          "avatarAlt":   coalesce(photo.alt, name, "Emma"),
          "displayName": coalesce(name, "Emma")
        }`
      );
      return data ?? null;
    } catch (err) {
      console.error("[sanity] getEmmaPersona error:", err);
      return null;
    }
  });
}
async function getPreviewImagesByHandles(handles) {
  const out = /* @__PURE__ */ new Map();
  if (!projectId || handles.length === 0) return out;
  try {
    const client4 = getClient();
    if (!client4) return out;
    const rows = await client4.fetch(
      `*[_type == "productPage" && shopifyHandle in $handles]{ shopifyHandle, previewImageUrl }`,
      { handles }
    );
    for (const r of rows ?? []) {
      if (r?.shopifyHandle && r.previewImageUrl) out.set(r.shopifyHandle, r.previewImageUrl);
    }
  } catch (err) {
    console.error("[sanity] getPreviewImagesByHandles error:", err);
  }
  return out;
}
async function getProductPageBlocks(handle) {
  if (!projectId) return [];
  try {
    const client4 = getClient();
    if (!client4) return [];
    const data = await client4.fetch(
      `*[_type == "productPage" && shopifyHandle == $handle][0]{
        "sections": contentBlocks[]{
          _key,
          ...select(
            _type == "reference" => @->{
              _id, _type, active, order, heading, eyebrow, emmaAside, status, target,
              "productHandles": productHandles[]{ handle },
              layout, bgStyle, ctaLink, ctaLabel
            },
            { ${CONTENT_BLOCKS_PROJECTION} }
          )
        }[active == true && (status == "live" || !defined(status))]
      }`,
      { handle }
    );
    return data?.sections ?? [];
  } catch (err) {
    console.error("[sanity] getProductPageBlocks error:", err);
    return [];
  }
}
async function getProductFaqs(handle) {
  if (!projectId) return [];
  try {
    const client4 = getClient();
    if (!client4) return [];
    const data = await client4.fetch(
      `*[_type == "productPage" && shopifyHandle == $handle][0]{
        "faqs": productFaqs[]{ question, answer, category }
      }`,
      { handle }
    );
    return (data?.faqs ?? []).filter((f) => f && f.question && f.answer).map((f) => ({ ...f, category: f.category ?? "general" }));
  } catch (err) {
    console.error("[sanity] getProductFaqs error:", err);
    return [];
  }
}
async function getCollectionPage(handle, preview = false) {
  if (!projectId) return null;
  try {
    const client4 = getClient(false, preview);
    if (!client4) return null;
    const data = await client4.fetch(
      `*[_type == "collectionPage" && shopifyHandle == $handle][0]{
        shopifyHandle,
        collectionType,
        seoTitle,
        seoDescription,
        h1,
        introCopy,
        "heroImage": heroImageOverride{ "url": asset->url, alt },
        "faqs": faqs[]{ question, answer },
        "related": relatedCollections[]{ handle, label }
      }`,
      { handle }
    );
    if (!data) return null;
    const introHtml = data.introCopy && data.introCopy.length > 0 ? toHTML2(data.introCopy) : null;
    return {
      shopifyHandle: data.shopifyHandle,
      collectionType: data.collectionType ?? "category",
      seoTitle: data.seoTitle ?? null,
      seoDescription: data.seoDescription ?? null,
      h1: data.h1 ?? null,
      introHtml,
      heroImageUrl: data.heroImage?.url ?? null,
      heroImageAlt: data.heroImage?.alt ?? null,
      faqs: (data.faqs ?? []).filter((f) => f?.question && f?.answer),
      related: (data.related ?? []).filter((r) => r?.handle && r?.label)
    };
  } catch (err) {
    console.error("[sanity] getCollectionPage error:", err);
    return null;
  }
}
async function getCollectionTypeMap() {
  const out = /* @__PURE__ */ new Map();
  if (!projectId) return out;
  try {
    const client4 = getClient();
    if (!client4) return out;
    const data = await client4.fetch(
      `*[_type == "collectionPage"]{ shopifyHandle, collectionType }`
    );
    for (const row of data ?? []) {
      if (row.shopifyHandle) {
        out.set(row.shopifyHandle, row.collectionType ?? "category");
      }
    }
    return out;
  } catch (err) {
    console.error("[sanity] getCollectionTypeMap error:", err);
    return out;
  }
}
async function getCollectionsHub(preview = false) {
  if (!projectId) return null;
  try {
    const client4 = getClient(false, preview);
    if (!client4) return null;
    const data = await client4.fetch(
      `*[_type == "collectionsHub"][0]{
        seoTitle,
        seoDescription,
        h1,
        introCopy,
        "featured": featuredCollectionHandles[]{ handle, blurb },
        "faqs": faqs[]{ question, answer }
      }`
    );
    if (!data) return null;
    const introHtml = data.introCopy && data.introCopy.length > 0 ? toHTML2(data.introCopy) : null;
    return {
      seoTitle: data.seoTitle ?? null,
      seoDescription: data.seoDescription ?? null,
      h1: data.h1 ?? null,
      introHtml,
      featured: (data.featured ?? []).filter((f) => f?.handle).map((f) => ({ handle: f.handle, blurb: f.blurb ?? null })),
      faqs: (data.faqs ?? []).filter((f) => f?.question && f?.answer)
    };
  } catch (err) {
    console.error("[sanity] getCollectionsHub error:", err);
    return null;
  }
}
async function getPage(slug, preview = false) {
  if (!projectId) {
    console.warn("[sanity] getPage: no projectId");
    return null;
  }
  try {
    const client4 = getClient(false, preview);
    if (!client4) {
      console.warn("[sanity] getPage: no client");
      return null;
    }
    console.log("[sanity] getPage fetching slug:", slug);
    const result = await client4.fetch(
      `*[_type == "page" && slug.current == $slug][0]{
        _id,
        title,
        "slug": slug.current,
        seoTitle,
        seoDescription,
        "sections": sections[] { ${CONTENT_BLOCKS_PROJECTION} }
      }`,
      { slug }
    );
    console.log("[sanity] getPage result:", result ? `found "${result.title}"` : "null");
    return result;
  } catch (err) {
    console.error("[sanity] getPage error:", err);
    return null;
  }
}
async function getPageList() {
  if (!projectId) return [];
  try {
    const client4 = getClient();
    if (!client4) return [];
    return await client4.fetch(
      `*[_type == "page"] | order(title asc) { title, "slug": slug.current }`
    );
  } catch (err) {
    console.error("[sanity] getPageList error:", err);
    return [];
  }
}
async function getBlogHomepage(preview = false) {
  if (!projectId) return null;
  try {
    const client4 = getClient(false, preview);
    if (!client4) return null;
    return await client4.fetch(
      `*[_id == "singleton.blogHomepage"][0]{
        heading, subtext,
        "heroImageUrl": heroImage.asset->url,
        heroImageAlt
      }`
    );
  } catch (err) {
    console.error("[sanity] getBlogHomepage error:", err);
    return null;
  }
}
function getCachedBlog(key, ttl) {
  const entry = _blogCache.get(key);
  if (entry && Date.now() - entry.ts < ttl) return entry.data;
  return null;
}
function setCachedBlog(key, data) {
  _blogCache.set(key, { data, ts: Date.now() });
}
function invalidateBlogCache() {
  _blogCache.clear();
}
function calculateReadingTime(body) {
  const text2 = (body ?? []).filter((b) => b._type === "block").map((b) => (b.children ?? []).map((c) => c.text ?? "").join("")).join(" ");
  return Math.max(1, Math.ceil(text2.split(/\s+/).filter(Boolean).length / 200));
}
async function getBlogPosts(opts = {}) {
  if (!projectId) return { posts: [], total: 0 };
  const page = opts.page ?? 1;
  const perPage = opts.perPage ?? 12;
  const start = (page - 1) * perPage;
  const end = start + perPage;
  const cacheKey3 = `posts:${page}:${perPage}:${opts.category ?? ""}:${opts.featured ?? ""}:${opts.authorSlug ?? ""}`;
  const cached2 = getCachedBlog(cacheKey3, BLOG_CACHE_TTL);
  if (cached2) return cached2;
  try {
    const client4 = getClient();
    if (!client4) return { posts: [], total: 0 };
    let filter = `_type == "blogPost" && status == "published"`;
    const params = {};
    if (opts.category) {
      filter += ` && category->slug.current == $category`;
      params.category = opts.category;
    }
    if (opts.featured) {
      filter += ` && featured == true`;
    }
    if (opts.authorSlug) {
      filter += ` && author->slug.current == $authorSlug`;
      params.authorSlug = opts.authorSlug;
    }
    const [rawPosts, total] = await Promise.all([
      client4.fetch(
        `*[${filter}] | order(publishedAt desc) [${start}...${end}] { ${BLOG_POST_CARD_PROJECTION}, "bodyText": body[_type == "block"]{ "text": children[].text } }`,
        params
      ),
      client4.fetch(`count(*[${filter}])`, params)
    ]);
    const posts = (rawPosts ?? []).map((p) => {
      const words = (p.bodyText ?? []).flatMap((b) => (b.text ?? []).join("")).join(" ");
      const readingTime = Math.max(1, Math.ceil(words.split(/\s+/).filter(Boolean).length / 200));
      const { bodyText: _, ...rest } = p;
      return { ...rest, readingTime };
    });
    const result = { posts, total };
    setCachedBlog(cacheKey3, result);
    return result;
  } catch (err) {
    console.error("[sanity] getBlogPosts error:", err);
    return { posts: [], total: 0 };
  }
}
async function getBlogPost(slug, preview = false) {
  if (!projectId) return null;
  const cacheKey3 = `post:${slug}`;
  if (!preview) {
    const cached2 = getCachedBlog(cacheKey3, BLOG_CACHE_TTL);
    if (cached2) return cached2;
  }
  try {
    const client4 = getClient(false, preview);
    if (!client4) return null;
    const filter = preview ? `_type == "blogPost" && slug.current == $slug` : `_type == "blogPost" && slug.current == $slug && status == "published"`;
    const raw = await client4.fetch(
      `*[${filter}][0]{
        ${BLOG_POST_CARD_PROJECTION},
        _updatedAt,
        body[]{
          ...,
          _type == "blogImage" => {
            ...,
            "image": image{ "url": asset->url, alt },
            "secondImage": secondImage{ "url": asset->url }
          }
        },
        seoTitle, seoDescription, noIndex,
        "ogImageUrl": ogImage.asset->url,
        tags,
        "relatedPosts": relatedPosts[]->{
          ${BLOG_POST_CARD_PROJECTION}
        }
      }`,
      { slug }
    );
    if (!raw) return null;
    const readingTime = calculateReadingTime(raw.body ?? []);
    const relatedPosts = (raw.relatedPosts ?? []).map((rp) => ({
      ...rp,
      readingTime: 0
      // don't fetch body for related posts
    }));
    const post = { ...raw, readingTime, relatedPosts };
    if (!preview) setCachedBlog(cacheKey3, post);
    return post;
  } catch (err) {
    console.error("[sanity] getBlogPost error:", err);
    return null;
  }
}
async function getBlogAuthor(slug) {
  if (!projectId) return null;
  try {
    const client4 = getClient();
    if (!client4) return null;
    const data = await client4.fetch(
      `*[_type == "blogAuthor" && slug.current == $slug][0] {
        name, "slug": slug.current, bio, "avatarUrl": avatar.asset->url, role,
        "joinedAt": coalesce(joinedAt, _createdAt),
        "postCount": count(*[_type == "blogPost" && status == "published" && author._ref == ^._id])
      }`,
      { slug }
    );
    return data ?? null;
  } catch (err) {
    console.error("[sanity] getBlogAuthor error:", err);
    return null;
  }
}
async function getBlogCategories() {
  if (!projectId) return [];
  const cacheKey3 = "blogCategories";
  const cached2 = getCachedBlog(cacheKey3, BLOG_CAT_CACHE_TTL);
  if (cached2) return cached2;
  try {
    const client4 = getClient();
    if (!client4) return [];
    const data = await client4.fetch(
      `*[_type == "blogCategory"] | order(name asc) {
        name, "slug": slug.current, description, color, seoTitle, seoDescription
      }`
    );
    if (data) setCachedBlog(cacheKey3, data);
    return data ?? [];
  } catch (err) {
    console.error("[sanity] getBlogCategories error:", err);
    return [];
  }
}
async function getBlogPostsForSitemap() {
  if (!projectId) return [];
  try {
    const client4 = getClient();
    if (!client4) return [];
    return await client4.fetch(
      `*[_type == "blogPost" && status == "published" && noIndex != true] | order(publishedAt desc) {
        "slug": slug.current, publishedAt, _updatedAt
      }`
    );
  } catch (err) {
    console.error("[sanity] getBlogPostsForSitemap error:", err);
    return [];
  }
}
async function createEmmaRailDraft(input) {
  const writeClient = getClient(true);
  if (!writeClient) throw new Error("Sanity not configured");
  const safeDealId = input.sourceDealId.replace(/^gid:\/\/shopify\/Product\//, "").replace(/[^a-zA-Z0-9_-]/g, "-");
  const baseId = `emmaRail-${safeDealId}-${input.target}-${Date.now()}`;
  const draftId = `drafts.${baseId}`;
  const doc = {
    _id: draftId,
    _type: "emmaCuratedRail",
    active: true,
    status: "draft",
    order: input.order ?? 50,
    heading: input.heading,
    target: input.target,
    sourceDealId: input.sourceDealId,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    productHandles: input.productHandles.map((handle, i) => ({
      _type: "productRef",
      _key: `ph-${i}-${Math.random().toString(36).slice(2, 8)}`,
      handle
    })),
    layout: input.layout ?? "carousel",
    bgStyle: input.bgStyle ?? "cream"
  };
  if (input.eyebrow !== void 0) doc.eyebrow = input.eyebrow;
  if (input.emmaAside !== void 0) doc.emmaAside = input.emmaAside;
  if (input.ctaLink !== void 0) doc.ctaLink = input.ctaLink;
  if (input.ctaLabel !== void 0) doc.ctaLabel = input.ctaLabel;
  if (input.rationale !== void 0) doc.rationale = input.rationale;
  await writeClient.create(doc);
  return { _id: draftId };
}
async function patchEmmaRail(id, patch) {
  const writeClient = getClient(true);
  if (!writeClient) throw new Error("Sanity not configured");
  const set = { ...patch };
  if (patch.productHandles) {
    set.productHandles = patch.productHandles.map((handle, i) => ({
      _type: "productRef",
      _key: `ph-${i}-${Math.random().toString(36).slice(2, 8)}`,
      handle
    }));
  }
  await writeClient.patch(id).set(set).commit();
  invalidateCache("sanity:homepage");
}
async function publishEmmaRailDraft(draftId) {
  const writeClient = getClient(true);
  if (!writeClient) throw new Error("Sanity not configured");
  if (!draftId.startsWith("drafts.")) {
    await writeClient.patch(draftId).set({ status: "live" }).commit();
    invalidateCache("sanity:homepage");
    return { _id: draftId };
  }
  const publishedId = draftId.slice("drafts.".length);
  const draft = await writeClient.getDocument(draftId);
  if (!draft) throw new Error(`Draft not found: ${draftId}`);
  const { _id: _omit, _rev: _omitRev, ...rest } = draft;
  await writeClient.transaction().createOrReplace({ ...rest, _id: publishedId, status: "live" }).delete(draftId).commit();
  invalidateCache("sanity:homepage");
  return { _id: publishedId };
}
async function addRailRefToHomepage(railId) {
  const writeClient = getClient(true);
  if (!writeClient) throw new Error("Sanity not configured");
  await writeClient.createIfNotExists({
    _id: "singleton.homepage",
    _type: "homepageSections",
    sections: []
  });
  await writeClient.patch("singleton.homepage").setIfMissing({ sections: [] }).append("sections", [{
    _type: "emmaCuratedRailRef",
    _key: `rail-${railId}-${Date.now()}`,
    _ref: railId
  }]).commit();
  invalidateCache("sanity:homepage");
}
async function addRailRefToProductPage(handle, railId) {
  const writeClient = getClient(true);
  if (!writeClient) throw new Error("Sanity not configured");
  const doc = await writeClient.fetch(
    `*[_type == "productPage" && shopifyHandle == $handle][0]{ _id }`,
    { handle }
  );
  if (!doc) throw new Error(`No productPage for handle "${handle}"`);
  await writeClient.patch(doc._id).setIfMissing({ contentBlocks: [] }).append("contentBlocks", [{
    _type: "emmaCuratedRailRef",
    _key: `rail-${railId}-${Date.now()}`,
    _ref: railId
  }]).commit();
}
async function removeRailRefFromHomepage(railId) {
  const writeClient = getClient(true);
  if (!writeClient) throw new Error("Sanity not configured");
  await writeClient.patch("singleton.homepage").unset([`sections[_ref=="${railId}"]`]).commit();
  invalidateCache("sanity:homepage");
}
async function getRailsByDealId(dealId, opts) {
  if (!projectId) return [];
  const writeClient = getClient(true);
  if (!writeClient) return [];
  let filter = `_type == "emmaCuratedRail" && sourceDealId == $dealId && !(_id in path("drafts.**"))`;
  if (opts?.target) filter += ` && target == "${opts.target}"`;
  if (opts?.status) filter += ` && status == "${opts.status}"`;
  return writeClient.fetch(
    `*[${filter}]{ _id, target, status }`,
    { dealId }
  );
}
async function archiveHomepageRailsForDeal(dealId) {
  const writeClient = getClient(true);
  if (!writeClient) return { archived: [] };
  const homepageTargeted = await getRailsByDealId(dealId, { target: "homepage", status: "live" });
  const allLiveForDeal = await getRailsByDealId(dealId, { status: "live" });
  const homepageRefIds = await writeClient.fetch(
    `*[_id == "singleton.homepage"][0].sections[defined(_ref)]._ref`
  ).catch(() => []);
  const homepageRefSet = new Set(homepageRefIds);
  const leaked = allLiveForDeal.filter((r) => homepageRefSet.has(r._id) && !homepageTargeted.find((h) => h._id === r._id));
  const toArchive = [...homepageTargeted, ...leaked];
  if (!toArchive.length) return { archived: [] };
  const archived = [];
  for (const r of toArchive) {
    try {
      await writeClient.patch(r._id).set({ status: "archived", active: false }).commit();
      await removeRailRefFromHomepage(r._id);
      archived.push(r._id);
    } catch (err) {
      console.error("[sanity] archiveHomepageRailsForDeal failed for", r._id, err);
    }
  }
  invalidateCache("sanity:homepage");
  return { archived };
}
async function unarchiveHomepageRailsForDeal(dealId) {
  const writeClient = getClient(true);
  if (!writeClient) return { unarchived: [] };
  const rails = await getRailsByDealId(dealId, { target: "homepage", status: "archived" });
  if (!rails.length) return { unarchived: [] };
  const unarchived = [];
  for (const r of rails) {
    try {
      await writeClient.patch(r._id).set({ status: "live", active: true }).commit();
      await addRailRefToHomepage(r._id);
      unarchived.push(r._id);
    } catch (err) {
      console.error("[sanity] unarchiveHomepageRailsForDeal failed for", r._id, err);
    }
  }
  invalidateCache("sanity:homepage");
  return { unarchived };
}
async function getRailDraftsForDeal(dealId) {
  if (!projectId) return [];
  const writeClient = getClient(true, false, "raw");
  if (!writeClient) return [];
  return writeClient.fetch(
    `*[_type == "emmaCuratedRail" && sourceDealId == $dealId] | order(generatedAt desc){
      _id, status, active, order, heading, eyebrow, emmaAside, target,
      "productHandles": productHandles[].handle,
      layout, bgStyle, ctaLink, ctaLabel, sourceDealId, generatedAt, rationale
    }`,
    { dealId }
  );
}
async function getProductHandlesForSitemap() {
  if (!projectId) return [];
  try {
    const client4 = getClient();
    if (!client4) return [];
    return await client4.fetch(
      `*[_type == "productPage" && defined(shopifyHandle)] | order(title asc) {
        "handle": shopifyHandle, _updatedAt
      }`
    );
  } catch (err) {
    console.error("[sanity] getProductHandlesForSitemap error:", err);
    return [];
  }
}
async function getHomeConfig() {
  if (!projectId) return null;
  return cached("sanity:home-config", 300, async () => {
    try {
      const client4 = getClient();
      if (!client4) return null;
      const raw = await client4.fetch(HOME_CONFIG_GROQ);
      if (!raw) return null;
      return {
        activeVariant: raw.activeVariant ?? "off",
        welcomeBackEnabled: raw.welcomeBackEnabled ?? true,
        emmaCopyOverrides: raw.emmaCopyOverrides ?? {},
        analyticsLabel: raw.analyticsLabel ?? ""
      };
    } catch (err) {
      console.error("[sanity] getHomeConfig error:", err);
      return null;
    }
  });
}
var CONTENT_BLOCKS_PROJECTION, projectId, dataset, apiVersion, SECTIONS_WITH_REFS_PROJECTION, HOMEPAGE_GROQ, EMMA_HERO_GROQ, EDITOR_GROQ, EMMA_PRESETS_GROQ, HOMEPAGE_DOC_ID, _blogCache, BLOG_CACHE_TTL, BLOG_CAT_CACHE_TTL, BLOG_POST_CARD_PROJECTION, HOME_CONFIG_GROQ;
var init_sanity_server = __esm({
  "app/lib/sanity.server.ts"() {
    "use strict";
    init_kv_server();
    init_tag_normalize();
    CONTENT_BLOCKS_PROJECTION = `
  _type, _key, active, order,
  // announcementBar
  messages, rotationIntervalMs, bgStyle,
  // promoBanner
  headline, subtext, ctaLabel, ctaLink, layout,
  "image": image{ "url": asset->url, alt },
  // editorialTiles
  eyebrow, heading,
  "tiles": tiles[]{
    label, body, link, linkLabel, emoji,
    "image": image{ "url": asset->url, alt }
  },
  // wayfinderMosaic \u2014 shares eyebrow/heading (above) plus its own emphasis word.
  // "tiles" above is editorialTiles-shaped (no _key) \u2014 wayfinderMosaic tiles need
  // _key (the image bridge addresses tiles by _key), so they get their own field
  // name to avoid colliding with the editorialTiles projection. select() keeps
  // every other block type null-safe.
  emphasis,
  "wayfinderTiles": select(
    _type == "wayfinderMosaic" => tiles[]{
      _key, label, link, emmaAside,
      "image": image{ "url": asset->url, alt }
    }
  ),
  "promo": select(
    _type == "wayfinderMosaic" => promo{
      eyebrow, heading, emphasis, body, ctaLabel, ctaLink,
      "image": image{ "url": asset->url, alt }
    }
  ),
  // categoryGrid + testimonials use inline item objects; trustBar uses references.
  // Keep them in separate fields \u2014 combining them via select() silently null-derefs
  // the trustBar references (GROQ quirk). TrustBarBlock reads trustItems.
  "items": select(
    _type == "categoryGrid" => items[]{ label, link, emoji, "image": image{ "url": asset->url, alt } },
    _type == "testimonials" => items[]{ quote, author, rating, verified }
  ),
  "trustItems": select(
    _type == "trustBar" => items[]->{ icon, headline, subheadline, active }
  ),
  columns,
  // productCarousel
  source, shopifyTag, collectionHandle,
  "productHandles": productHandles[]{ handle },
  productLimit, layout,
  // playTogetherBanner
  body, imagePosition,
  // brandLogoWall
  "logos": logos[]{ brand, emoji, link, "logo": logo{ "url": asset->url, alt } },
  // richText \u2014 resolve inline image assets; body is also used by playTogetherBanner (plain text)
  "body": select(
    _type == "richText" => body[]{ ..., _type == "image" => { ..., "asset": { "url": asset->url } } },
    body
  ),
  bgColor, maxWidth,
  // editorBio \u2014 dereference the editor singleton at query time so the block
  // always renders live data without a second round-trip.
  variant, headingOverride, hideLongBio, hideSocials, showCta,
  "editor": select(
    _type == "editorBio" => *[_id == "singleton.editor"][0]{
      name, role,
      "photoUrl": photo.asset->url,
      "photoAlt": photo.alt,
      shortBio, longBio,
      "picksSince": picksSince,
      instagram, email
    }
  ),
`;
    projectId = process.env["SANITY_PROJECT_ID"];
    dataset = process.env["SANITY_DATASET"] ?? "production";
    apiVersion = "2024-10-01";
    SECTIONS_WITH_REFS_PROJECTION = `
  sections[]{
    _key,
    ...select(
      // Named reference array items (e.g. emmaCuratedRailRef) store _type as the
      // custom name, not "reference" \u2014 so match by the presence of _ref instead.
      defined(_ref) => @->{
        _id, _type, active, order, heading, eyebrow, emmaAside, status, target,
        "productHandles": productHandles[]{ handle },
        layout, bgStyle, ctaLink, ctaLabel
      },
      { ${CONTENT_BLOCKS_PROJECTION} }
    )
  }[active == true && (status == "live" || !defined(status))]
`;
    HOMEPAGE_GROQ = `
  *[_id == "singleton.homepage"][0]{
    _id,
    "sections": ${SECTIONS_WITH_REFS_PROJECTION}
  }
`;
    EMMA_HERO_GROQ = `
{
  "settings": *[_id == "singleton.emmaHero"][0]{
    heroVariant, eyebrow, headline, body, aside, pullQuote, pairProductHandle
  },
  "cta": *[_id == "singleton.emmaHeroStorefront"][0]{
    primaryCtaLabel, primaryCtaLink, featuredProductHandle
  }
}
`;
    EDITOR_GROQ = `
  *[_id == "singleton.editor"][0]{
    name,
    role,
    "photoUrl": photo.asset->url,
    "photoAlt": photo.alt,
    shortBio,
    longBio,
    "picksSince": picksSince,
    instagram,
    email
  }
`;
    EMMA_PRESETS_GROQ = `
  *[_type == "emmaPreset"] | order(order asc, label asc){
    label, "slug": slug.current, narratorCopy, moodTags, audienceTags, mattersTags, priceMax, featured, order
  }
`;
    HOMEPAGE_DOC_ID = "singleton.homepage";
    _blogCache = /* @__PURE__ */ new Map();
    BLOG_CACHE_TTL = 6e4;
    BLOG_CAT_CACHE_TTL = 3e5;
    BLOG_POST_CARD_PROJECTION = `
  _id, title, "slug": slug.current, excerpt, publishedAt, featured,
  "heroImageUrl": heroImage.asset->url, heroImageAlt,
  "author": author->{ name, "slug": slug.current, bio, "avatarUrl": avatar.asset->url, role },
  "category": category->{ name, "slug": slug.current, color }
`;
    HOME_CONFIG_GROQ = `
  *[_id == "singleton.homeConfig"][0]{
    activeVariant,
    welcomeBackEnabled,
    emmaCopyOverrides,
    analyticsLabel
  }
`;
  }
});

// app/lib/feed-processor.server.ts
var feed_processor_server_exports = {};
__export(feed_processor_server_exports, {
  SECTION_VALUES: () => SECTION_VALUES,
  archiveDiscontinuedProducts: () => archiveDiscontinuedProducts,
  buildTags: () => buildTags,
  cleanDescription: () => cleanDescription,
  dailyFeedProcessor: () => dailyFeedProcessor,
  deriveSection: () => deriveSection,
  fetchNalpacFeed: () => fetchNalpacFeed,
  getPipelineSetting: () => getPipelineSetting,
  getSKUsNeedingImagen: () => getSKUsNeedingImagen,
  isDiscontinued: () => isDiscontinued,
  parseCategories: () => parseCategories,
  scoreProduct: () => scoreProduct
});
import { parse } from "csv-parse/sync";
import { sql as sql2, eq as eq4 } from "drizzle-orm";
async function getPipelineSetting(key) {
  try {
    const rows = await db.select({ value: pipelineSettings.value }).from(pipelineSettings).where(eq4(pipelineSettings.key, key)).limit(1);
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}
function cleanDescription(raw) {
  let clean = raw.replace(/(\w)ft\./g, "$1'");
  clean = clean.replace(/(?<!\d)in\./g, '"');
  return clean.replace(/\s+/g, " ").trim();
}
async function fetchNalpacFeed() {
  const cached2 = await kvGet(KV_KEYS.feedCache);
  if (cached2) return cached2;
  const feedUrl2 = await getPipelineSetting("feedUrl") || process.env["NALPAC_FEED_URL"] || "";
  if (!feedUrl2) throw new Error("No feed URL configured. Set NALPAC_FEED_URL env var or configure in Admin \u2192 Settings.");
  const res = await fetch(feedUrl2);
  if (!res.ok) throw new Error(`Feed fetch failed: ${res.status}`);
  const csv = await res.text();
  const records = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });
  await kvSet(KV_KEYS.feedCache, records, FEED_TTL);
  await kvSet(KV_KEYS.feedCacheTimestamp, (/* @__PURE__ */ new Date()).toISOString());
  return records;
}
function isDiscontinued(product) {
  const fields = [
    product["Sub-Category"] ?? "",
    product["Product Title"] ?? ""
  ];
  for (const f of fields) {
    if (/\bdiscontinued\b/i.test(f)) return true;
    if (/\b(DISC|DC)\b/.test(f)) return true;
  }
  const desc = product["Product Description"] ?? "";
  if (/\bdiscontinued by manufacturer\b/i.test(desc)) return true;
  if (/\bproduct (?:has been |is )?discontinued\b/i.test(desc)) return true;
  return false;
}
function parseCategories(raw) {
  return raw.split(",").map((c) => c.trim()).filter(Boolean);
}
function deriveSection(input) {
  const hay = [
    input.productType ?? "",
    (input.categories ?? []).join(" "),
    input.title ?? ""
  ].join(" ").toLowerCase();
  for (const { section, words } of SECTION_KEYWORDS) {
    if (words.some((w) => hay.includes(w))) return section;
  }
  const dial = (input.productTypeDial ?? "").toLowerCase();
  if (dial === "lube" || dial === "massage" || dial === "enhancer" || dial === "wellness" || dial === "condom") return "body";
  if (dial === "wear") return "wear";
  return "pleasure";
}
function getImages(product) {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => product[`Image ${i}`]).filter(Boolean);
}
function flagForImagenGeneration(sku) {
  SKU_NEEDS_IMAGEN.add(sku);
}
function getSKUsNeedingImagen() {
  return [...SKU_NEEDS_IMAGEN];
}
function isEligible2(product, recentSkus, blockedBrands) {
  const qty = parseInt(product["Total qty available"] ?? "0");
  const wholesale = parseFloat(product["Wholesale"] ?? "0");
  const msrp = parseFloat(product["MSRP"] ?? "0");
  const brandBlocked = blockedBrands.has(product.Brand.toLowerCase().trim());
  return qty >= 20 && wholesale > 0 && msrp > 0 && !recentSkus.has(product.SKU) && !brandBlocked;
}
function scoreProduct(product, recentSkus, recentCategories, blockedBrands = /* @__PURE__ */ new Set()) {
  if (!isEligible2(product, recentSkus, blockedBrands)) return null;
  const wholesale = parseFloat(product["Wholesale"]);
  const msrp = parseFloat(product["MSRP"]);
  const map = parseFloat(product["MAP"] ?? "0") || 0;
  const qty = parseInt(product["Total qty available"]);
  const images = getImages(product);
  const categories = parseCategories(product["Sub-Category"]);
  const profScore = (msrp - wholesale) / msrp;
  let dealScore;
  let dealPrice;
  let discountPct;
  let mapType;
  if (map === 0) {
    dealPrice = Math.max(wholesale * 1.4, msrp * 0.55);
    discountPct = (msrp - dealPrice) / msrp * 100;
    dealScore = 1;
    mapType = "no-map";
  } else if (map < msrp) {
    dealPrice = map;
    discountPct = (msrp - map) / msrp * 100;
    dealScore = Math.min(discountPct / 30, 1);
    mapType = "below-msrp";
  } else {
    dealPrice = msrp;
    discountPct = 0;
    dealScore = 0.05;
    mapType = "equals-msrp";
  }
  const invScore = qty < 50 ? 0.4 : qty <= 250 ? 1 : qty <= 600 ? 0.8 : 0.65;
  if (images.length < 3) flagForImagenGeneration(product.SKU);
  const imgScore = Math.min(images.length / 8, 1);
  const overlap = categories.filter(
    (c) => recentCategories.flat().includes(c)
  ).length;
  const catScore = Math.pow(0.7, overlap);
  const score2 = profScore * 0.35 + dealScore * 0.3 + invScore * 0.2 + imgScore * 0.1 + catScore * 0.05;
  return {
    sku: product.SKU,
    title: cleanDescription(product["Product Title"]),
    brand: product.Brand,
    description: cleanDescription(product["Product Description"] ?? ""),
    score: score2,
    msrp: Math.round(msrp * 100) / 100,
    wholesaleCost: Math.round(wholesale * 100) / 100,
    mapPrice: Math.round(map * 100) / 100,
    dealPrice: Math.round(dealPrice * 100) / 100,
    discountPct: Math.round(discountPct * 10) / 10,
    profitPerUnit: Math.round((dealPrice - wholesale) * 100) / 100,
    qty,
    mapType,
    images,
    categories
  };
}
async function dailyFeedProcessor() {
  const [products, history, blockedBrandsSetting] = await Promise.all([
    fetchNalpacFeed(),
    db.select({
      sku: dealHistory.sku,
      categories: dealHistory.categories
    }).from(dealHistory).orderBy(sql2`${dealHistory.dealDate} DESC`).limit(90),
    getPipelineSetting("blockedBrands")
  ]);
  const recentSkus = new Set(history.map((h) => h.sku));
  const recentCategories = history.map((h) => h.categories ?? []);
  const blockedBrands = new Set(
    (blockedBrandsSetting ?? "").split(",").map((b) => b.toLowerCase().trim()).filter(Boolean)
  );
  const discontinuedSkus = [];
  const eligibleProducts = [];
  for (const p of products) {
    if (isDiscontinued(p)) {
      discontinuedSkus.push(p.SKU);
    } else {
      eligibleProducts.push(p);
    }
  }
  const scores = eligibleProducts.map((p) => scoreProduct(p, recentSkus, recentCategories, blockedBrands)).filter((s) => s !== null).sort((a, b) => b.score - a.score);
  const topCandidates = scores.slice(0, 30);
  await kvSet("feed:top-candidates", topCandidates, FEED_TTL);
  const discontinuedSweep = await archiveDiscontinuedProducts(discontinuedSkus);
  console.info(
    `[feed-processor] discontinued sweep: ${discontinuedSweep.flagged} flagged, ${discontinuedSweep.archived} archived, ${discontinuedSweep.alreadyArchived} already-archived, ${discontinuedSweep.notImported} not-imported, ${discontinuedSweep.errors.length} errors`
  );
  return {
    topCandidates,
    needsImagen: getSKUsNeedingImagen(),
    discontinuedSkus,
    discontinuedSweep
  };
}
async function archiveDiscontinuedProducts(skus) {
  const result = {
    flagged: skus.length,
    archived: 0,
    alreadyArchived: 0,
    notImported: 0,
    errors: []
  };
  if (skus.length === 0) return result;
  const { archiveShopifyProduct: archiveShopifyProduct2 } = await Promise.resolve().then(() => (init_shopify_server(), shopify_server_exports));
  const { upsertProductPage: upsertProductPage2 } = await Promise.resolve().then(() => (init_sanity_server(), sanity_server_exports)).catch(() => ({ upsertProductPage: null }));
  for (const sku of skus) {
    try {
      const rows = await db.select({
        shopifyProductId: dealHistory.shopifyProductId,
        status: dealHistory.status
      }).from(dealHistory).where(eq4(dealHistory.sku, sku)).limit(1);
      const row = rows[0];
      if (!row) {
        result.notImported++;
        continue;
      }
      if (row.status === "archived") {
        result.alreadyArchived++;
        continue;
      }
      if (!row.shopifyProductId) {
        result.errors.push({ sku, message: "dealHistory row has no shopifyProductId \u2014 cannot archive" });
        continue;
      }
      const archived = await archiveShopifyProduct2(row.shopifyProductId, "discontinued by manufacturer");
      await db.update(dealHistory).set({ status: "archived" }).where(eq4(dealHistory.sku, sku));
      if (upsertProductPage2 && archived?.handle) {
        try {
          await upsertProductPage2({
            handle: archived.handle,
            shopifyProductId: `gid://shopify/Product/${row.shopifyProductId}`,
            archived: true
          });
        } catch (err) {
          console.warn(`[feed-processor] archive-discontinued: sanity sync ${sku} failed:`, err instanceof Error ? err.message : err);
        }
      }
      result.archived++;
    } catch (err) {
      result.errors.push({ sku, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
function buildTags(product) {
  const cats = parseCategories(product["Sub-Category"]);
  const tags = cats.map((c) => `cat:${c.toLowerCase().replace(/\s+/g, "-")}`);
  const forHimCats = ["Vagina Strokers", "Body Molds", "Prostate Toys", "Masturbators", "Hands-Free Masturbators"];
  const forHerCats = ["Dual Action and Rabbits", "Finger and Clit", "Air Pulse and Suction", "Bullets and Eggs"];
  const coupleCats = ["Couples and Wearable", "Remote", "Top Couples Toys", "Restraints"];
  if (cats.some((c) => forHimCats.includes(c))) tags.push("for-him");
  if (cats.some((c) => forHerCats.includes(c))) tags.push("for-her");
  if (cats.some((c) => coupleCats.includes(c))) tags.push("for-couples");
  tags.push(`brand:${product.Brand.toLowerCase().replace(/\s+/g, "-")}`);
  tags.push(`nalpac-sku-${product.SKU}`);
  const price = parseFloat(product["MSRP"]);
  tags.push(
    price < 25 ? "price:under-25" : price < 50 ? "price:25-50" : price < 100 ? "price:50-100" : "price:100-plus"
  );
  return tags;
}
var FEED_TTL, SECTION_VALUES, SECTION_KEYWORDS, SKU_NEEDS_IMAGEN;
var init_feed_processor_server = __esm({
  "app/lib/feed-processor.server.ts"() {
    "use strict";
    init_kv_server();
    init_db_server();
    init_schema();
    FEED_TTL = 23 * 60 * 60;
    SECTION_VALUES = ["pleasure", "play", "body", "wear"];
    SECTION_KEYWORDS = [
      { section: "play", words: ["bondage", "bdsm", "restraint", "handcuff", "cuff", "paddle", "flogger", "whip", "crop", "gag", "blindfold", "collar", "leash", "chastity", "cage", "harness", "strap-on", "strapon", "rope", "shibari", "spank", "kink", "fetish play", "role-play", "roleplay", "role play", "furniture", "sling", "swing", "wartenberg", "nipple clamp", "clamp", "electrostim", "e-stim", "game"] },
      { section: "wear", words: ["lingerie", "babydoll", "chemise", "bodysuit", "bodystocking", "teddy", "corset", "bustier", "garter", "stocking", "hosiery", "fishnet", "pasties", "pasty", "panty", "pantie", "thong", "g-string", "bra ", "bra-", "bra set", "underwear", "boxer", "brief", "jock", "apparel", "dress", "robe", "kimono", "fetishwear", "leatherwear", "costume"] },
      { section: "body", words: ["lubricant", "lube", "massage oil", "massage candle", "candle", "arousal", "desensitiz", "enhancer", "oral enhancer", "cleaner", "toy cleaner", "pheromone", "wipe", "hygiene", "douche", "enema", "kegel", "extender", "cbd", "supplement", " pill", "gummies", "gummy", "gel", "cream", "lotion", "balm", "spray", "oil", "powder", "edible body"] }
    ];
    SKU_NEEDS_IMAGEN = /* @__PURE__ */ new Set();
  }
});

// app/lib/klaviyo.server.ts
var klaviyo_server_exports = {};
__export(klaviyo_server_exports, {
  getProfileByEmail: () => getProfileByEmail,
  getProfileSubscriptions: () => getProfileSubscriptions,
  subscribeToDailyDeal: () => subscribeToDailyDeal,
  subscribeToList: () => subscribeToList,
  subscribeToWaitlist: () => subscribeToWaitlist,
  syncWishlistProfileProperty: () => syncWishlistProfileProperty,
  trackEvent: () => trackEvent,
  trackReviewApproved: () => trackReviewApproved,
  trackReviewInviteSent: () => trackReviewInviteSent,
  trackReviewReminderSent: () => trackReviewReminderSent,
  trackReviewSubmitted: () => trackReviewSubmitted,
  trackWishlistAdded: () => trackWishlistAdded,
  trackWishlistRemoved: () => trackWishlistRemoved,
  triggerDailyDealEmail: () => triggerDailyDealEmail,
  unsubscribeAll: () => unsubscribeAll,
  unsubscribeFromList: () => unsubscribeFromList,
  updatePreferences: () => updatePreferences,
  updateProfileProperties: () => updateProfileProperties
});
async function klaviyoFetch(path, method = "GET", body) {
  const init2 = {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      revision: "2024-10-15",
      Authorization: `Klaviyo-API-Key ${process.env["KLAVIYO_API_KEY"]}`
    }
  };
  if (body) init2.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, init2);
  if (!res.ok) {
    const text3 = await res.text();
    throw new Error(`Klaviyo API error ${res.status}: ${text3}`);
  }
  if (res.status === 204 || res.status === 202) return {};
  const text2 = await res.text();
  if (!text2) return {};
  return JSON.parse(text2);
}
async function subscribeToList(listId, email, firstName) {
  const profileAttrs = {
    email,
    subscriptions: {
      email: { marketing: { consent: "SUBSCRIBED" } }
    }
  };
  if (firstName) profileAttrs.first_name = firstName;
  await klaviyoFetch("/profile-subscription-bulk-create-jobs/", "POST", {
    data: {
      type: "profile-subscription-bulk-create-job",
      attributes: {
        profiles: {
          data: [{ type: "profile", attributes: profileAttrs }]
        }
      },
      relationships: {
        list: { data: { type: "list", id: listId } }
      }
    }
  });
}
async function subscribeToDailyDeal(email, firstName) {
  const listId = process.env["KLAVIYO_LIST_ID_DAILY_DEAL"];
  await subscribeToList(listId, email, firstName);
}
async function subscribeToWaitlist(email, productHandle) {
  const listId = process.env["KLAVIYO_LIST_ID_WAITLIST"];
  await klaviyoFetch("/profile-subscription-bulk-create-jobs/", "POST", {
    data: {
      type: "profile-subscription-bulk-create-job",
      attributes: {
        profiles: {
          data: [{
            type: "profile",
            attributes: {
              email,
              subscriptions: {
                email: { marketing: { consent: "SUBSCRIBED" } }
              }
            }
          }]
        }
      },
      relationships: {
        list: { data: { type: "list", id: listId } }
      }
    }
  });
  await trackEvent(email, "Waitlist Signup", { product_handle: productHandle });
}
async function trackEvent(email, eventName, properties) {
  await klaviyoFetch("/events/", "POST", {
    data: {
      type: "event",
      attributes: {
        metric: { data: { type: "metric", attributes: { name: eventName } } },
        profile: { data: { type: "profile", attributes: { email } } },
        properties
      }
    }
  });
}
async function trackReviewSubmitted(params) {
  await trackEvent(params.email, "Review Submitted", {
    reviewer_name: params.reviewerName,
    shopify_product_id: params.shopifyProductId,
    rating: params.rating,
    review_id: params.reviewId,
    is_verified_purchase: params.isVerifiedPurchase,
    submitted_at: (/* @__PURE__ */ new Date()).toISOString()
  });
}
async function trackReviewApproved(params) {
  await trackEvent(params.email, "Review Approved", {
    reviewer_name: params.reviewerName,
    shopify_product_id: params.shopifyProductId,
    review_id: params.reviewId,
    approved_at: (/* @__PURE__ */ new Date()).toISOString()
  });
}
async function trackReviewInviteSent(params) {
  await trackEvent(params.email, "Review Invite Sent", {
    reviewer_name: params.reviewerName,
    shopify_product_id: params.shopifyProductId,
    shopify_order_id: params.shopifyOrderId,
    invite_token: params.inviteToken,
    invite_url: `https://xdipx.com/api/reviews/invite/${params.inviteToken}`,
    sent_at: (/* @__PURE__ */ new Date()).toISOString()
  });
}
async function trackReviewReminderSent(params) {
  await trackEvent(params.email, "Review Reminder Sent", {
    reviewer_name: params.reviewerName,
    shopify_product_id: params.shopifyProductId,
    invite_token: params.inviteToken,
    invite_url: `https://xdipx.com/api/reviews/invite/${params.inviteToken}`,
    reminder_at: (/* @__PURE__ */ new Date()).toISOString()
  });
}
async function triggerDailyDealEmail(deal) {
  await klaviyoFetch("/events/", "POST", {
    data: {
      type: "event",
      attributes: {
        metric: { data: { type: "metric", attributes: { name: "Daily Deal Activated" } } },
        profile: { data: { type: "profile", attributes: { email: "broadcast@xdipx.com" } } },
        properties: { ...deal }
      }
    }
  });
}
function knownListIds() {
  const ids = [
    process.env["KLAVIYO_LIST_ID_DAILY_DEAL"],
    process.env["KLAVIYO_LIST_ID_WAITLIST"]
  ];
  return ids.filter((id) => !!id);
}
async function getProfileByEmail(email) {
  try {
    const filter = `equals(email,"${email}")`;
    const path = `/profiles/?filter=${encodeURIComponent(filter)}`;
    const res = await klaviyoFetch(path, "GET");
    const first = res.data?.[0];
    return first ? { id: first.id } : null;
  } catch (err) {
    console.error("[klaviyo.getProfileByEmail] failed:", err);
    return null;
  }
}
async function getProfileSubscriptions(email) {
  const known = knownListIds();
  if (known.length === 0) return [];
  const profile = await getProfileByEmail(email);
  if (!profile) {
    return known.map((listId) => ({ listId, subscribed: false }));
  }
  try {
    const res = await klaviyoFetch(`/profiles/${profile.id}/relationships/lists/`, "GET");
    const memberships = new Set((res.data ?? []).map((d) => d.id));
    return known.map((listId) => ({
      listId,
      subscribed: memberships.has(listId)
    }));
  } catch (err) {
    console.error("[klaviyo.getProfileSubscriptions] failed:", err);
    return known.map((listId) => ({ listId, subscribed: false }));
  }
}
async function unsubscribeFromList(listId, email) {
  await klaviyoFetch("/profile-subscription-bulk-delete-jobs/", "POST", {
    data: {
      type: "profile-subscription-bulk-delete-job",
      attributes: {
        profiles: {
          data: [{ type: "profile", attributes: { email } }]
        }
      },
      relationships: {
        list: { data: { type: "list", id: listId } }
      }
    }
  });
}
async function updatePreferences(email, updates) {
  for (const { listId, subscribed } of updates) {
    try {
      if (subscribed) {
        await subscribeToList(listId, email);
      } else {
        await unsubscribeFromList(listId, email);
      }
    } catch (err) {
      console.error(
        `[klaviyo.updatePreferences] failed for list=${listId} subscribed=${subscribed}:`,
        err
      );
    }
  }
}
async function unsubscribeAll(email) {
  for (const listId of knownListIds()) {
    try {
      await unsubscribeFromList(listId, email);
    } catch (err) {
      console.error(
        `[klaviyo.unsubscribeAll] failed for list=${listId}:`,
        err
      );
    }
  }
}
async function updateProfileProperties(email, properties) {
  try {
    const profile = await getProfileByEmail(email);
    if (!profile) {
      console.warn("[klaviyo.updateProfileProperties] no profile found for", email);
      return;
    }
    await klaviyoFetch(`/profiles/${profile.id}/`, "PATCH", {
      data: {
        type: "profile",
        id: profile.id,
        attributes: { properties }
      }
    });
  } catch (err) {
    console.error("[klaviyo.updateProfileProperties] failed:", err);
  }
}
async function trackWishlistAdded(email, item) {
  try {
    await trackEvent(email, "Added to Wishlist", {
      product_handle: item.productHandle,
      product_title: item.productTitle ?? null,
      price: item.price ?? null,
      list_name: item.listName ?? null,
      added_at: (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (err) {
    console.error("[klaviyo.trackWishlistAdded] failed:", err);
  }
}
async function trackWishlistRemoved(email, item) {
  try {
    await trackEvent(email, "Removed from Wishlist", {
      product_handle: item.productHandle,
      list_name: item.listName ?? null,
      removed_at: (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (err) {
    console.error("[klaviyo.trackWishlistRemoved] failed:", err);
  }
}
async function syncWishlistProfileProperty(email, handles) {
  try {
    const profile = await getProfileByEmail(email);
    if (!profile) {
      console.warn("[klaviyo.syncWishlistProfileProperty] no profile found for", email);
      return;
    }
    await klaviyoFetch(`/profiles/${profile.id}/`, "PATCH", {
      data: {
        type: "profile",
        id: profile.id,
        attributes: {
          properties: {
            wishlist_handles: handles,
            wishlist_count: handles.length
          }
        }
      }
    });
  } catch (err) {
    console.error("[klaviyo.syncWishlistProfileProperty] failed:", err);
  }
}
var BASE;
var init_klaviyo_server = __esm({
  "app/lib/klaviyo.server.ts"() {
    "use strict";
    BASE = "https://a.klaviyo.com/api";
  }
});

// app/lib/models.server.ts
var SONNET;
var init_models_server = __esm({
  "app/lib/models.server.ts"() {
    "use strict";
    SONNET = "claude-sonnet-4-6";
  }
});

// app/lib/seo-keywords.server.ts
import { createClient as createClient2 } from "@sanity/client";
function getReadClient() {
  if (!projectId2) return null;
  return createClient2({
    projectId: projectId2,
    dataset: dataset2,
    apiVersion: apiVersion2,
    useCdn: true,
    token: process.env["SANITY_API_TOKEN"],
    perspective: "published"
  });
}
function score(k) {
  const rel = k.relevanceScore ?? 0.5;
  const vol = k.volume ?? 0;
  const diff = k.difficulty ?? 50;
  return rel * Math.log(vol + 1) / (1 + diff / 100);
}
async function fetchCandidates(input) {
  const client4 = getReadClient();
  if (!client4) return [];
  const productType = input.productType ?? null;
  const moods = input.moods ?? [];
  const audiences = input.audiences ?? [];
  const matters = input.matters ?? [];
  const contentType = input.contentType;
  const groq = `
    *[_type == "seoKeyword" && status == "approved" && flagged != true && (
      // Content type matches or is "any" / unspecified
      !defined(contentTypes) || count(contentTypes) == 0 ||
      "any" in contentTypes || $contentType in contentTypes
    ) && (
      (
        // No taxonomy tags at all = general-purpose, always eligible
        (!defined(productTypeDials) || count(productTypeDials) == 0) &&
        (!defined(moodTags)         || count(moodTags) == 0) &&
        (!defined(audienceTags)     || count(audienceTags) == 0) &&
        (!defined(mattersTags)      || count(mattersTags) == 0)
      ) || (
        // Or shares at least one tag with the input.
        // Note: GROQ rejects "??" coalesce inside count() ("expected ')'
        // following parenthesized expression"). Use defined() guards instead.
        ($productType != null && defined(productTypeDials) && count(productTypeDials[@ == $productType]) > 0) ||
        (defined(moodTags)     && count(moodTags[@ in $moods])         > 0) ||
        (defined(audienceTags) && count(audienceTags[@ in $audiences]) > 0) ||
        (defined(mattersTags)  && count(mattersTags[@ in $matters])    > 0)
      )
    )]{ ${KEYWORD_PROJECTION} }
  `;
  try {
    return await client4.fetch(groq, {
      contentType,
      productType,
      moods,
      audiences,
      matters
    }) ?? [];
  } catch (err) {
    console.error("[seo-keywords] fetchCandidates error:", err);
    return [];
  }
}
async function fetchAvoidList() {
  const client4 = getReadClient();
  if (!client4) return [];
  try {
    const rows = await client4.fetch(
      `*[_type == "seoKeyword" && (status == "rejected" || flagged == true)]{ term }`
    );
    return (rows ?? []).map((r) => r.term).filter(Boolean);
  } catch {
    return [];
  }
}
function cacheKey2(input) {
  const sortedMoods = [...input.moods ?? []].sort();
  const sortedAudiences = [...input.audiences ?? []].sort();
  const sortedMatters = [...input.matters ?? []].sort();
  const parts = [
    "seo-kw:v1",
    input.contentType,
    input.productType ?? "none",
    sortedMoods.join(","),
    sortedAudiences.join(","),
    sortedMatters.join(","),
    input.topic ? input.topic.slice(0, 80).toLowerCase() : ""
  ];
  return parts.join("|");
}
function pickFromCandidates(candidates, count) {
  const sorted = [...candidates].sort((a, b) => score(b) - score(a));
  const used = /* @__PURE__ */ new Set();
  const take = (predicate, n) => {
    const out = [];
    for (const k of sorted) {
      if (out.length >= n) break;
      if (used.has(k._id)) continue;
      if (predicate(k)) {
        out.push(k);
        used.add(k._id);
      }
    }
    return out;
  };
  const primary = take((k) => k.kind === "head", count.primary)[0] ?? take(() => true, 1)[0] ?? null;
  const secondary = take((k) => k.kind === "long-tail" || k.intent === "commercial", count.secondary);
  const longTail = take((k) => k.kind === "long-tail", count.longTail);
  const questions = take((k) => k.kind === "question", count.questions);
  return { primary, secondary, longTail, questions, avoid: [] };
}
async function buildKeywordContext(input) {
  if (input.seoMode === "off") return EMPTY_CONTEXT;
  if (!projectId2) return EMPTY_CONTEXT;
  const counts = {
    primary: input.count?.primary ?? 1,
    secondary: input.count?.secondary ?? 4,
    longTail: input.count?.longTail ?? 8,
    questions: input.count?.questions ?? 3
  };
  const key = cacheKey2(input);
  return cached(key, 7 * 24 * 60 * 60, async () => {
    const [candidates, avoid] = await Promise.all([
      fetchCandidates(input),
      fetchAvoidList()
    ]);
    const ctx = pickFromCandidates(candidates, counts);
    return { ...ctx, avoid };
  });
}
function renderKeywordBlock(ctx) {
  if (!ctx.primary && ctx.secondary.length === 0 && ctx.longTail.length === 0 && ctx.questions.length === 0) {
    return "";
  }
  const lines = ["<keyword_targets>"];
  if (ctx.primary) {
    lines.push(`  <primary intent="${ctx.primary.intent ?? "unknown"}">${ctx.primary.term}</primary>`);
  }
  if (ctx.secondary.length) {
    lines.push("  <secondary>");
    for (const k of ctx.secondary) lines.push(`    - ${k.term}`);
    lines.push("  </secondary>");
  }
  if (ctx.longTail.length) {
    lines.push("  <long_tail>");
    for (const k of ctx.longTail) lines.push(`    - ${k.term}`);
    lines.push("  </long_tail>");
  }
  if (ctx.questions.length) {
    lines.push("  <questions>");
    for (const k of ctx.questions) lines.push(`    - ${k.term}`);
    lines.push("  </questions>");
  }
  if (ctx.avoid.length) {
    const trimmed = ctx.avoid.slice(0, 12);
    lines.push(`  <avoid>${trimmed.join(" | ")}</avoid>`);
  }
  lines.push("</keyword_targets>");
  return lines.join("\n");
}
async function buildKeywordBlock(input) {
  const ctx = await buildKeywordContext(input);
  return renderKeywordBlock(ctx);
}
var EMPTY_CONTEXT, projectId2, dataset2, apiVersion2, KEYWORD_PROJECTION;
var init_seo_keywords_server = __esm({
  "app/lib/seo-keywords.server.ts"() {
    "use strict";
    init_kv_server();
    EMPTY_CONTEXT = {
      primary: null,
      secondary: [],
      longTail: [],
      questions: [],
      avoid: []
    };
    projectId2 = process.env["SANITY_PROJECT_ID"];
    dataset2 = process.env["SANITY_DATASET"] ?? "production";
    apiVersion2 = "2024-10-01";
    KEYWORD_PROJECTION = `
  _id, term, kind, intent, volume, difficulty, relevanceScore,
  productTypeDials, moodTags, audienceTags, mattersTags, contentTypes,
  "cluster": cluster->{ "slug": slug.current, title, pillarTerm }
`;
  }
});

// app/lib/editorial-author.server.ts
import { createClient as createClient3 } from "@sanity/client";
function getReadClient2() {
  if (!projectId3) return null;
  return createClient3({
    projectId: projectId3,
    dataset: dataset3,
    apiVersion: apiVersion3,
    useCdn: true,
    token: process.env["SANITY_API_TOKEN"],
    perspective: "published"
  });
}
async function getEditorialAuthor(slug) {
  if (!slug) return null;
  return cached(`editorial-author:${slug}`, 300, async () => {
    const client4 = getReadClient2();
    if (!client4) return null;
    try {
      const doc = await client4.fetch(
        `*[_type == "editorialAuthor" && slug.current == $slug][0]{
          slug, name, personaSummary, voiceRules, keywordContentTypes, seoMode, active
        }`,
        { slug }
      );
      if (!doc?.name) return null;
      const isActive = doc.active !== false;
      if (!isActive) return null;
      return {
        slug,
        name: doc.name,
        personaSummary: doc.personaSummary,
        voiceRules: doc.voiceRules ?? [],
        keywordContentTypes: doc.keywordContentTypes ?? [],
        seoMode: doc.seoMode ?? "natural",
        active: isActive
      };
    } catch (err) {
      console.error("[editorial-author] fetch error:", err);
      return null;
    }
  });
}
var projectId3, dataset3, apiVersion3;
var init_editorial_author_server = __esm({
  "app/lib/editorial-author.server.ts"() {
    "use strict";
    init_kv_server();
    projectId3 = process.env["SANITY_PROJECT_ID"];
    dataset3 = process.env["SANITY_DATASET"] ?? "production";
    apiVersion3 = "2024-10-01";
  }
});

// app/lib/emma-rail-tools.server.ts
function toCandidate(p) {
  const candidate = {
    handle: p.handle,
    title: p.title,
    price: p.price,
    tags: p.tags?.slice(0, 12)
  };
  if (p.brand) candidate.brand = p.brand;
  if (p.category) candidate.category = p.category;
  if (p.audienceTags) candidate.audienceTags = p.audienceTags;
  if (p.moodTags) candidate.moodTags = p.moodTags;
  if (p.mattersTags) candidate.mattersTags = p.mattersTags;
  return candidate;
}
function createRailGenState(excludeHandles = []) {
  return {
    rails: [],
    pairingWhy: [],
    excludeHandles: new Set(excludeHandles)
  };
}
async function buildCandidatePool(deal, partner) {
  const audiences = [.../* @__PURE__ */ new Set([...deal.audienceTags ?? [], ...partner?.audienceTags ?? []])];
  const moods = [.../* @__PURE__ */ new Set([...deal.moodTags ?? [], ...partner?.moodTags ?? []])];
  const categories = [.../* @__PURE__ */ new Set([
    ...deal.category ?? [],
    ...partner?.category ?? []
  ])];
  const buckets = await Promise.all([
    ...audiences.slice(0, 3).map((t) => getProductsByTag(`audience-${t}`, 10).catch(() => [])),
    ...moods.slice(0, 3).map((t) => getProductsByTag(`mood-${t}`, 10).catch(() => [])),
    ...categories.map((c) => getProductsByTag(c, 15).catch(() => []))
  ]);
  const seen = new Set([deal.handle, partner?.handle].filter(Boolean));
  const pool = [];
  for (const bucket of buckets) {
    for (const p of bucket) {
      if (seen.has(p.handle)) continue;
      seen.add(p.handle);
      pool.push(toCandidate(p));
      if (pool.length >= 60) return pool;
    }
  }
  if (pool.length < 8) {
    const vault = await getProductsByTag("deal-status-archived", 40).catch(() => []);
    for (const p of vault) {
      if (seen.has(p.handle)) continue;
      seen.add(p.handle);
      pool.push(toCandidate(p));
      if (pool.length >= 60) break;
    }
  }
  return pool;
}
async function executeRailTool(name, input, state, pool) {
  switch (name) {
    case "list_candidate_pool":
      return { count: pool.length, products: pool };
    case "query_products_by_tag": {
      const limit = Math.min(Math.max(Number(input?.limit ?? 10), 1), 20);
      const products = await getProductsByTag(String(input?.tag ?? ""), limit);
      return {
        products: products.filter((p) => !state.excludeHandles.has(p.handle)).map(toCandidate)
      };
    }
    case "query_products_by_collection": {
      const limit = Math.min(Math.max(Number(input?.limit ?? 10), 1), 20);
      const products = await getCollectionProducts(String(input?.handle ?? ""), limit);
      return {
        products: products.filter((p) => !state.excludeHandles.has(p.handle)).map(toCandidate)
      };
    }
    case "inspect_products": {
      const handles = (Array.isArray(input?.handles) ? input.handles : []).map(String).slice(0, 8);
      const products = await getProductsByHandles(handles);
      return { products: products.map(toCandidate) };
    }
    case "propose_rail": {
      const target = input?.target === "pdp" ? "pdp" : "homepage";
      const handles = (Array.isArray(input?.productHandles) ? input.productHandles : []).map(String).filter((h) => !state.excludeHandles.has(h));
      if (handles.length < 2) {
        return { ok: false, error: "A rail needs at least 2 product handles after self-exclusion." };
      }
      const proposal = {
        target,
        heading: String(input?.heading ?? "").trim(),
        productHandles: handles.slice(0, 8),
        rationale: String(input?.rationale ?? "").trim()
      };
      if (input?.eyebrow) proposal.eyebrow = String(input.eyebrow).trim();
      if (input?.emmaAside) proposal.emmaAside = String(input.emmaAside).trim();
      if (input?.ctaLabel) proposal.ctaLabel = String(input.ctaLabel).trim();
      if (input?.ctaLink) proposal.ctaLink = String(input.ctaLink).trim();
      state.rails.push(proposal);
      return { ok: true, railIndex: state.rails.length - 1, target, handleCount: handles.length };
    }
    case "propose_pairing_why": {
      const accessoryProductId = String(input?.accessoryProductId ?? "").trim();
      const blurb = String(input?.blurb ?? "").trim();
      if (!accessoryProductId || !blurb) {
        return { ok: false, error: "accessoryProductId and blurb are both required." };
      }
      state.pairingWhy.push({ accessoryProductId, blurb });
      return { ok: true, count: state.pairingWhy.length };
    }
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}
var RAIL_TOOLS;
var init_emma_rail_tools_server = __esm({
  "app/lib/emma-rail-tools.server.ts"() {
    "use strict";
    init_shopify_server();
    RAIL_TOOLS = [
      {
        name: "list_candidate_pool",
        description: "Returns the pre-filtered catalog candidate pool for this deal \u2014 products that overlap with the deal's audience and mood tags. Start here. Each candidate has handle, title, brand, category, price, and tag facets.",
        input_schema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "query_products_by_tag",
        description: "Fetch products by Shopify tag. Use this if the candidate pool doesn't have what you need. Examples: 'audience-couples', 'mood-slow-burn', 'best-sellers', 'for-her'.",
        input_schema: {
          type: "object",
          properties: {
            tag: { type: "string", description: "Shopify tag string (without the tag: prefix)" },
            limit: { type: "number", description: "Max products to return (1\u201320)", default: 10 }
          },
          required: ["tag"]
        }
      },
      {
        name: "query_products_by_collection",
        description: "Fetch products from a Shopify collection by handle. Useful for thematic groupings. Examples: 'lubes', 'wearables', 'best-sellers', 'editor-picks'.",
        input_schema: {
          type: "object",
          properties: {
            handle: { type: "string", description: "Shopify collection handle" },
            limit: { type: "number", description: "Max products to return (1\u201320)", default: 10 }
          },
          required: ["handle"]
        }
      },
      {
        name: "inspect_products",
        description: "Fetch full details for specific product handles to verify before adding to a rail. Returns the same trimmed shape as the candidate pool.",
        input_schema: {
          type: "object",
          properties: {
            handles: { type: "array", items: { type: "string" }, description: "1\u20138 product handles" }
          },
          required: ["handles"]
        }
      },
      {
        name: "propose_rail",
        description: "Propose one rail. Call this 2\u20133 times total (typically 2 PDP rails + 1 homepage rail). Each rail must have 4\u20138 products, an Emma-voice aside, and a one-sentence rationale.",
        input_schema: {
          type: "object",
          properties: {
            target: { type: "string", enum: ["homepage", "pdp"], description: "Where this rail appears" },
            heading: { type: "string", description: "Rail heading shown to shoppers" },
            eyebrow: { type: "string", description: "Small caps label above the heading" },
            emmaAside: { type: "string", description: "Emma's first-person aside above the heading" },
            productHandles: {
              type: "array",
              items: { type: "string" },
              description: "4\u20138 Shopify product handles in display order"
            },
            rationale: { type: "string", description: "One sentence explaining why these products belong together" },
            ctaLabel: { type: "string", description: 'Optional CTA label (default "See all \u2192")' },
            ctaLink: { type: "string", description: "Optional CTA link (e.g. /collections/...)" }
          },
          required: ["target", "heading", "productHandles", "rationale"]
        }
      },
      {
        name: "propose_pairing_why",
        description: "Propose Emma-voice copy explaining why a specific accessory pairs with the primary deal. Call once per accessory in the deal's accessory_product_ids list.",
        input_schema: {
          type: "object",
          properties: {
            accessoryProductId: { type: "string", description: "The accessory product GID" },
            blurb: { type: "string", description: "One short sentence in Emma voice (\u2264120 chars)" }
          },
          required: ["accessoryProductId", "blurb"]
        }
      }
    ];
  }
});

// app/lib/emma-voice.server.ts
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
function slice(text2, startMarker, endMarker) {
  const start = text2.indexOf(startMarker);
  const end = text2.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`emma-voice.server: missing marker pair ${startMarker} / ${endMarker} in docs/emma-voice.md`);
  }
  return text2.slice(start + startMarker.length, end).trim();
}
var __dirname, CHARTER_CANDIDATES, charterPath, charter, EMMA_VOICE_CORE, MARKETING_ADDENDUM, ENRICHMENT_ADDENDUM, CONVERSATIONAL_ADDENDUM, SUPPORT_ADDENDUM, EMMA_VOICE_MARKETING, EMMA_VOICE_ENRICHMENT, EMMA_VOICE_CONVERSATIONAL, EMMA_VOICE_SUPPORT;
var init_emma_voice_server = __esm({
  "app/lib/emma-voice.server.ts"() {
    "use strict";
    __dirname = dirname(fileURLToPath(import.meta.url));
    CHARTER_CANDIDATES = [
      resolve(process.cwd(), "docs/emma-voice.md"),
      resolve(__dirname, "../../docs/emma-voice.md"),
      resolve(__dirname, "../docs/emma-voice.md")
    ];
    charterPath = CHARTER_CANDIDATES.find((p) => existsSync(p));
    if (!charterPath) {
      throw new Error(`emma-voice.server: docs/emma-voice.md not found; tried ${CHARTER_CANDIDATES.join(", ")}`);
    }
    charter = readFileSync(charterPath, "utf-8");
    EMMA_VOICE_CORE = slice(charter, "<!-- core:start -->", "<!-- core:end -->");
    MARKETING_ADDENDUM = slice(charter, "<!-- addendum:marketing:start -->", "<!-- addendum:marketing:end -->");
    ENRICHMENT_ADDENDUM = slice(charter, "<!-- addendum:enrichment:start -->", "<!-- addendum:enrichment:end -->");
    CONVERSATIONAL_ADDENDUM = slice(charter, "<!-- addendum:conversational:start -->", "<!-- addendum:conversational:end -->");
    SUPPORT_ADDENDUM = slice(charter, "<!-- addendum:support:start -->", "<!-- addendum:support:end -->");
    EMMA_VOICE_MARKETING = `${EMMA_VOICE_CORE}

${MARKETING_ADDENDUM}`;
    EMMA_VOICE_ENRICHMENT = `${EMMA_VOICE_CORE}

${ENRICHMENT_ADDENDUM}`;
    EMMA_VOICE_CONVERSATIONAL = `${EMMA_VOICE_CORE}

${CONVERSATIONAL_ADDENDUM}`;
    EMMA_VOICE_SUPPORT = `${EMMA_VOICE_CORE}

${SUPPORT_ADDENDUM}`;
  }
});

// app/lib/model-pricing.server.ts
var model_pricing_server_exports = {};
__export(model_pricing_server_exports, {
  estimateCostUsd: () => estimateCostUsd,
  estimateImageCostUsd: () => estimateImageCostUsd
});
function estimateCostUsd(args) {
  if (args.source === "agent-sdk") return 0;
  const r = RATES[args.model] ?? DEFAULT_RATE;
  const mult = args.source === "batch" ? 0.5 : 1;
  const perTok = (rate) => rate * mult / 1e6;
  const cost = args.inputTokens * perTok(r.input) + args.outputTokens * perTok(r.output) + args.cacheCreationTokens * perTok(r.input * 1.25) + args.cacheReadTokens * perTok(r.input * 0.1);
  return Math.round(cost * 1e5) / 1e5;
}
function estimateImageCostUsd(model, count) {
  const per = IMAGE_RATES[model] ?? DEFAULT_IMAGE_RATE;
  const cost = per * Math.max(0, count);
  return Math.round(cost * 1e5) / 1e5;
}
var RATES, DEFAULT_RATE, IMAGE_RATES, DEFAULT_IMAGE_RATE;
var init_model_pricing_server = __esm({
  "app/lib/model-pricing.server.ts"() {
    "use strict";
    RATES = {
      "claude-sonnet-4-20250514": { input: 3, output: 15 },
      "claude-sonnet-4-6": { input: 3, output: 15 },
      // legacy alias used by ai-agent/chat
      "claude-haiku-4-5-20251001": { input: 1, output: 5 }
    };
    DEFAULT_RATE = { input: 3, output: 15 };
    IMAGE_RATES = {
      "fal/flux-schnell": 3e-3,
      "fal/flux-dev": 0.025,
      "fal/flux-pro": 0.05,
      "fal/flux-kontext": 0.04,
      // FLUX.1 Kontext [pro] image-to-image
      "fal/flux-kontext-dev": 0.025,
      // FLUX.1 Kontext [dev] image-to-image (product refs; safety checker off)
      "fal/nano-banana": 0.039,
      // fal's Gemini-flash-image endpoint
      "imagen": 0.04,
      // Google Vertex gemini-2.5-flash-image
      "imagen-3": 0.04
    };
    DEFAULT_IMAGE_RATE = 0.04;
  }
});

// app/lib/token-log.server.ts
var token_log_server_exports = {};
__export(token_log_server_exports, {
  getDailyTokenRollup: () => getDailyTokenRollup,
  getTokenCallDetail: () => getTokenCallDetail,
  logApiTokens: () => logApiTokens,
  logImageCost: () => logImageCost
});
async function logApiTokens(entry) {
  try {
    const { db: db2 } = await Promise.resolve().then(() => (init_db_server(), db_server_exports));
    const { apiTokenLog: apiTokenLog2 } = await Promise.resolve().then(() => (init_schema(), schema_exports));
    const { estimateCostUsd: estimateCostUsd2 } = await Promise.resolve().then(() => (init_model_pricing_server(), model_pricing_server_exports));
    const cacheCreation = entry.cacheCreationTokens ?? 0;
    const cacheRead = entry.cacheReadTokens ?? 0;
    const cost = estimateCostUsd2({
      model: entry.model,
      source: entry.source,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheCreationTokens: cacheCreation,
      cacheReadTokens: cacheRead
    });
    await db2.insert(apiTokenLog2).values({
      feature: entry.feature,
      model: entry.model,
      source: entry.source,
      batchId: entry.batchId ?? null,
      productId: entry.productId ?? null,
      sku: entry.sku ?? null,
      caller: entry.caller ?? null,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheCreationTokens: cacheCreation,
      cacheReadTokens: cacheRead,
      requestCount: entry.requestCount ?? 1,
      estCostUsd: String(cost)
    });
  } catch (err) {
    console.error("[token-log] best-effort write failed (ignored):", err);
  }
}
async function logImageCost(entry) {
  try {
    if (!entry.count || entry.count <= 0) return;
    const { db: db2 } = await Promise.resolve().then(() => (init_db_server(), db_server_exports));
    const { apiTokenLog: apiTokenLog2 } = await Promise.resolve().then(() => (init_schema(), schema_exports));
    const { estimateImageCostUsd: estimateImageCostUsd2 } = await Promise.resolve().then(() => (init_model_pricing_server(), model_pricing_server_exports));
    const cost = estimateImageCostUsd2(entry.model, entry.count);
    await db2.insert(apiTokenLog2).values({
      feature: entry.feature,
      model: entry.model,
      source: "sync",
      batchId: null,
      productId: entry.productId ?? null,
      sku: entry.sku ?? null,
      caller: entry.caller ?? null,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      requestCount: entry.count,
      estCostUsd: String(cost)
    });
  } catch (err) {
    console.error("[token-log] best-effort image-cost write failed (ignored):", err);
  }
}
async function getDailyTokenRollup(opts = {}) {
  const { db: db2 } = await Promise.resolve().then(() => (init_db_server(), db_server_exports));
  const { sql: sql8 } = await import("drizzle-orm");
  const days = opts.days ?? 30;
  const result = await db2.execute(
    sql8`SELECT * FROM api_token_daily
        WHERE day >= current_date - ${days}::int
        ORDER BY day DESC, est_cost_usd DESC`
  );
  return result.rows;
}
async function getTokenCallDetail(opts) {
  const { db: db2 } = await Promise.resolve().then(() => (init_db_server(), db_server_exports));
  const { sql: sql8 } = await import("drizzle-orm");
  const model = opts.model ?? null;
  const source = opts.source ?? null;
  const result = await db2.execute(
    sql8`
      WITH grouped AS (
        SELECT
          caller, sku, product_id, batch_id,
          COUNT(*)                   AS row_count,
          SUM(request_count)         AS calls,
          SUM(input_tokens)          AS input_tokens,
          SUM(output_tokens)         AS output_tokens,
          SUM(cache_creation_tokens) AS cache_creation_tokens,
          SUM(cache_read_tokens)     AS cache_read_tokens,
          SUM(est_cost_usd)          AS est_cost_usd,
          MIN(ts)                    AS first_ts,
          MAX(ts)                    AS last_ts
        FROM api_token_log
        WHERE date_trunc('day', ts)::date = ${opts.day}::date
          AND feature = ${opts.feature}
          AND (${model}::text  IS NULL OR model  = ${model})
          AND (${source}::text IS NULL OR source = ${source})
        GROUP BY caller, sku, product_id, batch_id
      )
      SELECT g.*, bj.job_type, bj.sku_list AS job_sku_list
      FROM grouped g
      LEFT JOIN LATERAL (
        SELECT job_type, sku_list
        FROM batch_jobs
        WHERE g.batch_id IS NOT NULL
          AND (current_batch_id = g.batch_id OR batch_ids::jsonb ? g.batch_id)
        LIMIT 1
      ) bj ON TRUE
      ORDER BY est_cost_usd DESC
    `
  );
  return result.rows;
}
var init_token_log_server = __esm({
  "app/lib/token-log.server.ts"() {
    "use strict";
  }
});

// app/lib/claude.server.ts
var claude_server_exports = {};
__export(claude_server_exports, {
  BRAND_VOICE_SYSTEM_PROMPT: () => BRAND_VOICE_SYSTEM_PROMPT,
  IVR_EXPERIENCE_LEVELS: () => IVR_EXPERIENCE_LEVELS,
  IVR_FEATURES: () => IVR_FEATURES,
  IVR_USE_CASES: () => IVR_USE_CASES,
  PRODUCT_SUBTYPES_BY_TYPE: () => PRODUCT_SUBTYPES_BY_TYPE,
  buildEmmaSystemBlocks: () => buildEmmaSystemBlocks,
  drainToolTokens: () => drainToolTokens,
  enhanceLtxPrompt: () => enhanceLtxPrompt,
  enhanceVeoPrompt: () => enhanceVeoPrompt,
  generateAskEmmaTags: () => generateAskEmmaTags,
  generateAskEmmaTagsAll: () => generateAskEmmaTagsAll,
  generateBlogArticle: () => generateBlogArticle,
  generateBlogDraft: () => generateBlogDraft,
  generateBlogOutline: () => generateBlogOutline,
  generateBlogSEO: () => generateBlogSEO,
  generateCareInstructions: () => generateCareInstructions,
  generateCopy: () => generateCopy,
  generateEmmaHero: () => generateEmmaHero,
  generateEmmaTagline: () => generateEmmaTagline,
  generateEmmaTake: () => generateEmmaTake,
  generateIvrAll: () => generateIvrAll,
  generateIvrExperience: () => generateIvrExperience,
  generateIvrFeatures: () => generateIvrFeatures,
  generateIvrUseCase: () => generateIvrUseCase,
  generatePairingWhy: () => generatePairingWhy,
  generateProductCopyBundle: () => generateProductCopyBundle,
  generateProductFaqs: () => generateProductFaqs,
  generateProductTitle: () => generateProductTitle,
  generateRails: () => generateRails,
  generateSEOTitle: () => generateSEOTitle,
  generateSchedule: () => generateSchedule,
  generateSensationDialV2: () => generateSensationDialV2,
  generateTweetCopy: () => generateTweetCopy,
  generateVideoContent: () => generateVideoContent,
  generateWithSystem: () => generateWithSystem,
  inferProductTaxonomy: () => inferProductTaxonomy,
  inferProductTypeDial: () => inferProductTypeDial,
  pickForContextGroup: () => pickForContextGroup,
  selectAccessories: () => selectAccessories
});
import Anthropic from "@anthropic-ai/sdk";
import { createHash as createHash3 } from "node:crypto";
async function callClaude(opts) {
  void opts.llmClient;
  const systemParam = opts.systemBlocks ? opts.systemBlocks.map((b) => ({
    type: "text",
    text: b.text,
    ...b.cache ? { cache_control: { type: "ephemeral" } } : {}
  })) : opts.system;
  if (systemParam === void 0) {
    throw new Error("callClaude: system or systemBlocks required");
  }
  const msg = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens,
    system: systemParam,
    messages: [{ role: "user", content: opts.userPrompt }]
  });
  const block = msg.content[0];
  if (block?.type !== "text") throw new Error("Unexpected Claude response type");
  const usage = msg.usage;
  const result = {
    text: block.text,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens
  };
  _toolTokenAccumulator.input += result.inputTokens;
  _toolTokenAccumulator.output += result.outputTokens;
  _toolTokenAccumulator.cacheCreation += usage.cache_creation_input_tokens ?? 0;
  _toolTokenAccumulator.cacheRead += usage.cache_read_input_tokens ?? 0;
  void Promise.resolve().then(() => (init_token_log_server(), token_log_server_exports)).then(({ logApiTokens: logApiTokens2 }) => {
    const entry = {
      feature: opts.feature ?? "copy-gen",
      model: opts.model,
      source: "sync",
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0
    };
    if (opts.caller) entry.caller = opts.caller;
    return logApiTokens2(entry);
  }).catch((err) => console.error("[claude] callClaude token-log failed (ignored):", err));
  return result;
}
async function buildEmmaSystemBlocks(brandVoiceOverride) {
  const brandVoice = brandVoiceOverride ?? await getPipelineSetting("brandVoice") ?? DEFAULT_BRAND_VOICE;
  return [
    { text: EMMA_SYSTEM_PROMPT, cache: true },
    { text: brandVoice, cache: true }
  ];
}
function buildLegacySystemBlocks() {
  return [{ text: SYSTEM_PROMPT, cache: true }];
}
function drainToolTokens() {
  const out = _toolTokenAccumulator;
  _toolTokenAccumulator = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
  return out;
}
async function generate(prompt, maxTokens = 1024, model = MODEL, llmClient) {
  const { text: text2 } = await callClaude({
    llmClient,
    model,
    maxTokens,
    systemBlocks: buildLegacySystemBlocks(),
    userPrompt: prompt
  });
  return text2;
}
async function generateWithSystem(opts) {
  const { system, user, model = MODEL_FAST, maxTokens = 128, timeoutMs } = opts;
  const call = client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }]
  });
  const msg = timeoutMs ? await Promise.race([
    call,
    new Promise(
      (_, reject) => setTimeout(() => reject(new Error("Claude request timed out")), timeoutMs)
    )
  ]) : await call;
  const block = msg.content[0];
  if (block?.type !== "text") throw new Error("Unexpected Claude response type");
  const u = msg.usage;
  void Promise.resolve().then(() => (init_token_log_server(), token_log_server_exports)).then(({ logApiTokens: logApiTokens2 }) => {
    const entry = {
      feature: opts.feature ?? "copy-gen",
      model,
      source: "sync",
      caller: opts.caller ?? "generateWithSystem",
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0
    };
    if (opts.sku) entry.sku = opts.sku;
    if (opts.productId) entry.productId = opts.productId;
    return logApiTokens2(entry);
  }).catch((err) => console.error("[claude] generateWithSystem token-log failed (ignored):", err));
  return block.text;
}
function stripFences(raw) {
  return raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
}
function containsPrice(text2) {
  return /\$\s?\d/.test(text2) || /\b\d+(?:\.\d{1,2})?\s*(?:dollars|usd)\b/i.test(text2);
}
function looksLikeMetaCommentary(text2) {
  const head = text2.slice(0, 80).toLowerCase();
  return head.startsWith("i notice") || head.startsWith("i'm flagging") || head.startsWith("i am flagging") || head.startsWith("i'd flag") || head.startsWith("the keyword") || head.startsWith("these keywords don't") || head.startsWith("these keyword targets") || head.startsWith("the provided keyword");
}
function resolveSeoContentType(type) {
  if (type === "blog_article") return "blog";
  return "pdp";
}
async function generateCopy(req, llmClient) {
  const { type, product } = req;
  const author = req.authorSlug ? await getEditorialAuthor(req.authorSlug).catch(() => null) : null;
  const seoMode = req.seoMode ?? author?.seoMode ?? "natural";
  const keywordBlock = await buildKeywordBlock({
    productType: product.productTypeDial,
    moods: product.moodTags,
    audiences: product.audienceTags,
    matters: product.mattersTags,
    contentType: resolveSeoContentType(type),
    topic: req.topic,
    seoMode
  }).catch((err) => {
    console.error("[claude] buildKeywordBlock failed (continuing without):", err);
    return "";
  });
  const productContextBase = `Product: ${product.title}
Brand: ${product.brand}
Description: ${product.description}
Categories: ${product.categories.join(", ")}`;
  const productContext = keywordBlock ? `${productContextBase}

${keywordBlock}` : productContextBase;
  switch (type) {
    case "tagline": {
      const primaryPrompt = `Write 3 one-sentence taglines for the following product. Emma voice \u2014 observational, casual, lightly witty. Think: a trusted friend who's recommending it, not a stand-up comedian. Avoid punchline-shaped puns and ad-copy zingers. Fragments are welcome ("the one I keep recommending", "earns its spot daily", "quietly indispensable"). First person OK. Max 12 words each. NO em-dashes. NO \u2665 glyph (reserve it for CTAs and asides). If any keyword targets in the prompt do not fit this product, IGNORE them silently \u2014 write from product details only. Never narrate a mismatch, never preface, never explain. Return as a JSON array of strings (no markdown).

${productContext}`;
      const retryPrompt = `Return exactly one short Emma-voice product tagline. Observational, casual, \u2264 12 words. No em-dashes, no \u2665 glyph, no quotes, no preamble, no commentary. Just the sentence.

${productContext}`;
      const raw = await generate(primaryPrompt, 1024, MODEL_FAST, llmClient);
      try {
        const parsed = JSON.parse(stripFences(raw));
        if (Array.isArray(parsed)) {
          const clean = parsed.filter((s) => typeof s === "string" && s.trim() && !looksLikeMetaCommentary(s));
          if (clean.length > 0) return { type, content: clean };
        }
      } catch {
      }
      const retried = await generate(retryPrompt, 1024, MODEL_FAST, llmClient);
      const line = retried.trim().split("\n")[0]?.trim();
      if (line && !looksLikeMetaCommentary(line)) return { type, content: [line] };
      return { type, content: [`${product.brand} ${product.title}, today on xdipx.`] };
    }
    case "full_story": {
      const primaryPrompt = `Write a short, punchy product description in xdipx brand voice. Return valid HTML only \u2014 use <p> tags for paragraphs, <strong> for emphasis, <em> for playful asides, <ul>/<li> for bullets. No <html>, <head>, <body> tags. No headings.

Format: EXACTLY 2 short paragraphs (3\u20134 sentences each) followed by a <ul> with 6\u201310 benefit bullets.

Tone: funny, cheeky, a little raunchy \u2014 innuendo is welcome, tasteful dirty jokes are great, but nothing gross or clinical. Think: your funniest friend who sells pleasure products and has zero shame. Make the reader smile AND want to buy.

Do NOT include: price, shipping, dimensions, materials, or any technical specs (those live in a separate Specs tab).
Do NOT start with the product name.

${productContext}`;
      const retryPrompt = `Return ONLY valid HTML starting with <p>. No preamble, no markdown, no explanation. Write 2 short paragraphs and a <ul> bullet list about this product in a funny, cheeky brand voice.

${productContext}`;
      const text2 = await generate(primaryPrompt);
      if (text2.includes("<p")) return { type, content: text2 };
      const retried = await generate(retryPrompt);
      if (retried.includes("<p")) return { type, content: retried };
      return { type, content: `<p>${product.description.slice(0, 400)}</p>` };
    }
    case "both_ways": {
      const primaryPrompt = `Write two sections for the xdipx "Both Ways \u2665" tab (60\u201390 words each). Return valid HTML \u2014 use <p> tags, <strong> for emphasis, <em> for playful asides. No headings. Return as JSON with keys "forHim" and "forHer", each containing an HTML string.

STRATEGY \u2014 read the product categories carefully:

If the product is primarily FOR HER (vibrators, rabbits, clit stimulators, air pulse, etc.):
- "forHer": Genuine, warm, compelling sell written directly TO women. Speak to her pleasure, her curiosity, her experience. Make her feel seen and excited. This is the hero section.
- "forHim": Humorous angle \u2014 he can't use it directly but here's why he should buy it anyway. Options: the joy of being the one who gives this gift, using it together as a couple, or a playfully absurd "creative solo use" that's funny but not weird. Keep it light and self-aware.

If the product is primarily FOR HIM (strokers, masturbators, prostate toys, etc.):
- "forHim": Genuine, warm, compelling sell written directly TO men. Speak to his pleasure, curiosity, experience. Make him feel this was made for him.
- "forHer": Humorous angle \u2014 she can't use it directly but here's why she should be excited about it. Options: the magic of a satisfied partner, using it together, or a playfully absurd angle. Keep it warm and funny.

If the product works for both or is a couples toy: write genuine, enthusiastic content for each.

${productContext}`;
      const retryPrompt = `Return ONLY raw JSON with no markdown, no prose before or after:
{"forHim": "<p>...</p>", "forHer": "<p>...</p>"}

Write 60-90 words each in a playful brand voice about this product.

${productContext}`;
      const tryParse = (raw) => {
        try {
          const parsed = JSON.parse(stripFences(raw));
          if (parsed?.forHim && parsed?.forHer) return parsed;
        } catch {
        }
        const match = raw.match(/\{[\s\S]*?"forHim"[\s\S]*?"forHer"[\s\S]*?\}/);
        if (match) {
          try {
            const parsed = JSON.parse(match[0]);
            if (parsed?.forHim && parsed?.forHer) return parsed;
          } catch {
          }
        }
        return null;
      };
      const first = await generate(primaryPrompt);
      const firstParsed = tryParse(first);
      if (firstParsed) return { type, content: firstParsed };
      const retried = await generate(retryPrompt);
      const secondParsed = tryParse(retried);
      if (secondParsed) return { type, content: secondParsed };
      return {
        type,
        content: {
          forHim: `<p><strong>${product.title}</strong> \u2014 worth exploring together. Trust us, being the person who brings this home is its own reward. \u2665</p>`,
          forHer: `<p><strong>${product.title}</strong> \u2014 made with you in mind. Your curiosity is valid, your comfort matters, and this is exactly the kind of upgrade you deserve. \u2665</p>`
        }
      };
    }
    case "bullets": {
      const primaryPrompt = `Write 4\u20136 feature bullet points for this product. Short, specific, benefit-first. No fluff. Return as a JSON array of strings.

${productContext}`;
      const retryPrompt = `Return ONLY a JSON array of 4 to 5 short benefit strings. Example: ["Dual motors for blended stimulation", "Whisper-quiet for total privacy"]. Nothing else \u2014 no markdown, no prose.

${productContext}`;
      const raw = await generate(primaryPrompt, 1024, MODEL_FAST, llmClient);
      try {
        const parsed = JSON.parse(stripFences(raw));
        if (Array.isArray(parsed) && parsed.length >= 3) return { type, content: parsed };
      } catch {
      }
      const retried = await generate(retryPrompt, 1024, MODEL_FAST, llmClient);
      try {
        const parsed = JSON.parse(stripFences(retried));
        if (Array.isArray(parsed) && parsed.length >= 3) return { type, content: parsed };
      } catch {
      }
      const lines = product.description.split(/[.!?\n]/).map((s) => s.trim()).filter((s) => s.length > 20 && s.length < 120).slice(0, 4);
      return { type, content: lines.length >= 3 ? lines : [`${product.title} by ${product.brand}`, "Rechargeable and body-safe", "Ships discreetly"] };
    }
    case "email_subjects": {
      const raw = await generate(
        `Write 5 email subject lines for today's daily deal email. Max 50 chars each. Playful, urgent, curiosity-driven. Return as a JSON array of strings.

${productContext}`,
        1024,
        MODEL_FAST
      );
      try {
        return { type, content: JSON.parse(stripFences(raw)) };
      } catch {
        return { type, content: raw.split("\n").filter(Boolean).slice(0, 5) };
      }
    }
    case "seo_meta": {
      const primaryPrompt = `Write a 140\u2013155 character SEO meta description for this product. This shows in Google SERP and link previews \u2014 drives click-through.

Two anchors to include (Emma voice within these constraints):
  (a) Trust beat: "Ships discreetly" \u2014 keeps the discretion signal in SERP
  (b) Benefit beat in light Emma voice \u2014 fragment OK, first-person OK, no marketing fluff

NEVER mention price, discount, or any dollar amount. Prices change; this copy is durable. Keep the focus on the product and how it feels to use.

If any keyword targets in this prompt don't actually fit the product, IGNORE them silently and write the description from the product details only \u2014 never narrate the mismatch, never preface, never explain. Output exactly the description and nothing else.

Voice: light Emma \u2014 observational, warm, specific. Not a generic SEO template, not a stand-up zinger. Brand mentions written as "XDIPX" (uppercase). NO em-dashes ("\u2014" or "\u2013"). Return ONLY the meta description text \u2014 no quotes, no labels.

${productContext}`;
      const retryPrompt = `Write a single SEO meta description, 140 to 155 characters. Light Emma voice. Include "Ships discreetly". NEVER mention price or dollar amounts. No em-dashes. Output ONLY the description text \u2014 no preamble, no commentary, no quotes.

${productContext}`;
      const text2 = await generate(primaryPrompt, 1024, MODEL_FAST, llmClient);
      const cleaned = text2.replace(/^["']|["']$/g, "").trim();
      if (cleaned.length >= 50 && !looksLikeMetaCommentary(cleaned) && !containsPrice(cleaned)) return { type, content: cleaned.slice(0, 155) };
      const retried = await generate(retryPrompt, 1024, MODEL_FAST, llmClient);
      const cleanedRetry = retried.replace(/^["']|["']$/g, "").trim();
      if (cleanedRetry.length >= 50 && !looksLikeMetaCommentary(cleanedRetry) && !containsPrice(cleanedRetry)) return { type, content: cleanedRetry.slice(0, 155) };
      const fallback = `${product.brand} ${product.title}. Ships discreetly from XDIPX.`;
      return { type, content: fallback.slice(0, 155) };
    }
    case "box_contents": {
      const primaryPrompt = `Extract what is physically included in the box for this product from the description below. Return a JSON array of short strings (one item per element), e.g. ["1x vibrator", "1x USB charging cable", "1x storage pouch"]. If the description doesn't mention box contents, infer the most likely inclusions based on the product type. Return only the JSON array, no markdown.

${productContext}`;
      const retryPrompt = `Return ONLY a JSON array of what's in the box. Example: ["1x vibrator", "1x USB cable"]. Nothing else \u2014 no markdown, no prose, no explanation.

${productContext}`;
      const raw = await generate(primaryPrompt, 1024, MODEL_FAST, llmClient);
      try {
        const parsed = JSON.parse(stripFences(raw));
        if (Array.isArray(parsed) && parsed.length >= 1) return { type, content: parsed };
      } catch {
      }
      const retried = await generate(retryPrompt, 1024, MODEL_FAST, llmClient);
      try {
        const parsed = JSON.parse(stripFences(retried));
        if (Array.isArray(parsed) && parsed.length >= 1) return { type, content: parsed };
      } catch {
      }
      return { type, content: [`1x ${product.title}`, "1x User manual"] };
    }
    case "quiet_endorsement": {
      const mapNote = product.mapRestricted ? "This product is MAP-restricted \u2014 do NOT reference a discount or a strike price. The hook must be Emma's endorsement, not the price." : "You may reference a pleasant price or value if it flows naturally, but the hook should still be Emma's endorsement, not the discount.";
      const primaryPrompt = `Write the four short strings for Emma's "quiet endorsement" homepage template. Emma voice: a trusted, funny friend who has actually tried this and quietly can't stop thinking about it. Never "Buy now" \u2014 never countdowns \u2014 never "sex" as an adjective. Use "intimate", "pleasure", "wellness", "slow-burn", "satisfaction".
${mapNote}

Return ONLY a raw JSON object (no markdown) with these exact keys:
- eyebrow: a tag line \u2264 60 chars, two short phrases joined by " \xB7 " (middle dot, U+00B7). Example shape: "quiet endorsement \xB7 works for MAP-restricted".
- subhead: one short line, lowercase, casual \u2014 something like "updated whenever I change my mind".
- body: 1\u20132 sentences (\u2264 200 chars total). First person, Emma voice. Wrap one 1\u20134 word phrase in underscores like _slow-burn energy_ so the UI can highlight it in coral. End with a soft curiosity nudge ("Come see.", "Worth a peek.", etc).
- bannerHeadline: \u2264 30 chars, italic-editorial feel, product name in Emma's words. Use " \xB7 " as separator if you have two parts. Example: "Slowburn \xB7 the Hush".

${productContext}`;
      const retryPrompt = `Return ONLY raw JSON. No markdown, no prose before or after. Shape: {"eyebrow": "...", "subhead": "...", "body": "...", "bannerHeadline": "..."}. Follow Emma voice rules. ${productContext}`;
      const isValid = (v) => {
        if (!v || typeof v !== "object") return false;
        const obj = v;
        return typeof obj.eyebrow === "string" && obj.eyebrow.trim().length > 0 && typeof obj.subhead === "string" && obj.subhead.trim().length > 0 && typeof obj.body === "string" && obj.body.trim().length > 0 && typeof obj.bannerHeadline === "string" && obj.bannerHeadline.trim().length > 0;
      };
      const raw = await generate(primaryPrompt, 512, MODEL_FAST, llmClient);
      try {
        const parsed = JSON.parse(stripFences(raw));
        if (isValid(parsed)) return { type, content: parsed };
      } catch {
      }
      const retried = await generate(retryPrompt, 512, MODEL_FAST, llmClient);
      try {
        const parsed = JSON.parse(stripFences(retried));
        if (isValid(parsed)) return { type, content: parsed };
      } catch {
      }
      return {
        type,
        content: {
          eyebrow: product.mapRestricted ? "quiet endorsement \xB7 works for MAP-restricted" : "quiet endorsement \xB7 editor\u2019s pick",
          subhead: "updated whenever I change my mind",
          body: `I\u2019ve been a little obsessed with this one \u2014 it\u2019s got a kind of _slow-burn energy_ I wasn\u2019t expecting. Come see.`,
          bannerHeadline: `${product.brand || "Emma\u2019s pick"} \xB7 ${product.title}`.slice(0, 30)
        }
      };
    }
    case "pair_bundle": {
      const partner = product.partner;
      const nowISO = () => (/* @__PURE__ */ new Date()).toISOString();
      const staticFallback = () => ({
        headline: "These two were made for each other.",
        emmaByline: "two picks I think really click together",
        pairedHandle: "",
        generatedAt: nowISO(),
        knotCaption: "tied together on purpose",
        whyCards: [
          { head: "One handles the fun part.", body: "The rumble, the tease, the main event. Dialed in and ready to go." },
          { head: "The other handles the smart part.", body: "Keeps everything gliding, safe on toys, easy on skin. No drama, no cleanup headache." },
          { head: "Together they buy you time.", body: "Less stop-and-start, more flow. You\u2019ll feel the difference in the first few minutes." }
        ],
        emmaQuote: `This is the pair I\u2019d hand a friend who asked \u201Cjust pick something for me.\u201D One does the work, one does the _finish_, and together they feel intentional. That\u2019s the whole point of a good pair.`,
        momentTitle: "how to make this pair click",
        moments: [
          { lead: "Start with the lube.", body: "A little goes a long way. Warm it in your hands first so it lands smooth instead of startling." },
          { lead: "Then bring in the other.", body: "Let the rhythm build before you ramp up. The pair wants you unhurried." }
        ]
      });
      if (!partner) {
        return {
          type,
          content: {
            ...staticFallback(),
            emmaByline: "waiting on a pairing"
          }
        };
      }
      const pairContext = `Primary product:
- Title: ${product.title}
- Brand: ${product.brand}
- Description: ${product.description}
- Categories: ${product.categories.join(", ")}${product.dealPrice ? `
- Deal price: $${product.dealPrice}` : ""}

Partner product:
- Title: ${partner.title}
- Brand: ${partner.brand}
- Description: ${partner.description}
- Categories: ${partner.categories.join(", ")}${partner.dealPrice ? `
- Deal price: $${partner.dealPrice}` : ""}`;
      const voiceRules = `VOICE RULES (strict):
- Emma is a persona \u2014 she does NOT claim to have personally used or tested any product.
- NEVER say: "I tried", "I tested", "I've been using", "tested both", "loved both", "been living with", "spent X weeks", "I reached for this", "since April", "a month of use", or any similar first-person use claim.
- NEVER invent usage stats ("238 pairs grabbed", "top 5%", "my #1").
- Emma curates, pairs, and recommends \u2014 she speaks about why things WOULD click, not what she felt.
- OK to say: "picks this pair", "I\u2019d hand this to a friend", "why they click", "made for each other", "the slow one", "the fix-it one", "a pairing that works".
- Do NOT name the brands. Do NOT restate the product titles. Do NOT surface countdowns or "until midnight".
- Use "intimate", "pleasure", "wellness", "slow-burn", "satisfaction" \u2014 never "sex" as an adjective.
- Avoid em-dashes (\u2014). Use periods, commas, or short sentences. Hyphens in compounds (slow-burn) are fine.`;
      const shapeSpec = `Return ONLY a raw JSON object (no markdown fences, no prose around it) with EXACTLY these keys:

{
  "headline":    string  // 6\u201310 words, editorial italic feel, the hero hook. e.g. "These two were made for each other."
  "emmaByline":  string  // 6\u201312 words, lowercase, curator voice. Renders next to Emma's avatar AFTER the bold "Picked by Emma." label, so it reads as a continuation of that phrase. NEVER "tested both", "loved both", "I tried", or any first-person use claim. e.g. "two picks I think really click together" or "a slow-burn pairing worth the time"
  "knotCaption": string  // 3\u20136 words, short label for why they're tied together. e.g. "tied together on purpose" or "one better idea"
  "whyCards": [          // EXACTLY 3 entries explaining why the pairing works
    { "head": string,    // 5\u20139 words ending in a period. Short editorial hook. e.g. "One handles the fun part."
      "body": string }   // 15\u201325 words, no testimony, factual + evocative
  ],
  "emmaQuote":   string  // 35\u201360 words, 2\u20133 sentences, first-person curator voice ("this is the pair I'd hand a friend"). Supports 1\u20132 _emphasis_ spans. NEVER "tried/tested/used".
  "momentTitle": string  // 5\u20138 words, italic feel. e.g. "how to make this pair click"
  "moments": [           // 2 or 3 entries \u2014 a quick how-to for the pair
    { "lead": string,    // 4\u20137 words, will render bold. e.g. "Start with the lube."
      "body": string }   // 15\u201322 words continuing the step in Emma voice
  ]
}

The whyCards array MUST have length 3. The moments array MUST have length 2 or 3. No extra keys. No nulls.`;
      const primaryPrompt = `Write Emma's "pair bundle" editorial module copy \u2014 two curated products sold together at a better price.

${voiceRules}

${shapeSpec}

${pairContext}`;
      const retryPrompt = `Return ONLY raw JSON matching this exact shape: {"headline","emmaByline","knotCaption","whyCards":[{"head","body"},{"head","body"},{"head","body"}],"emmaQuote","momentTitle","moments":[{"lead","body"},{"lead","body"}]}.

${voiceRules}

${pairContext}`;
      const isStr = (v) => typeof v === "string" && v.trim().length > 0;
      const isCard = (v) => !!v && typeof v === "object" && isStr(v.head) && isStr(v.body);
      const isMoment = (v) => !!v && typeof v === "object" && isStr(v.lead) && isStr(v.body);
      const isValid = (v) => {
        if (!v || typeof v !== "object") return false;
        const o = v;
        return isStr(o.headline) && isStr(o.emmaByline) && isStr(o.knotCaption) && isStr(o.emmaQuote) && isStr(o.momentTitle) && Array.isArray(o.whyCards) && o.whyCards.length === 3 && o.whyCards.every(isCard) && Array.isArray(o.moments) && (o.moments.length === 2 || o.moments.length === 3) && o.moments.every(isMoment);
      };
      const wrap = (copy) => ({
        ...copy,
        pairedHandle: "",
        generatedAt: nowISO()
      });
      const raw = await generate(primaryPrompt, 1800, MODEL_FAST, llmClient);
      try {
        const parsed = JSON.parse(stripFences(raw));
        if (isValid(parsed)) return { type, content: wrap(parsed) };
      } catch {
      }
      const retried = await generate(retryPrompt, 1800, MODEL_FAST, llmClient);
      try {
        const parsed = JSON.parse(stripFences(retried));
        if (isValid(parsed)) return { type, content: wrap(parsed) };
      } catch {
      }
      return { type, content: staticFallback() };
    }
    case "endorsement": {
      const nowISO = () => (/* @__PURE__ */ new Date()).toISOString();
      const collections = req.availableCollections ?? [];
      const validHandles = new Set(collections.map((c) => c.handle));
      const staticFallback = () => ({
        emmaIntro: "updated whenever I change my mind",
        quote: `I\u2019ve been a little obsessed with this one.
It\u2019s got a kind of _slow-burn energy_ I wasn\u2019t expecting.
Come see.`,
        alsoIntoLabel: "I'm also into",
        alsoIntoCollectionHandle: "",
        noteLabel: product.mapRestricted ? "quiet endorsement \xB7 works for MAP-restricted" : "quiet endorsement \xB7 editor\u2019s pick",
        rails: [
          { title: "If you liked this, try", collectionHandle: "" },
          { title: "Pair it with", collectionHandle: "" }
        ],
        generatedAt: nowISO()
      });
      const productContext2 = `Product:
- Title: ${product.title}
- Brand: ${product.brand}
- Description: ${product.description}
- Categories: ${product.categories.join(", ")}${product.dealPrice ? `
- Deal price: $${product.dealPrice}` : ""}${product.mapRestricted ? `
- MAP-restricted: yes` : ""}${product.moodTags?.length ? `
- Mood tags: ${product.moodTags.join(", ")}` : ""}${product.audienceTags?.length ? `
- Audience tags: ${product.audienceTags.join(", ")}` : ""}${product.mattersTags?.length ? `
- Matters tags: ${product.mattersTags.join(", ")}` : ""}`;
      const collectionRoster = collections.length ? `AVAILABLE COLLECTIONS \u2014 pick handles ONLY from this list. Each line is "<handle> \xB7 <title>[ \xB7 <description>]":
${collections.map((c) => `- ${c.handle} \xB7 ${c.title}${c.description ? ` \xB7 ${c.description}` : ""}`).join("\n")}` : `AVAILABLE COLLECTIONS \u2014 none provided; leave all collection handles as empty strings.`;
      const voiceRules = `VOICE RULES (strict):
- Emma is a persona \u2014 she does NOT claim to have personally used or tested any product.
- NEVER say: "I tried", "I tested", "I've been using", "been living with", "spent X weeks", "I reached for this", "since April", "a month of use", or any similar first-person use claim.
- NEVER invent usage stats ("238 grabbed", "top 5%", "my #1").
- Emma curates and recommends \u2014 she speaks about why something WOULD click, not what she felt physically.
- OK to say: "I'm a little obsessed", "this one's for the ___ crowd", "comes recommended", "I'd hand this to a friend who said pick something for me".
- Do NOT name the brand. Do NOT restate the product title. Do NOT surface countdowns or "until midnight".
- Use "intimate", "pleasure", "wellness", "slow-burn", "satisfaction" \u2014 never "sex" as an adjective.
- Avoid em-dashes (\u2014). Use periods, commas, or short sentences instead. Hyphens in compound words (slow-burn) are fine.`;
      const shapeSpec = `Return ONLY a raw JSON object (no markdown fences, no prose around it) with EXACTLY these keys:

{
  "emmaIntro": string         // \u2264 60 chars, lowercase, casual. Emma's "what she's about right now" tagline shown next to her avatar. e.g. "updated whenever I change my mind" or "still on a slow-burn kick"
  "quote":     string         // 3 lines, separated by real newline characters (\\n). Each line \u2264 70 chars. First-person editorial voice, NOT a usage testimonial. Wrap exactly ONE 1\u20134 word phrase in underscores like _slow-burn energy_ for coral highlight. End on a soft curiosity nudge.
  "alsoIntoLabel":  string    // 2\u20134 words, label for the secondary CTA. Default "I'm also into". Stay in Emma's lowercase, friend-voice register.
  "alsoIntoCollectionHandle": string  // EXACT handle from AVAILABLE COLLECTIONS that fits an "if you liked this, also try" angle \u2014 different from both rails. Use "" only if no listed collection fits.
  "noteLabel": string         // \u2264 50 chars, sticky-note label shown above the avatar. Two short phrases joined by " \xB7 " (middle dot U+00B7). e.g. "quiet endorsement \xB7 works for MAP-restricted"
  "rails": [                  // EXACTLY 2 entries \u2014 contextual rail suggestions for below the hero.
    { "title": string,        // 2\u20135 words, Emma-voice rail heading. e.g. "Slow-burn picks", "If you liked this, try"
      "collectionHandle": string }  // EXACT handle from AVAILABLE COLLECTIONS that matches the rail's angle. "" only if nothing fits.
  ]
}

Rules:
- The quote is the centerpiece \u2014 make those 3 lines feel earned, like she means them.
- The two rails should be DIFFERENT angles. Rail 1 = "more like this" (similar product type / sensation / category). Rail 2 = "pair it with" (complementary \u2014 the thing that makes this one shine).
- "alsoIntoCollectionHandle" should be a THIRD distinct angle from the rails \u2014 adjacent crowd, mood, or use case Emma's also into.
- Collection handles MUST come verbatim from the AVAILABLE COLLECTIONS list. Do NOT invent handles. If nothing in the list fits, use "" and the admin will fill it in.
- The three picks (alsoInto + 2 rails) should be three DIFFERENT handles when possible.
- Output strictly the JSON object \u2014 no preamble, no fences, no commentary.`;
      const isValid = (v) => {
        const o = v;
        if (!o || typeof o !== "object") return false;
        if (typeof o.emmaIntro !== "string" || !o.emmaIntro.trim()) return false;
        if (typeof o.quote !== "string" || !o.quote.trim()) return false;
        return true;
      };
      const cleanHandle = (h) => {
        if (!h) return "";
        if (validHandles.size === 0) return "";
        return validHandles.has(h) ? h : "";
      };
      const wrap = (raw) => ({
        ...raw,
        alsoIntoLabel: raw.alsoIntoLabel || "I'm also into",
        alsoIntoCollectionHandle: cleanHandle(raw.alsoIntoCollectionHandle),
        rails: (raw.rails || []).map((r) => ({
          ...r,
          collectionHandle: cleanHandle(r.collectionHandle)
        })),
        generatedAt: nowISO()
      });
      const prompt = `${voiceRules}

${productContext2}

${collectionRoster}

${shapeSpec}`;
      const text2 = await generate(prompt, 1024, MODEL_FAST, llmClient);
      try {
        const parsed = JSON.parse(stripFences(text2));
        if (isValid(parsed)) return { type, content: wrap(parsed) };
      } catch {
      }
      const retried = await generate(`${prompt}

The previous response wasn't valid JSON or was missing required keys. Output ONLY the JSON object, no fences, no prose.`, 1024, MODEL_FAST, llmClient);
      try {
        const parsed = JSON.parse(stripFences(retried));
        if (isValid(parsed)) return { type, content: wrap(parsed) };
      } catch {
      }
      return { type, content: staticFallback() };
    }
    case "specifications": {
      const primaryPrompt = `Extract the technical specifications from this product description as a JSON array of "Label: Value" bullet pairs. Each entry is a single short string with the label, a colon, and the value (e.g. "Color: Black", "Material: Body-safe silicone", "Battery life: 90 minutes per charge").

Include only objective facts surfaced in the description: dimensions, materials, power source, charge time, run time, waterproofing, colors, weight, controls, country of origin. Skip categories the source doesn't mention \u2014 better fewer accurate specs than padded ones. NEVER include price, discount, or dollar amounts.

Voice: factual and concise. No fluff, no marketing copy, no Emma asides. Each value 4\u201380 chars.

Return ONLY a JSON array of strings, max 12 entries. No markdown, no prose, no wrapper.

Example: ["Color: Black", "Material: Nylon straps with padded cuffs", "Includes: 4 cuffs and restraint straps", "Fit: Universal mattress sizes"]

${productContext}`;
      const retryPrompt = `Return ONLY a JSON array of "Label: Value" spec strings extracted from this product. No markdown, no explanation, no preamble. Example: ["Color: Black", "Material: Silicone"]

${productContext}`;
      const tryParse = (raw) => {
        try {
          const parsed2 = JSON.parse(stripFences(raw));
          if (!Array.isArray(parsed2)) return null;
          const out = parsed2.filter((s) => typeof s === "string" && s.trim().length >= 4 && s.trim().length <= 100).map((s) => s.trim());
          return out.length > 0 ? out.slice(0, 12) : null;
        } catch {
          return null;
        }
      };
      const text2 = await generate(primaryPrompt, 1500, MODEL_FAST, llmClient);
      const parsed = tryParse(text2);
      if (parsed) return { type, content: parsed };
      const retried = await generate(retryPrompt, 1500, MODEL_FAST, llmClient);
      const parsedRetry = tryParse(retried);
      if (parsedRetry) return { type, content: parsedRetry };
      return { type, content: [] };
    }
    case "blog_article": {
      const article = await generateBlogArticle({
        topic: req.topic ?? product.title,
        context: product.description ?? "",
        tags: product.categories ?? [],
        keywordBlock,
        author
      });
      return { type, content: article };
    }
    default:
      throw new Error(`Unknown copy type: ${type}`);
  }
}
async function generateProductCopyBundle(req) {
  const { product } = req;
  const author = req.authorSlug ? await getEditorialAuthor(req.authorSlug).catch(() => null) : null;
  const seoMode = req.seoMode ?? author?.seoMode ?? "natural";
  const keywordBlock = await buildKeywordBlock({
    productType: product.productTypeDial,
    moods: product.moodTags,
    audiences: product.audienceTags,
    matters: product.mattersTags,
    contentType: "pdp",
    seoMode
  }).catch((err) => {
    console.error("[generateProductCopyBundle] buildKeywordBlock failed (continuing without):", err);
    return "";
  });
  const productContextBase = `Product: ${product.title}
Brand: ${product.brand}
Description: ${product.description}
Categories: ${product.categories.join(", ")}`;
  const productContext = keywordBlock ? `${productContextBase}

${keywordBlock}` : productContextBase;
  const prompt = `Produce three independent copy fields for this product in a SINGLE JSON response. Each field has its own constraints \u2014 apply them strictly. NEVER mention price, discount, or dollar amounts in any field; the PDP renders Shopify's live price separately. NO em-dashes ("\u2014" or "\u2013") anywhere.

If any keyword targets in the prompt do not fit this product, IGNORE them silently and write from the product details only. Never narrate a mismatch, never preface, never explain.

FIELD 1 \u2014 "tagline" (string):
- One short Emma-voice tagline. Observational, casual, lightly witty. Not a stand-up zinger.
- Fragments are welcome ("the one I keep recommending", "earns its spot daily", "quietly indispensable").
- Max 12 words. First person OK. NO em-dashes. NO \u2665 glyph (reserve it for CTAs and asides).

FIELD 2 \u2014 "seoMeta" (string):
- 140\u2013155 characters. Shows in Google SERP and link previews.
- Include both: (a) the trust beat "Ships discreetly", (b) one short Emma-voice benefit beat (fragment OK, first-person OK).
- Brand mentions written as "XDIPX" (uppercase). NO em-dashes. NO price/discount language.

FIELD 3 \u2014 "specifications" (string[]):
- JSON array of "Label: Value" bullet pairs (e.g. "Color: Black", "Material: Body-safe silicone").
- Include only objective facts surfaced in the description: dimensions, materials, power source, charge time, run time, waterproofing, colors, weight, controls, country of origin.
- Skip categories the source doesn't mention. Better fewer accurate specs than padded ones.
- Factual and concise \u2014 no fluff, no Emma asides. Each value 4\u201380 chars. Max 12 entries. NEVER include price.

Return ONLY this JSON shape (no markdown, no preamble):
{ "tagline": "string", "seoMeta": "string", "specifications": ["Label: Value", ...] }

${productContext}`;
  let parsed = null;
  try {
    const { text: text2 } = await callClaude({
      llmClient: req.llmClient,
      model: MODEL_FAST,
      maxTokens: 1500,
      systemBlocks: buildLegacySystemBlocks(),
      userPrompt: prompt
    });
    parsed = JSON.parse(stripFences(text2));
  } catch (err) {
    console.error("[generateProductCopyBundle] consolidated call failed, falling back to per-field:", err);
  }
  const taglineOk = (s) => typeof s === "string" && s.trim().length > 0 && s.trim().split(/\s+/).length <= 12 && !looksLikeMetaCommentary(s) && !s.includes("\u2014") && !s.includes("\u2013");
  const seoMetaOk = (s) => typeof s === "string" && s.trim().length >= 50 && !looksLikeMetaCommentary(s) && !containsPrice(s);
  const specsOk = (a) => Array.isArray(a) && a.length > 0 && a.every((v) => typeof v === "string" && v.trim().length >= 4 && v.trim().length <= 100);
  let tagline = "";
  let seoMeta = "";
  let specifications = [];
  if (parsed && taglineOk(parsed.tagline)) {
    tagline = parsed.tagline.trim();
  } else {
    const r = await generateCopy({ type: "tagline", product, ...req.authorSlug ? { authorSlug: req.authorSlug } : {}, ...req.seoMode ? { seoMode: req.seoMode } : {} }, req.llmClient);
    const arr = r.content;
    tagline = (Array.isArray(arr) ? arr[0] : arr)?.trim() ?? "";
  }
  if (parsed && seoMetaOk(parsed.seoMeta)) {
    seoMeta = parsed.seoMeta.trim().slice(0, 155);
  } else {
    const r = await generateCopy({ type: "seo_meta", product, ...req.authorSlug ? { authorSlug: req.authorSlug } : {}, ...req.seoMode ? { seoMode: req.seoMode } : {} }, req.llmClient);
    seoMeta = r.content ?? "";
  }
  if (parsed && specsOk(parsed.specifications)) {
    specifications = parsed.specifications.map((s) => s.trim()).slice(0, 12);
  } else {
    const r = await generateCopy({ type: "specifications", product, ...req.authorSlug ? { authorSlug: req.authorSlug } : {}, ...req.seoMode ? { seoMode: req.seoMode } : {} }, req.llmClient);
    specifications = Array.isArray(r.content) ? r.content : [];
  }
  return { tagline, seoMeta, specifications };
}
function rid(prefix) {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}
function markdownToPortableText(md) {
  const blocks = [];
  const paragraphs = md.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  for (const p of paragraphs) {
    let style = "normal";
    let text2 = p;
    if (text2.startsWith("### ")) {
      style = "h3";
      text2 = text2.slice(4).trim();
    } else if (text2.startsWith("## ")) {
      style = "h2";
      text2 = text2.slice(3).trim();
    } else if (text2.startsWith("# ")) {
      style = "h2";
      text2 = text2.slice(2).trim();
    }
    blocks.push({
      _type: "block",
      _key: rid("b"),
      style,
      markDefs: [],
      children: [{
        _type: "span",
        _key: rid("s"),
        text: text2,
        marks: []
      }]
    });
  }
  return blocks;
}
function slugifyForBlog(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 80);
}
async function generateBlogArticle(input) {
  const { topic, context = "", tags = [], keywordBlock, author } = input;
  const composedSystem = author?.voiceRules?.length ? `${SYSTEM_PROMPT}

Author voice (${author.name}):
${author.voiceRules.map((r) => `- ${r}`).join("\n")}${author.personaSummary ? `

Persona: ${author.personaSummary}` : ""}` : SYSTEM_PROMPT;
  const ctxBlock = [
    `Topic: ${topic}`,
    context ? `Background context:
${context}` : "",
    tags.length ? `Related tags: ${tags.join(", ")}` : "",
    keywordBlock
  ].filter(Boolean).join("\n\n");
  const userPrompt = `Write a blog article for xdipx.com targeting the topic and keyword set above. Length: ~700\u20131100 words. Structure: a hook intro (no heading), then 3\u20135 H2 sections with at least one H3 subsection in the longest section. Conversational, useful, never preachy. Cite specific scenarios over generalities.

Return a single JSON object with this exact shape (JSON only, no markdown fences):
{
  "title":          "string \u2014 50\u201370 chars, weave the primary keyword",
  "slug":           "string \u2014 kebab-case, \u2264 60 chars, derived from title",
  "excerpt":        "string \u2014 110\u2013160 chars, hook the reader",
  "seoTitle":       "string \u2014 50\u201360 chars, optimized for SERP",
  "seoDescription": "string \u2014 140\u2013155 chars, includes primary keyword",
  "body":           "string \u2014 markdown body (## for H2, ### for H3, blank lines between paragraphs). Do NOT include the H1 title (that's the title field)."
}

${ctxBlock}`;
  const fallback = () => ({
    title: topic,
    slug: slugifyForBlog(topic),
    excerpt: `A look at ${topic} from xdipx.`,
    seoTitle: topic.slice(0, 60),
    seoDescription: `Practical, tasteful guidance on ${topic} \u2014 written for curious adults.`.slice(0, 155),
    body: markdownToPortableText(`A short note on ${topic}. We'll come back with more soon.`)
  });
  let raw;
  try {
    raw = await generateWithSystem({
      system: composedSystem,
      user: userPrompt,
      model: MODEL,
      maxTokens: 4096
    });
  } catch (err) {
    console.error("[claude] generateBlogArticle Claude call failed:", err);
    return fallback();
  }
  try {
    const parsed = JSON.parse(stripFences(raw));
    const title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : topic;
    const slug = typeof parsed.slug === "string" && parsed.slug.trim() ? slugifyForBlog(parsed.slug) : slugifyForBlog(title);
    const excerpt = typeof parsed.excerpt === "string" ? parsed.excerpt.trim() : "";
    const seoTitle = typeof parsed.seoTitle === "string" && parsed.seoTitle.trim() ? parsed.seoTitle.trim() : title.slice(0, 60);
    const seoDescription = typeof parsed.seoDescription === "string" && parsed.seoDescription.trim() ? parsed.seoDescription.trim() : (excerpt || `A practical guide to ${topic}.`).slice(0, 155);
    const bodyMd = typeof parsed.body === "string" ? parsed.body : "";
    return {
      title,
      slug,
      excerpt: excerpt || `A look at ${topic}.`,
      seoTitle,
      seoDescription,
      body: bodyMd ? markdownToPortableText(bodyMd) : markdownToPortableText(`A short note on ${topic}.`)
    };
  } catch (err) {
    console.error("[claude] generateBlogArticle JSON parse failed:", err);
    return fallback();
  }
}
async function generateSchedule(products, days = 30) {
  const productList = products.map(
    (p, i) => `${i + 1}. SKU: ${p.sku} | Brand: ${p.brand} | Title: ${p.title} | Score: ${p.score.toFixed(3)} | Categories: ${p.categories.join(", ")}`
  ).join("\n");
  const startDate = /* @__PURE__ */ new Date();
  startDate.setDate(startDate.getDate() + 1);
  const raw = await generate(
    `Given these ${products.length} products and their scores, suggest a ${days}-day deal calendar starting ${startDate.toISOString().split("T")[0]}.

Rules:
- No same brand within 3 days
- Alternate price tiers (budget/mid/premium)
- Highest-value deals on Friday/Saturday
- Lubricants as accessories not daily deals when possible
- Use highest-scoring products first

Products:
${productList}

Return a JSON array: [{"date": "YYYY-MM-DD", "sku": "...", "rationale": "..."}]
Return only the JSON array, no markdown.`
  );
  try {
    return JSON.parse(stripFences(raw));
  } catch {
    return [];
  }
}
async function generateSEOTitle(rawTitle, brand) {
  const text2 = await generate(
    `Rewrite this product title for SEO. Max 60 chars. Format: {Brand} {Product Type} {Key Feature}. Remove filler words and explicit language. Replace explicit terms with tasteful equivalents.

Raw title: "${rawTitle}"
Brand: "${brand}"

Return only the rewritten title, no quotes.`,
    256,
    MODEL_FAST
  );
  return text2.trim().slice(0, 60);
}
async function generateProductTitle(input) {
  const original = input.rawTitle.trim();
  const fallbackDescriptor = PRODUCT_TYPE_DESCRIPTOR_FALLBACK[input.productTypeDial] ?? "Vibrator";
  const keywordBlock = input.keywordBlock ?? "";
  const userPrompt = `Compose an SEO-friendly product title for this product. Pull descriptors (material, format, category, size / variant) from the manufacturer's description and assemble them in this standardized order:

  [Material / Feature] [Original Manufacturer Name] [Category Noun] [Size / Variant]

Raw manufacturer title: "${input.rawTitle}"
Product type (dial): ${input.productTypeDial}
${input.rawDescription ? `Manufacturer description (first 600 chars):
${input.rawDescription.slice(0, 600)}` : "(no description provided)"}
${keywordBlock || ""}

Rules (in priority order):
1. PRESERVE branded model names verbatim \u2014 "Sona 2 Cruise", "Magic Wand Original", numbered model names. Treat the manufacturer's chosen name as a proper noun. You may APPEND descriptors after the branded name; never rewrite the name itself.
2. NO BRAND PREFIX \u2014 the PDP shows the brand above the title, so don't include "Hott Products" / "System JO" / "Lelo" etc. Start with the material / feature descriptor or the product name.
3. PULL descriptors from the description, not from imagination. If the description doesn't say "silicone" or "rechargeable", don't add those words.
4. CATEGORY NOUN \u2014 every title ends with (or contains) a clear category word: "Underwear", "Vibrator", "Wand", "Lube", "Lubricant", "Plug", "Massager", "Sleeve", "Kit", etc. If you can't determine one from the description, fall back to: ${fallbackDescriptor}.
5. SIZE / VARIANT \u2014 append size or volume when stated ("16oz", "One-Size", "Medium", "12-Pack"). Skip if not in the source.
6. PLAIN FACTUAL TONE \u2014 no Emma personality, no marketing puffery, no benefit claims ("luxurious", "intense"). Just descriptors.
7. NEVER use em-dashes ("\u2014") or en-dashes ("\u2013"). Hyphens in compound words ("water-based", "soft-touch") are fine.
8. Cap final title at 70 characters total. Trim least-informative descriptor first if over.
9. \`augmented\` should be \`true\` when the new title differs from the raw manufacturer title (which is almost always); \`false\` only when no useful descriptors could be extracted and you preserved the original as-is.

Return ONLY raw JSON (no markdown):
{"title":"<final title>","augmented":<true|false>,"reason":"<one short sentence>"}`;
  let raw;
  try {
    raw = await generate(userPrompt, 256, MODEL, input.llmClient);
  } catch (err) {
    console.warn("[generateProductTitle] Claude call failed, falling back to raw title:", err instanceof Error ? err.message : err);
    return {
      title: original.slice(0, 70),
      augmented: false,
      originalTitle: original,
      reason: "claude error; preserved original"
    };
  }
  let parsed = {};
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    const m = raw.match(/\{[\s\S]*?"title"[\s\S]*?\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
      }
    }
  }
  const finalTitle = (parsed.title ?? original).trim().slice(0, 70);
  const augmented = Boolean(parsed.augmented) && finalTitle !== original;
  const reason = (parsed.reason ?? "").trim() || (augmented ? "augmented with descriptor" : "preserved as-is");
  return {
    title: finalTitle,
    augmented,
    originalTitle: original,
    reason
  };
}
async function generatePairingWhy(input) {
  if (input.candidates.length === 0) {
    return { accessoryProductIds: [], pairingWhy: {} };
  }
  const candidatesBlock = input.candidates.map((c, i) => `${i + 1}. id=${c.productId}
   title="${c.title}"${c.brand ? `, brand="${c.brand}"` : ""}${c.productTypeDial ? `, type=${c.productTypeDial}` : ""}${c.price !== void 0 ? `, price=$${c.price}` : ""}`).join("\n");
  const userPrompt = `You're picking 1\u20133 accessory products that genuinely pair with the primary product, then writing one short Emma-voice "why this pairs" blurb per pick.

Primary product:
Title: ${input.primary.title}
Brand: ${input.primary.brand}
Type: ${input.primary.productTypeDial}
${input.primary.tagline ? `Tagline: ${input.primary.tagline}` : ""}
${input.primary.description ? `Description (200 chars): ${input.primary.description.slice(0, 200)}` : ""}

Accessory candidates:
${candidatesBlock}

Rules:
- Pick 1, 2, or 3 \u2014 only the ones that genuinely complement the primary. Quality over quota.
- Skip any candidate that doesn't fit. Better to return 1 strong pick than 3 weak ones.
- Each blurb: ONE short sentence (\u2264120 chars), Emma voice, first-person friend who's tested it. Explains WHY they pair (not what each product does on its own).
- Voice: warm, curious, witty. Not clinical, not sleazy.
- NEVER use em-dashes ("\u2014"). Hyphens in compound words are fine.
- Don't restate the product titles. Don't name brands.
- If NO candidates are strong fits, return picks: [].

Return ONLY raw JSON (no markdown):
{"picks":[{"id":"<accessoryProductId>","blurb":"<\u2264120 chars Emma voice>"}]}`;
  let raw;
  try {
    raw = await generate(userPrompt, 800, MODEL, input.llmClient);
  } catch (err) {
    console.warn("[generatePairingWhy] Claude call failed:", err instanceof Error ? err.message : err);
    return { accessoryProductIds: [], pairingWhy: {} };
  }
  let parsed = {};
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    const m = raw.match(/\{[\s\S]*?"picks"[\s\S]*?\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
      }
    }
  }
  const validIds = new Set(input.candidates.map((c) => c.productId));
  const accessoryProductIds = [];
  const pairingWhy = {};
  for (const pick of parsed.picks ?? []) {
    if (!pick?.id || !pick?.blurb) continue;
    if (!validIds.has(pick.id)) continue;
    if (accessoryProductIds.includes(pick.id)) continue;
    const blurb = pick.blurb.trim().slice(0, 140);
    if (!blurb) continue;
    accessoryProductIds.push(pick.id);
    pairingWhy[pick.id] = blurb;
    if (accessoryProductIds.length >= 3) break;
  }
  return { accessoryProductIds, pairingWhy };
}
async function generateTweetCopy(deal, llmClient) {
  const discountPct = deal.msrp > 0 ? Math.round(100 - deal.dealPrice / deal.msrp * 100) : 0;
  const productUrl = `https://xdipx.com/products/${deal.handle}`;
  const primaryPrompt = `Write a tweet featuring this product from xdipx.com, an editorially curated sexual wellness storefront.

Product: ${deal.title}
Brand: ${deal.brand}${deal.tagline ? `
Tagline: ${deal.tagline}` : ""}
Price: $${deal.dealPrice} (was $${deal.msrp}) \u2014 ${discountPct}% off
Category: ${deal.category}
Link: ${productUrl}

Rules:
- The main tweet MUST be under 240 characters (leave room for the link)
- Include the product URL at the end: ${productUrl}
- Include 1-2 relevant hashtags from: #SelfCare #PleasurePositive #IntimateWellness #TreatYourself
- Brand voice: playful, cheeky, warm. Never clinical, never sleazy.
- Keep it product-forward. No flash-sale or "today only" urgency framing.
- Include the price if compelling
- Use the \u2665 motif naturally
- NEVER use explicit language or the word "sex" as an adjective

Also write a thread reply (optional second tweet) with 1-2 extra detail sentences if the product warrants it. Max 240 chars. If no thread reply is needed, set threadReply to null.

Return ONLY this JSON (no markdown):
{"mainTweet": "...", "threadReply": "..." or null}`;
  const retryPrompt = `Return ONLY raw JSON, no markdown. Write a product-forward tweet under 240 chars for this product (no flash-sale or "today only" framing). Include the URL ${productUrl} and one hashtag.
{"mainTweet": "...", "threadReply": null}

Product: ${deal.brand} ${deal.title} \u2014 $${deal.dealPrice} (was $${deal.msrp})`;
  const tryParse = (raw) => {
    try {
      const parsed = JSON.parse(stripFences(raw));
      if (parsed?.mainTweet) {
        const result = { mainTweet: parsed.mainTweet };
        if (parsed.threadReply) result.threadReply = parsed.threadReply;
        return result;
      }
    } catch {
    }
    return null;
  };
  const first = await generate(primaryPrompt, 512, MODEL_FAST, llmClient);
  const firstParsed = tryParse(first);
  if (firstParsed) return firstParsed;
  const retried = await generate(retryPrompt, 512, MODEL_FAST, llmClient);
  const secondParsed = tryParse(retried);
  if (secondParsed) return secondParsed;
  return {
    mainTweet: `${deal.brand} ${deal.title}, ${discountPct}% off. $${deal.dealPrice} (was $${deal.msrp}) \u2665

${productUrl}

#SelfCare #IntimateWellness`
  };
}
function pickFormat(category) {
  const lowerCat = category.toLowerCase();
  if (lowerCat.includes("couples")) return "sitcom_sketch";
  if (lowerCat.includes("him") || lowerCat.includes("strok")) return "breaking_news";
  if (lowerCat.includes("her") || lowerCat.includes("vibrat")) return "fake_testimonial";
  if (lowerCat.includes("lube") || lowerCat.includes("lubricant")) return "educational";
  const formats = ["sitcom_sketch", "fake_testimonial", "educational", "breaking_news", "absurdist_narrator"];
  return formats[Math.floor(Math.random() * formats.length)];
}
function stripHtml(value) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
}
async function generateVideoContent(product) {
  const format = product.customFormatDescription ? "custom" : product.forceFormat ?? pickFormat(product.category);
  const fullStory = product.fullStory ? stripHtml(product.fullStory).slice(0, 300) : "";
  const worksForHim = product.worksForHim ? stripHtml(product.worksForHim).slice(0, 200) : "";
  const worksForHer = product.worksForHer ? stripHtml(product.worksForHer).slice(0, 200) : "";
  const specs = product.specifications ? stripHtml(product.specifications).slice(0, 200) : "";
  const inTheBox = product.whatsInTheBox ? stripHtml(product.whatsInTheBox).slice(0, 150) : "";
  const productContext = [
    `Product: ${product.title}`,
    `Brand: ${product.brand}`,
    `Category: ${product.category}`,
    product.tagline ? `Tagline: ${product.tagline}` : "",
    product.dealPrice ? `Deal price: $${product.dealPrice} (was $${product.msrp})` : "",
    fullStory ? `Full story: ${fullStory}` : "",
    worksForHim ? `Works for him: ${worksForHim}` : "",
    worksForHer ? `Works for her: ${worksForHer}` : "",
    specs ? `Specifications: ${specs}` : "",
    inTheBox ? `What's in the box: ${inTheBox}` : ""
  ].filter(Boolean).join("\n");
  const formatDescriptions = {
    sitcom_sketch: "narrator is a well-meaning friend who keeps accidentally describing couples activities in extremely innocent terms",
    fake_testimonial: "narrator is an EXTREMELY enthusiastic stranger who found this product and their life is now unrecognizable, in the best way",
    educational: "narrator is a hilariously underqualified 'expert' delivering 'facts' that are not facts",
    breaking_news: "narrator is reporting BREAKING NEWS with escalating urgency about a very personal problem that this product solves",
    absurdist_narrator: "narrator keeps accidentally describing the product perfectly while appearing to talk about something else entirely"
  };
  const customInstruction = product.customPrompt ? `

ADDITIONAL DIRECTION FROM CREATOR:
${product.customPrompt}
` : "";
  const persona = product.customFormatDescription || formatDescriptions[format] || "narrator delivers a funny, engaging product pitch";
  const prompt = `Write a funny 10-second product ad narration.

Narrator persona: ${persona}${customInstruction}

This is for xdipx.com, an editorially curated sexual wellness storefront.
Brand voice: playful, cheeky, warm. PG-13 strictly \u2014 suggest, never show. Innuendo welcome, explicit never.

Product:
${productContext}

Use the product details above to make the narrator script and reaction text feel specific to THIS product \u2014 not generic wellness copy. Mine the full story and specs for details that are funny, surprising, or unusually specific. A narrator referencing an actual feature ("7 settings" or "whisper quiet" or "USB rechargeable") is always funnier and more trustworthy than one speaking in generalities. Specificity = credibility = conversion.

If works-for-him and works-for-her are both present, the narrator should feel warm and inclusive toward both without assuming who is watching. If only one is present, subtly orient the tone toward that audience without being exclusionary.

Mine specifications and what's-in-the-box for unexpected details that land as humor (e.g. "comes with a satin pouch, because you deserve nice things").

Write the narrator script: 2\u20133 sentences, max 35 words total. Punchy, warm, slightly conspiratorial. Written to be performed aloud, not read. This is the exact voiceover script for a female voice.

Write exactly 2 reaction strings: max 8 words each. Style them like a phone notification or TikTok comment \u2014 a stranger reacting to what the narrator just said. Keep them dry, funny, relatable.
Examples of good reactions: "sir this is a wellness site" / "...adding to cart" / "my therapist said treat yourself so" / "wait this is actually genius"

Also write:
- endTagline: a funny 4\u20138 word closing line for the end card (e.g. "Your body called. We answered." or "Treat yourself. You've earned it, probably.")

Return ONLY this JSON (no markdown):
{
  "formatRationale": "one sentence why this format fits this product",
  "narratorScript": "...",
  "reactionText": ["...", "..."],
  "endTagline": "..."
}`;
  const raw = await generate(prompt, 1024);
  let parsed;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    const match = raw.match(/\{[\s\S]*?"narratorScript"[\s\S]*?\}/);
    if (match) {
      parsed = JSON.parse(match[0]);
    } else {
      parsed = {
        formatRationale: "Fallback content",
        narratorScript: `${product.tagline ?? `${product.brand} ${product.title}. Today only at xdipx.`}`,
        reactionText: ["...adding to cart", "my therapist said treat yourself so"],
        endTagline: "One deal. One day. No regrets."
      };
    }
  }
  const titleSum = product.title.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const ctaWord = CTA_WORDS[titleSum % CTA_WORDS.length];
  return {
    format,
    formatRationale: parsed.formatRationale,
    narratorScript: parsed.narratorScript,
    reactionText: parsed.reactionText ?? ["...adding to cart", "my therapist said treat yourself so"],
    endTagline: parsed.endTagline,
    ctaWord
  };
}
async function enhanceVeoPrompt(opts) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: VEO_SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: `Enhance this video idea into a detailed Google Veo prompt. IMPORTANT: The user's idea IS the creative direction \u2014 keep it as the core of your prompt and build around it with cinematic detail.

THE VIDEO IDEA: "${opts.userIdea}"

Product: ${opts.productTitle} by ${opts.productBrand}${opts.productCategory ? ` (${opts.productCategory})` : ""}
${opts.hasStartingImage ? opts.imageMode === "reference" ? "Mode: TEXT-TO-VIDEO with REFERENCE IMAGE \u2014 a product photo is included as visual context (NOT the first frame). The video should feature the product as it appears in the reference image." : "Mode: IMAGE-TO-VIDEO \u2014 the starting frame is a product photo. Describe how the scene evolves FROM that image." : "Mode: TEXT-TO-VIDEO \u2014 describe the full scene from scratch."}
Aspect: ${opts.aspectRatio} (${opts.aspectRatio === "16:9" ? "landscape" : "vertical"}) | Duration: ${opts.durationSeconds}s

Take the user's idea above and enrich it with:
- Camera work (angle, movement: pan, dolly, tracking, etc.)
- Lighting (golden hour, soft diffusion, neon, etc.)
- Depth of field / focus effects
- Audio: dialogue in quotes, sound effects, ambient noise

Stay true to what the user described. Don't replace their concept with something different. Add production detail, don't reimagine.

Return ONLY the enhanced prompt as one flowing paragraph. No labels, no markdown.`
    }]
  });
  const block = msg.content[0];
  if (block?.type !== "text") throw new Error("Unexpected Claude response type for Veo prompt");
  const uVeo = msg.usage;
  void Promise.resolve().then(() => (init_token_log_server(), token_log_server_exports)).then(
    ({ logApiTokens: logApiTokens2 }) => logApiTokens2({
      feature: "video-prompt",
      model: MODEL,
      source: "sync",
      caller: "enhanceVeoPrompt",
      inputTokens: uVeo.input_tokens,
      outputTokens: uVeo.output_tokens,
      cacheCreationTokens: uVeo.cache_creation_input_tokens ?? 0,
      cacheReadTokens: uVeo.cache_read_input_tokens ?? 0
    })
  ).catch((err) => console.error("[claude] enhanceVeoPrompt token-log failed (ignored):", err));
  return block.text.trim();
}
async function enhanceLtxPrompt(opts) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: LTX_SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: `Enhance this video idea into a detailed LTX Video prompt using the three-layer structure. IMPORTANT: The user's idea IS the creative direction \u2014 keep it as the core and build cinematic detail around it.

THE VIDEO IDEA: "${opts.userIdea}"

Product: ${opts.productTitle} by ${opts.productBrand}${opts.productCategory ? ` (${opts.productCategory})` : ""}

FIRST FRAME: The starting frame is a product photo \u2014 the model already sees it. DO NOT re-describe the product's appearance, color, shape, or packaging. Jump straight into what happens next.

Duration: ${opts.durationSeconds}s \u2014 scale your detail proportionally. ${opts.durationSeconds <= 8 ? "Keep it tight: 3-5 sentences." : opts.durationSeconds <= 15 ? "Medium detail: 5-8 sentences with temporal progression." : "Full detail: 8-12 sentences with phases of motion, mid-video shifts, and an ending beat."}
Resolution: ${opts.resolution}
${opts.cameraMotion ? `Camera direction: "${opts.cameraMotion.replace(/_/g, " ")}" \u2014 use this as the Camera Movement layer. Integrate it specifically (e.g., if "dolly in", describe pace and target of the dolly).` : "No camera direction specified \u2014 choose an appropriate camera movement for the Subject Action."}

Build the prompt with these three layers in order:
1. SUBJECT ACTION \u2014 what moves, how, the hero moment
2. CAMERA MOVEMENT \u2014 specific cinematographic terms
3. ENVIRONMENT/ATMOSPHERE \u2014 what shifts in lighting, particles, reflections, color temperature

Return ONLY the enhanced prompt as one flowing paragraph. No labels, no markdown, no layer headings.`
    }]
  });
  const block = msg.content[0];
  if (block?.type !== "text") throw new Error("Unexpected Claude response type for LTX prompt");
  const uLtx = msg.usage;
  void Promise.resolve().then(() => (init_token_log_server(), token_log_server_exports)).then(
    ({ logApiTokens: logApiTokens2 }) => logApiTokens2({
      feature: "video-prompt",
      model: MODEL,
      source: "sync",
      caller: "enhanceLtxPrompt",
      inputTokens: uLtx.input_tokens,
      outputTokens: uLtx.output_tokens,
      cacheCreationTokens: uLtx.cache_creation_input_tokens ?? 0,
      cacheReadTokens: uLtx.cache_read_input_tokens ?? 0
    })
  ).catch((err) => console.error("[claude] enhanceLtxPrompt token-log failed (ignored):", err));
  return block.text.trim();
}
async function selectAccessories(mainProduct, candidates, count = 3) {
  if (candidates.length === 0) return [];
  const productList = candidates.slice(0, 20).map(
    (p) => `SKU: ${p.sku} | Title: ${p.title} | Brand: ${p.brand} | Categories: ${p.categories.join(", ")}`
  ).join("\n");
  const raw = await generate(
    `You are selecting complementary add-on products for a daily deal.

Main product: "${mainProduct.title}" by ${mainProduct.brand}
Categories: ${mainProduct.categories.join(", ")}

From the candidates below, choose exactly ${count} products that would work as accessories or perfect pairings \u2014 things that complete the experience or enhance the main product.

Good pairings: lubricants with toys, cleaners/maintenance items, charging accessories, enhancement items that serve a complementary function.
Do NOT pick products in the same primary category as the main product \u2014 those are competitors, not accessories.
Prefer variety \u2014 don't pick ${count} of the same type.

Return a JSON array of exactly ${count} SKU strings. Example: ["SKU1", "SKU2", "SKU3"]
Return only the JSON array, no markdown.

Candidates:
${productList}`
  );
  try {
    const parsed = JSON.parse(stripFences(raw));
    return Array.isArray(parsed) ? parsed.slice(0, count) : [];
  } catch {
    return [];
  }
}
async function generateBlogOutline(topic, keywords = [], category) {
  const raw = await generate(
    `Create a detailed blog post outline for the xdipx.com blog.

Topic: ${topic}
${keywords.length ? `SEO keywords to target: ${keywords.join(", ")}` : ""}
${category ? `Category: ${category}` : ""}

The blog covers sexual wellness topics \u2014 guides, tips, product roundups, relationship advice.
Voice: playful, cheeky, warm, judgment-free. Never clinical or sleazy.

Return a JSON object with:
- "title": an engaging, SEO-friendly headline (max 70 chars)
- "sections": array of { "heading": "H2 section title", "bullets": ["key point 1", "key point 2", ...] }
  Include 4-6 sections with 2-4 bullets each.
- "suggestedTags": array of 3-5 tag strings for categorization

Return only the JSON object, no markdown fences.`,
    2048
  );
  try {
    return JSON.parse(stripFences(raw));
  } catch {
    return {
      title: topic,
      sections: [{ heading: "Introduction", bullets: ["Overview of the topic"] }],
      suggestedTags: []
    };
  }
}
async function generateBlogDraft(outline) {
  const sectionsText = outline.sections.map((s) => `## ${s.heading}
${s.bullets.map((b) => `- ${b}`).join("\n")}`).join("\n\n");
  const raw = await generate(
    `Write a full blog post draft for the xdipx.com blog based on this outline.

Title: ${outline.title}

Outline:
${sectionsText}

Write in xdipx brand voice: playful, cheeky, warm, curious, judgment-free.
Return valid HTML using: <h2>, <h3>, <p>, <strong>, <em>, <ul>/<li>, <blockquote>.
No <html>, <head>, <body>, or <h1> tags.
Each section should be 2-3 paragraphs.
Include a brief intro paragraph before the first section.
End with a wrap-up that includes a subtle CTA to browse xdipx deals.
Make it genuinely entertaining \u2014 innuendo and tasteful humor welcome.
Target word count: 800-1200 words.`,
    4096
  );
  if (raw.includes("<h2>") || raw.includes("<p>")) return raw.trim();
  return `<p>${raw.trim()}</p>`;
}
function emmaHeroFallback(deal, variant, voiceHash) {
  const base = {
    variant,
    eyebrow: "Kinda obsessed",
    headline: deal.tagline || `This ${deal.brand} one earned its spot for a reason.`,
    body: `Slow-burn build, surprisingly gentle finish. If you want something that feels considered, not gimmicky, this is the one.`,
    aside: `Emma, on the specs: worth the closer look`,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    voiceHash
  };
  if (variant === "quote") base.pullQuote = `"This one earned its spot."`;
  return base;
}
async function generateEmmaHero(opts) {
  const variant = opts.variant ?? (opts.deal.mapRestricted ? "quote" : "loving");
  const brandVoice = opts.brandVoice ?? await getPipelineSetting("brandVoice") ?? DEFAULT_BRAND_VOICE;
  const voiceHash = createHash3("sha1").update(brandVoice).digest("hex").slice(0, 12);
  const discountPct = opts.deal.msrp > 0 && opts.deal.dealPrice > 0 ? Math.round((opts.deal.msrp - opts.deal.dealPrice) / opts.deal.msrp * 100) : 0;
  const mapLine = opts.deal.mapRestricted ? "MAP-restricted \u2014 no discount claims, no percent-off language, no struck prices." : discountPct > 0 ? `Currently ${discountPct}% off MSRP \u2014 you may allude to value, but never in "buy now" or countdown language.` : "";
  const systemBlocksForHero = await buildEmmaSystemBlocks(opts.brandVoice);
  const user = `Write the Emma hero block for the homepage of xdipx.com. Variant: "${variant}".

Product context (do NOT echo \u2014 rewrite in Emma's voice):
- Title: ${opts.deal.seoTitle}
- Brand: ${opts.deal.brand}
- Category: ${opts.deal.category.join(", ")}
${opts.deal.tagline ? `- Existing tagline (for context only): ${opts.deal.tagline}` : ""}
${opts.deal.fullStory ? `- Full story (context only, strip HTML): ${opts.deal.fullStory.replace(/<[^>]+>/g, " ").slice(0, 400)}` : ""}
${mapLine}

Return ONLY this JSON (no markdown):
{
  "eyebrow":   "A DYNAMIC FEELING in Emma's own voice \u2014 2\u20134 words, first-person, informal. Examples: 'Kinda obsessed', 'Low-key amazed', 'Still thinking about this', 'Quietly sold', 'Actually impressed'. No period. Do NOT use 'Currently loving' or generic editorial phrases like 'This week's pick'. Must feel like a quick reaction, not a label.",
  "headline":  "ONE sentence (8\u201314 words) that explains WHY Emma is featuring this pick right now \u2014 the reason it earned the slot. First-person, specific, warm. Never starts with the product name. Never 'buy now'. Example shape: 'Something about how quiet this one is just broke my brain.'",
  "body":      "1\u20132 short sentences (25\u201345 words total) \u2014 the highlights a shopper should know. What it feels like, what stands out, what surprised her. Tight and specific. No marketing bloat. No clinical language.",
  "aside":     "'\u2014 Emma \xB7 <3\u20136 word aside>', e.g. '\u2014 Emma \xB7 still on my desk'"${variant === "quote" ? `,
  "pullQuote": "one short pull-quote (6\u201312 words) \u2014 in quotes \u2014 a friend-to-friend endorsement. No price or discount language."` : ""}
}`;
  async function attempt(tries = 2) {
    for (let i = 0; i < tries; i++) {
      try {
        const { text: text2 } = await callClaude({
          llmClient: opts.llmClient,
          model: MODEL,
          maxTokens: 800,
          systemBlocks: systemBlocksForHero,
          userPrompt: user
        });
        const parsed = JSON.parse(stripFences(text2));
        if (parsed.eyebrow && parsed.headline && parsed.body && parsed.aside) {
          const out = {
            variant,
            eyebrow: parsed.eyebrow,
            headline: parsed.headline,
            body: parsed.body,
            aside: parsed.aside,
            generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
            voiceHash
          };
          if (variant === "quote" && parsed.pullQuote) out.pullQuote = parsed.pullQuote;
          return out;
        }
      } catch (err) {
        if (i === tries - 1) throw err;
      }
    }
    throw new Error("unreachable");
  }
  try {
    return await attempt(2);
  } catch (err) {
    console.error("[generateEmmaHero] falling back to hardcoded copy:", err);
    return emmaHeroFallback(opts.deal, variant, voiceHash);
  }
}
async function generateEmmaTagline() {
  const system = `You are Emma, xdipx's AI guide. You write like a trusted, funny friend. Tasteful, warm, curious. Never clinical. Never sleazy. Never "sex" as an adjective.

${EMMA_VOICE_CORE}`;
  const user = `Write ONE short tagline for the Emma chat window's status line. It sits right under "Ask Emma \xB7 Online".

Rules:
- 5 to 9 words, lowercase (first word may be capitalized).
- First-person Emma voice.
- Ends with the \u2665 glyph (exactly one).
- No quotes, no period, no emoji other than \u2665.
- No "buy now", no countdown, no pricing, no "sex" as adjective.
- Never claim lived experience (no "I've tried", "I've tested"). Speak from catalog knowledge.
- Feel friendly and specific, the kind of thing a friend might say when you open the chat. Examples of the vibe (don't copy): "here to help you find what you're into \u2665", "pick my brain, I know the catalog cold \u2665".

Return ONLY the tagline text, nothing else.`;
  try {
    const msg = await client.messages.create({
      model: MODEL_FAST,
      max_tokens: 80,
      system,
      messages: [{ role: "user", content: user }]
    });
    const block = msg.content[0];
    if (block?.type !== "text") throw new Error("non-text response");
    const uTagline = msg.usage;
    void Promise.resolve().then(() => (init_token_log_server(), token_log_server_exports)).then(
      ({ logApiTokens: logApiTokens2 }) => logApiTokens2({
        feature: "contextual-tagline",
        model: MODEL_FAST,
        source: "sync",
        caller: "generateEmmaTagline",
        inputTokens: uTagline.input_tokens,
        outputTokens: uTagline.output_tokens,
        cacheCreationTokens: uTagline.cache_creation_input_tokens ?? 0,
        cacheReadTokens: uTagline.cache_read_input_tokens ?? 0
      })
    ).catch((err) => console.error("[claude] generateEmmaTagline token-log failed (ignored):", err));
    const line = block.text.trim().replace(/^["'`]|["'`]$/g, "").replace(/\s+/g, " ").split("\n")[0]?.trim();
    if (line && line.length > 4 && line.length <= 80 && line.includes("\u2665")) return line;
    if (line && line.length > 4 && line.length <= 80) return `${line} \u2665`;
  } catch (err) {
    console.error("[generateEmmaTagline] falling back:", err);
  }
  return EMMA_TAGLINE_FALLBACKS[Math.floor(Math.random() * EMMA_TAGLINE_FALLBACKS.length)];
}
async function generateBlogSEO(title, excerpt) {
  const raw = await generate(
    `Generate SEO metadata for this blog post on xdipx.com (an editorially curated sexual wellness storefront).

Title: ${title}
Excerpt: ${excerpt}

Return a JSON object with:
- "seoTitle": optimized page title, max 70 chars. Include primary keyword near the start.
- "seoDescription": meta description, exactly 140-160 chars. Include a benefit and CTA. Conversational tone.
- "suggestedTags": array of 3-5 relevant tags for the post.

Return only the JSON object, no markdown.`
  );
  try {
    return JSON.parse(stripFences(raw));
  } catch {
    return {
      seoTitle: title.slice(0, 70),
      seoDescription: excerpt.slice(0, 160),
      suggestedTags: []
    };
  }
}
async function generateEmmaTake(opts) {
  const systemBlocksForTake = await buildEmmaSystemBlocks(opts.brandVoice);
  const user = `Write Emma's "take" on this product. It appears at the top of the PDP \u2014 a friend-to-friend honest read. This is THE customer-facing voice surface; treat it accordingly.

Product:
- Title: ${opts.deal.seoTitle}
- Brand: ${opts.deal.brand}
- Category: ${opts.deal.category.join(", ")}
${opts.deal.productTypeDial ? `- Type: ${opts.deal.productTypeDial}` : ""}
${opts.deal.tagline ? `- Tagline (context only \u2014 DO NOT echo in first sentence): ${opts.deal.tagline}` : ""}
${opts.deal.fullStory ? `- Existing story (context, strip HTML): ${opts.deal.fullStory.replace(/<[^>]+>/g, " ").slice(0, 600)}` : ""}

Cover, in this order, in your own voice (no headings, just flowing paragraphs):
1. Who this clicks for \u2014 what they're after, what they'll like.
2. Why it's worth exploring \u2014 what makes it intriguing, approachable, or fun to try. POSITIVE INVITATION. NEVER tell anyone to skip this product. NEVER gatekeep.
3. How to get the most out of it \u2014 a tip Emma would whisper to a friend.

Constraints:
- Under 100 words total. One paragraph (or two very short ones, max). The PDP shows this above a "...more" expand fold; staying tight means readers see all three beats without clicking.
- Return clean HTML \u2014 only <p>, <em>, <strong> tags. No headings, no <ul>, no inline styles, no class attrs.
- First-person Emma voice throughout. Present tense. No "Buy now". No countdowns. No clinical language.
- Do NOT mention price, MAP, or discounts.
- Do NOT echo the product title OR tagline in the first sentence.
- "sex" and "sexy" are allowed where contextually relevant to the product and customer discovery (e.g. "sex toy", "safer sex", "sexy gift"). Default to "intimate"/"pleasure"/"wellness" for general voice \u2014 don't drop "sex" in for SEO bait.
- NO em-dashes ("\u2014" or "\u2013"). Use periods, commas, or parentheses.

Return ONLY the HTML \u2014 no markdown, no fences, no preamble.`;
  try {
    const { text: text2 } = await callClaude({
      llmClient: opts.llmClient,
      model: MODEL,
      maxTokens: 800,
      systemBlocks: systemBlocksForTake,
      userPrompt: user
    });
    return stripFences(text2).trim();
  } catch (err) {
    console.error("[generateEmmaTake] failed:", err);
    throw err;
  }
}
async function generateCareInstructions(opts) {
  const CONSUMABLE_TYPES = /* @__PURE__ */ new Set([
    "lube",
    "massage",
    "enhancer",
    "condom"
  ]);
  const isConsumable = opts.deal.productTypeDial !== void 0 && CONSUMABLE_TYPES.has(opts.deal.productTypeDial);
  const user = isConsumable ? `Write 2 or 3 short care/storage bullets for this consumable product. Each is one playful, SEO-friendly sentence \u2014 under 16 words. Goal: fill the PDP "Care" card with something genuinely useful and a little fun, NOT a maintenance manual.

Product:
- Title: ${opts.deal.seoTitle}
- Type: ${opts.deal.productTypeDial}
${opts.deal.specifications?.length ? `- Specs (context): ${opts.deal.specifications.join("; ").slice(0, 400)}` : ""}

Tone:
- This stuff takes care of you more than you take care of it.
- Cover what actually matters: where to keep it, when to use it, how it plays with toys / condoms / skin (if relevant), shelf life.
- SPECIFIC OVER GENERIC. "Store wherever you intend to use it most" beats "store in a cool, dry place." "Stays slick from morning shower to midnight nightstand" beats "long-lasting formula."
- The word "sex" or "sexy" is allowed where it fits naturally and helps SEO.
- No em-dashes ("\u2014" or "\u2013"). Use periods, commas, or parentheses.

Return ONLY a JSON array of strings (2\u20133 items). Example: ["Stays slick from morning shower to midnight nightstand.", "Plays well with silicone toys, latex condoms, and sensitive skin."]
No markdown, no fences, no commentary.` : `Write 3 to 5 short care instructions for this product. Each is one short imperative sentence \u2014 under 14 words.

Product:
- Title: ${opts.deal.seoTitle}
- Brand: ${opts.deal.brand}
- Category: ${opts.deal.category.join(", ")}
${opts.deal.productTypeDial ? `- Type: ${opts.deal.productTypeDial}` : ""}
${opts.deal.specifications?.length ? `- Specs (context): ${opts.deal.specifications.join("; ").slice(0, 500)}` : ""}

Cover what actually matters for this object \u2014 cleaning, charging/storage, lube compatibility (where relevant), what to avoid. Practical, not clinical.

SPECIFIC OVER GENERIC. "Tucks back into the storage pouch; charges off any USB-C" beats "Store in a cool, dry place." "Wipe with mild soap and warm water after use" beats "Clean before storage."

No em-dashes ("\u2014" or "\u2013"). Use periods, commas, or parentheses.

Return ONLY a JSON array of strings. Example: ["Wipe with mild soap and warm water after each use.", "Air-dry before storing in the included pouch."]
No markdown, no fences, no commentary.`;
  try {
    const { text: text2 } = await callClaude({
      llmClient: opts.llmClient,
      model: MODEL_FAST,
      maxTokens: 400,
      systemBlocks: await buildEmmaSystemBlocks(),
      userPrompt: user
    });
    const parsed = JSON.parse(stripFences(text2));
    if (!Array.isArray(parsed)) throw new Error("expected array");
    const bullets = parsed.filter((x) => typeof x === "string").map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 160).slice(0, 5);
    const minRequired = isConsumable ? 2 : 3;
    if (bullets.length < minRequired) throw new Error(`only ${bullets.length} valid bullets returned (needed ${minRequired})`);
    return bullets;
  } catch (err) {
    console.error("[generateCareInstructions] failed:", err);
    throw err;
  }
}
async function generateProductFaqs(opts) {
  const tagsLine = [
    opts.deal.moodTags?.length ? `mood: ${opts.deal.moodTags.join(", ")}` : "",
    opts.deal.audienceTags?.length ? `audience: ${opts.deal.audienceTags.join(", ")}` : "",
    opts.deal.mattersTags?.length ? `matters: ${opts.deal.mattersTags.join(", ")}` : ""
  ].filter(Boolean).join(" / ");
  const descriptionHtmlText = opts.deal.descriptionHtml ? opts.deal.descriptionHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600) : "";
  const careInstructionsText = Array.isArray(opts.deal.careInstructions) && opts.deal.careInstructions.length > 0 ? opts.deal.careInstructions.join(" | ").slice(0, 500) : "";
  const user = `Generate 6 to 8 FAQs for this product's PDP. They render visibly AND get emitted as FAQPage JSON-LD \u2014 visible text must match structured text (no hidden content).

Product:
- Title: ${opts.deal.seoTitle}
- Brand: ${opts.deal.brand}
- Category: ${opts.deal.category.join(", ")}
${opts.deal.productTypeDial ? `- Type: ${opts.deal.productTypeDial}` : ""}
${opts.deal.tagline ? `- Tagline (context): ${opts.deal.tagline}` : ""}
${tagsLine ? `- Tags: ${tagsLine}` : ""}
${opts.deal.specifications?.length ? `- Specs (context): ${opts.deal.specifications.join("; ").slice(0, 500)}` : ""}
${opts.deal.fullStory ? `- Existing story (context, strip HTML): ${opts.deal.fullStory.replace(/<[^>]+>/g, " ").slice(0, 600)}` : ""}

DIFFERENTIATION CONTEXT (what's already covered elsewhere on the PDP):
${descriptionHtmlText ? `- Emma's Take (descriptionHtml \u2014 narrative beat: who it clicks for / why explore / Emma's tip):
  ${descriptionHtmlText}
` : ""}${careInstructionsText ? `- Care card (careInstructions \u2014 structured imperatives covering cleaning / charging / storage / lube compat):
  ${careInstructionsText}
` : ""}
**Each FAQ must be DISTINCT from the description and care instructions above. If the answer would just restate content from those surfaces, SKIP that FAQ \u2014 better fewer distinct entries than overlap.**

Coverage requirements + DIFFERENTIATION RULES per category:

- \`general\` \u2014 1 to 2 entries.
  Focus: practical "what is this" \u2014 product type, primary feature, basic spec.
  Good: "What kind of stimulation does this provide?", "Is this rechargeable?", "What's the runtime on a full charge?"
  AVOID: "Who is this for?" / "Who clicks for this?" \u2014 already covered in Emma's Take.

- \`usage\` \u2014 1 to 2 entries.
  Focus: practical operation \u2014 controls, modes, setup, partner/solo.
  Good: "How do I switch between intensity levels?", "Can I use this in the shower?", "Does it work with a partner or solo?"
  AVOID: "How do I get the most out of it?" \u2014 already covered in Emma's Take.

- \`care\` \u2014 **2 to 3 entries (REQUIRED for SEO).** Each must hit a DIFFERENT care angle from the list below.
  Focus: customer-question framings that COMPLEMENT (do not restate) the structured care card.
  Distinct angles to choose 2-3 from:
    \u2022 Safety / sharing \u2014 "Is it safe to share with a partner?", "Do I need a condom or barrier when sharing?"
    \u2022 Material safety \u2014 "Is the material body-safe?", "Is this phthalate-free?", "Is it hypoallergenic?"
    \u2022 Battery / power longevity \u2014 "How long does the battery last on a full charge?", "What if it stops charging?", "How long until I need to replace the battery?"
    \u2022 Lifespan / replacement \u2014 "How long should this last with regular use?", "When should I retire it?"
    \u2022 Travel / on-the-go \u2014 "Can I take this on a plane?", "Will the charger work internationally?", "Is it discreet for travel?"
    \u2022 Lube + material compatibility \u2014 "Which lubes are safe with this material?", "Will silicone lube damage the surface?"
  AVOID: "How do I clean it?" / "How do I store it?" / "How do I charge it?" \u2014 already in the care card.

- \`compatibility\` \u2014 OPTIONAL. Only when relevant: lube\u2194toy materials (if not already covered in care), sleeve sizing, app/Bluetooth requirements, condom safety.

- \`shipping\` \u2014 OPTIONAL. Only for non-standard shipping (oversize, restricted regions). Otherwise SKIP entirely.

Question rules:
- Full natural-language sentences ("How long does it take to charge?") \u2014 never keyword fragments.
- Each question 10\u2013160 chars. Each unique.
- Phrase the way a real customer would type into search or ask out loud.

Answer rules:
- 1\u20133 sentences, 40\u2013800 chars. Emma voice \u2014 friendly, factual, specific.
- Plain text only. No markdown, no HTML, no URLs, no emoji.
- NO em-dashes ("\u2014" or "\u2013"). Use periods, commas, or parentheses instead.
- The words "sex" and "sexy" are allowed where contextually relevant to the product and customer discovery \u2014 FAQs benefit from these terms for SEO + LLM-citer indexing.
- Don't invent specs not in the source (no fabricated battery life, dimensions, materials).

Return ONLY raw JSON (no markdown). An array of objects: [{ "question": "...", "answer": "...", "category": "general|care|usage|compatibility|shipping" }, ...]`;
  const parseFaqs = (raw) => {
    const parsed = JSON.parse(stripFences(raw));
    if (!Array.isArray(parsed)) throw new Error("expected array");
    const faqs = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry;
      const question = typeof e.question === "string" ? e.question.trim() : "";
      const answer = typeof e.answer === "string" ? e.answer.trim() : "";
      const category = typeof e.category === "string" ? e.category.trim() : "";
      if (question.length < 10 || question.length > 160) continue;
      if (answer.length < 40 || answer.length > 800) continue;
      if (!PRODUCT_FAQ_CATEGORIES.includes(category)) continue;
      faqs.push({ question, answer, category });
    }
    return faqs;
  };
  const trimWithCoverage = (faqs) => {
    const caps = {
      care: 3,
      general: 2,
      usage: 2,
      compatibility: 1,
      shipping: 1
    };
    const taken = [];
    const counts = {};
    for (const f of faqs) {
      if (taken.length >= 8) break;
      const cap = caps[f.category];
      const cur = counts[f.category] ?? 0;
      if (cur >= cap) continue;
      taken.push(f);
      counts[f.category] = cur + 1;
    }
    return taken;
  };
  try {
    const { text: text2 } = await callClaude({
      llmClient: opts.llmClient,
      model: MODEL,
      maxTokens: 2500,
      systemBlocks: await buildEmmaSystemBlocks(),
      userPrompt: user
    });
    let faqs = parseFaqs(text2);
    const careCount = (arr) => arr.filter((f) => f.category === "care").length;
    if (careCount(faqs) < 2) {
      const existingCareQs = faqs.filter((f) => f.category === "care").map((f) => `- ${f.question}`).join("\n") || "(none yet)";
      const careTopUp = `The first FAQ pass for this product produced fewer than 2 \`care\` entries. Generate ${2 - careCount(faqs) + 1} additional \`care\` FAQs that COMPLEMENT (do not restate) the structured care card AND are DISTINCT from these existing care entries:

${existingCareQs}

Each new FAQ must hit a DIFFERENT care angle (safety/sharing, material safety, battery/power longevity, lifespan/replacement, travel/on-the-go, or lube\u2194material compatibility) from the others.

Same product context, same answer rules (40\u2013800 chars, plain text, no em-dashes, Emma voice).
Return ONLY raw JSON array of objects: [{ "question": "...", "answer": "...", "category": "care" }, ...]

Product:
- Title: ${opts.deal.seoTitle}
- Brand: ${opts.deal.brand}
${opts.deal.productTypeDial ? `- Type: ${opts.deal.productTypeDial}` : ""}
${opts.deal.specifications?.length ? `- Specs (context): ${opts.deal.specifications.join("; ").slice(0, 400)}` : ""}
${careInstructionsText ? `- Care card already covers (do NOT restate): ${careInstructionsText}` : ""}`;
      try {
        const { text: retryText } = await callClaude({
          llmClient: opts.llmClient,
          model: MODEL,
          maxTokens: 1200,
          systemBlocks: await buildEmmaSystemBlocks(),
          userPrompt: careTopUp
        });
        const extras = parseFaqs(retryText).filter((f) => f.category === "care");
        const seen = new Set(faqs.map((f) => f.question.toLowerCase()));
        for (const e of extras) {
          if (seen.has(e.question.toLowerCase())) continue;
          faqs.push(e);
          seen.add(e.question.toLowerCase());
        }
      } catch (err) {
        console.warn("[generateProductFaqs] care top-up failed (continuing with primary batch):", err instanceof Error ? err.message : err);
      }
    }
    const trimmed = trimWithCoverage(faqs);
    if (trimmed.length < 3) throw new Error(`only ${trimmed.length} valid FAQs returned`);
    if (careCount(trimmed) < 1) {
      console.warn(`[generateProductFaqs] no care FAQs after retry \u2014 Care card will fall back to careInstructions bullets`);
    } else if (careCount(trimmed) < 2) {
      console.warn(`[generateProductFaqs] only 1 care FAQ after retry \u2014 below the SEO target of 2-3`);
    }
    return trimmed;
  } catch (err) {
    console.error("[generateProductFaqs] failed:", err);
    throw err;
  }
}
async function generateSensationDialV2(opts) {
  const type = opts.deal.productTypeDial ?? "vibrator";
  const taxonomyBlock = (() => {
    if (!opts.taxonomy?.length) return "";
    const lines = opts.taxonomy.map((d) => {
      const head = `- ${d.label}${d.definition ? `: ${d.definition}` : ""}`;
      const scale = [];
      if (d.scaleLow) scale.push(`1 = ${d.scaleLow}`);
      if (d.scaleMid) scale.push(`3 = ${d.scaleMid}`);
      if (d.scaleHigh) scale.push(`5 = ${d.scaleHigh}`);
      return scale.length > 0 ? `${head}
  scale: ${scale.join(" | ")}` : head;
    });
    return `

Dimension definitions and value scales (use these to anchor your scoring \u2014 same dimension should mean the same thing across products):
${lines.join("\n")}`;
  })();
  const labelList = opts.preferredLabels.length > 0 ? opts.preferredLabels.map((l) => `- ${l}`).join("\n") : "(none \u2014 invent appropriate labels)";
  const user = `Build the "How it feels" sensation dial for this product. 5 to 6 dimensions, each scored 1 to 5 (5 = most).

Product:
- Title: ${opts.deal.seoTitle}
- Brand: ${opts.deal.brand}
- Category: ${opts.deal.category.join(", ")}
- Type: ${type}
${opts.deal.tagline ? `- Tagline: ${opts.deal.tagline}` : ""}
${opts.deal.fullStory ? `- Story (context, strip HTML): ${opts.deal.fullStory.replace(/<[^>]+>/g, " ").slice(0, 500)}` : ""}
${opts.deal.specifications?.length ? `- Specs (context): ${opts.deal.specifications.join("; ").slice(0, 400)}` : ""}

Preferred labels for this product type (use these when they fit):
${labelList}${taxonomyBlock}

If a different label clearly fits this product better than any of the preferred ones, propose the new label and set "proposed": true. Otherwise reuse a preferred label exactly as written and omit "proposed". Do not propose a synonym of a preferred label \u2014 propose only when the dimension is genuinely different.

Return ONLY this JSON shape (no markdown, no fences):
{
  "items": [
    { "label": "Intensity", "value": 4 },
    { "label": "Quietness", "value": 5 },
    { "label": "Suction strength", "value": 3, "proposed": true }
  ]
}

Rules:
- 5 or 6 items, no duplicates.
- Each "value" is an integer from the set {1, 2, 3, 4, 5}. No half-steps. No values outside 1\u20135.
- Keep labels under 24 chars, sentence case, no trailing punctuation.
- Honest scoring \u2014 don't max everything. Use the dimension scale docs above (when present) to anchor "what 3 vs 5 means" \u2014 consistency across products matters.

Spread requirements (CRITICAL \u2014 dials look identical across products when these are ignored):
- Use the full 1\u20135 range. Across the 5 or 6 dimensions, the values MUST span at least 3 distinct integers (e.g. {2, 3, 4, 5} is fine; {4, 4, 5, 5, 5} is not).
- At MOST one dimension may be a 5. At MOST one dimension may be a 1.
- The product's defining strength gets the 5; everything else is scored honestly relative to category peers. A "medium" wand is a 3 on intensity by default, not a 4. A "quiet" device is a 4 on quietness, not a 5 unless it's near-silent.
- If you find yourself writing 4 or 5 on more than two dimensions, drop the weakest of those dimensions to a 3 or below before returning.`;
  const { text: text2 } = await callClaude({
    llmClient: opts.llmClient,
    model: MODEL_FAST,
    maxTokens: 600,
    systemBlocks: await buildEmmaSystemBlocks(),
    userPrompt: user
  });
  const parsed = JSON.parse(stripFences(text2));
  if (!parsed.items || !Array.isArray(parsed.items)) throw new Error("missing items array");
  const seen = /* @__PURE__ */ new Set();
  const items = [];
  for (const raw of parsed.items) {
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    const value = typeof raw.value === "number" ? Math.round(raw.value) : NaN;
    if (!label || label.length > 30) continue;
    if (!Number.isFinite(value) || value < 1 || value > 5) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const item = { label, value };
    if (raw.proposed === true) item.proposed = true;
    items.push(item);
    if (items.length >= 6) break;
  }
  if (items.length < 5) throw new Error(`only ${items.length} valid dial items returned`);
  const distinct = new Set(items.map((i) => i.value)).size;
  const fives = items.filter((i) => i.value === 5).length;
  const ones = items.filter((i) => i.value === 1).length;
  if (distinct < 3 || fives > 1 || ones > 1) {
    console.warn(
      `[sensation-dial] spread violation: distinct=${distinct} fives=${fives} ones=${ones} values=[${items.map((i) => i.value).join(",")}] product="${opts.deal.seoTitle}"`
    );
  }
  return { items };
}
function mapLegacyDialBucket(legacy) {
  if (legacy === "air-pulsation" || legacy === "wand" || legacy === "vibrator") return "vibrator";
  if (legacy === "lube") return "lube";
  if (legacy === "wear") return "wear";
  return null;
}
async function inferProductTypeDial(input) {
  const user = `Classify the product into ONE of these buckets (return exactly one):
- air-pulsation  (clitoral suction / air-pulse / pressure-wave devices)
- vibrator       (internal/external vibrators, rabbits, bullets, couples vibes)
- wand           (large-format wand massagers, corded or rechargeable)
- lube           (lubricants, gels, oils, intimate moisturizers)
- wear           (lingerie, harnesses, panties, apparel, restraints, accessories worn on the body)

Product:
- Title: ${input.title}
- Brand: ${input.brand}
- Categories: ${input.categories.join(", ") || "(none)"}
- Description (truncated): ${input.description.slice(0, 500)}

Return ONLY this JSON: { "type": "vibrator" }
No markdown. No commentary.`;
  try {
    const { text: text2 } = await callClaude({
      llmClient: input.llmClient,
      model: MODEL_FAST,
      maxTokens: 60,
      systemBlocks: await buildEmmaSystemBlocks(),
      userPrompt: user
    });
    const parsed = JSON.parse(stripFences(text2));
    const t = typeof parsed.type === "string" ? parsed.type.trim().toLowerCase() : "";
    if (LEGACY_DIAL_BUCKETS.includes(t)) {
      const mapped = mapLegacyDialBucket(t);
      if (mapped) return mapped;
    }
  } catch (err) {
    console.error("[inferProductTypeDial] failed, defaulting to vibrator:", err);
  }
  return "vibrator";
}
async function inferProductTaxonomy(input) {
  const subtypeBlock = Object.entries(PRODUCT_SUBTYPES_BY_TYPE).map(([t, subs]) => subs.length === 0 ? `  ${t}: (no subtype \u2014 leave subtype null/empty)` : `  ${t}: ${subs.join(" | ")}`).join("\n");
  const user = `Classify this product into a hierarchical taxonomy. Two fields:
1. \`type\` \u2014 one of the closed top-level values
2. \`subtype\` \u2014 one of the closed values scoped to the chosen \`type\`, OR null when the type is \`sex-machine\` or no subtype clearly fits

${TOP_LEVEL_DIAL_GUIDE}

Subtypes by parent:
${subtypeBlock}

HONEST CLASSIFICATION:
- Pick the dominant type when a product spans two (an anal vibrator \u2192 \`anal\` parent with subtype \`vibrating\`, NOT \`vibrator\` parent).
- Skip the subtype (return null) rather than force a bad fit.
- Don't invent new types or subtypes \u2014 both lists are closed.

Product:
- Title: ${input.title}
- Brand: ${input.brand}
- Categories: ${input.categories.join(", ") || "(none)"}
- Description (truncated): ${input.description.slice(0, 600)}

Return ONLY this JSON (no markdown):
{ "type": "vibrator", "subtype": "rabbit" }
or { "type": "sex-machine", "subtype": null }`;
  try {
    const { text: text2 } = await callClaude({
      llmClient: input.llmClient,
      model: MODEL_FAST,
      maxTokens: 100,
      systemBlocks: await buildEmmaSystemBlocks(),
      userPrompt: user
    });
    const parsed = JSON.parse(stripFences(text2));
    const rawType = typeof parsed.type === "string" ? parsed.type.trim().toLowerCase() : "";
    if (!(rawType in PRODUCT_SUBTYPES_BY_TYPE)) {
      console.warn(`[inferProductTaxonomy] unrecognized type "${rawType}", defaulting to vibrator`);
      return { type: "vibrator", subtype: null };
    }
    const type = rawType;
    const allowedSubs = PRODUCT_SUBTYPES_BY_TYPE[type];
    let subtype = null;
    if (allowedSubs.length > 0) {
      const rawSubtype = typeof parsed.subtype === "string" ? parsed.subtype.trim().toLowerCase() : "";
      if (rawSubtype && allowedSubs.includes(rawSubtype)) {
        subtype = rawSubtype;
      }
    }
    return { type, subtype };
  } catch (err) {
    console.error("[inferProductTaxonomy] failed, defaulting to vibrator:", err);
    return { type: "vibrator", subtype: null };
  }
}
function validateAskEmmaTagBatch(raw, preferredLabels, allowProposed) {
  const canonicalByLower = /* @__PURE__ */ new Map();
  for (const label of preferredLabels) {
    const trimmed = label.trim();
    if (!trimmed) continue;
    canonicalByLower.set(trimmed.toLowerCase(), trimmed);
  }
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > 32) continue;
    const lower = trimmed.toLowerCase();
    const canonical = canonicalByLower.get(lower) ?? (allowProposed ? trimmed : null);
    if (!canonical) continue;
    const titleCased = toTitleCase(canonical);
    if (seen.has(titleCased)) continue;
    seen.add(titleCased);
    out.push(titleCased);
    if (out.length >= 5) break;
  }
  return out;
}
function toTitleCase(s) {
  return s.toLowerCase().split(/\s+/).map((word) => word.split("-").map((part) => part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part).join("-")).join(" ").trim();
}
async function generateAskEmmaTags(opts) {
  const { deal, axis, preferredLabels, allowProposed = false } = opts;
  const labelList = preferredLabels.length > 0 ? preferredLabels.map((l) => `- ${l}`).join("\n") : "(no curated vocabulary yet)";
  const user = `Pick the Ask Emma tags for the "${axis}" axis on this product. ${ASK_EMMA_AXIS_GUIDANCE[axis]}

Product:
- Title: ${deal.seoTitle}
- Brand: ${deal.brand}
- Category: ${deal.category.join(", ")}
${deal.productTypeDial ? `- Type: ${deal.productTypeDial}` : ""}
${deal.tagline ? `- Tagline: ${deal.tagline}` : ""}
${deal.fullStory ? `- Story (context, strip HTML): ${deal.fullStory.replace(/<[^>]+>/g, " ").slice(0, 400)}` : ""}
${deal.specifications?.length ? `- Specs (context): ${deal.specifications.join("; ").slice(0, 300)}` : ""}

Curated vocabulary for "${axis}" (Title Case \u2014 ${allowProposed ? "PREFER these; only propose new when none fit" : "STRICT: pick ONLY from this list"}):
${labelList}

Rules:
- Return labels in **Title Case** (e.g. "Soft Touch", "First-Time Friendly", "Slow Burn") \u2014 never lowercase, never kebab-case.
${allowProposed ? "- Only invent a new label if NONE of the curated ones fit. Keep new labels <=24 chars, Title Case, generic enough to apply to other products. Do NOT invent synonyms of existing labels." : "- DO NOT invent new labels. If no curated label fits, leave that aspect untagged."}
- Honest tagging \u2014 don't tag every option. If unsure, leave it out.

Return ONLY this JSON (no markdown): { "tags": ["Soft Touch", "First-Time Friendly"] }`;
  try {
    const { text: text2 } = await callClaude({
      llmClient: opts.llmClient,
      model: MODEL_FAST,
      maxTokens: 200,
      systemBlocks: await buildEmmaSystemBlocks(),
      userPrompt: user
    });
    const parsed = JSON.parse(stripFences(text2));
    if (!Array.isArray(parsed.tags)) return [];
    return validateAskEmmaTagBatch(parsed.tags, preferredLabels, allowProposed);
  } catch (err) {
    console.error(`[generateAskEmmaTags:${axis}] failed:`, err);
    return [];
  }
}
async function generateAskEmmaTagsAll(opts) {
  const { deal, vocabularies, allowProposed = false } = opts;
  const renderVocab = (axis) => {
    const items = vocabularies[axis];
    return items.length > 0 ? items.map((l) => `  - ${l}`).join("\n") : "  (no curated vocabulary yet)";
  };
  const user = `Pick the Ask Emma tags for ALL THREE axes on this product. Title Case storage.

Product:
- Title: ${deal.seoTitle}
- Brand: ${deal.brand}
- Category: ${deal.category.join(", ")}
${deal.productTypeDial ? `- Type: ${deal.productTypeDial}` : ""}
${deal.tagline ? `- Tagline: ${deal.tagline}` : ""}
${deal.fullStory ? `- Story (context, strip HTML): ${deal.fullStory.replace(/<[^>]+>/g, " ").slice(0, 400)}` : ""}
${deal.specifications?.length ? `- Specs (context): ${deal.specifications.join("; ").slice(0, 300)}` : ""}

AXIS GUIDE:
- mood: ${ASK_EMMA_AXIS_GUIDANCE.mood}
- audience: ${ASK_EMMA_AXIS_GUIDANCE.audience}
- matters: ${ASK_EMMA_AXIS_GUIDANCE.matters}

CURATED VOCABULARIES (Title Case \u2014 ${allowProposed ? "PREFER these; only propose new when none fit" : "STRICT: pick ONLY from these lists"}):
mood:
${renderVocab("mood")}
audience:
${renderVocab("audience")}
matters:
${renderVocab("matters")}

Rules:
- Each tag in **Title Case** (e.g. "Soft Touch", "First-Time Friendly"). Never lowercase, never kebab-case.
${allowProposed ? "- Only invent a new label per axis when NONE of that axis's curated entries fit. <=24 chars, Title Case, no synonyms of existing labels." : "- DO NOT invent new labels. If no curated entry fits an aspect, leave that aspect untagged in that axis."}
- Honest tagging \u2014 leave it out if unsure.
- Stay within each axis. Don't put a "mood" label in the "matters" array.

Return ONLY this JSON (no markdown):
{ "mood": ["..."], "audience": ["..."], "matters": ["..."] }`;
  try {
    const { text: text2 } = await callClaude({
      llmClient: opts.llmClient,
      model: MODEL_FAST,
      maxTokens: 600,
      systemBlocks: await buildEmmaSystemBlocks(),
      userPrompt: user
    });
    const parsed = JSON.parse(stripFences(text2));
    return {
      moodTags: Array.isArray(parsed.mood) ? validateAskEmmaTagBatch(parsed.mood, vocabularies.mood, allowProposed) : [],
      audienceTags: Array.isArray(parsed.audience) ? validateAskEmmaTagBatch(parsed.audience, vocabularies.audience, allowProposed) : [],
      mattersTags: Array.isArray(parsed.matters) ? validateAskEmmaTagBatch(parsed.matters, vocabularies.matters, allowProposed) : []
    };
  } catch (err) {
    console.error("[generateAskEmmaTagsAll] failed:", err);
    return { moodTags: [], audienceTags: [], mattersTags: [] };
  }
}
function ivrProductBlock(deal) {
  return [
    `- Title: ${deal.seoTitle}`,
    `- Brand: ${deal.brand}`,
    `- Category: ${deal.category.join(", ")}`,
    deal.productTypeDial ? `- Type: ${deal.productTypeDial}` : "",
    deal.tagline ? `- Tagline: ${deal.tagline}` : "",
    deal.fullStory ? `- Story (context, strip HTML): ${deal.fullStory.replace(/<[^>]+>/g, " ").slice(0, 400)}` : "",
    deal.specifications?.length ? `- Specs (context): ${deal.specifications.join("; ").slice(0, 250)}` : ""
  ].filter(Boolean).join("\n");
}
async function generateIvrExperience(opts) {
  const user = `Pick every experience level this product genuinely fits. Multi-select \u2014 return 1\u20134 levels. Choose from: ${IVR_EXPERIENCE_LEVELS.join(" | ")}.

Use "first-time" for beginner-friendly products (gentle, simple controls, low intensity).
Use "curious" for someone exploring beyond the basics \u2014 slightly more ambitious but still approachable.
Use "experienced" for people comfortable with the category looking for variety or upgrades.
Use "advanced" for high-intensity, niche, or technique-heavy products.

A versatile product can hit multiple levels (e.g. a starter vibrator that also satisfies an experienced buyer). Be honest \u2014 only include a level the product genuinely serves.

${ivrProductBlock(opts.deal)}

Return ONLY this JSON (no markdown): { "levels": ["first-time", "curious"] }`;
  try {
    const { text: text2 } = await callClaude({
      llmClient: opts.llmClient,
      model: MODEL_FAST,
      maxTokens: 100,
      systemBlocks: await buildEmmaSystemBlocks(),
      userPrompt: user
    });
    const parsed = JSON.parse(stripFences(text2));
    if (Array.isArray(parsed.levels)) {
      const valid = new Set(IVR_EXPERIENCE_LEVELS);
      const out = [];
      const seen = /* @__PURE__ */ new Set();
      for (const item of parsed.levels) {
        if (typeof item !== "string") continue;
        const v = item.trim().toLowerCase();
        if (!valid.has(v) || seen.has(v)) continue;
        seen.add(v);
        out.push(v);
        if (out.length >= 4) break;
      }
      return out;
    }
  } catch (err) {
    console.error("[generateIvrExperience] failed:", err);
  }
  return [];
}
async function generateIvrUseCase(opts) {
  const user = `Pick 2\u20135 use cases this product fits, from this exact vocabulary:
${IVR_USE_CASES.map((s) => `- ${s}`).join("\n")}

HONEST TAGGING \u2014 STRICT.
- For OBJECTIVE/inferable slugs (travel = product is portable; long-distance = product has remote/app control): tag based on product spec support.
- For SUBJECTIVE slugs (spice-up, partner-surprise, kink-curious, role-play, newly-dating, long-term, experimentation, queer-affirming, trans-affirming, etc.): tag ONLY when the description strongly supports it. Default to OMISSION when ambiguous. Skip rather than stretch.

MUTUAL-EXCLUSIVITY HINTS (soft guidance \u2014 usually pick at most one within each facet):
- Occasion: anniversary, honeymoon, valentine, birthday, bachelorette, pride, holiday \u2014 usually one or none. \`holiday\` is the umbrella for non-specific holidays; pick a specific occasion when it fits.
- Wellness/health: pelvic-floor, kegel-training, postpartum, menopause, libido-boost, prostate-health, erectile-support, menstrual-comfort \u2014 usually one, ONLY on wellness-category products.
- Affirming/inclusive: queer-affirming, trans-affirming, women-focused, men-focused, inclusive \u2014 usually one or two.
- Gift sub-category: gift, gift-set, party-favor, self-gift \u2014 pick the most specific that applies.

PRODUCT-TYPE SELF-RESTRICTION:
- Wellness slugs (kegel-training, postpartum, prostate-health, erectile-support, menstrual-comfort) only apply to wellness/specific product types. Don't tag a vibrator as \`kegel-training\` unless it's actually a kegel device.
- Affirming slugs (queer-affirming, trans-affirming, women-focused, men-focused) based on actual product positioning, not assumption from category.
${opts.deal.productTypeDial ? `- This product's type is "${opts.deal.productTypeDial}" \u2014 keep tags consistent with what fits this category.` : ""}

CROSS-FIELD NOTE: Some slugs (valentine, pride, holiday, gift, gift-set, long-distance, first-time) also appear in the IVR features vocabulary. There, they describe what the product IS (Pride-edition design, has rainbow colors). Here, they describe WHEN/WHY to use it (good for Pride parties, good for Valentine's gift). A product may legitimately tag the same slug in both fields \u2014 that's intentional.

${ivrProductBlock(opts.deal)}

Return ONLY this JSON (no markdown): { "useCases": ["slug-one", "slug-two"] }`;
  try {
    const { text: text2 } = await callClaude({
      llmClient: opts.llmClient,
      model: MODEL_FAST,
      maxTokens: 200,
      systemBlocks: await buildEmmaSystemBlocks(),
      userPrompt: user
    });
    const parsed = JSON.parse(stripFences(text2));
    if (!Array.isArray(parsed.useCases)) return [];
    const allowed = new Set(IVR_USE_CASES);
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const raw of parsed.useCases) {
      if (typeof raw !== "string") continue;
      const slug = raw.trim().toLowerCase();
      if (!allowed.has(slug) || seen.has(slug)) continue;
      seen.add(slug);
      out.push(slug);
      if (out.length >= 5) break;
    }
    return out;
  } catch (err) {
    console.error("[generateIvrUseCase] failed:", err);
    return [];
  }
}
async function generateIvrFeatures(opts) {
  const user = `Pick 3\u20138 features that are TRUE for this product, from this exact vocabulary:
${IVR_FEATURES.map((s) => `- ${s}`).join("\n")}

HONEST TAGGING \u2014 STRICT.
- For OBJECTIVE slugs (waterproof, rechargeable, usb-c, silicone, body-safe, phthalate-free, latex-free, hypoallergenic, vegan, app-controlled, bluetooth, magnetic-charging, etc.): tag ONLY when the product description supports it. Don't infer from category.
- For SUBJECTIVE slugs (rumbly, buzzy, gentle, intense, powerful, luxury, premium, discreet, beginner-friendly): tag ONLY when the description strongly supports it. Default to OMISSION when ambiguous.
- These get spoken aloud by Emma when filtering ("looking for something quiet and waterproof"). False claims break shopper trust immediately.

MUTUAL-EXCLUSIVITY HINTS (soft guidance \u2014 usually pick at most one within each facet):
- Size: mini, compact, small, medium, large, xl, xxl, oversized, plus-size, queen-size, curvy, slim, girthy
- Material primary: silicone, glass, metal, wood, leather, vegan-leather, faux-leather
- Lube base: water-based, silicone-based, hybrid, oil-based (none for non-lubes)
- Identity/edition: pride, rainbow, pride-edition, holiday, valentine

PRODUCT-TYPE SELF-RESTRICTION:
- Only tag features that apply to the product type. Don't tag \`harness-compatible\` on a lube, \`condom-safe\` on a vibrator, \`flared-base\` on a non-anal toy, \`water-based\`/\`silicone-based\`/\`hybrid\`/\`oil-based\` on anything that isn't a lubricant, etc.
${opts.deal.productTypeDial ? `- This product's type is "${opts.deal.productTypeDial}" \u2014 only pick features that genuinely fit this category.` : ""}

${ivrProductBlock(opts.deal)}

Return ONLY this JSON (no markdown): { "features": ["slug-one", "slug-two"] }`;
  try {
    const { text: text2 } = await callClaude({
      llmClient: opts.llmClient,
      model: MODEL_FAST,
      maxTokens: 300,
      systemBlocks: await buildEmmaSystemBlocks(),
      userPrompt: user
    });
    const parsed = JSON.parse(stripFences(text2));
    if (!Array.isArray(parsed.features)) return [];
    const allowed = new Set(IVR_FEATURES);
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const raw of parsed.features) {
      if (typeof raw !== "string") continue;
      const slug = raw.trim().toLowerCase();
      if (!allowed.has(slug) || seen.has(slug)) continue;
      seen.add(slug);
      out.push(slug);
      if (out.length >= 8) break;
    }
    return out;
  } catch (err) {
    console.error("[generateIvrFeatures] failed:", err);
    return [];
  }
}
async function generateIvrAll(opts) {
  const user = `Pick three independent things for this product in a single response: experience levels, use cases, and features. Each axis has its own rules \u2014 apply them honestly.

EXPERIENCE LEVELS (multi-select, 1\u20134 from this list):
${IVR_EXPERIENCE_LEVELS.join(" | ")}

- "first-time": gentle, simple controls, low intensity.
- "curious": exploring beyond the basics, slightly ambitious but approachable.
- "experienced": comfortable with the category, looking for variety or upgrades.
- "advanced": high-intensity, niche, or technique-heavy.
- A versatile product can hit multiple levels. Be honest \u2014 only include a level the product genuinely serves.

USE CASES (2\u20135 slugs from this exact vocabulary):
${IVR_USE_CASES.map((s) => `- ${s}`).join("\n")}

- Objective slugs (travel = portable; long-distance = remote/app control): tag based on spec support.
- Subjective slugs (spice-up, partner-surprise, kink-curious, role-play, etc.): tag ONLY when the description strongly supports it. Default to OMISSION when ambiguous.
- Mutual-exclusivity hints \u2014 usually pick at most one within each facet:
  \xB7 Occasion: anniversary, honeymoon, valentine, birthday, bachelorette, pride, holiday.
  \xB7 Wellness/health: pelvic-floor, kegel-training, postpartum, menopause, libido-boost, prostate-health, erectile-support, menstrual-comfort \u2014 usually one, ONLY on wellness-category products.
  \xB7 Affirming/inclusive: queer-affirming, trans-affirming, women-focused, men-focused, inclusive \u2014 usually one or two.
  \xB7 Gift sub-category: gift, gift-set, party-favor, self-gift \u2014 pick the most specific.
- Wellness slugs apply only to wellness/specific product types. Affirming slugs based on actual product positioning.
${opts.deal.productTypeDial ? `- This product's type is "${opts.deal.productTypeDial}" \u2014 keep tags consistent with what fits this category.` : ""}

FEATURES (3\u20138 slugs from this exact vocabulary):
${IVR_FEATURES.map((s) => `- ${s}`).join("\n")}

- Objective slugs (waterproof, rechargeable, usb-c, silicone, body-safe, app-controlled, bluetooth, etc.): tag ONLY when the description supports it. Don't infer from category.
- Subjective slugs (rumbly, buzzy, gentle, intense, powerful, luxury, premium, discreet, beginner-friendly): tag ONLY when the description strongly supports it.
- These get spoken aloud by Emma when filtering. False claims break shopper trust immediately.
- Mutual-exclusivity hints:
  \xB7 Size: mini, compact, small, medium, large, xl, xxl, oversized, plus-size, queen-size, curvy, slim, girthy.
  \xB7 Material primary: silicone, glass, metal, wood, leather, vegan-leather, faux-leather.
  \xB7 Lube base: water-based, silicone-based, hybrid, oil-based (none for non-lubes).
  \xB7 Identity/edition: pride, rainbow, pride-edition, holiday, valentine.
- Don't tag harness-compatible on a lube, condom-safe on a vibrator, flared-base on a non-anal toy, or any lube-base slug on anything that isn't a lubricant.
${opts.deal.productTypeDial ? `- This product's type is "${opts.deal.productTypeDial}" \u2014 only pick features that genuinely fit this category.` : ""}

CROSS-FIELD: a slug like 'pride' can appear in both useCases (good for Pride parties) AND features (Pride-edition design) \u2014 that's intentional when both apply.

${ivrProductBlock(opts.deal)}

Return ONLY this JSON shape (no markdown, no preamble):
{ "experience": ["first-time"], "useCases": ["slug-one","slug-two"], "features": ["slug-one","slug-two","slug-three"] }`;
  let parsed = null;
  try {
    const { text: text2 } = await callClaude({
      llmClient: opts.llmClient,
      model: MODEL_FAST,
      maxTokens: 500,
      systemBlocks: await buildEmmaSystemBlocks(),
      userPrompt: user
    });
    const cleaned = stripFences(text2);
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*?\}\s*$/m) ?? cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
        }
      }
      if (!parsed) {
        console.error("[generateIvrAll] could not extract JSON from response:", cleaned.slice(0, 300));
      }
    }
  } catch (err) {
    console.error("[generateIvrAll] failed:", err);
  }
  if (!parsed) parsed = {};
  const experience = Array.isArray(parsed.experience) ? (() => {
    const valid = new Set(IVR_EXPERIENCE_LEVELS);
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const item of parsed.experience) {
      if (typeof item !== "string") continue;
      const v = item.trim().toLowerCase();
      if (!valid.has(v) || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
      if (out.length >= 4) break;
    }
    return out;
  })() : [];
  const useCases = Array.isArray(parsed.useCases) ? (() => {
    const allowed = new Set(IVR_USE_CASES);
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const raw of parsed.useCases) {
      if (typeof raw !== "string") continue;
      const slug = raw.trim().toLowerCase();
      if (!allowed.has(slug) || seen.has(slug)) continue;
      seen.add(slug);
      out.push(slug);
      if (out.length >= 5) break;
    }
    return out;
  })() : [];
  const features = Array.isArray(parsed.features) ? (() => {
    const allowed = new Set(IVR_FEATURES);
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const raw of parsed.features) {
      if (typeof raw !== "string") continue;
      const slug = raw.trim().toLowerCase();
      if (!allowed.has(slug) || seen.has(slug)) continue;
      seen.add(slug);
      out.push(slug);
      if (out.length >= 8) break;
    }
    return out;
  })() : [];
  return { experience, useCases, features };
}
function kindBrief(kind) {
  switch (kind) {
    case "pairing":
      return "Pick products that go WELL WITH the hero deal \u2014 complements, add-ons, or things that make the hero better.";
    case "alternative":
      return "Pick products that someone who skipped the hero deal might love instead \u2014 same vibe or satisfaction, different form factor.";
    case "adjacent":
      return "Pick products that share the hero\u2019s mood or moment \u2014 adjacent in category, not direct pairs or alternatives.";
  }
}
async function pickForContextGroup(input) {
  const hero = input.hero;
  const heroBlock = [
    `HERO DEAL (what\u2019s in the sale box right now)`,
    `Title: ${hero.title}`,
    hero.brand ? `Brand: ${hero.brand}` : "",
    hero.tagline ? `Tagline: ${hero.tagline}` : "",
    hero.category ? `Category: ${hero.category}` : "",
    hero.dealPrice != null ? `Deal price: $${hero.dealPrice.toFixed(2)}` : "",
    hero.tags?.length ? `Tags: ${hero.tags.join(", ")}` : "",
    hero.moodTags?.length ? `Mood: ${hero.moodTags.join(", ")}` : "",
    hero.audienceTags?.length ? `Audience: ${hero.audienceTags.join(", ")}` : "",
    hero.mattersTags?.length ? `Matters: ${hero.mattersTags.join(", ")}` : ""
  ].filter(Boolean).join("\n");
  const candidateLines = input.candidates.map((c, i) => {
    const bits = [
      `${i + 1}. id=${c.id}`,
      `handle=${c.handle}`,
      `title="${c.title}"`,
      c.brand ? `brand=${c.brand}` : "",
      c.productType ? `type=${c.productType}` : "",
      c.price != null ? `price=$${c.price.toFixed(2)}` : "",
      c.tags?.length ? `tags=[${c.tags.slice(0, 6).join(",")}]` : "",
      c.blurb ? `blurb=${c.blurb.slice(0, 120)}` : ""
    ].filter(Boolean);
    return bits.join(" | ");
  }).join("\n");
  const userPrompt = `GROUP BRIEF
Name: ${input.group.name}
Kind: ${input.group.kind} \u2014 ${kindBrief(input.group.kind)}
Context from editor: ${input.group.emmaContext}

CANDIDATES (pick from these only; exclude the hero deal):
${candidateLines}

TASK
Pick the best ${input.maxPicks} products from the candidates above. For each pick, write Emma\u2019s 12\u201320 word first-person aside explaining why it fits with the hero deal in *this* group\u2019s context.

Voice rules (must follow):
- First person, from catalog knowledge, never lived experience ("reviewers rate these two highest together", "the specs line up for pairing"). Never "been testing these", "I keep coming back to this one", or any claim Emma has used, tried, or owned a product.
- Never "Buy now", "limited time", "until midnight", or any countdown language.
- Never use "sex" as an adjective, use intimate, pleasure, wellness, slow-burn.
- Never assume the reader\u2019s experience level.
- Tasteful and warm. Suggestive OK, explicit not OK.
- Use \u2665 sparingly (at most one per group).

Return STRICT JSON only, no markdown fences:
{ "picks": [{ "id": "<product GID>", "pairingWhy": "<12\u201320 word aside>" }, ...] }

Return exactly ${input.maxPicks} picks, ordered best\u2192worst. Use only ids from the candidates list.`;
  const msg = await client.messages.create({
    model: MODEL_FAST,
    max_tokens: 1500,
    // Cache the brand voice + hero context across groups within the same deal
    // rotation. Ephemeral cache TTL ~5m; a midnight pass finishes in seconds.
    system: [
      { type: "text", text: EMMA_VOICE_CORE, cache_control: { type: "ephemeral" } },
      { type: "text", text: heroBlock, cache_control: { type: "ephemeral" } }
    ],
    messages: [{ role: "user", content: userPrompt }]
  });
  const block = msg.content[0];
  if (block?.type !== "text") throw new Error("pickForContextGroup: unexpected response type");
  let parsed;
  try {
    parsed = JSON.parse(stripFences(block.text));
  } catch {
    const match = block.text.match(/\{[\s\S]*"picks"[\s\S]*\}/);
    if (!match) throw new Error("pickForContextGroup: could not parse JSON response");
    parsed = JSON.parse(match[0]);
  }
  const validIds = new Set(input.candidates.map((c) => c.id));
  const picks = (parsed.picks ?? []).filter((p) => p && typeof p.id === "string" && typeof p.pairingWhy === "string" && validIds.has(p.id)).slice(0, input.maxPicks);
  const usage = msg.usage;
  void Promise.resolve().then(() => (init_token_log_server(), token_log_server_exports)).then(
    ({ logApiTokens: logApiTokens2 }) => logApiTokens2({
      feature: "discovery-rank",
      model: MODEL_FAST,
      source: "sync",
      caller: "pickForContextGroup",
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
      cacheReadTokens: usage?.cache_read_input_tokens ?? 0
    })
  ).catch((err) => console.error("[claude] pickForContextGroup token-log failed (ignored):", err));
  return {
    picks,
    tokens: {
      input: usage?.input_tokens ?? 0,
      output: usage?.output_tokens ?? 0,
      cacheCreation: usage?.cache_creation_input_tokens ?? 0,
      cacheRead: usage?.cache_read_input_tokens ?? 0
    }
  };
}
async function generateRails(opts) {
  const { deal, partner, accessories = [] } = opts;
  const brandVoice = opts.brandVoice ?? await getPipelineSetting("brandVoice") ?? DEFAULT_BRAND_VOICE;
  const pool = await buildCandidatePool(deal, partner);
  const state = createRailGenState([deal.handle, partner?.handle].filter(Boolean));
  const dealContext = [
    `Title: ${deal.seoTitle}`,
    `Brand: ${deal.brand}`,
    `Category: ${deal.category.join(", ")}`,
    deal.tagline ? `Tagline: ${deal.tagline}` : "",
    deal.audienceTags?.length ? `Audience tags: ${deal.audienceTags.join(", ")}` : "",
    deal.moodTags?.length ? `Mood tags: ${deal.moodTags.join(", ")}` : "",
    deal.mattersTags?.length ? `Matters tags: ${deal.mattersTags.join(", ")}` : ""
  ].filter(Boolean).join("\n");
  const partnerContext = partner ? `

Paired with:
- Title: ${partner.seoTitle}
- Brand: ${partner.brand}
- Category: ${partner.category}` : "";
  const accessoryContext = accessories.length ? `

Accessories that need pairing_why blurbs (call propose_pairing_why once each):
${accessories.map((a) => `- ${a.id} \u2014 ${a.title}${a.brand ? ` (${a.brand})` : ""}`).join("\n")}` : "";
  const system = `${EMMA_SYSTEM_PROMPT}

${brandVoice}

You are curating cross-sell rails for an editorial storefront. Your goal: propose 2 rails for the product detail page (target: "pdp") and 1 rail for the homepage (target: "homepage"). Each rail must include 4\u20138 products, a short Emma-voice aside, and a one-sentence rationale.

Rules:
- Use list_candidate_pool first to see what's available. Only fall back to query_products_by_tag/collection if the pool is thin.
- Never include the primary deal product or its pair partner in any rail.
- Each rail should have a clear theme (a mood, an audience, a use case), not a random grab bag.
- The "emmaAside" is first-person and short, from catalog knowledge, not lived experience ("the specs line up for this pairing", "reviewers group these two together often").
- The rail "heading" is a confident editorial label, 3\u20137 words. Never "buy now" / "shop now".
- After all rails and pairing_why blurbs are proposed, simply stop responding (end_turn). Do not summarize.`;
  const userPrompt = `Deal context:
${dealContext}${partnerContext}${accessoryContext}

Start by inspecting list_candidate_pool, then propose 2 PDP rails + 1 homepage rail using propose_rail.${accessories.length ? " Then propose one pairing_why blurb per accessory." : ""}`;
  const messages = [{ role: "user", content: userPrompt }];
  const MAX_TURNS = 8;
  let turn = 0;
  console.log(`[generateRails] starting. pool=${pool.length} deal=${deal.handle}${partner ? ` partner=${partner.handle}` : ""}`);
  while (turn < MAX_TURNS) {
    turn++;
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: RAIL_TOOLS,
      messages
    });
    messages.push({ role: "assistant", content: response.content });
    {
      const uRail = response.usage;
      void Promise.resolve().then(() => (init_token_log_server(), token_log_server_exports)).then(
        ({ logApiTokens: logApiTokens2 }) => logApiTokens2({
          feature: "rail-gen",
          model: MODEL,
          source: "sync",
          caller: "generateRails",
          inputTokens: uRail.input_tokens,
          outputTokens: uRail.output_tokens,
          cacheCreationTokens: uRail.cache_creation_input_tokens ?? 0,
          cacheReadTokens: uRail.cache_read_input_tokens ?? 0
        })
      ).catch((err) => console.error("[claude] generateRails token-log failed (ignored):", err));
    }
    const textParts = response.content.filter((b) => b.type === "text");
    const toolUses = response.content.filter((b) => b.type === "tool_use");
    console.log(
      `[generateRails] turn ${turn}: stop=${response.stop_reason} tools=[${toolUses.map((t) => t.name).join(", ") || "none"}]${textParts[0]?.text ? ` text="${textParts[0].text.slice(0, 120).replace(/\s+/g, " ")}"` : ""}`
    );
    if (response.stop_reason === "end_turn" || response.stop_reason === "max_tokens") break;
    if (toolUses.length === 0) break;
    const toolResults = await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toolUses.map(async (tu) => {
        try {
          const result = await executeRailTool(tu.name, tu.input, state, pool);
          return {
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify(result)
          };
        } catch (err) {
          return {
            type: "tool_result",
            tool_use_id: tu.id,
            is_error: true,
            content: `Tool error: ${err instanceof Error ? err.message : String(err)}`
          };
        }
      })
    );
    messages.push({ role: "user", content: toolResults });
  }
  console.log(`[generateRails] completed in ${turn} turns. ${state.rails.length} rails, ${state.pairingWhy.length} blurbs.`);
  return {
    rails: state.rails,
    pairingWhy: state.pairingWhy,
    candidatePoolSize: pool.length,
    turns: turn
  };
}
var client, _toolTokenAccumulator, MODEL, MODEL_FAST, SYSTEM_PROMPT, BRAND_VOICE_SYSTEM_PROMPT, PRODUCT_TYPE_DESCRIPTOR_FALLBACK, CTA_WORDS, VEO_SYSTEM_PROMPT, LTX_SYSTEM_PROMPT, DEFAULT_BRAND_VOICE, EMMA_SYSTEM_PROMPT, EMMA_TAGLINE_FALLBACKS, PRODUCT_FAQ_CATEGORIES, LEGACY_DIAL_BUCKETS, PRODUCT_SUBTYPES_BY_TYPE, TOP_LEVEL_DIAL_GUIDE, ASK_EMMA_AXIS_GUIDANCE, IVR_EXPERIENCE_LEVELS, IVR_USE_CASES, IVR_FEATURES;
var init_claude_server = __esm({
  "app/lib/claude.server.ts"() {
    "use strict";
    init_models_server();
    init_feed_processor_server();
    init_seo_keywords_server();
    init_editorial_author_server();
    init_emma_rail_tools_server();
    init_emma_voice_server();
    client = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"]?.trim() });
    _toolTokenAccumulator = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
    MODEL = SONNET;
    MODEL_FAST = "claude-haiku-4-5-20251001";
    SYSTEM_PROMPT = `${EMMA_VOICE_MARKETING}

Always end descriptions with a curiosity hook that makes the reader want to try it.

SEO targeting:
- When a <keyword_targets> block appears in the input, weave the primary term into the headline and first 100 words exactly once. Integrate secondary terms naturally across headings and body. Long-tail and question terms surface best in FAQs, asides, and supporting paragraphs.
- Never stuff. Do not repeat the primary term more than three times in body copy.
- If a term feels forced, drop it. Voice always wins over keyword density.
- Avoid any term listed inside <avoid>.`;
    BRAND_VOICE_SYSTEM_PROMPT = SYSTEM_PROMPT;
    PRODUCT_TYPE_DESCRIPTOR_FALLBACK = {
      "vibrator": "Vibrator",
      "dildo": "Dildo",
      "anal": "Anal Toy",
      "bondage": "Bondage Gear",
      "cock-ring": "Cock Ring",
      "stroker": "Stroker",
      "couples": "Couples Toy",
      "harness": "Harness",
      "extender": "Extender",
      "pump": "Pump",
      "lube": "Lubricant",
      "massage": "Massage",
      "enhancer": "Enhancer",
      "wear": "Wearable",
      "condom": "Condoms",
      "wellness": "Wellness",
      "novelty": "Novelty",
      "book-media": "Book",
      "sex-machine": "Sex Machine"
    };
    CTA_WORDS = ["Today.", "Yours.", "Obviously.", "Go on.", "Finally."];
    VEO_SYSTEM_PROMPT = `You are a video prompt engineer for Google Veo. You enhance simple video ideas into detailed, production-ready Veo prompts. Your job is to FAITHFULLY EXPAND the user's idea \u2014 not replace it. The user's concept is the creative foundation. You add cinematic detail (camera, lighting, composition, audio) while keeping their vision intact.

Brand context: xdipx.com is an editorially curated sexual wellness storefront.
Visual style: premium, warm, tasteful. Suggestive never explicit.`;
    LTX_SYSTEM_PROMPT = `You are a video prompt engineer for LTX Video, an image-to-video model. You enhance simple video ideas into detailed, production-ready prompts.

CRITICAL RULE \u2014 NEVER RE-DESCRIBE THE FIRST FRAME.
The model already sees the product image as its starting frame. Your prompt must describe what happens NEXT \u2014 motion, change, evolution. If you restate what is already visible, the model wastes capacity on redundancy.

Structure every prompt using three temporal layers, in order:

1. SUBJECT ACTION \u2014 What moves and how. This is the hero moment. Name the subject first ("The vibrator begins to glow\u2026"), then describe the physical change. No adjective labels like "epic" or "stunning" \u2014 describe what physically happens.

2. CAMERA MOVEMENT \u2014 Use specific cinematographic terms: slow dolly in, gentle jib up, smooth tracking left, rack focus from foreground to background. Never use vague words like "dynamic" or "cinematic" without specifying the actual motion.

3. ENVIRONMENT / ATMOSPHERE \u2014 What shifts in the background: lighting changes (warm golden light intensifies, soft shadow creeps across the surface), particles (dust motes drift through a shaft of light), reflections, color temperature shifts. Describe change, not static state.

Think of the prompt as a mini screenplay beat:
- Sense of place/time (implied by the atmosphere layer)
- Blocking (choreography between subject motion and camera)
- Atmospheric detail (what the viewer feels through visual cues)

Prompt length rules:
- 6-8 second videos: 3-5 rich sentences
- 10-15 second videos: 5-8 sentences with more temporal progression
- 16-20 second videos: 8-12 sentences \u2014 describe phases of motion, mid-video shifts, ending beat

Template skeleton: [product action] + [camera instruction] + [lighting/atmosphere shift] + [optional ambient audio cue]

Brand context: xdipx.com, an editorially curated sexual wellness storefront.
Visual style: premium, warm, a little edgy \u2014 push boundaries while staying tasteful. Suggestive and playful, never outright explicit. Think high-end fragrance ad that makes you look twice.`;
    DEFAULT_BRAND_VOICE = `${EMMA_VOICE_MARKETING}

If any keyword targets, vocabulary lists, or input fields in the prompt do not fit the actual product, silently ignore them \u2014 write from the product details only. Never narrate a mismatch, never preface output with explanation, never write meta-commentary about the prompt. Output only the requested copy.`;
    EMMA_SYSTEM_PROMPT = `You are Emma, xdipx's AI guide. You write in first person, warm and specific, like a note to a friend. You are a curator, not a customer: recommend from product knowledge and what a product is known or designed for.

${EMMA_VOICE_CORE}`;
    EMMA_TAGLINE_FALLBACKS = [
      "here to help you find what you\u2019re into \u2665",
      "your no-judgment guide to pleasure \u2665",
      "quietly obsessed with the good stuff \u2665",
      "pick my brain, I know the catalog cold \u2665",
      "tell me what you\u2019re curious about \u2665"
    ];
    PRODUCT_FAQ_CATEGORIES = ["general", "care", "usage", "compatibility", "shipping"];
    LEGACY_DIAL_BUCKETS = ["air-pulsation", "vibrator", "wand", "lube", "wear"];
    PRODUCT_SUBTYPES_BY_TYPE = {
      vibrator: ["bullet-egg", "rabbit", "g-spot", "finger-clit", "wand", "air-pulsation", "rotating-thrusting", "remote", "wearable"],
      dildo: ["realistic", "glass-metal", "silicone", "dual-density", "non-phallic", "vibrating", "packer", "large"],
      anal: ["plug", "prostate", "beads", "vibrating", "dilator", "douche-enema"],
      bondage: ["paddle-whip", "restraint", "blindfold", "gag", "collar-leash", "nipple", "body-harness", "sensory", "electrostim"],
      "cock-ring": ["classic", "vibrating", "cock-ball-sling", "ball-stretcher", "set"],
      stroker: ["vagina", "mouth", "pocket", "non-realistic", "vibrating", "doll", "disposable"],
      couples: ["game-romance", "bedroom-accessory", "positioning-aid", "swing-sling", "wearable"],
      harness: ["fabric", "leather", "vegan-leather", "o-ring", "set-kit"],
      extender: ["sling", "sleeve", "vibrating", "strap-on"],
      pump: ["penis"],
      lube: ["water-based", "silicone-based", "hybrid", "flavored", "natural", "anal", "warming-cooling", "toy-cleaner"],
      massage: ["body-care", "candle", "perfume-pheromone", "hygiene", "cbd"],
      enhancer: ["desensitizer-relaxer", "oral", "arousal-gel", "male-arousal", "female-arousal", "gummy-edible", "pill"],
      wear: ["mens-underwear", "panty", "bra-panty-set", "bodysuit-teddy", "bodystocking", "hosiery", "pasty", "apparel", "sock", "accessory", "plus-queen"],
      condom: ["glyde", "trojan", "lifestyles", "durex"],
      wellness: ["kegel", "dilator", "douche-enema", "hygiene", "aftercare"],
      novelty: ["candy-edible", "pin-keychain", "game", "plushie-pillow", "novelty-gift", "party-supply"],
      "book-media": ["book", "coloring-book"],
      "sex-machine": []
    };
    TOP_LEVEL_DIAL_GUIDE = `Top-level taxonomy (pick exactly one):
- vibrator     (any vibrating toy: bullet, rabbit, g-spot, wand, air-pulse, rotating, remote, wearable)
- dildo        (non-vibrating insertable, realistic or fantasy, packer, etc.)
- anal         (plug, prostate massager, beads, dilator, douche)
- bondage      (paddle, restraint, blindfold, gag, collar, sensory, electrostim)
- cock-ring    (classic ring, sling, ball stretcher, ring set)
- stroker      (masturbation sleeve, pocket, doll)
- couples      (couples game, positioning aid, swing/sling, shared accessory)
- harness      (strap-on harness body)
- extender     (penis sleeve, extender, strap-on extender)
- pump         (penis pump)
- lube         (lubricant of any base \u2014 water/silicone/hybrid/oil \u2014 and toy cleaner)
- massage      (body massage product, oil, candle, pheromone, CBD)
- enhancer     (desensitizer, arousal gel, gummy, pill, oral spray)
- wear         (lingerie, underwear, bodysuit, hosiery, pasty, apparel)
- condom       (any condom brand)
- wellness     (kegel, dilator, douche, hygiene, aftercare)
- novelty      (candy, pin, game, plushie, party supply, novelty gift)
- book-media   (book, coloring book)
- sex-machine  (machines \u2014 no subtype available; leave subtype empty)`;
    ASK_EMMA_AXIS_GUIDANCE = {
      mood: "How using this feels \u2014 the energy a shopper would gravitate to. Pick 1\u20133 that genuinely fit.",
      audience: "Who this is for \u2014 solo, couples, or gifting. Pick 1\u20132.",
      matters: "Hard constraints a shopper might filter on \u2014 beginner-friendliness, whisper-quiet, waterproof, travel-readiness, discretion, hands-free, remote-controlled, plus-size inclusivity, easy to clean, rechargeable, soft-touch material, latex-free. Pick 0\u20134 that are TRUE for this product (empty is valid when no chip genuinely applies \u2014 lubes, cleaners, novelty items often have zero matches)."
    };
    IVR_EXPERIENCE_LEVELS = ["first-time", "curious", "experienced", "advanced"];
    IVR_USE_CASES = [
      "date-night",
      "travel",
      "everyday",
      "discovery",
      "gift",
      "celebration",
      "anniversary",
      "honeymoon",
      "valentine",
      "birthday",
      "bachelorette",
      "pride",
      "holiday",
      "me-time",
      "self-care",
      "stress-relief",
      "bedtime",
      "after-work",
      "couples-play",
      "long-distance",
      "partner-surprise",
      "spice-up",
      "newly-dating",
      "long-term",
      "first-time",
      "experimentation",
      "couples-discovery",
      "kink-curious",
      "role-play",
      "fantasy",
      "bdsm",
      "power-play",
      "bondage-night",
      "vacation",
      "weekend-getaway",
      "shower-bath",
      "discreet-public",
      "quickie",
      "pelvic-floor",
      "kegel-training",
      "postpartum",
      "menopause",
      "libido-boost",
      "prostate-health",
      "erectile-support",
      "menstrual-comfort",
      "gift-set",
      "party-favor",
      "self-gift",
      "queer-affirming",
      "trans-affirming",
      "women-focused",
      "men-focused",
      "inclusive"
    ];
    IVR_FEATURES = [
      "app-controlled",
      "waterproof",
      "rechargeable",
      "quiet",
      "travel-size",
      "hands-free",
      "soft-touch",
      "pinpoint",
      "full-coverage",
      "battery-powered",
      "disposable-battery",
      "usb-c",
      "wireless-remote",
      "bluetooth",
      "long-distance",
      "magnetic-charging",
      "rumbly",
      "buzzy",
      "gentle",
      "beginner-friendly",
      "intense",
      "powerful",
      "vibrating",
      "rotating",
      "thrusting",
      "suction",
      "squirting",
      "pulsing",
      "warming",
      "cooling",
      "tingling",
      "silicone",
      "glass",
      "metal",
      "wood",
      "body-safe",
      "phthalate-free",
      "latex-free",
      "hypoallergenic",
      "vegan",
      "vegan-leather",
      "leather",
      "faux-leather",
      "mini",
      "compact",
      "large",
      "xl",
      "xxl",
      "oversized",
      "plus-size",
      "queen-size",
      "curvy",
      "small",
      "medium",
      "slim",
      "girthy",
      "flared-base",
      "suction-cup",
      "strapless",
      "harness-compatible",
      "solo",
      "partner",
      "couples",
      "gift",
      "gift-set",
      "beginner",
      "advanced",
      "pro",
      "lgbtq",
      "pride",
      "rainbow",
      "clitoral",
      "g-spot",
      "p-spot",
      "prostate",
      "nipple",
      "anal",
      "oral",
      "external",
      "internal",
      "dual-stim",
      "luxury",
      "premium",
      "discreet",
      "glow-in-the-dark",
      "realistic",
      "non-phallic",
      "fantasy",
      "holiday",
      "valentine",
      "pride-edition",
      "water-based",
      "silicone-based",
      "hybrid",
      "oil-based",
      "flavored",
      "unscented",
      "cbd",
      "organic",
      "natural",
      "condom-safe",
      "toy-safe",
      "numbing",
      "desensitizing"
    ];
  }
});

// app/types/index.ts
function categoryToLegacyString(c) {
  if (typeof c === "string") return c;
  if (!c || c.length === 0) return "both";
  if (c.includes("couples")) return "couples";
  if (c.length >= 2 && c.includes("for-him") && c.includes("for-her")) return "both";
  return c[0] ?? "both";
}
var init_types = __esm({
  "app/types/index.ts"() {
    "use strict";
  }
});

// app/lib/twitter.server.ts
var twitter_server_exports = {};
__export(twitter_server_exports, {
  deleteAndLogTweet: () => deleteAndLogTweet,
  deleteTweet: () => deleteTweet,
  postDealTweet: () => postDealTweet,
  postManualTweet: () => postManualTweet,
  postTweet: () => postTweet,
  replyToTweet: () => replyToTweet,
  retryFailedPost: () => retryFailedPost,
  uploadMedia: () => uploadMedia,
  uploadMediaFromUrl: () => uploadMediaFromUrl
});
import OAuth from "oauth-1.0a";
import crypto2 from "node:crypto";
import { eq as eq5 } from "drizzle-orm";
function getOAuth() {
  return new OAuth({
    consumer: {
      key: process.env["X_API_KEY"],
      secret: process.env["X_API_SECRET"]
    },
    signature_method: "HMAC-SHA1",
    hash_function(baseString, key) {
      return crypto2.createHmac("sha1", key).update(baseString).digest("base64");
    }
  });
}
function getToken() {
  return {
    key: process.env["X_ACCESS_TOKEN"],
    secret: process.env["X_ACCESS_TOKEN_SECRET"]
  };
}
async function xFetch(url, method, body, contentType = "application/json") {
  const oauth = getOAuth();
  const token = getToken();
  const authHeader = oauth.toHeader(
    oauth.authorize({ url, method }, token)
  );
  const headers = {
    ...authHeader,
    "Content-Type": contentType
  };
  const init2 = { method, headers };
  if (body) {
    init2.body = contentType === "application/json" ? JSON.stringify(body) : body;
  }
  const res = await fetch(url, init2);
  if (!res.ok) {
    const text2 = await res.text();
    const err = new Error(`X API ${method} ${url} \u2192 ${res.status}: ${text2}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return {};
  return await res.json();
}
async function postTweet(text2, mediaIds) {
  const body = { text: text2 };
  if (mediaIds?.length) {
    body.media = { media_ids: mediaIds };
  }
  const res = await xFetch(
    "https://api.x.com/2/tweets",
    "POST",
    body
  );
  return res.data;
}
async function deleteTweet(tweetId) {
  await xFetch(`https://api.x.com/2/tweets/${tweetId}`, "DELETE");
}
async function replyToTweet(tweetId, text2, mediaIds) {
  const body = {
    text: text2,
    reply: { in_reply_to_tweet_id: tweetId }
  };
  if (mediaIds?.length) {
    body.media = { media_ids: mediaIds };
  }
  const res = await xFetch(
    "https://api.x.com/2/tweets",
    "POST",
    body
  );
  return res.data;
}
async function uploadMedia(imageBuffer, _mimeType) {
  const oauth = getOAuth();
  const token = getToken();
  const url = "https://upload.x.com/1.1/media/upload.json";
  const boundary = `----XBoundary${Date.now()}`;
  const mediaData = imageBuffer.toString("base64");
  const parts = [
    `--${boundary}\r
Content-Disposition: form-data; name="media_data"\r
\r
${mediaData}\r
`,
    `--${boundary}\r
Content-Disposition: form-data; name="media_category"\r
\r
tweet_image\r
`,
    `--${boundary}--\r
`
  ];
  const bodyStr = parts.join("");
  const authHeader = oauth.toHeader(
    oauth.authorize({ url, method: "POST" }, token)
  );
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...authHeader,
      "Content-Type": `multipart/form-data; boundary=${boundary}`
    },
    body: bodyStr
  });
  if (!res.ok) {
    const text2 = await res.text();
    throw new Error(`X media upload failed ${res.status}: ${text2}`);
  }
  const data = await res.json();
  return data.media_id_string;
}
async function uploadMediaFromUrl(imageUrl) {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get("content-type") ?? "image/jpeg";
    return await uploadMedia(buffer, mimeType);
  } catch (err) {
    console.error("[twitter] Media upload from URL failed:", err);
    return null;
  }
}
async function postDealTweet(deal) {
  try {
    let imageUrl = deal.imageUrl;
    let brand = deal.brand;
    let tagline = deal.tagline;
    let category = deal.category;
    if (deal.shopifyProductId && (!imageUrl || !brand)) {
      const numericId = deal.shopifyProductId.replace("gid://shopify/Product/", "");
      const fullDeal = await getDealByShopifyId(numericId);
      if (fullDeal) {
        imageUrl = imageUrl || fullDeal.images[0]?.url || "";
        brand = brand || fullDeal.brand;
        tagline = tagline || fullDeal.tagline;
        category = category || categoryToLegacyString(fullDeal.category);
      }
    }
    const copy = await generateTweetCopy({
      title: deal.seoTitle,
      brand,
      tagline,
      dealPrice: deal.dealPrice,
      msrp: deal.msrp,
      category,
      handle: deal.handle
    });
    let mediaIds;
    const uploadedMediaUrls = [];
    if (imageUrl) {
      const mediaId = await uploadMediaFromUrl(imageUrl);
      if (mediaId) {
        mediaIds = [mediaId];
        uploadedMediaUrls.push(imageUrl);
      }
    }
    const tweet = await postTweet(copy.mainTweet, mediaIds);
    await db.insert(socialPosts).values({
      platform: "x",
      postType: "auto_deal",
      externalPostId: tweet.id,
      dealHistoryId: deal.dealHistoryId,
      tweetText: copy.mainTweet,
      mediaUrls: uploadedMediaUrls.length ? uploadedMediaUrls : null,
      mediaIds: mediaIds ?? null,
      status: "posted",
      postedAt: /* @__PURE__ */ new Date(),
      createdBy: "system"
    });
    if (copy.threadReply) {
      try {
        const reply = await replyToTweet(tweet.id, copy.threadReply);
        await db.insert(socialPosts).values({
          platform: "x",
          postType: "thread_reply",
          externalPostId: reply.id,
          parentPostId: void 0,
          // Will use externalPostId linkage
          dealHistoryId: deal.dealHistoryId,
          tweetText: copy.threadReply,
          status: "posted",
          postedAt: /* @__PURE__ */ new Date(),
          createdBy: "system"
        });
      } catch (replyErr) {
        console.error("[twitter] Thread reply failed (main tweet OK):", replyErr);
      }
    }
    return { ok: true, tweetId: tweet.id, tweetText: copy.mainTweet };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[twitter] postDealTweet failed:", errorMessage);
    try {
      await db.insert(socialPosts).values({
        platform: "x",
        postType: "auto_deal",
        dealHistoryId: deal.dealHistoryId,
        tweetText: `[Failed to generate] ${deal.seoTitle}`,
        status: "failed",
        errorMessage,
        createdBy: "system"
      });
    } catch {
    }
    return { ok: false, error: errorMessage };
  }
}
async function postManualTweet(text2, imageUrl, dealHistoryId) {
  try {
    let mediaIds;
    const uploadedMediaUrls = [];
    if (imageUrl) {
      const mediaId = await uploadMediaFromUrl(imageUrl);
      if (mediaId) {
        mediaIds = [mediaId];
        uploadedMediaUrls.push(imageUrl);
      }
    }
    const tweet = await postTweet(text2, mediaIds);
    await db.insert(socialPosts).values({
      platform: "x",
      postType: "manual",
      externalPostId: tweet.id,
      dealHistoryId: dealHistoryId ?? null,
      tweetText: text2,
      mediaUrls: uploadedMediaUrls.length ? uploadedMediaUrls : null,
      mediaIds: mediaIds ?? null,
      status: "posted",
      postedAt: /* @__PURE__ */ new Date(),
      createdBy: "admin"
    });
    return { ok: true, tweetId: tweet.id, tweetText: text2 };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[twitter] postManualTweet failed:", errorMessage);
    return { ok: false, error: errorMessage };
  }
}
async function deleteAndLogTweet(postId, externalPostId) {
  try {
    await deleteTweet(externalPostId);
    await db.update(socialPosts).set({ status: "deleted" }).where(eq5(socialPosts.id, postId));
    return { ok: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMessage };
  }
}
async function retryFailedPost(postId) {
  const [post] = await db.select().from(socialPosts).where(eq5(socialPosts.id, postId)).limit(1);
  if (!post || post.status !== "failed") {
    return { ok: false, error: "Post not found or not in failed state" };
  }
  try {
    const tweet = await postTweet(post.tweetText);
    await db.update(socialPosts).set({
      externalPostId: tweet.id,
      status: "posted",
      postedAt: /* @__PURE__ */ new Date(),
      errorMessage: null
    }).where(eq5(socialPosts.id, postId));
    return { ok: true, tweetId: tweet.id, tweetText: post.tweetText };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await db.update(socialPosts).set({ errorMessage }).where(eq5(socialPosts.id, postId));
    return { ok: false, error: errorMessage };
  }
}
var init_twitter_server = __esm({
  "app/lib/twitter.server.ts"() {
    "use strict";
    init_db_server();
    init_schema();
    init_claude_server();
    init_shopify_server();
    init_types();
  }
});

// app/lib/emma-rails.server.ts
var emma_rails_server_exports = {};
__export(emma_rails_server_exports, {
  computeBriefHash: () => computeBriefHash,
  getEmmaContextRows: () => getEmmaContextRows,
  listActiveRails: () => listActiveRails,
  regenerateActiveRails: () => regenerateActiveRails,
  regenerateRail: () => regenerateRail,
  regenerateRailById: () => regenerateRailById
});
import { createHash as createHash4 } from "node:crypto";
import { createClient as createClient4 } from "@sanity/client";
function getReadClient3() {
  if (!projectId4) return null;
  return createClient4({ projectId: projectId4, dataset: dataset4, apiVersion: apiVersion4, useCdn: true, token: process.env["SANITY_API_TOKEN"] });
}
function getWriteClient() {
  if (!projectId4) return null;
  return createClient4({ projectId: projectId4, dataset: dataset4, apiVersion: apiVersion4, useCdn: false, token: process.env["SANITY_API_TOKEN"] });
}
function computeBriefHash(rail) {
  const sv = rail.source === "tag" ? rail.shopifyTag ?? "" : rail.source === "collection" ? rail.collectionHandle ?? "" : JSON.stringify(rail.productGids ?? []);
  const payload = JSON.stringify({
    k: rail.kind,
    c: (rail.emmaBrief ?? "").trim(),
    st: rail.source,
    sv: sv.trim(),
    m: rail.maxPicks
  });
  return createHash4("sha256").update(payload).digest("hex").slice(0, 32);
}
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = t + 1831565813 >>> 0;
    let r = t;
    r = Math.imul(r ^ r >>> 15, r | 1);
    r ^= r + Math.imul(r ^ r >>> 7, r | 61);
    return ((r ^ r >>> 14) >>> 0) / 4294967296;
  };
}
function seedFromString(s) {
  const hex = createHash4("sha256").update(s).digest("hex").slice(0, 8);
  return parseInt(hex, 16) >>> 0;
}
function seededShuffle(items, seed) {
  const rand = mulberry32(seed);
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}
function describeFailure(reason, rail) {
  switch (reason) {
    case "hero_not_found":
      return `Live deal not found in Shopify \u2014 check the daily deal is set and published.`;
    case "not_enough_candidates": {
      const src = rail ? rail.source === "tag" ? ` \u2014 tag "${rail.shopifyTag ?? ""}"` : rail.source === "collection" ? ` \u2014 collection "${rail.collectionHandle ?? ""}"` : " \u2014 manual list" : "";
      return `Not enough matching products in Shopify${src}. Need at least 3.`;
    }
    case "empty_picks":
      return `Emma returned no picks from the candidates. Try rewording the brief.`;
    case "no_live_deal":
      return `No live deal set \u2014 can't generate picks until one is live.`;
    case "sanity_not_configured":
      return `Sanity is not configured \u2014 set SANITY_PROJECT_ID and SANITY_API_TOKEN.`;
    default:
      return reason;
  }
}
async function loadCandidates(rail) {
  if (rail.source === "tag") {
    return getProductsByTag((rail.shopifyTag ?? "").trim(), 40);
  }
  if (rail.source === "collection") {
    return getCollectionProducts((rail.collectionHandle ?? "").trim(), 40);
  }
  const ids = rail.productGids ?? [];
  return getProductsByIds(ids.filter((x) => typeof x === "string").slice(0, 40));
}
function toPickCandidate(p, heroHandle) {
  if (p.handle === heroHandle) return null;
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    ...p.brand ? { brand: p.brand } : {},
    ...p.tags?.length ? { tags: p.tags } : {},
    ...p.category ? { productType: p.category } : {},
    price: p.price,
    ...p.seoTitle && p.seoTitle !== p.title ? { blurb: p.seoTitle } : {}
  };
}
async function listActiveRails() {
  return cached("emma:active-rails", 300, async () => {
    const client4 = getReadClient3();
    if (!client4) return [];
    try {
      const rows = await client4.fetch(RAILS_GROQ);
      return rows ?? [];
    } catch (err) {
      console.error("[emma-rails] listActiveRails error:", err);
      return [];
    }
  });
}
async function getRailById(id) {
  const client4 = getReadClient3();
  if (!client4) return null;
  try {
    return await client4.fetch(
      `*[_type == "emmaContextRail" && _id == $id][0]${RAIL_FIELDS_GROQ}`,
      { id }
    );
  } catch (err) {
    console.error("[emma-rails] getRailById error:", err);
    return null;
  }
}
async function patchCurrent(railId, current) {
  const client4 = getWriteClient();
  if (!client4) throw new Error("sanity_not_configured");
  await client4.patch(railId).set({ current }).unset(["lastError"]).commit({ autoGenerateArrayKeys: true });
  const draftId = railId.startsWith("drafts.") ? railId : `drafts.${railId}`;
  try {
    await client4.patch(draftId).set({ current }).unset(["lastError"]).commit({ autoGenerateArrayKeys: true });
  } catch {
  }
}
async function patchLastError(railId, reason, message) {
  const client4 = getWriteClient();
  if (!client4) return;
  const lastError = { reason, message, at: (/* @__PURE__ */ new Date()).toISOString() };
  try {
    await client4.patch(railId).set({ lastError }).commit();
  } catch (err) {
    console.error("[emma-rails] patchLastError error:", err);
  }
}
async function regenerateRail(rail, dealHandle, trigger) {
  if (!getWriteClient()) {
    return { ok: false, reason: "sanity_not_configured" };
  }
  try {
    const hero = await getDealByHandle(dealHandle);
    if (!hero) {
      await patchLastError(rail._id, "hero_not_found", describeFailure("hero_not_found"));
      return { ok: false, reason: "hero_not_found" };
    }
    const candidates = await loadCandidates(rail);
    const shaped = candidates.map((p) => toPickCandidate(p, hero.handle)).filter((c) => c !== null).slice(0, 20);
    if (shaped.length < 3) {
      await patchLastError(rail._id, "not_enough_candidates", describeFailure("not_enough_candidates", rail));
      return { ok: false, reason: "not_enough_candidates" };
    }
    const result = await pickForContextGroup({
      hero: {
        handle: hero.handle,
        title: hero.seoTitle,
        ...hero.brand ? { brand: hero.brand } : {},
        ...hero.tagline ? { tagline: hero.tagline } : {},
        ...hero.category?.length ? { category: categoryToLegacyString(hero.category) } : {},
        ...hero.tags?.length ? { tags: hero.tags } : {},
        dealPrice: hero.dealPrice
      },
      group: {
        name: rail.name,
        kind: rail.kind,
        emmaContext: rail.emmaBrief
      },
      candidates: shaped,
      maxPicks: Math.max(3, Math.min(rail.maxPicks, 12))
    });
    if (result.picks.length < 1) {
      await patchLastError(rail._id, "empty_picks", describeFailure("empty_picks"));
      return { ok: false, reason: "empty_picks" };
    }
    const handleById = new Map(shaped.map((c) => [c.id, c.handle]));
    const picks = result.picks.map((p, i) => ({
      productGid: p.id,
      handle: handleById.get(p.id) ?? "",
      pairingWhy: p.pairingWhy.trim(),
      rank: i,
      edited: false
    })).filter((p) => p.handle);
    const current = {
      dealHandle,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      briefHash: computeBriefHash(rail),
      trigger,
      model: "claude-haiku-4-5-20251001",
      inputTokens: result.tokens.input + result.tokens.cacheCreation + result.tokens.cacheRead,
      outputTokens: result.tokens.output,
      picks
    };
    await patchCurrent(rail._id, current);
    await kvDel(`emma:rails:hydrated:${dealHandle}`);
    invalidateCache("emma:active-rails");
    return { ok: true, count: picks.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "internal_error";
    await patchLastError(rail._id, "internal_error", msg).catch(() => {
    });
    throw err;
  }
}
async function regenerateActiveRails(dealHandle, trigger = "midnight") {
  const rails = await listActiveRails();
  let ok = 0, failed = 0;
  for (const rail of rails) {
    try {
      const res = await regenerateRail(rail, dealHandle, trigger);
      if (res.ok) ok++;
      else failed++;
    } catch (err) {
      console.error("[emma-rails] regenerate failed for", rail.slug, err);
      failed++;
    }
  }
  return { ran: rails.length, ok, failed };
}
async function regenerateRailById(railId, dealHandle, trigger) {
  const rail = await getRailById(railId);
  if (!rail) return { ok: false, reason: "rail_not_found" };
  return regenerateRail(rail, dealHandle, trigger);
}
async function acquireLock(key, ttlSeconds = 60) {
  const existing = await kvGet(key);
  if (existing != null) return false;
  await kvSet(key, Date.now(), ttlSeconds);
  return true;
}
async function hydrateProducts(dealHandle, ids) {
  const cacheKey3 = `emma:rails:hydrated:${dealHandle}`;
  const cached2 = await kvGet(cacheKey3);
  if (cached2 && cached2.length) {
    const map = new Map(cached2.map((p) => [p.id, p]));
    if (ids.every((id) => map.has(id))) return map;
  }
  const fresh = await getProductsByIds(ids);
  await kvSet(cacheKey3, fresh, 24 * 60 * 60);
  return new Map(fresh.map((p) => [p.id, p]));
}
async function getEmmaContextRows(opts) {
  const { dealHandle, sessionSeed } = opts;
  const rails = await listActiveRails();
  if (rails.length === 0) return [];
  const railsById = new Map(rails.map((r) => [r._id, r]));
  for (const rail of rails) {
    const briefHash = computeBriefHash(rail);
    const needs = !rail.current || rail.current.dealHandle !== dealHandle || rail.current.briefHash !== briefHash;
    if (!needs) continue;
    const lockKey = `emma:rails:lock:${dealHandle}:${rail._id}`;
    const got = await acquireLock(lockKey, 60);
    if (!got) continue;
    void (async () => {
      try {
        await regenerateRail(rail, dealHandle, "lazy");
      } catch (err) {
        console.error("[emma-rails] lazy regen failed for", rail.slug, err);
      } finally {
        await kvDel(lockKey).catch(() => {
        });
      }
    })();
  }
  const allIds = /* @__PURE__ */ new Set();
  for (const rail of railsById.values()) {
    for (const p of rail.current?.picks ?? []) allIds.add(p.productGid);
  }
  const hydrated = allIds.size ? await hydrateProducts(dealHandle, [...allIds]) : /* @__PURE__ */ new Map();
  const rows = [];
  for (const rail of railsById.values()) {
    const picks = rail.current?.picks ?? [];
    if (picks.length === 0) continue;
    const alive = picks.map((p) => {
      const product = hydrated.get(p.productGid);
      if (!product) return null;
      return { product, pairingWhy: p.pairingWhy };
    }).filter((x) => x !== null);
    if (alive.length === 0) continue;
    const seed = seedFromString(`${sessionSeed}|${dealHandle}|${rail._id}`);
    const shuffled = seededShuffle(alive, seed);
    const selected = shuffled.slice(0, Math.max(1, rail.displayCount));
    rows.push({
      rail: {
        id: rail._id,
        name: rail.name,
        slug: rail.slug,
        kind: rail.kind,
        displayCount: rail.displayCount
      },
      picks: selected
    });
  }
  return rows;
}
var projectId4, dataset4, apiVersion4, RAIL_FIELDS_GROQ, RAILS_GROQ;
var init_emma_rails_server = __esm({
  "app/lib/emma-rails.server.ts"() {
    "use strict";
    init_shopify_server();
    init_claude_server();
    init_kv_server();
    init_types();
    projectId4 = process.env["SANITY_PROJECT_ID"];
    dataset4 = process.env["SANITY_DATASET"] ?? "production";
    apiVersion4 = "2024-10-01";
    RAIL_FIELDS_GROQ = `{
  _id, name, "slug": slug.current, kind, emmaBrief,
  source, shopifyTag, collectionHandle, productGids,
  maxPicks, displayCount, active, sortOrder,
  current, lastError
}`;
    RAILS_GROQ = `*[_type == "emmaContextRail" && active == true] | order(sortOrder asc, _createdAt asc) ${RAIL_FIELDS_GROQ}`;
  }
});

// app/lib/search-ping.server.ts
var search_ping_server_exports = {};
__export(search_ping_server_exports, {
  pingSearchEngines: () => pingSearchEngines
});
async function pingSearchEngines(paths) {
  if (process.env["SEARCH_PING_ENABLED"] !== "true") return;
  const urlList = [...new Set(paths)].filter(Boolean).map((p) => p.startsWith("http") ? p : `${SITE_ORIGIN}${p.startsWith("/") ? p : `/${p}`}`);
  if (urlList.length === 0) return;
  const key = process.env["INDEXNOW_API_KEY"];
  if (!key) {
    console.warn("[search-ping] SEARCH_PING_ENABLED set but INDEXNOW_API_KEY missing \u2014 skipping");
    return;
  }
  try {
    const host = new URL(SITE_ORIGIN).host;
    const res = await fetch("https://api.indexnow.org/IndexNow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host,
        key,
        keyLocation: `${SITE_ORIGIN}/${key}.txt`,
        urlList
      })
    });
    console.log(`[search-ping] IndexNow ${res.status} for ${urlList.length} url(s)`);
  } catch (err) {
    console.error("[search-ping] IndexNow ping failed (non-blocking):", err);
  }
}
var SITE_ORIGIN;
var init_search_ping_server = __esm({
  "app/lib/search-ping.server.ts"() {
    "use strict";
    SITE_ORIGIN = "https://xdipx.com";
  }
});

// app/lib/with-timeout.server.ts
async function withTimeout(p, ms, fallback, label = "op") {
  let timer;
  const timeout = new Promise((resolve2) => {
    timer = setTimeout(() => {
      console.warn(`[with-timeout] ${label} timed out after ${ms}ms \u2014 using fallback`);
      resolve2(fallback);
    }, ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
var init_with_timeout_server = __esm({
  "app/lib/with-timeout.server.ts"() {
    "use strict";
  }
});

// app/types/discovery.ts
var MATTERS_V1, MATTERS_V2, MATTERS, CATEGORIES, DEFAULT_BUDGET, EMPTY_STATE;
var init_discovery = __esm({
  "app/types/discovery.ts"() {
    "use strict";
    MATTERS_V1 = [
      "Beginner-Friendly",
      "Body-Safe Silicone",
      "Discreet Design",
      "First-Time",
      "Hands-Free",
      "Rechargeable",
      "Soft-Touch",
      "Travel-Size",
      "Waterproof",
      "App-Controlled",
      "Whisper-Quiet",
      "Plus-Size-Friendly"
    ];
    MATTERS_V2 = [
      "Beginner-friendly",
      "Whisper-quiet",
      "Waterproof",
      "Travel-ready",
      "Discreet",
      "Hands-free",
      "Remote-controlled",
      "Plus-size friendly",
      "Easy to clean",
      "Rechargeable",
      "Soft-touch",
      "Latex-free"
    ];
    MATTERS = [...MATTERS_V1, ...MATTERS_V2];
    CATEGORIES = ["Pleasure", "Play", "Body", "Wear"];
    DEFAULT_BUDGET = 200;
    EMPTY_STATE = {
      mood: [],
      audience: [],
      matters: [],
      budget: DEFAULT_BUDGET,
      step: 0
    };
  }
});

// app/lib/discovery-emma.ts
function scoreProduct2(p, s) {
  let score2 = 0;
  for (const m of s.mood) if (p.mood.includes(m)) score2 += SCORE_MOOD;
  for (const a of s.audience) if (p.audience.includes(a)) score2 += SCORE_AUDIENCE;
  for (const k of s.matters) if (p.matters.includes(k)) score2 += SCORE_MATTERS;
  return score2;
}
function computeAvailable(index2, s) {
  const moods = /* @__PURE__ */ new Set();
  const audiences = /* @__PURE__ */ new Set();
  const matters = /* @__PURE__ */ new Set();
  const hasMood = s.mood.length > 0;
  const hasAudience = s.audience.length > 0;
  const hasMatters = s.matters.length > 0;
  for (const p of index2) {
    const okMood = !hasMood || s.mood.some((m) => p.mood.includes(m));
    const okAudience = !hasAudience || s.audience.some((a) => p.audience.includes(a));
    const okMatters = !hasMatters || s.matters.some((k) => p.matters.includes(k));
    if (okAudience && okMatters) for (const m of p.mood) moods.add(m);
    if (okMood && okMatters) for (const a of p.audience) audiences.add(a);
    if (okMood && okAudience) for (const k of p.matters) matters.add(k);
  }
  return { moods, audiences, matters };
}
function availableToArrays(a) {
  return {
    moods: Array.from(a.moods),
    audiences: Array.from(a.audiences),
    matters: Array.from(a.matters)
  };
}
function mulberry322(seed) {
  let t = seed >>> 0;
  return () => {
    t = t + 1831565813 >>> 0;
    let r = t;
    r = Math.imul(r ^ r >>> 15, r | 1);
    r ^= r + Math.imul(r ^ r >>> 7, r | 61);
    return ((r ^ r >>> 14) >>> 0) / 4294967296;
  };
}
function seededShuffle2(arr, seed) {
  const rand = mulberry322(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}
function rankRails(products, state, opts = {}) {
  const { perRail = 4, dropEmpty = false, seed } = opts;
  const hasAny = state.mood.length > 0 || state.audience.length > 0 || state.matters.length > 0;
  const filtered = products.filter((p) => p.price <= state.budget);
  const buckets = {
    Pleasure: [],
    Play: [],
    Body: [],
    Wear: []
  };
  const totals = { Pleasure: 0, Play: 0, Body: 0, Wear: 0 };
  const aggScore = { Pleasure: 0, Play: 0, Body: 0, Wear: 0 };
  for (const p of filtered) {
    const score2 = hasAny ? scoreProduct2(p, state) : 0;
    buckets[p.category].push({ product: p, score: score2 });
    totals[p.category] += 1;
    aggScore[p.category] += score2;
  }
  for (let ci = 0; ci < CATEGORIES.length; ci++) {
    const cat = CATEGORIES[ci];
    if (!hasAny && seed !== void 0) {
      seededShuffle2(buckets[cat], (seed ^ (ci + 1) * 2654435761) >>> 0);
    } else {
      buckets[cat].sort((a, b) => b.score - a.score);
    }
  }
  const order = [...CATEGORIES];
  if (hasAny) {
    order.sort((a, b) => {
      const diff = aggScore[b] - aggScore[a];
      if (diff !== 0) return diff;
      return CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b);
    });
  }
  const rails = order.map((cat) => ({
    category: cat,
    score: aggScore[cat],
    total: totals[cat],
    items: buckets[cat].slice(0, perRail)
  }));
  return dropEmpty ? rails.filter((r) => r.items.length > 0) : rails;
}
function rankSingleRail(products, state, category, offset, limit) {
  const hasAny = state.mood.length > 0 || state.audience.length > 0 || state.matters.length > 0;
  const filtered = products.filter((p) => p.price <= state.budget && p.category === category);
  const scored = filtered.map((p) => ({
    product: p,
    score: hasAny ? scoreProduct2(p, state) : 0
  }));
  scored.sort((a, b) => b.score - a.score);
  return { items: scored.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(0, limit)), total: scored.length };
}
var SCORE_MOOD, SCORE_AUDIENCE, SCORE_MATTERS;
var init_discovery_emma = __esm({
  "app/lib/discovery-emma.ts"() {
    "use strict";
    init_discovery();
    SCORE_MOOD = 3;
    SCORE_AUDIENCE = 2;
    SCORE_MATTERS = 2;
  }
});

// app/lib/discovery-tags.ts
function normalizeTag2(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.toLowerCase().split(/(\s+|-)/).map((part) => {
    if (/^\s+$/.test(part) || part === "-") return part;
    if (part.length === 0) return part;
    return part[0].toUpperCase() + part.slice(1);
  }).join("");
}
var init_discovery_tags = __esm({
  "app/lib/discovery-tags.ts"() {
    "use strict";
  }
});

// app/lib/discovery-rules.server.ts
import { eq as eq6, and, asc } from "drizzle-orm";
async function getActiveDiscoveryRules() {
  const cached2 = await kvGet(RULES_CACHE_KEY);
  if (cached2 && Array.isArray(cached2)) return cached2;
  const rows = await db.select().from(discoveryRules).where(eq6(discoveryRules.active, true)).orderBy(asc(discoveryRules.ruleType), asc(discoveryRules.sortOrder), asc(discoveryRules.id));
  const rules = rows.map(rowToRule);
  await kvSet(RULES_CACHE_KEY, rules, RULES_TTL_SECONDS);
  return rules;
}
async function getInventoryMin() {
  const cached2 = await kvGet(INVENTORY_MIN_CACHE_KEY);
  if (typeof cached2 === "number") return cached2;
  const row = await db.select({ value: pipelineSettings.value }).from(pipelineSettings).where(eq6(pipelineSettings.key, "discovery_inventory_min")).limit(1);
  const parsed = row.length && row[0] ? parseInt(row[0].value, 10) : 0;
  const value = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  await kvSet(INVENTORY_MIN_CACHE_KEY, value, INVENTORY_MIN_CACHE_TTL);
  return value;
}
function rowToRule(row) {
  return {
    id: row.id,
    ruleType: row.ruleType,
    ruleValue: row.ruleValue,
    category: row.category ?? null,
    sortOrder: row.sortOrder,
    notes: row.notes ?? null,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
function applyRules(products, rules, inventoryMin) {
  if (rules.length === 0 && inventoryMin === 0) return products;
  const excludeHandles = /* @__PURE__ */ new Set();
  const excludeTypes = [];
  const excludeKeywords = [];
  const priceFloors = [];
  const priceCeilings = [];
  for (const rule of rules) {
    switch (rule.ruleType) {
      case "exclude_product":
        excludeHandles.add(rule.ruleValue);
        break;
      case "exclude_product_type":
        excludeTypes.push({ value: rule.ruleValue.trim().toLowerCase(), category: rule.category });
        break;
      case "exclude_keyword":
        excludeKeywords.push(rule.ruleValue.toLowerCase());
        break;
      case "exclude_price_min": {
        const n = parseFloat(rule.ruleValue);
        if (Number.isFinite(n)) priceFloors.push(n);
        break;
      }
      case "exclude_price_max": {
        const n = parseFloat(rule.ruleValue);
        if (Number.isFinite(n)) priceCeilings.push(n);
        break;
      }
    }
  }
  return products.filter((p) => {
    if (excludeHandles.has(p.handle)) return false;
    if (p.productType) {
      const productTypeLc = p.productType.trim().toLowerCase();
      for (const et of excludeTypes) {
        if (et.value === productTypeLc && (et.category === null || et.category === p.category)) {
          return false;
        }
      }
    }
    const lowerTitle = p.title.toLowerCase();
    for (const kw of excludeKeywords) {
      if (lowerTitle.includes(kw)) return false;
    }
    for (const floor of priceFloors) {
      if (p.price < floor) return false;
    }
    for (const ceiling of priceCeilings) {
      if (p.price > ceiling) return false;
    }
    if (inventoryMin > 0 && p.totalInventory !== null && p.totalInventory < inventoryMin) {
      return false;
    }
    return true;
  });
}
function fillFallbacks(rail, rules, filteredIndex, perRail, alreadyIncludedIds = /* @__PURE__ */ new Set(), collectionPinIds = {}, honoraryProductsByCategory = {}) {
  const slots = perRail - rail.items.length;
  if (slots <= 0) return rail;
  const byHandle = /* @__PURE__ */ new Map();
  const byId = /* @__PURE__ */ new Map();
  for (const p of filteredIndex) {
    byHandle.set(p.handle, p);
    byId.set(p.id, p);
  }
  for (const p of honoraryProductsByCategory[rail.category] ?? []) {
    if (!byId.has(p.id)) byId.set(p.id, p);
  }
  const inRail = new Set(rail.items.map((sp) => sp.product.handle));
  const inRailIds = new Set(rail.items.map((sp) => sp.product.id));
  const pins = rules.filter((r) => r.ruleType === "pin_fallback" && r.category === rail.category).sort((a, b) => a.sortOrder - b.sortOrder);
  const extras = [];
  const usedIds = /* @__PURE__ */ new Set();
  for (const pin of pins) {
    if (extras.length >= slots) break;
    const product = byHandle.get(pin.ruleValue);
    if (!product) continue;
    if (inRail.has(product.handle)) continue;
    if (alreadyIncludedIds.has(product.id)) continue;
    if (usedIds.has(product.id)) continue;
    extras.push({ product, score: 0 });
    usedIds.add(product.id);
  }
  const collectionIds = collectionPinIds[rail.category] ?? [];
  for (const id of collectionIds) {
    if (extras.length >= slots) break;
    const product = byId.get(id);
    if (!product) continue;
    if (product.category !== rail.category) continue;
    if (inRailIds.has(product.id)) continue;
    if (alreadyIncludedIds.has(product.id)) continue;
    if (usedIds.has(product.id)) continue;
    extras.push({ product, score: 0 });
    usedIds.add(product.id);
  }
  if (extras.length === 0) return rail;
  return {
    ...rail,
    items: [...rail.items, ...extras],
    total: rail.total + extras.length
  };
}
function cleanCollectionHandle(input) {
  if (!input) return "";
  let s = input.trim().toLowerCase();
  const protoMatch = s.match(/^https?:\/\/[^/]+(.*)$/);
  if (protoMatch && protoMatch[1] !== void 0) s = protoMatch[1];
  s = s.replace(/^\/+collections\/+/, "").replace(/^\/+/, "");
  const stop = s.search(/[?#/]/);
  if (stop !== -1) s = s.slice(0, stop);
  return s;
}
async function resolveCollectionPins(rules, fetcher) {
  const collectionPins = rules.filter((r) => r.ruleType === "pin_collection_fallback" && r.category !== null).sort((a, b) => a.sortOrder - b.sortOrder);
  if (collectionPins.length === 0) return {};
  const handleCache = /* @__PURE__ */ new Map();
  const result = {};
  for (const pin of collectionPins) {
    const handle = cleanCollectionHandle(pin.ruleValue);
    if (!handle || !pin.category) continue;
    let ids = handleCache.get(handle);
    if (!ids) {
      ids = await fetcher(handle);
      handleCache.set(handle, ids);
    }
    const seen = new Set(result[pin.category] ?? []);
    const merged = result[pin.category] ?? [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(id);
    }
    result[pin.category] = merged;
  }
  return result;
}
function autoLoosen(category, state, filteredIndex, perRail) {
  const withoutMatters = { ...state, matters: [] };
  const r1 = rankSingleRail(filteredIndex, withoutMatters, category, 0, perRail);
  if (r1.items.length > 0) {
    return { items: r1.items, reason: `Loosened your brief \u2014 showing all of ${category}.` };
  }
  const withoutAudience = { ...withoutMatters, audience: [] };
  const r2 = rankSingleRail(filteredIndex, withoutAudience, category, 0, perRail);
  if (r2.items.length > 0) {
    return { items: r2.items, reason: `Loosened your brief \u2014 showing all of ${category}.` };
  }
  const withoutMood = { ...withoutAudience, mood: [] };
  const r3 = rankSingleRail(filteredIndex, withoutMood, category, 0, perRail);
  if (r3.items.length > 0) {
    return { items: r3.items, reason: `Loosened your brief \u2014 showing all of ${category}.` };
  }
  return null;
}
var RULES_CACHE_KEY, RULES_TTL_SECONDS, INVENTORY_MIN_CACHE_KEY, INVENTORY_MIN_CACHE_TTL;
var init_discovery_rules_server = __esm({
  "app/lib/discovery-rules.server.ts"() {
    "use strict";
    init_db_server();
    init_schema();
    init_kv_server();
    init_discovery_emma();
    init_discovery_server();
    RULES_CACHE_KEY = "discovery:rules:v1";
    RULES_TTL_SECONDS = 5 * 60;
    INVENTORY_MIN_CACHE_KEY = "discovery:inventory-min:v1";
    INVENTORY_MIN_CACHE_TTL = 5 * 60;
  }
});

// app/lib/discovery.server.ts
var discovery_server_exports = {};
__export(discovery_server_exports, {
  INDEX_KEY: () => INDEX_KEY,
  INDEX_TTL_SECONDS: () => INDEX_TTL_SECONDS,
  VOCAB_KEY: () => VOCAB_KEY,
  VOCAB_TTL_SECONDS: () => VOCAB_TTL_SECONDS,
  buildDiscoveryIndex: () => buildDiscoveryIndex,
  computeVocab: () => computeVocab,
  fetchHonoraryProducts: () => fetchHonoraryProducts,
  getDiscoveryIndex: () => getDiscoveryIndex,
  getDiscoveryRailPage: () => getDiscoveryRailPage,
  getDiscoveryRails: () => getDiscoveryRails,
  getDiscoveryVocab: () => getDiscoveryVocab,
  getHonoraryProductsForPin: () => getHonoraryProductsForPin,
  getProductIdsByCollectionHandle: () => getProductIdsByCollectionHandle,
  invalidateDiscoveryIndex: () => invalidateDiscoveryIndex,
  reportTagCoverage: () => reportTagCoverage,
  triggerDiscoveryRebuild: () => triggerDiscoveryRebuild,
  writeDiscoveryIndexDurable: () => writeDiscoveryIndexDurable
});
import { eq as eq7 } from "drizzle-orm";
function dialToSubcategory(dial) {
  switch (dial) {
    case "vibrator":
      return "Vibrators";
    case "dildo":
      return "Dildos";
    case "anal":
      return "Anal";
    case "cock-ring":
    case "stroker":
    case "extender":
    case "pump":
    case "sex-machine":
      return "For Him";
    case "bondage":
      return "Bondage & Kink";
    case "couples":
      return "Couples";
    case "lube":
      return "Lubricants";
    case "massage":
      return "Massage";
    case "enhancer":
    case "wellness":
      return "Wellness";
    case "wear":
      return "Lingerie";
    case "harness":
      return "Accessories";
    default:
      return null;
  }
}
function cleanTagList(arr) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const raw of arr) {
    const v = normalizeTag2(raw);
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
function classifyOptionValues(options) {
  let colorValues = [];
  let sizeValues = [];
  for (const o of options) {
    const name = o.name.toLowerCase();
    const values = o.optionValues.map((v) => v.name.trim()).filter(Boolean);
    if (/colou?r/.test(name)) colorValues = values;
    else if (/size|length/.test(name)) sizeValues = values;
  }
  return { colorValues, sizeValues };
}
function derivePricingAndOptions(n, price) {
  const maxRaw = Number(n.priceRangeV2.maxVariantPrice?.amount);
  const priceMax = Number.isFinite(maxRaw) && maxRaw > price ? maxRaw : null;
  const originalRaw = Number(n.originalPriceRaw?.value);
  const compareRaw = Number(n.compareAtPriceRange?.minVariantCompareAtPrice?.amount);
  const msrp = Number.isFinite(originalRaw) && originalRaw > 0 ? originalRaw : Number.isFinite(compareRaw) ? compareRaw : NaN;
  const compareAtPrice = Number.isFinite(msrp) && msrp > price ? msrp : null;
  const { colorValues, sizeValues } = classifyOptionValues(n.options ?? []);
  return { priceMax, compareAtPrice, colorValues, sizeValues };
}
function parseListMetafield(value) {
  if (!value) return [];
  if (value.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}
function nodeToDiscoveryProduct(n, categoryMap) {
  const category = categoryMap.get(n.id);
  if (!category) return null;
  const price = Number(n.priceRangeV2.minVariantPrice.amount);
  if (!Number.isFinite(price) || price <= 0) return null;
  const dial = n.productTypeDial?.value ?? "";
  const subcategory = dialToSubcategory(dial) ?? category;
  const mood = cleanTagList(parseListMetafield(n.moodTagsRaw?.value));
  const audience = cleanTagList(parseListMetafield(n.audienceTagsRaw?.value));
  const matters = cleanTagList(parseListMetafield(n.mattersTagsRaw?.value));
  const productType = (n.productType ?? "").trim() || null;
  const productTypeDial = dial || null;
  const { priceMax, compareAtPrice, colorValues, sizeValues } = derivePricingAndOptions(n, price);
  return {
    id: n.id,
    handle: n.handle,
    title: n.title,
    defaultVariantId: n.variants?.nodes?.[0]?.id ?? null,
    price,
    priceMax,
    compareAtPrice,
    colorValues,
    sizeValues,
    imageUrl: n.featuredImage?.url ?? null,
    imageAlt: n.featuredImage?.altText ?? null,
    category,
    subcategory,
    mood,
    audience,
    matters,
    totalInventory: n.totalInventory ?? null,
    productType,
    productTypeDial
  };
}
async function fetchCollectionProductIds(collectionGid) {
  const ids = /* @__PURE__ */ new Set();
  let cursor = null;
  while (true) {
    const data = await adminGraphQL(
      COLLECTION_PRODUCTS_QUERY,
      { id: collectionGid, cursor }
    );
    const page = data.collection?.products;
    if (!page) break;
    for (const n of page.nodes) ids.add(n.id);
    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
    if (!cursor) break;
  }
  return ids;
}
async function getProductIdsByCollectionHandle(handle) {
  const key = handle.trim().toLowerCase();
  if (!key) return [];
  const cacheKey3 = collectionHandleKey(key);
  const cached2 = await kvGet(cacheKey3);
  if (cached2 && Array.isArray(cached2)) return cached2;
  let ids = [];
  try {
    const data = await adminGraphQL(
      COLLECTION_BY_HANDLE_QUERY,
      { handle: key }
    );
    const gid = data.collectionByHandle?.id;
    if (gid) {
      const set = await fetchCollectionProductIds(gid);
      ids = Array.from(set);
    }
  } catch (err) {
    console.error("[discovery] getProductIdsByCollectionHandle error for", key, err);
    return [];
  }
  await kvSet(cacheKey3, ids, COLLECTION_HANDLE_CACHE_TTL);
  return ids;
}
async function fetchHonoraryProducts(ids, category) {
  if (ids.length === 0) return [];
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    let resp;
    try {
      resp = await adminGraphQL(NODES_BY_IDS_QUERY, { ids: batch });
    } catch (err) {
      console.error("[discovery] fetchHonoraryProducts batch failed:", err);
      continue;
    }
    for (const node of resp.nodes) {
      if (!node || node.status !== "ACTIVE") continue;
      const price = Number(node.priceRangeV2.minVariantPrice.amount);
      if (!Number.isFinite(price) || price <= 0) continue;
      const dial = node.productTypeDial?.value ?? "";
      const subcategory = dialToSubcategory(dial) ?? category;
      const productType = (node.productType ?? "").trim() || null;
      const { priceMax, compareAtPrice, colorValues, sizeValues } = derivePricingAndOptions(node, price);
      out.push({
        id: node.id,
        handle: node.handle,
        title: node.title,
        defaultVariantId: node.variants?.nodes?.[0]?.id ?? null,
        price,
        priceMax,
        compareAtPrice,
        colorValues,
        sizeValues,
        imageUrl: node.featuredImage?.url ?? null,
        imageAlt: node.featuredImage?.altText ?? null,
        category,
        // honorary — forced to the pinned rail's category
        subcategory,
        mood: cleanTagList(parseListMetafield(node.moodTagsRaw?.value)),
        audience: cleanTagList(parseListMetafield(node.audienceTagsRaw?.value)),
        matters: cleanTagList(parseListMetafield(node.mattersTagsRaw?.value)),
        totalInventory: node.totalInventory ?? null,
        productType,
        productTypeDial: dial || null
      });
    }
  }
  return out;
}
async function getHonoraryProductsForPin(handle, category) {
  const cleaned = handle.trim().toLowerCase();
  if (!cleaned) return [];
  const cacheKey3 = honoraryCacheKey(category, cleaned);
  const cached2 = await kvGet(cacheKey3);
  if (cached2 && Array.isArray(cached2)) return cached2;
  const ids = await getProductIdsByCollectionHandle(cleaned);
  if (ids.length === 0) {
    await kvSet(cacheKey3, [], HONORARY_CACHE_TTL);
    return [];
  }
  const products = await fetchHonoraryProducts(ids, category);
  await kvSet(cacheKey3, products, HONORARY_CACHE_TTL);
  return products;
}
async function buildCategoryMap() {
  const sets = await Promise.all(
    CATEGORY_PRIORITY.map(async (cat) => ({
      cat,
      ids: await fetchCollectionProductIds(CATEGORY_COLLECTION_IDS[cat])
    }))
  );
  const map = /* @__PURE__ */ new Map();
  for (const { cat, ids } of sets) {
    for (const id of ids) {
      if (!map.has(id)) map.set(id, cat);
    }
  }
  return map;
}
async function buildDiscoveryIndex() {
  const categoryMap = await buildCategoryMap();
  const out = [];
  let cursor = null;
  while (true) {
    const data = await adminGraphQL(
      PRODUCTS_PAGE_QUERY,
      { cursor }
    );
    for (const node of data.products.nodes) {
      const dp = nodeToDiscoveryProduct(node, categoryMap);
      if (dp) out.push(dp);
    }
    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
    if (!cursor) break;
  }
  return out;
}
function triggerDiscoveryRebuild() {
  const baseUrl = process.env["BASE_URL"];
  const cronSecret = process.env["CRON_SECRET"];
  if (!baseUrl || !cronSecret) return;
  void fetch(`${baseUrl}/cron/warm-discovery-index`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${cronSecret}` }
  }).catch(() => {
  });
}
function readL1Memo() {
  const entry = _g4.__discoveryIndexMemo;
  if (!entry) return null;
  if (Date.now() - entry.ts > L1_TTL_MS) return null;
  return entry;
}
function writeL1Memo(index2, vocab) {
  _g4.__discoveryIndexMemo = { index: index2, vocab, ts: Date.now() };
}
async function readDiscoveryIndexDurable() {
  try {
    const [row] = await db.select().from(discoveryIndexPayload).where(eq7(discoveryIndexPayload.version, INDEX_VERSION)).limit(1);
    if (!row) return null;
    const index2 = row.indexJson;
    const vocab = row.vocabJson;
    if (!Array.isArray(index2) || index2.length === 0) return null;
    void kvSet(INDEX_KEY, index2, INDEX_TTL_SECONDS).catch(() => {
    });
    void kvSet(VOCAB_KEY, vocab, VOCAB_TTL_SECONDS).catch(() => {
    });
    return { index: index2, vocab };
  } catch (err) {
    console.warn("[discovery] Neon durable read failed:", err);
    return null;
  }
}
async function writeDiscoveryIndexDurable(index2, vocab) {
  if (index2.length === 0) return;
  await kvSet(INDEX_KEY, index2, INDEX_TTL_SECONDS);
  await kvSet(VOCAB_KEY, vocab, VOCAB_TTL_SECONDS);
  writeL1Memo(index2, vocab);
  try {
    await db.insert(discoveryIndexPayload).values({
      version: INDEX_VERSION,
      indexJson: index2,
      vocabJson: vocab,
      count: index2.length
    }).onConflictDoUpdate({
      target: [discoveryIndexPayload.version],
      set: {
        indexJson: index2,
        vocabJson: vocab,
        count: index2.length,
        builtAt: /* @__PURE__ */ new Date()
      }
    });
  } catch (err) {
    console.error("[discovery] Neon durable upsert failed (KV still written):", err);
  }
}
async function getDiscoveryIndex(opts = {}) {
  if (!opts.force) {
    const memo = readL1Memo();
    if (memo) return memo.index;
    const cached2 = await kvGet(INDEX_KEY);
    if (cached2 && Array.isArray(cached2) && cached2.length > 0) {
      const vocab = await kvGet(VOCAB_KEY) ?? computeVocab(cached2);
      writeL1Memo(cached2, vocab);
      return cached2;
    }
  }
  if (!isKvConfigured()) {
    const fresh = await buildDiscoveryIndex();
    if (fresh.length > 0) {
      await writeDiscoveryIndexDurable(fresh, computeVocab(fresh));
    }
    return fresh;
  }
  if (!opts.force) {
    const durable = await readDiscoveryIndexDurable();
    if (durable) {
      writeL1Memo(durable.index, durable.vocab);
      return durable.index;
    }
  }
  triggerDiscoveryRebuild();
  return [];
}
async function invalidateDiscoveryIndex() {
  await kvSet(INDEX_KEY, null, 1);
  await kvSet(VOCAB_KEY, null, 1);
  _g4.__discoveryIndexMemo = null;
}
function computeVocab(index2) {
  const tally = (key) => {
    const counts = /* @__PURE__ */ new Map();
    for (const p of index2) {
      for (const v of p[key]) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v);
  };
  return {
    moods: tally("mood"),
    audiences: tally("audience"),
    matters: tally("matters")
  };
}
async function getDiscoveryVocab() {
  const cached2 = await kvGet(VOCAB_KEY);
  if (cached2 && Array.isArray(cached2.moods) && cached2.moods.length > 0) return cached2;
  const idx = await getDiscoveryIndex();
  if (idx.length === 0) return { moods: [], audiences: [], matters: [] };
  const vocab = computeVocab(idx);
  if (vocab.moods.length > 0 || vocab.audiences.length > 0 || vocab.matters.length > 0) {
    await kvSet(VOCAB_KEY, vocab, VOCAB_TTL_SECONDS);
  }
  return vocab;
}
async function getDiscoveryRails(state, opts = {}) {
  const products = opts.index ?? await getDiscoveryIndex();
  const perRail = opts.perRail ?? 4;
  const [rules, inventoryMin] = await Promise.all([
    getActiveDiscoveryRules(),
    getInventoryMin()
  ]);
  const filtered = applyRules(products, rules, inventoryMin);
  const collectionPinIds = await resolveCollectionPins(
    rules,
    getProductIdsByCollectionHandle
  );
  const rankOpts = { perRail };
  if (opts.dropEmpty !== void 0) rankOpts.dropEmpty = opts.dropEmpty;
  if (opts.seed !== void 0) rankOpts.seed = opts.seed;
  const rails = rankRails(filtered, state, rankOpts);
  const hasAnySelections = state.mood.length > 0 || state.audience.length > 0 || state.matters.length > 0;
  const indexedIds = new Set(filtered.map((p) => p.id));
  const honoraryByCategory = {};
  const collectionPinRules = rules.filter((r) => r.ruleType === "pin_collection_fallback" && r.category).sort((a, b) => a.sortOrder - b.sortOrder);
  await Promise.all(
    collectionPinRules.map(async (pin) => {
      const cat = pin.category;
      const products2 = await getHonoraryProductsForPin(pin.ruleValue, cat);
      const novel = products2.filter((p) => !indexedIds.has(p.id));
      if (novel.length === 0) return;
      const allowed = applyRules(novel, rules, inventoryMin);
      if (allowed.length === 0) return;
      const existing = honoraryByCategory[cat] ?? [];
      const seen = new Set(existing.map((p) => p.id));
      for (const p of allowed) {
        if (!seen.has(p.id)) {
          existing.push(p);
          seen.add(p.id);
        }
      }
      honoraryByCategory[cat] = existing;
    })
  );
  const includedIds = new Set(
    rails.flatMap((r) => r.items.map((sp) => sp.product.id))
  );
  for (const rail of rails) {
    if (rail.items.length < perRail) {
      const filled = fillFallbacks(
        rail,
        rules,
        filtered,
        perRail,
        includedIds,
        collectionPinIds,
        honoraryByCategory
      );
      for (const sp of filled.items) {
        if (!includedIds.has(sp.product.id)) includedIds.add(sp.product.id);
      }
      rail.items = filled.items;
      rail.total = filled.total;
    }
  }
  for (const rail of rails) {
    if (rail.items.length === 0 && hasAnySelections) {
      const loosened = autoLoosen(rail.category, state, filtered, perRail);
      if (loosened) {
        rail.items = loosened.items;
        rail.total = loosened.items.length;
        rail.relaxed = true;
        rail.relaxedReason = loosened.reason;
      }
    }
  }
  const available = availableToArrays(computeAvailable(filtered, state));
  return { rails, total: filtered.length, available };
}
async function getDiscoveryRailPage(state, category, offset, limit, opts = {}) {
  const products = opts.index ?? await getDiscoveryIndex();
  const [rules, inventoryMin] = await Promise.all([
    getActiveDiscoveryRules(),
    getInventoryMin()
  ]);
  const filtered = applyRules(products, rules, inventoryMin);
  return rankSingleRail(filtered, state, category, offset, limit);
}
async function reportTagCoverage() {
  const idx = await getDiscoveryIndex({ force: true });
  const report = {
    total: idx.length,
    withMood: 0,
    withAudience: 0,
    withMatters: 0,
    withAllThree: 0,
    withCategoryMapping: idx.length,
    // index already requires a category mapping
    byCategory: { Pleasure: 0, Play: 0, Body: 0, Wear: 0 }
  };
  for (const p of idx) {
    if (p.mood.length > 0) report.withMood += 1;
    if (p.audience.length > 0) report.withAudience += 1;
    if (p.matters.length > 0) report.withMatters += 1;
    if (p.mood.length > 0 && p.audience.length > 0 && p.matters.length > 0) {
      report.withAllThree += 1;
    }
    report.byCategory[p.category] += 1;
  }
  return report;
}
var INDEX_VERSION, INDEX_KEY, INDEX_TTL_SECONDS, VOCAB_KEY, VOCAB_TTL_SECONDS, CATEGORY_COLLECTION_IDS, CATEGORY_PRIORITY, PRODUCTS_PAGE_QUERY, COLLECTION_PRODUCTS_QUERY, COLLECTION_BY_HANDLE_QUERY, COLLECTION_HANDLE_CACHE_TTL, collectionHandleKey, NODES_BY_IDS_QUERY, HONORARY_CACHE_TTL, honoraryCacheKey, L1_TTL_MS, _g4;
var init_discovery_server = __esm({
  "app/lib/discovery.server.ts"() {
    "use strict";
    init_db_server();
    init_schema();
    init_shopify_server();
    init_kv_server();
    init_discovery_emma();
    init_discovery_tags();
    init_discovery_rules_server();
    INDEX_VERSION = "v7";
    INDEX_KEY = `discovery:index:${INDEX_VERSION}`;
    INDEX_TTL_SECONDS = 60 * 60 * 24;
    VOCAB_KEY = `discovery:vocab:${INDEX_VERSION}`;
    VOCAB_TTL_SECONDS = 60 * 60 * 24;
    CATEGORY_COLLECTION_IDS = {
      Pleasure: "gid://shopify/Collection/330228727979",
      Play: "gid://shopify/Collection/330228695211",
      Body: "gid://shopify/Collection/330227581099",
      Wear: "gid://shopify/Collection/330229514411"
    };
    CATEGORY_PRIORITY = ["Pleasure", "Play", "Body", "Wear"];
    PRODUCTS_PAGE_QUERY = /* GraphQL */
    `
  query DiscoveryIndexPage($cursor: String) {
    products(first: 100, after: $cursor, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        title
        status
        productType
        featuredImage { url altText }
        variants(first: 1) { nodes { id } }
        priceRangeV2 { minVariantPrice { amount } maxVariantPrice { amount } }
        compareAtPriceRange { minVariantCompareAtPrice { amount } }
        options(first: 3) { name optionValues { name } }
        totalInventory
        originalPriceRaw: metafield(namespace: "xdipx", key: "original_price")     { value }
        productTypeDial:  metafield(namespace: "xdipx", key: "product_type_dial") { value }
        moodTagsRaw:      metafield(namespace: "xdipx", key: "mood_tags")          { value }
        audienceTagsRaw:  metafield(namespace: "xdipx", key: "audience_tags")      { value }
        mattersTagsRaw:   metafield(namespace: "xdipx", key: "matters_tags")       { value }
      }
    }
  }
`;
    COLLECTION_PRODUCTS_QUERY = /* GraphQL */
    `
  query DiscoveryCollectionProducts($id: ID!, $cursor: String) {
    collection(id: $id) {
      products(first: 250, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { id }
      }
    }
  }
`;
    COLLECTION_BY_HANDLE_QUERY = /* GraphQL */
    `
  query DiscoveryCollectionByHandle($handle: String!) {
    collectionByHandle(handle: $handle) { id }
  }
`;
    COLLECTION_HANDLE_CACHE_TTL = 30 * 60;
    collectionHandleKey = (h) => `discovery:collection-pin:${INDEX_VERSION}:${h}`;
    NODES_BY_IDS_QUERY = /* GraphQL */
    `
  query DiscoveryHonoraryNodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        handle
        title
        status
        productType
        featuredImage { url altText }
        variants(first: 1) { nodes { id } }
        priceRangeV2 { minVariantPrice { amount } maxVariantPrice { amount } }
        compareAtPriceRange { minVariantCompareAtPrice { amount } }
        options(first: 3) { name optionValues { name } }
        totalInventory
        originalPriceRaw: metafield(namespace: "xdipx", key: "original_price")     { value }
        productTypeDial:  metafield(namespace: "xdipx", key: "product_type_dial") { value }
        moodTagsRaw:      metafield(namespace: "xdipx", key: "mood_tags")          { value }
        audienceTagsRaw:  metafield(namespace: "xdipx", key: "audience_tags")      { value }
        mattersTagsRaw:   metafield(namespace: "xdipx", key: "matters_tags")       { value }
      }
    }
  }
`;
    HONORARY_CACHE_TTL = 30 * 60;
    honoraryCacheKey = (cat, handle) => `discovery:honorary:${INDEX_VERSION}:${cat}:${handle}`;
    L1_TTL_MS = 12e4;
    _g4 = globalThis;
    if (_g4.__discoveryIndexMemo === void 0) _g4.__discoveryIndexMemo = null;
  }
});

// app/lib/homepage-payload.server.ts
var homepage_payload_server_exports = {};
__export(homepage_payload_server_exports, {
  HOMEPAGE_PAYLOAD_KV_KEY: () => HOMEPAGE_PAYLOAD_KV_KEY,
  HOMEPAGE_PAYLOAD_KV_PREFIX: () => HOMEPAGE_PAYLOAD_KV_PREFIX,
  HOMEPAGE_PAYLOAD_VERSION: () => HOMEPAGE_PAYLOAD_VERSION,
  assertJsonSafe: () => assertJsonSafe,
  buildHomeContentBlocks: () => buildHomeContentBlocks,
  buildHomepagePayloadA: () => buildHomepagePayloadA,
  invalidateHomepagePayloadA: () => invalidateHomepagePayloadA,
  readHomepagePayloadA: () => readHomepagePayloadA,
  reshuffleRailsWithSeed: () => reshuffleRailsWithSeed,
  triggerHomepageWarm: () => triggerHomepageWarm,
  warmHomepagePayloadA: () => warmHomepagePayloadA,
  writeHomepagePayloadA: () => writeHomepagePayloadA
});
import { eq as eq8 } from "drizzle-orm";
async function buildHomeContentBlocks() {
  const cmsData = await withTimeout(
    getHomepageSections(),
    BUILD_TIMEOUT_MS,
    null,
    "getHomepageSections(payloadA)"
  );
  const sections = (cmsData?.sections ?? []).filter((s) => s._type !== "announcementBar");
  const carouselBlocks = sections.filter(
    (s) => s._type === "productCarousel"
  );
  const emmaRailBlocks = sections.filter(
    (s) => s._type === "emmaCuratedRail"
  );
  const [carouselResults, emmaRailResults] = await Promise.all([
    carouselBlocks.length > 0 ? withTimeout(Promise.all(carouselBlocks.map((b) => {
      const limit = b.productLimit ?? 8;
      const source = b.source ?? "tag";
      if (source === "collection" && b.collectionHandle) {
        return getCollectionProducts(b.collectionHandle, limit);
      }
      if (source === "manual" && b.productHandles?.length) {
        return getProductsByHandles(b.productHandles.map((p) => p.handle));
      }
      return b.shopifyTag ? getProductsByTag(b.shopifyTag, limit) : Promise.resolve([]);
    })), BUILD_TIMEOUT_MS, [], "carouselResults(payloadA)") : Promise.resolve([]),
    emmaRailBlocks.length > 0 ? withTimeout(Promise.all(emmaRailBlocks.map(
      (b) => b.productHandles?.length ? getProductsByHandles(b.productHandles.map((p) => p.handle)) : Promise.resolve([])
    )), BUILD_TIMEOUT_MS, [], "emmaRailResults(payloadA)") : Promise.resolve([])
  ]);
  const carouselProductMap = {};
  carouselBlocks.forEach((b, i) => {
    carouselProductMap[b._key] = carouselResults[i] ?? [];
  });
  emmaRailBlocks.forEach((b, i) => {
    carouselProductMap[b._key] = emmaRailResults[i] ?? [];
  });
  return { sections, carouselProductMap };
}
async function buildHomepagePayloadA() {
  const [railsResult, vocab, content] = await Promise.all([
    withTimeout(
      getDiscoveryRails(EMPTY_STATE, { perRail: 12, seed: 0 }),
      BUILD_TIMEOUT_MS,
      { rails: [], total: 0, available: { moods: [], audiences: [], matters: [] } },
      "getDiscoveryRails(payloadA)"
    ),
    withTimeout(
      getDiscoveryVocab(),
      BUILD_TIMEOUT_MS,
      { moods: [], audiences: [], matters: [] },
      "getDiscoveryVocab(payloadA)"
    ),
    buildHomeContentBlocks()
  ]);
  const payload = {
    version: HOMEPAGE_PAYLOAD_VERSION,
    variant: "a",
    rails: railsResult.rails,
    total: railsResult.total,
    welcomeBackEnabled: true,
    moods: vocab.moods,
    audiences: vocab.audiences,
    matters: vocab.matters,
    available: railsResult.available,
    sections: content.sections,
    carouselProductMap: content.carouselProductMap,
    builtAt: Date.now(),
    // Empty rails == the discovery index was cold during the build. Strictly
    // worse than a populated blob; the write guard refuses to clobber a good
    // blob with a degraded one unless forced.
    degraded: railsResult.rails.length === 0
  };
  return payload;
}
function assertJsonSafe(payload) {
  const round = JSON.parse(JSON.stringify(payload));
  if (!Array.isArray(round.rails)) throw new Error("payload.rails not array after JSON round-trip");
  if (typeof round.builtAt !== "number") throw new Error("payload.builtAt not number after JSON round-trip");
  if (round.version !== HOMEPAGE_PAYLOAD_VERSION) throw new Error("payload.version mismatch after JSON round-trip");
}
async function readHomepagePayloadA() {
  try {
    const kv = await kvGet(HOMEPAGE_PAYLOAD_KV_KEY);
    if (kv && kv.version === HOMEPAGE_PAYLOAD_VERSION) return kv;
  } catch (err) {
    console.warn("[homepage-payload] KV read failed, trying Neon:", err);
  }
  try {
    const [row] = await db.select().from(homepagePayload).where(eq8(homepagePayload.variant, "a")).limit(1);
    if (row && row.version === HOMEPAGE_PAYLOAD_VERSION && row.payload) {
      const payload = row.payload;
      void kvSet(HOMEPAGE_PAYLOAD_KV_KEY, payload, KV_TTL_SECONDS).catch(() => {
      });
      return payload;
    }
  } catch (err) {
    console.warn("[homepage-payload] Neon read failed:", err);
  }
  return null;
}
async function writeHomepagePayloadA(payload, opts = {}) {
  assertJsonSafe(payload);
  if (payload.degraded && !opts.force) {
    const existing = await readHomepagePayloadA();
    if (existing && !existing.degraded) {
      console.warn("[homepage-payload] skipping degraded write over a good blob (use force to override)");
      return;
    }
  }
  await kvSet(HOMEPAGE_PAYLOAD_KV_KEY, payload, KV_TTL_SECONDS);
  try {
    await db.insert(homepagePayload).values({
      variant: "a",
      version: HOMEPAGE_PAYLOAD_VERSION,
      payload,
      degraded: payload.degraded
    }).onConflictDoUpdate({
      target: [homepagePayload.variant, homepagePayload.version],
      set: {
        payload,
        degraded: payload.degraded,
        builtAt: /* @__PURE__ */ new Date()
      }
    });
  } catch (err) {
    console.error("[homepage-payload] Neon upsert failed (KV still written):", err);
  }
}
async function warmHomepagePayloadA(opts = {}) {
  const force = opts.force ?? true;
  const payload = await buildHomepagePayloadA();
  await writeHomepagePayloadA(payload, { force });
  return payload;
}
async function invalidateHomepagePayloadA() {
  await kvDel(HOMEPAGE_PAYLOAD_KV_KEY);
}
function triggerHomepageWarm() {
  const baseUrl = process.env["BASE_URL"];
  const cronSecret = process.env["CRON_SECRET"];
  if (!baseUrl || !cronSecret) return;
  void fetch(`${baseUrl}/cron/warm-homepage`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${cronSecret}` }
  }).catch(() => {
  });
}
function mulberry323(seed) {
  let t = seed >>> 0;
  return () => {
    t = t + 1831565813 >>> 0;
    let r = t;
    r = Math.imul(r ^ r >>> 15, r | 1);
    r ^= r + Math.imul(r ^ r >>> 7, r | 61);
    return ((r ^ r >>> 14) >>> 0) / 4294967296;
  };
}
function reshuffleRailsWithSeed(rails, seed) {
  return rails.map((rail, railIdx) => {
    if (rail.items.length <= 1) return rail;
    const items = [...rail.items];
    const rand = mulberry323(seed + railIdx * 2654435761);
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
    return { ...rail, items };
  });
}
var HOMEPAGE_PAYLOAD_VERSION, HOMEPAGE_PAYLOAD_KV_KEY, HOMEPAGE_PAYLOAD_KV_PREFIX, KV_TTL_SECONDS, BUILD_TIMEOUT_MS;
var init_homepage_payload_server = __esm({
  "app/lib/homepage-payload.server.ts"() {
    "use strict";
    init_db_server();
    init_schema();
    init_kv_server();
    init_with_timeout_server();
    init_discovery_server();
    init_discovery();
    init_sanity_server();
    init_shopify_server();
    HOMEPAGE_PAYLOAD_VERSION = "v1";
    HOMEPAGE_PAYLOAD_KV_KEY = `homepage:payload:${HOMEPAGE_PAYLOAD_VERSION}`;
    HOMEPAGE_PAYLOAD_KV_PREFIX = "homepage:payload";
    KV_TTL_SECONDS = 6 * 60 * 60;
    BUILD_TIMEOUT_MS = 8e3;
  }
});

// app/lib/deal-rotator.server.ts
var deal_rotator_server_exports = {};
__export(deal_rotator_server_exports, {
  activateDeal: () => activateDeal,
  isLiveDealSoldOut: () => isLiveDealSoldOut,
  rotateDeal: () => rotateDeal,
  transitionToVaultPricing: () => transitionToVaultPricing
});
import { eq as eq9, ne, and as and2, isNull, asc as asc2, inArray as inArray2 } from "drizzle-orm";
function estDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1e3);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
function pastDealTag(dealDate) {
  if (!dealDate) return null;
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(dealDate);
  if (!m) return null;
  const [, yyyy, mm] = m;
  return `past-daily-deal-${mm}-${yyyy.slice(2)}`;
}
async function getVaultDiscountPct() {
  const [row] = await db.select().from(pipelineSettings).where(eq9(pipelineSettings.key, "vaultDiscountPct")).limit(1);
  const pct = parseFloat(row?.value ?? "25");
  return isNaN(pct) ? 25 : Math.max(5, Math.min(60, pct));
}
async function getFirstVariantGid(shopifyProductId) {
  const numericId = shopifyProductId.replace("gid://shopify/Product/", "");
  let product;
  try {
    ;
    ({ product } = await shopifyAdmin(`/products/${numericId}.json?fields=variants`));
  } catch (err) {
    console.error(`[deal-rotator] product ${numericId} lookup failed \u2014 treating as missing:`, err);
    return null;
  }
  const v = product?.variants?.[0];
  return v ? `gid://shopify/ProductVariant/${v.id}` : null;
}
async function transitionToVaultPricing(deal) {
  if (!deal.shopifyProductId) return;
  const msrp = parseFloat(deal.msrp ?? "0");
  let vaultPrice = deal.vaultPrice ? parseFloat(deal.vaultPrice) : 0;
  if (!vaultPrice && msrp > 0) {
    const productPct = deal.pctOffMsrp ? parseFloat(deal.pctOffMsrp) : NaN;
    const pct = isFinite(productPct) && productPct > 0 ? Math.max(0, Math.min(100, productPct)) : await getVaultDiscountPct();
    vaultPrice = Math.round(msrp * (1 - pct / 100) * 100) / 100;
  }
  try {
    if (vaultPrice > 0) {
      const variantGid = await getFirstVariantGid(deal.shopifyProductId);
      if (variantGid) {
        await updateVariantPricing(
          variantGid,
          vaultPrice.toFixed(2),
          msrp > 0 ? msrp.toFixed(2) : ""
        );
      }
      await updateProductMetafield(
        deal.shopifyProductId,
        "vault_price",
        vaultPrice.toFixed(2),
        "number_decimal"
      );
    }
    await setDealStatus(deal.shopifyProductId, "vault");
    const tag = pastDealTag(deal.dealDate);
    if (tag) await appendProductTag(deal.shopifyProductId, tag);
  } catch (err) {
    console.error(
      `[deal-rotator] Shopify-side vaulting failed for deal ${deal.id} (product ${deal.shopifyProductId}) \u2014 product may no longer exist; archiving in DB only:`,
      err
    );
  }
  await db.update(dealHistory).set({
    status: "archived",
    completedAt: /* @__PURE__ */ new Date(),
    vaultPrice: vaultPrice > 0 ? vaultPrice.toFixed(2) : null
  }).where(and2(eq9(dealHistory.id, deal.id), eq9(dealHistory.status, "live")));
  try {
    const { archiveHomepageRailsForDeal: archiveHomepageRailsForDeal2 } = await Promise.resolve().then(() => (init_sanity_server(), sanity_server_exports));
    const { archived } = await archiveHomepageRailsForDeal2(deal.shopifyProductId);
    if (archived.length) {
      console.log("[deal-rotator] Archived homepage rails:", archived.length);
    }
  } catch (err) {
    console.error("[deal-rotator] Rail archive failed (non-blocking):", err);
  }
}
async function activateDeal(deal) {
  if (!deal.shopifyProductId) return;
  const blockingJobs = await db.select({ id: batchJobs.id }).from(batchJobs).where(and2(
    eq9(batchJobs.gatesDealId, deal.id),
    inArray2(batchJobs.status, ["queued", "submitted", "processing", "applying"])
  ));
  if (blockingJobs.length > 0) {
    console.log(`[deal-rotator] enrichment in flight for deal ${deal.id} \u2014 deferring activation (${blockingJobs.length} blocking job(s))`);
    return;
  }
  const failedJobs = await db.select({ id: batchJobs.id }).from(batchJobs).where(and2(eq9(batchJobs.gatesDealId, deal.id), eq9(batchJobs.status, "failed")));
  if (failedJobs.length > 0) {
    console.warn(`[deal-rotator] WARN gated enrichment failed for deal ${deal.id}; activating with stale/partial copy (degraded-enrichment path)`);
  }
  const claimed = await db.update(dealHistory).set({ status: "live" }).where(and2(eq9(dealHistory.id, deal.id), ne(dealHistory.status, "live"))).returning({ id: dealHistory.id });
  if (claimed.length === 0) {
    console.log(`[deal-rotator] deal ${deal.id} already live \u2014 skipping duplicate activation`);
    return;
  }
  const anyGatingJob = await db.select({ id: batchJobs.id, status: batchJobs.status }).from(batchJobs).where(eq9(batchJobs.gatesDealId, deal.id)).limit(1);
  const skipInlineHero = anyGatingJob.length > 0;
  const numericId = deal.shopifyProductId.replace("gid://shopify/Product/", "");
  await activateShopifyProduct(numericId);
  const dealPrice = parseFloat(deal.dealPrice ?? "0");
  const msrp = parseFloat(deal.msrp ?? "0");
  if (dealPrice > 0) {
    const variantGid = await getFirstVariantGid(deal.shopifyProductId);
    if (variantGid) {
      await updateVariantPricing(
        variantGid,
        dealPrice.toFixed(2),
        msrp > 0 ? msrp.toFixed(2) : "",
        deal.wholesaleCost ?? void 0
      );
    }
  }
  await setDealStatus(deal.shopifyProductId, "live");
  try {
    const { unarchiveHomepageRailsForDeal: unarchiveHomepageRailsForDeal2 } = await Promise.resolve().then(() => (init_sanity_server(), sanity_server_exports));
    const { unarchived } = await unarchiveHomepageRailsForDeal2(deal.shopifyProductId);
    if (unarchived.length) {
      console.log("[deal-rotator] Un-archived homepage rails:", unarchived.length);
    }
  } catch (err) {
    console.error("[deal-rotator] Rail un-archive failed (non-blocking):", err);
  }
  if (!skipInlineHero) {
    try {
      const { getDailyDeal: getDailyDeal2 } = await Promise.resolve().then(() => (init_shopify_server(), shopify_server_exports));
      const { generateEmmaHero: generateEmmaHero2 } = await Promise.resolve().then(() => (init_claude_server(), claude_server_exports));
      const fullDeal = await getDailyDeal2().catch(() => null);
      const seedDeal = fullDeal ?? {
        seoTitle: deal.seoTitle ?? "",
        tagline: "",
        fullStory: "",
        brand: "",
        category: ["for-him", "for-her"],
        dealPrice,
        msrp,
        mapRestricted: false
      };
      const variant = seedDeal.mapRestricted ? "quote" : "loving";
      const copy = await generateEmmaHero2({ deal: seedDeal, variant });
      await updateProductMetafield(
        deal.shopifyProductId,
        "emma_hero",
        JSON.stringify(copy),
        "json"
      );
      if (copy.aside) {
        await updateProductMetafield(
          deal.shopifyProductId,
          "tagline",
          copy.aside,
          "single_line_text_field"
        );
      }
      if (fullDeal?.handle) {
        try {
          const { upsertEmmaPick: upsertEmmaPick2 } = await Promise.resolve().then(() => (init_sanity_server(), sanity_server_exports));
          await upsertEmmaPick2({
            productId: deal.shopifyProductId,
            productHandle: fullDeal.handle,
            productTitle: fullDeal.seoTitle ?? deal.seoTitle ?? void 0,
            brand: fullDeal.brand ?? void 0,
            category: fullDeal.category && fullDeal.category.length > 0 ? fullDeal.category[0] : void 0,
            dealDate: estDate(0),
            variant: copy.variant,
            eyebrow: copy.eyebrow,
            headline: copy.headline,
            body: copy.body,
            aside: copy.aside,
            pullQuote: copy.pullQuote,
            voiceHash: copy.voiceHash,
            generatedAt: copy.generatedAt
          });
        } catch (sanityErr) {
          console.error("[deal-rotator] Emma pick Sanity index failed (non-blocking):", sanityErr);
        }
      }
    } catch (err) {
      console.error("[deal-rotator] Emma hero generation failed (non-blocking):", err);
    }
  } else {
    console.log(`[deal-rotator] Skipping inline Emma hero for deal ${deal.id} \u2014 gated enrichment job already wrote copy`);
  }
  await db.update(dealHistory).set({
    activatedAt: /* @__PURE__ */ new Date(),
    dealDate: estDate(0)
  }).where(eq9(dealHistory.id, deal.id));
  await kvSet(KV_KEYS.dealOfDay, {
    sku: deal.sku,
    title: deal.seoTitle,
    date: estDate(0)
  }, 86400);
  await triggerDailyDealEmail({
    title: deal.seoTitle ?? "",
    tagline: "",
    dealPrice: parseFloat(deal.dealPrice ?? "0"),
    msrp: parseFloat(deal.msrp ?? "0"),
    handle: deal.sku,
    imageUrl: "",
    subjectLine: `New deal just dropped \u2014 ${deal.seoTitle ?? "check it out"} \u2665`
  });
  if (process.env["X_AUTO_POST_ENABLED"] === "true") {
    try {
      const { postDealTweet: postDealTweet2 } = await Promise.resolve().then(() => (init_twitter_server(), twitter_server_exports));
      const result = await postDealTweet2({
        dealHistoryId: deal.id,
        seoTitle: deal.seoTitle ?? "",
        tagline: "",
        dealPrice: parseFloat(deal.dealPrice ?? "0"),
        msrp: parseFloat(deal.msrp ?? "0"),
        brand: "",
        category: "both",
        handle: deal.sku,
        imageUrl: "",
        shopifyProductId: deal.shopifyProductId ?? void 0
      });
      console.log("[deal-rotator] Auto-tweet:", result.ok ? result.tweetId : result.error);
    } catch (err) {
      console.error("[deal-rotator] Auto-tweet failed (non-blocking):", err);
    }
  }
}
async function rotateDeal() {
  const [liveDeal] = await db.select().from(dealHistory).where(eq9(dealHistory.status, "live")).limit(1);
  if (liveDeal) {
    await transitionToVaultPricing(liveDeal);
  }
  const [nextDeal] = await db.select().from(dealHistory).where(
    and2(
      eq9(dealHistory.status, "queued"),
      isNull(dealHistory.completedAt)
    )
  ).orderBy(asc2(dealHistory.sortOrder)).limit(1);
  if (nextDeal) {
    await activateDeal(nextDeal);
    let liveHandle = null;
    try {
      const { getDailyDeal: getDailyDeal2 } = await Promise.resolve().then(() => (init_shopify_server(), shopify_server_exports));
      const live = await getDailyDeal2().catch(() => null);
      liveHandle = live?.handle ?? null;
      if (liveHandle) {
        const { regenerateActiveRails: regenerateActiveRails2 } = await Promise.resolve().then(() => (init_emma_rails_server(), emma_rails_server_exports));
        const res = await regenerateActiveRails2(liveHandle, "midnight");
        console.log("[deal-rotator] emma rails precomputed:", res);
      }
    } catch (err) {
      console.error("[deal-rotator] emma rails precompute failed (non-blocking):", err);
    }
    try {
      const { pingSearchEngines: pingSearchEngines2 } = await Promise.resolve().then(() => (init_search_ping_server(), search_ping_server_exports));
      await pingSearchEngines2(["/", ...liveHandle ? [`/products/${liveHandle}`] : []]);
    } catch (err) {
      console.error("[deal-rotator] search ping failed (non-blocking):", err);
    }
    try {
      const { warmHomepagePayloadA: warmHomepagePayloadA2 } = await Promise.resolve().then(() => (init_homepage_payload_server(), homepage_payload_server_exports));
      const p = await warmHomepagePayloadA2({ force: true });
      console.log(`[deal-rotator] homepage payload precomputed (rails=${p.rails.length}, sections=${p.sections.length}, degraded=${p.degraded})`);
    } catch (err) {
      console.error("[deal-rotator] homepage precompute failed (non-blocking):", err);
    }
  }
  return {
    vaulted: liveDeal?.sku ?? null,
    activated: nextDeal?.sku ?? null
  };
}
async function isLiveDealSoldOut() {
  const [liveDeal] = await db.select().from(dealHistory).where(eq9(dealHistory.status, "live")).limit(1);
  if (!liveDeal?.shopifyProductId) return { soldOut: false, dealId: null };
  const numericId = liveDeal.shopifyProductId.replace("gid://shopify/Product/", "");
  let product;
  try {
    ;
    ({ product } = await shopifyAdmin(`/products/${numericId}.json?fields=variants`));
  } catch (err) {
    console.error(
      `[deal-rotator] live deal ${liveDeal.id} product ${numericId} lookup failed \u2014 treating as sold out:`,
      err
    );
    return { soldOut: true, dealId: liveDeal.id };
  }
  if (!product) return { soldOut: false, dealId: liveDeal.id };
  const totalInventory = product.variants.reduce(
    (sum, v) => sum + (v.inventory_quantity ?? 0),
    0
  );
  return { soldOut: totalInventory <= 0, dealId: liveDeal.id };
}
var init_deal_rotator_server = __esm({
  "app/lib/deal-rotator.server.ts"() {
    "use strict";
    init_db_server();
    init_schema();
    init_shopify_server();
    init_klaviyo_server();
    init_kv_server();
  }
});

// app/lib/homepage-healthcheck.server.ts
var homepage_healthcheck_server_exports = {};
__export(homepage_healthcheck_server_exports, {
  runHomepageHealthcheck: () => runHomepageHealthcheck
});
function siteOrigin() {
  const base = process.env["BASE_URL"] || (process.env["VERCEL_URL"] ? `https://${process.env["VERCEL_URL"]}` : "");
  return base.replace(/\/$/, "") || "https://xdipx.com";
}
function extractJsonLd(html) {
  let parsed = 0;
  let scripts = 0;
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    scripts += 1;
    try {
      JSON.parse((m[1] ?? "").trim());
      parsed += 1;
    } catch {
    }
  }
  return { parsed, scripts };
}
async function checkPageOnce(path) {
  const url = `${siteOrigin()}${path}`;
  const problems = [];
  let status = 0;
  let bodyOk = false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      headers: { "user-agent": "xdipx-homepage-healthcheck" },
      signal: ctrl.signal
    }).finally(() => clearTimeout(timer));
    status = res.status;
    const html = await res.text();
    if (status !== 200) problems.push(`HTTP ${status}`);
    if (html.length < MIN_BODY_BYTES) problems.push(`body too small (${html.length} bytes)`);
    if (!/<img[\s>]/i.test(html)) problems.push("no <img> (hero/LCP image likely missing)");
    bodyOk = status === 200 && html.length >= MIN_BODY_BYTES;
    const { parsed, scripts } = extractJsonLd(html);
    if (parsed === 0) problems.push("no valid JSON-LD");
    else if (parsed < scripts) problems.push(`malformed JSON-LD (${scripts - parsed} unparseable)`);
  } catch (err) {
    problems.push(`fetch error: ${err instanceof Error ? err.message : String(err)}`);
  }
  const hardFail = status >= 500;
  return { path, status, ok: problems.length === 0, problems, bodyOk, hardFail };
}
async function checkPage(path) {
  let best = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const c = await checkPageOnce(path);
    if (c.ok) return c;
    if (!best || c.problems.length < best.problems.length) best = c;
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
    }
  }
  return best;
}
async function openHealthcheckIssue(title, body) {
  const token = process.env["GITHUB_TOKEN"];
  const owner = process.env["GITHUB_OWNER"];
  const repo = process.env["GITHUB_REPO"];
  if (!token || !owner || !repo) {
    console.warn("[homepage-healthcheck] GITHUB_TOKEN/OWNER/REPO not set \u2014 skipping issue");
    return null;
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json"
  };
  try {
    const q = encodeURIComponent(`repo:${owner}/${repo} is:issue is:open in:title "${title}"`);
    const search = await fetch(`https://api.github.com/search/issues?q=${q}`, { headers });
    const existing = search.ok ? ((await search.json()).items ?? [])[0] : void 0;
    if (existing) {
      await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${existing.number}/comments`, {
        method: "POST",
        headers,
        body: JSON.stringify({ body })
      });
      return existing.html_url;
    }
    const create = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title, body, labels: ["healthcheck", "P0"] })
    });
    if (!create.ok) {
      console.error(`[homepage-healthcheck] issue create ${create.status}`);
      return null;
    }
    return (await create.json()).html_url;
  } catch (err) {
    console.error("[homepage-healthcheck] issue error", err);
    return null;
  }
}
async function runHomepageHealthcheck() {
  const checks = await Promise.all(PATHS.map(checkPage));
  const healthy = checks.every((c) => c.ok);
  const home = checks.find((c) => c.path === "/");
  if (home?.bodyOk) {
    try {
      const doc = await getHomepageDocRaw();
      if (doc) await kvSet(LAST_GOOD_KEY, doc);
    } catch (err) {
      console.warn("[homepage-healthcheck] last-good snapshot failed", err);
    }
  }
  if (healthy) {
    return { ok: true, checks, action: "snapshot", rolledBack: false, alerted: false };
  }
  const failed = checks.filter((c) => !c.ok);
  const summary = failed.map((c) => `${c.path}: ${c.problems.join("; ")}`).join(" | ");
  const homeHardBroken = !!home?.hardFail;
  const result = {
    ok: false,
    checks,
    action: homeHardBroken ? "rollback" : "alert",
    rolledBack: false,
    alerted: false
  };
  if (homeHardBroken) {
    try {
      const lastGood = await kvGet(LAST_GOOD_KEY);
      const valid = !!lastGood && lastGood["_type"] === "homepageSections" && Array.isArray(lastGood["sections"]);
      if (valid) {
        await invalidateHomepagePayloadA().catch(() => {
        });
        await restoreHomepageDoc(lastGood);
        await warmHomepagePayloadA({ force: true }).catch(
          (e) => console.error("[homepage-healthcheck] payload rewarm failed", e)
        );
        result.rolledBack = true;
      } else {
        result.message = lastGood ? "last-good snapshot is malformed \u2014 skipping rollback" : "no last-good snapshot available to roll back to";
      }
    } catch (err) {
      result.message = `rollback failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else if (home && !home.ok) {
    result.message = "homepage returned 200 but tripped render heuristics \u2014 not a Sanity-content failure; alerting without rollback";
  } else {
    result.message = "non-homepage page unhealthy; no homepage rollback applicable";
  }
  const isP0 = homeHardBroken || result.rolledBack;
  Sentry.captureException(
    new Error(`Homepage healthcheck ${isP0 ? "failed" : "soft-degraded"} \u2014 ${summary}`),
    {
      tags: { healthcheck: "homepage", severity: isP0 ? "P0" : "P2" },
      extra: { checks, rolledBack: result.rolledBack, note: result.message }
    }
  );
  result.alerted = true;
  if (isP0) {
    const issueBody = [
      `Homepage healthcheck failed against ${siteOrigin()}.`,
      "",
      "**Problems**",
      summary,
      "",
      `**Auto-recovery:** ${result.rolledBack ? "rolled the Sanity homepage doc back to last-good and re-warmed the Variant A payload." : result.message ?? "none"}`,
      "",
      "_Filed automatically by `/cron/homepage-healthcheck`._"
    ].join("\n");
    const issueUrl = await openHealthcheckIssue("[P0] Homepage healthcheck failing", issueBody);
    if (issueUrl) result.message = `${result.message ? result.message + " \xB7 " : ""}issue: ${issueUrl}`;
  }
  return result;
}
var LAST_GOOD_KEY, PATHS, FETCH_TIMEOUT_MS, MIN_BODY_BYTES, MAX_ATTEMPTS, RETRY_BACKOFF_MS;
var init_homepage_healthcheck_server = __esm({
  "app/lib/homepage-healthcheck.server.ts"() {
    "use strict";
    init_sentry_server();
    init_kv_server();
    init_sanity_server();
    init_homepage_payload_server();
    LAST_GOOD_KEY = "homepage:healthcheck:lastgood";
    PATHS = ["/", "/discover"];
    FETCH_TIMEOUT_MS = 12e3;
    MIN_BODY_BYTES = 1e3;
    MAX_ATTEMPTS = 3;
    RETRY_BACKOFF_MS = 1500;
  }
});

// app/lib/profit.server.ts
var profit_server_exports = {};
__export(profit_server_exports, {
  getDashboardStats: () => getDashboardStats,
  writeProfitSummary: () => writeProfitSummary
});
import { eq as eq10, sql as sql3 } from "drizzle-orm";
async function writeProfitSummary() {
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const [todayDeal] = await db.select().from(dealHistory).where(eq10(dealHistory.dealDate, today)).limit(1);
  if (!todayDeal) return;
  const { shopifyAdmin: shopifyAdmin2 } = await Promise.resolve().then(() => (init_shopify_server(), shopify_server_exports));
  const ordersData = await shopifyAdmin2(`/orders.json?status=paid&created_at_min=${today}T00:00:00-00:00`);
  let totalOrders = 0;
  let totalRevenue = 0;
  let totalCogs = 0;
  for (const order of ordersData.orders) {
    totalOrders++;
    totalRevenue += parseFloat(order.total_price);
    for (const item of order.line_items) {
      const cost = parseFloat(todayDeal.wholesaleCost ?? "0");
      totalCogs += cost * item.quantity;
    }
  }
  const totalProfit = totalRevenue - totalCogs;
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  await db.insert(dailyProfitSummary).values({
    summaryDate: today,
    totalOrders,
    totalRevenue: totalRevenue.toFixed(2),
    totalCogs: totalCogs.toFixed(2),
    totalProfit: totalProfit.toFixed(2),
    avgOrderValue: avgOrderValue.toFixed(2),
    featuredSku: todayDeal.sku
  }).onConflictDoUpdate({
    target: dailyProfitSummary.summaryDate,
    set: {
      totalOrders: sql3`excluded.total_orders`,
      totalRevenue: sql3`excluded.total_revenue`,
      totalCogs: sql3`excluded.total_cogs`,
      totalProfit: sql3`excluded.total_profit`,
      avgOrderValue: sql3`excluded.avg_order_value`
    }
  });
  await db.update(dealHistory).set({
    unitsSold: totalOrders,
    totalRevenue: totalRevenue.toFixed(2),
    totalProfit: totalProfit.toFixed(2)
  }).where(eq10(dealHistory.dealDate, today));
}
async function getDashboardStats(days = 30) {
  const rows = await db.select().from(dailyProfitSummary).orderBy(sql3`${dailyProfitSummary.summaryDate} DESC`).limit(days);
  const total = rows.reduce((acc, r) => ({
    revenue: acc.revenue + parseFloat(r.totalRevenue ?? "0"),
    profit: acc.profit + parseFloat(r.totalProfit ?? "0"),
    orders: acc.orders + (r.totalOrders ?? 0)
  }), { revenue: 0, profit: 0, orders: 0 });
  return { rows, total };
}
var init_profit_server = __esm({
  "app/lib/profit.server.ts"() {
    "use strict";
    init_db_server();
    init_schema();
  }
});

// app/lib/reviews.server.ts
var reviews_server_exports = {};
__export(reviews_server_exports, {
  createInvite: () => createInvite,
  createReview: () => createReview,
  deleteReview: () => deleteReview,
  getAdminReviewQueue: () => getAdminReviewQueue,
  getInviteByToken: () => getInviteByToken,
  getInviteStats: () => getInviteStats,
  getPaginatedInvites: () => getPaginatedInvites,
  getPendingReminderInvites: () => getPendingReminderInvites,
  getProductAggregate: () => getProductAggregate,
  getProductReviews: () => getProductReviews,
  getProductsWithReviews: () => getProductsWithReviews,
  getReviewById: () => getReviewById,
  getReviewSettings: () => getReviewSettings,
  getReviewStats: () => getReviewStats,
  getReviewsForExport: () => getReviewsForExport,
  getReviewsPerDay: () => getReviewsPerDay,
  markInviteClicked: () => markInviteClicked,
  markInviteOpened: () => markInviteOpened,
  markReminderSent: () => markReminderSent,
  updateReviewAI: () => updateReviewAI,
  updateReviewFeatured: () => updateReviewFeatured,
  updateReviewReply: () => updateReviewReply,
  updateReviewSettings: () => updateReviewSettings,
  updateReviewStatus: () => updateReviewStatus,
  voteHelpful: () => voteHelpful
});
import { neon as neon2 } from "@neondatabase/serverless";
function rowToReview(row) {
  return {
    id: row["id"],
    shopifyProductId: row["shopify_product_id"],
    shopifyOrderId: row["shopify_order_id"] ?? null,
    shopifyCustomerId: row["shopify_customer_id"] ?? null,
    reviewerName: row["reviewer_name"],
    reviewerEmail: row["reviewer_email"],
    rating: row["rating"],
    title: row["title"] ?? null,
    body: row["body"] ?? null,
    status: row["status"],
    isVerifiedPurchase: row["is_verified_purchase"],
    isFeatured: row["is_featured"],
    isIncentivized: row["is_incentivized"],
    helpfulYes: row["helpful_yes"],
    helpfulNo: row["helpful_no"],
    aiSentiment: row["ai_sentiment"] ?? null,
    aiSummary: row["ai_summary"] ?? null,
    aiSpamScore: row["ai_spam_score"] != null ? parseFloat(row["ai_spam_score"]) : null,
    moderationNote: row["moderation_note"] ?? null,
    moderatedBy: row["moderated_by"] ?? null,
    moderatedAt: row["moderated_at"] ? new Date(row["moderated_at"]).toISOString() : null,
    replyBody: row["reply_body"] ?? null,
    replyAt: row["reply_at"] ? new Date(row["reply_at"]).toISOString() : null,
    source: row["source"],
    inviteToken: row["invite_token"] ?? null,
    inviteTokenUsedAt: row["invite_token_used_at"] ? new Date(row["invite_token_used_at"]).toISOString() : null,
    ipAddress: row["ip_address"] ?? null,
    userAgent: row["user_agent"] ?? null,
    createdAt: new Date(row["created_at"]).toISOString(),
    updatedAt: new Date(row["updated_at"]).toISOString()
  };
}
function rowToMedia(row) {
  return {
    id: row["id"],
    reviewId: row["review_id"],
    mediaType: row["media_type"],
    url: row["url"],
    thumbnailUrl: row["thumbnail_url"] ?? null,
    sortOrder: row["sort_order"],
    createdAt: new Date(row["created_at"]).toISOString()
  };
}
function rowToAttributeRating(row) {
  return {
    id: row["id"],
    reviewId: row["review_id"],
    attributeName: row["attribute_name"],
    rating: row["rating"]
  };
}
function rowToAggregate(row) {
  return {
    shopifyProductId: row["shopify_product_id"],
    totalCount: row["total_count"],
    approvedCount: row["approved_count"],
    averageRating: parseFloat(row["average_rating"]),
    rating1Count: row["rating_1_count"],
    rating2Count: row["rating_2_count"],
    rating3Count: row["rating_3_count"],
    rating4Count: row["rating_4_count"],
    rating5Count: row["rating_5_count"],
    verifiedCount: row["verified_count"],
    withPhotoCount: row["with_photo_count"],
    lastUpdated: new Date(row["last_updated"]).toISOString()
  };
}
function rowToInvite(row) {
  return {
    id: row["id"],
    shopifyOrderId: row["shopify_order_id"],
    shopifyCustomerId: row["shopify_customer_id"] ?? null,
    shopifyProductId: row["shopify_product_id"],
    reviewerEmail: row["reviewer_email"],
    reviewerName: row["reviewer_name"],
    inviteToken: row["invite_token"],
    sentAt: new Date(row["sent_at"]).toISOString(),
    openedAt: row["opened_at"] ? new Date(row["opened_at"]).toISOString() : null,
    clickedAt: row["clicked_at"] ? new Date(row["clicked_at"]).toISOString() : null,
    completedAt: row["completed_at"] ? new Date(row["completed_at"]).toISOString() : null,
    reminderSentAt: row["reminder_sent_at"] ? new Date(row["reminder_sent_at"]).toISOString() : null,
    status: row["status"]
  };
}
async function getProductReviews(shopifyProductId, opts = {}) {
  const {
    status = "approved",
    sort = "newest",
    filter = "all",
    page = 1,
    perPage = 10
  } = opts;
  if (status === "approved") {
    const ck = `reviews:v1:${shopifyProductId}:${status}:${sort}:${filter}:${page}:${perPage}`;
    const hit = await kvGet(ck);
    if (hit) return hit;
  }
  const offset = (page - 1) * perPage;
  let orderBy = "r.created_at DESC";
  if (sort === "oldest") orderBy = "r.created_at ASC";
  if (sort === "highest") orderBy = "r.rating DESC, r.created_at DESC";
  if (sort === "lowest") orderBy = "r.rating ASC, r.created_at DESC";
  if (sort === "helpful") orderBy = "r.helpful_yes DESC, r.created_at DESC";
  let filterClause = "";
  if (filter === "verified") filterClause = "AND r.is_verified_purchase = true";
  if (filter === "with_photo") filterClause = "AND EXISTS (SELECT 1 FROM review_media rm2 WHERE rm2.review_id = r.id)";
  if (filter === "5star") filterClause = "AND r.rating = 5";
  if (filter === "4star") filterClause = "AND r.rating = 4";
  if (filter === "3star") filterClause = "AND r.rating = 3";
  if (filter === "2star") filterClause = "AND r.rating = 2";
  if (filter === "1star") filterClause = "AND r.rating = 1";
  const reviewQ = `SELECT r.* FROM reviews r WHERE r.shopify_product_id = $1 AND r.status = $2 ${filterClause} ORDER BY ${orderBy} LIMIT $3 OFFSET $4`;
  const countQ = `SELECT COUNT(*) as total FROM reviews r WHERE r.shopify_product_id = $1 AND r.status = $2 ${filterClause}`;
  const [rows, countRows] = await Promise.all([
    sql4(reviewQ, [shopifyProductId, status, perPage, offset]),
    sql4(countQ, [shopifyProductId, status])
  ]);
  if (rows.length === 0) return { reviews: [], total: 0 };
  const reviewIds = rows.map((r) => r["id"]);
  const [mediaRows, attrRows] = await Promise.all([
    sql4`SELECT * FROM review_media WHERE review_id = ANY(${reviewIds}) ORDER BY sort_order ASC`,
    sql4`SELECT * FROM review_attribute_ratings WHERE review_id = ANY(${reviewIds})`
  ]);
  const mediaByReview = /* @__PURE__ */ new Map();
  for (const m of mediaRows) {
    const rid2 = m["review_id"];
    if (!mediaByReview.has(rid2)) mediaByReview.set(rid2, []);
    mediaByReview.get(rid2).push(rowToMedia(m));
  }
  const attrByReview = /* @__PURE__ */ new Map();
  for (const a of attrRows) {
    const rid2 = a["review_id"];
    if (!attrByReview.has(rid2)) attrByReview.set(rid2, []);
    attrByReview.get(rid2).push(rowToAttributeRating(a));
  }
  const reviews = rows.map((r) => {
    const review = rowToReview(r);
    review.media = mediaByReview.get(review.id) ?? [];
    review.attributeRatings = attrByReview.get(review.id) ?? [];
    return review;
  });
  const total = parseInt(countRows[0]?.["total"] ?? "0", 10);
  const result = { reviews, total };
  if (status === "approved") {
    const ck = `reviews:v1:${shopifyProductId}:${status}:${sort}:${filter}:${page}:${perPage}`;
    kvSet(ck, result, 300).catch(() => {
    });
  }
  return result;
}
async function getProductAggregate(shopifyProductId) {
  const ck = `aggregate:v1:${shopifyProductId}`;
  const hit = await kvGet(ck);
  if (hit) return hit;
  const rows = await sql4`
    SELECT * FROM review_aggregates WHERE shopify_product_id = ${shopifyProductId}
  `;
  if (!rows[0]) return null;
  const agg = rowToAggregate(rows[0]);
  kvSet(ck, agg, 300).catch(() => {
  });
  return agg;
}
async function getAdminReviewQueue(filters = {}) {
  const {
    status,
    productId,
    search,
    sort = "newest",
    page = 1,
    perPage = 20
  } = filters;
  const offset = (page - 1) * perPage;
  const conditions = [];
  const params = [];
  let pIdx = 1;
  if (status && status !== "all") {
    conditions.push(`r.status = $${pIdx++}`);
    params.push(status);
  }
  if (productId) {
    conditions.push(`r.shopify_product_id = $${pIdx++}`);
    params.push(productId);
  }
  if (search) {
    conditions.push(`(r.reviewer_name ILIKE $${pIdx} OR r.title ILIKE $${pIdx} OR r.body ILIKE $${pIdx})`);
    params.push(`%${search}%`);
    pIdx++;
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  let orderBy = "r.created_at DESC";
  if (sort === "oldest") orderBy = "r.created_at ASC";
  if (sort === "highest") orderBy = "r.rating DESC";
  if (sort === "lowest") orderBy = "r.rating ASC";
  if (sort === "spam_risk") orderBy = "r.ai_spam_score DESC NULLS LAST";
  const baseQuery = `SELECT r.* FROM reviews r ${whereClause} ORDER BY ${orderBy} LIMIT $${pIdx} OFFSET $${pIdx + 1}`;
  const countQuery = `SELECT COUNT(*) as total FROM reviews r ${whereClause}`;
  const allParams = [...params, perPage, offset];
  const [rows, countRows] = await Promise.all([
    sql4(baseQuery, allParams),
    sql4(countQuery, params)
  ]);
  if (rows.length === 0) return { reviews: [], total: 0 };
  const typedRows = rows;
  const reviewIds = typedRows.map((r) => r["id"]);
  const mediaRows = await sql4`SELECT * FROM review_media WHERE review_id = ANY(${reviewIds}) ORDER BY sort_order ASC`;
  const mediaByReview = /* @__PURE__ */ new Map();
  for (const m of mediaRows) {
    const rid2 = m["review_id"];
    if (!mediaByReview.has(rid2)) mediaByReview.set(rid2, []);
    mediaByReview.get(rid2).push(rowToMedia(m));
  }
  const reviews = typedRows.map((r) => {
    const review = rowToReview(r);
    review.media = mediaByReview.get(review.id) ?? [];
    return review;
  });
  const total = parseInt(countRows[0]?.["total"] ?? "0", 10);
  return { reviews, total };
}
async function getReviewStats() {
  const [countRows, avgRows, inviteRows, conversionRows] = await Promise.all([
    sql4`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending')  as pending,
        COUNT(*) FILTER (WHERE status = 'approved') as approved,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
        COUNT(*) FILTER (WHERE status = 'spam')     as spam
      FROM reviews
    `,
    sql4`
      SELECT COALESCE(AVG(rating) FILTER (WHERE status = 'approved'), 0) as avg_rating
      FROM reviews
    `,
    sql4`SELECT COUNT(*) as sent FROM review_invites`,
    sql4`SELECT COUNT(*) as completed FROM review_invites WHERE status = 'completed'`
  ]);
  const c = countRows[0];
  const total = parseInt(c?.["total"] ?? "0", 10);
  const pending = parseInt(c?.["pending"] ?? "0", 10);
  const approved = parseInt(c?.["approved"] ?? "0", 10);
  const rejected = parseInt(c?.["rejected"] ?? "0", 10);
  const spam = parseInt(c?.["spam"] ?? "0", 10);
  const avgRating = parseFloat(avgRows[0]?.["avg_rating"] ?? "0");
  const sent = parseInt(inviteRows[0]?.["sent"] ?? "0", 10);
  const completed = parseInt(conversionRows[0]?.["completed"] ?? "0", 10);
  return {
    totalReviews: total,
    pendingReviews: pending,
    approvedReviews: approved,
    rejectedReviews: rejected,
    spamReviews: spam,
    averageRating: avgRating,
    totalInvitesSent: sent,
    inviteConversionRate: sent > 0 ? completed / sent : 0
  };
}
async function getReviewsPerDay() {
  const rows = await sql4`
    SELECT
      date_trunc('day', created_at)::date::text as date,
      COUNT(*) as count
    FROM reviews
    WHERE created_at > now() - interval '30 days'
    GROUP BY date_trunc('day', created_at)
    ORDER BY date_trunc('day', created_at)
  `;
  return rows.map((r) => ({
    date: r["date"],
    count: parseInt(r["count"], 10)
  }));
}
async function getProductsWithReviews() {
  const rows = await sql4`
    SELECT
      shopify_product_id,
      total_count,
      approved_count,
      average_rating,
      verified_count
    FROM review_aggregates
    ORDER BY approved_count DESC
  `;
  return rows.map((r) => ({
    shopifyProductId: r["shopify_product_id"],
    totalCount: r["total_count"],
    approvedCount: r["approved_count"],
    averageRating: parseFloat(r["average_rating"]),
    verifiedCount: r["verified_count"]
  }));
}
async function createReview(input) {
  const rows = await sql4`
    INSERT INTO reviews (
      shopify_product_id, shopify_order_id, shopify_customer_id,
      reviewer_name, reviewer_email, rating, title, body,
      is_verified_purchase, is_incentivized, source, invite_token,
      ip_address, user_agent, updated_at
    ) VALUES (
      ${input.shopifyProductId},
      ${input.shopifyOrderId ?? null},
      ${input.shopifyCustomerId ?? null},
      ${input.reviewerName},
      ${input.reviewerEmail},
      ${input.rating},
      ${input.title ?? null},
      ${input.body ?? null},
      ${input.isVerifiedPurchase ?? false},
      ${input.isIncentivized ?? false},
      ${input.source ?? "organic"},
      ${input.inviteToken ?? null},
      ${input.ipAddress ?? null},
      ${input.userAgent ?? null},
      now()
    )
    RETURNING *
  `;
  const review = rowToReview(rows[0]);
  if (input.attributeRatings && Object.keys(input.attributeRatings).length > 0) {
    for (const [name, rating] of Object.entries(input.attributeRatings)) {
      await sql4`
        INSERT INTO review_attribute_ratings (review_id, attribute_name, rating)
        VALUES (${review.id}, ${name}, ${rating})
      `;
    }
  }
  if (input.mediaUrls && input.mediaUrls.length > 0) {
    for (let i = 0; i < input.mediaUrls.length; i++) {
      const m = input.mediaUrls[i];
      await sql4`
        INSERT INTO review_media (review_id, media_type, url, thumbnail_url, sort_order)
        VALUES (${review.id}, ${m.mediaType}, ${m.url}, ${m.thumbnailUrl ?? null}, ${i})
      `;
    }
  }
  if (input.inviteToken) {
    await sql4`
      UPDATE review_invites
      SET status = 'completed', completed_at = now()
      WHERE invite_token = ${input.inviteToken}::uuid
    `.catch(() => {
    });
  }
  return review;
}
async function updateReviewStatus(id, status, opts = {}) {
  const rows = await sql4`
    UPDATE reviews
    SET
      status         = ${status},
      moderation_note = ${opts.moderationNote ?? null},
      moderated_by   = ${opts.moderatedBy ?? null},
      moderated_at   = now(),
      updated_at     = now()
    WHERE id = ${id}::uuid
    RETURNING *
  `;
  return rowToReview(rows[0]);
}
async function updateReviewAI(id, ai) {
  await sql4`
    UPDATE reviews
    SET
      ai_sentiment = ${ai.aiSentiment},
      ai_summary   = ${ai.aiSummary},
      ai_spam_score = ${ai.aiSpamScore},
      updated_at   = now()
    WHERE id = ${id}::uuid
  `;
}
async function updateReviewReply(id, replyBody) {
  const rows = await sql4`
    UPDATE reviews
    SET reply_body = ${replyBody}, reply_at = now(), updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING *
  `;
  return rowToReview(rows[0]);
}
async function updateReviewFeatured(id, isFeatured) {
  await sql4`
    UPDATE reviews SET is_featured = ${isFeatured}, updated_at = now() WHERE id = ${id}::uuid
  `;
}
async function deleteReview(id) {
  await sql4`DELETE FROM reviews WHERE id = ${id}::uuid`;
}
async function voteHelpful(id, vote) {
  const col = vote === "yes" ? "helpful_yes" : "helpful_no";
  const rows = await sql4(
    `UPDATE reviews SET ${col} = ${col} + 1, updated_at = now() WHERE id = $1::uuid RETURNING helpful_yes, helpful_no`,
    [id]
  );
  const row = rows[0];
  return {
    helpfulYes: row["helpful_yes"],
    helpfulNo: row["helpful_no"]
  };
}
async function getReviewById(id) {
  const rows = await sql4`SELECT * FROM reviews WHERE id = ${id}::uuid`;
  if (!rows[0]) return null;
  const review = rowToReview(rows[0]);
  const [mediaRows, attrRows] = await Promise.all([
    sql4`SELECT * FROM review_media WHERE review_id = ${id}::uuid ORDER BY sort_order`,
    sql4`SELECT * FROM review_attribute_ratings WHERE review_id = ${id}::uuid`
  ]);
  review.media = mediaRows.map((m) => rowToMedia(m));
  review.attributeRatings = attrRows.map((a) => rowToAttributeRating(a));
  return review;
}
async function createInvite(input) {
  const rows = await sql4`
    INSERT INTO review_invites (
      shopify_order_id, shopify_customer_id, shopify_product_id,
      reviewer_email, reviewer_name
    ) VALUES (
      ${input.shopifyOrderId},
      ${input.shopifyCustomerId ?? null},
      ${input.shopifyProductId},
      ${input.reviewerEmail},
      ${input.reviewerName}
    )
    RETURNING *
  `;
  return rowToInvite(rows[0]);
}
async function getInviteByToken(token) {
  const rows = await sql4`
    SELECT * FROM review_invites WHERE invite_token = ${token}::uuid
  `;
  if (!rows[0]) return null;
  return rowToInvite(rows[0]);
}
async function markInviteClicked(token) {
  await sql4`
    UPDATE review_invites
    SET clicked_at = COALESCE(clicked_at, now()), status = 'clicked'
    WHERE invite_token = ${token}::uuid AND status NOT IN ('completed', 'expired')
  `;
}
async function markInviteOpened(token) {
  await sql4`
    UPDATE review_invites
    SET opened_at = COALESCE(opened_at, now()), status = CASE WHEN status = 'sent' THEN 'opened' ELSE status END
    WHERE invite_token = ${token}::uuid
  `;
}
async function getPendingReminderInvites() {
  const rows = await sql4`
    SELECT * FROM review_invites
    WHERE sent_at < now() - interval '5 days'
      AND reminder_sent_at IS NULL
      AND status NOT IN ('completed', 'expired')
  `;
  return rows.map((r) => rowToInvite(r));
}
async function markReminderSent(id) {
  await sql4`
    UPDATE review_invites SET reminder_sent_at = now() WHERE id = ${id}::uuid
  `;
}
async function getInviteStats() {
  const rows = await sql4`
    SELECT
      COUNT(*) as sent,
      COUNT(*) FILTER (WHERE status IN ('opened','clicked','completed')) as opened,
      COUNT(*) FILTER (WHERE status IN ('clicked','completed')) as clicked,
      COUNT(*) FILTER (WHERE status = 'completed') as completed
    FROM review_invites
  `;
  const r = rows[0];
  return {
    sent: parseInt(r?.["sent"] ?? "0", 10),
    opened: parseInt(r?.["opened"] ?? "0", 10),
    clicked: parseInt(r?.["clicked"] ?? "0", 10),
    completed: parseInt(r?.["completed"] ?? "0", 10)
  };
}
async function getPaginatedInvites(page = 1, perPage = 20) {
  const offset = (page - 1) * perPage;
  const [rows, countRows] = await Promise.all([
    sql4`
      SELECT * FROM review_invites
      ORDER BY sent_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `,
    sql4`SELECT COUNT(*) as total FROM review_invites`
  ]);
  return {
    invites: rows.map((r) => rowToInvite(r)),
    total: parseInt(countRows[0]?.["total"] ?? "0", 10)
  };
}
async function getReviewSettings() {
  const rows = await sql4`SELECT * FROM review_settings WHERE id = 1`;
  const r = rows[0] ?? {};
  return {
    autoApprove: r["auto_approve"] ?? false,
    spamThreshold: parseFloat(r["spam_threshold"] ?? "0.75"),
    minBodyLength: r["min_body_length"] ?? 0,
    requireTitle: r["require_title"] ?? false,
    inviteDelayDays: r["invite_delay_days"] ?? 3,
    reminderDelayDays: r["reminder_delay_days"] ?? 5,
    remindersEnabled: r["reminders_enabled"] ?? true,
    reviewsPerPage: r["reviews_per_page"] ?? 10,
    defaultSort: r["default_sort"] ?? "newest",
    showAiSummaries: r["show_ai_summaries"] ?? true,
    showIncentivizedLabel: r["show_incentivized_label"] ?? true,
    digestEmail: r["digest_email"] ?? null,
    webhookUrl: r["webhook_url"] ?? null
  };
}
async function updateReviewSettings(settings) {
  await sql4`
    UPDATE review_settings SET
      auto_approve           = COALESCE(${settings.autoApprove ?? null}::boolean, auto_approve),
      spam_threshold         = COALESCE(${settings.spamThreshold ?? null}::numeric, spam_threshold),
      min_body_length        = COALESCE(${settings.minBodyLength ?? null}::int, min_body_length),
      require_title          = COALESCE(${settings.requireTitle ?? null}::boolean, require_title),
      invite_delay_days      = COALESCE(${settings.inviteDelayDays ?? null}::int, invite_delay_days),
      reminder_delay_days    = COALESCE(${settings.reminderDelayDays ?? null}::int, reminder_delay_days),
      reminders_enabled      = COALESCE(${settings.remindersEnabled ?? null}::boolean, reminders_enabled),
      reviews_per_page       = COALESCE(${settings.reviewsPerPage ?? null}::int, reviews_per_page),
      default_sort           = COALESCE(${settings.defaultSort ?? null}, default_sort),
      show_ai_summaries      = COALESCE(${settings.showAiSummaries ?? null}::boolean, show_ai_summaries),
      show_incentivized_label= COALESCE(${settings.showIncentivizedLabel ?? null}::boolean, show_incentivized_label),
      digest_email           = ${settings.digestEmail ?? null},
      webhook_url            = ${settings.webhookUrl ?? null},
      updated_at             = now()
    WHERE id = 1
  `;
}
async function getReviewsForExport(filters = {}) {
  const { status, productId } = filters;
  const conditions = [];
  const params = [];
  let pIdx = 1;
  if (status && status !== "all") {
    conditions.push(`status = $${pIdx++}`);
    params.push(status);
  }
  if (productId) {
    conditions.push(`shopify_product_id = $${pIdx++}`);
    params.push(productId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await sql4(`SELECT * FROM reviews ${where} ORDER BY created_at DESC`, params);
  return rows.map((r) => rowToReview(r));
}
var sql4;
var init_reviews_server = __esm({
  "app/lib/reviews.server.ts"() {
    "use strict";
    init_kv_server();
    sql4 = neon2(process.env["DATABASE_URL"]);
  }
});

// app/lib/ask-emma-vocab.server.ts
import { createClient as createClient5 } from "@sanity/client";
function client2(write = false) {
  if (!projectId5) return null;
  const token = process.env["SANITY_API_TOKEN"];
  return createClient5({
    projectId: projectId5,
    dataset: dataset5,
    apiVersion: apiVersion5,
    useCdn: !write,
    ...token ? { token } : {}
  });
}
function activeMattersVocab() {
  return [...MATTERS_V2];
}
async function getAskEmmaVocabulary() {
  const c = client2(false);
  if (!c) {
    return {
      mood: FALLBACK.mood,
      audience: FALLBACK.audience,
      matters: activeMattersVocab()
    };
  }
  try {
    const doc = await c.fetch(`*[_id == $id][0]{
      mood, audience, matters
    }`, { id: SINGLETON_ID });
    return {
      mood: doc?.["mood"]?.length ? doc["mood"] : FALLBACK.mood,
      audience: doc?.["audience"]?.length ? doc["audience"] : FALLBACK.audience,
      matters: activeMattersVocab()
    };
  } catch (err) {
    console.error("[ask-emma-vocab] fetch failed, using fallback:", err);
    return {
      mood: FALLBACK.mood,
      audience: FALLBACK.audience,
      matters: activeMattersVocab()
    };
  }
}
var projectId5, dataset5, apiVersion5, SINGLETON_ID, FALLBACK;
var init_ask_emma_vocab_server = __esm({
  "app/lib/ask-emma-vocab.server.ts"() {
    "use strict";
    init_discovery();
    projectId5 = process.env["SANITY_PROJECT_ID"];
    dataset5 = process.env["SANITY_DATASET"] ?? "production";
    apiVersion5 = "2024-10-01";
    SINGLETON_ID = "singleton.askEmmaVocabulary";
    FALLBACK = {
      mood: ["slow-and-intimate", "playful", "adventurous", "romantic", "indulgent", "curious", "comforting", "energetic", "bold", "sensual", "spontaneous", "tender"],
      audience: ["solo", "couples", "long-distance", "first-time", "date-night", "self-gift", "gift-idea", "anniversary", "bachelorette", "just-curious"],
      matters: [...MATTERS_V2]
    };
  }
});

// app/lib/seo-research.server.ts
var seo_research_server_exports = {};
__export(seo_research_server_exports, {
  runKeywordResearch: () => runKeywordResearch
});
import { createClient as createClient6 } from "@sanity/client";
import Anthropic2 from "@anthropic-ai/sdk";
import { createHash as createHash5 } from "node:crypto";
function getWriteClient2() {
  if (!projectId6) return null;
  return createClient6({
    projectId: projectId6,
    dataset: dataset6,
    apiVersion: apiVersion6,
    useCdn: false,
    token: process.env["SANITY_API_TOKEN"],
    perspective: "raw"
  });
}
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 80);
}
function termToDocId(term) {
  const slug = slugify(term);
  if (slug && slug.length <= 50) return `seoKeyword.${slug}`;
  const h = createHash5("sha1").update(term.toLowerCase()).digest("hex").slice(0, 16);
  return `seoKeyword.${h}`;
}
function dfsAuthHeader() {
  if (DFS_AUTH_B64) return `Basic ${DFS_AUTH_B64.trim()}`;
  if (DFS_LOGIN && DFS_PASSWORD) {
    return "Basic " + Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString("base64");
  }
  return null;
}
async function dfsRelatedKeywords(seed) {
  const auth = dfsAuthHeader();
  if (!auth) return [];
  try {
    const res = await fetch(`${DFS_BASE}/dataforseo_labs/google/related_keywords/live`, {
      method: "POST",
      headers: { "Authorization": auth, "Content-Type": "application/json" },
      body: JSON.stringify([{
        keyword: seed,
        language_code: "en",
        location_code: 2840,
        // United States
        depth: 2,
        limit: 40,
        include_serp_info: false
      }])
    });
    if (!res.ok) {
      console.warn(`[seo-research] DataForSEO related ${res.status} for "${seed}"`);
      return [];
    }
    const json2 = await res.json();
    const items = json2.tasks?.[0]?.result?.[0]?.items ?? [];
    const out = [];
    for (const it of items) {
      const kd = it.keyword_data;
      const term = kd?.keyword?.trim();
      if (!term) continue;
      const info = kd?.keyword_info ?? kd;
      const r = {
        term,
        source: `dataforseo:related:${seed}`
      };
      if (info && typeof info.search_volume === "number") r.volume = info.search_volume;
      if (info && typeof info.cpc === "number") r.cpc = info.cpc;
      if (info && typeof info.keyword_difficulty === "number") r.difficulty = info.keyword_difficulty;
      out.push(r);
    }
    return out;
  } catch (err) {
    console.error(`[seo-research] DataForSEO related error for "${seed}":`, err);
    return [];
  }
}
async function llmSeedExpansion(seed) {
  if (!ANTHROPIC_KEY) return [];
  const client4 = new Anthropic2({ apiKey: ANTHROPIC_KEY });
  try {
    const msg = await client4.messages.create({
      model: MODEL_FAST2,
      max_tokens: 800,
      system: `You expand SEO seed keywords for an editorially-curated sexual-wellness storefront. Return likely real search queries, including long-tail and question forms. Tasteful, never clinical, never sleazy.`,
      messages: [{
        role: "user",
        content: `Seed: "${seed}"

Return 12 related queries as a JSON array of strings. Mix head terms, long-tail (4+ words), and "how/what/best" question forms. No volume \u2014 we only need the strings. JSON only.`
      }]
    });
    const block = msg.content[0];
    if (block?.type !== "text") return [];
    const uSeed = msg.usage;
    void Promise.resolve().then(() => (init_token_log_server(), token_log_server_exports)).then(
      ({ logApiTokens: logApiTokens2 }) => logApiTokens2({
        feature: "seo-research",
        model: MODEL_FAST2,
        source: "sync",
        caller: "seo-research/llmSeedExpansion",
        inputTokens: uSeed.input_tokens,
        outputTokens: uSeed.output_tokens,
        cacheCreationTokens: uSeed.cache_creation_input_tokens ?? 0,
        cacheReadTokens: uSeed.cache_read_input_tokens ?? 0
      })
    ).catch((err) => console.error("[seo-research] llmSeedExpansion token-log failed (ignored):", err));
    const raw = block.text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((t) => typeof t === "string" && t.trim().length > 1).map((t) => ({ term: t.trim(), source: `llm-expansion:${seed}` }));
  } catch (err) {
    console.error(`[seo-research] llmSeedExpansion error for "${seed}":`, err);
    return [];
  }
}
async function gatherSeeds() {
  const client4 = getWriteClient2();
  if (!client4) return { approvedHeads: [], pillarTerms: [], productTitles: [] };
  try {
    const [approvedHeads, pillarTerms, productTitles] = await Promise.all([
      client4.fetch(
        `*[_type == "seoKeyword" && status == "approved" && kind == "head"][].term`
      ).catch(() => []),
      client4.fetch(
        `*[_type == "seoCluster" && status != "archived"][].pillarTerm`
      ).catch(() => []),
      client4.fetch(
        `*[_type == "productPage" && defined(title)] | order(_updatedAt desc)[0...50][].title`
      ).catch(() => [])
    ]);
    return {
      approvedHeads: (approvedHeads ?? []).filter(Boolean),
      pillarTerms: (pillarTerms ?? []).filter(Boolean),
      productTitles: (productTitles ?? []).filter(Boolean)
    };
  } catch (err) {
    console.error("[seo-research] gatherSeeds error:", err);
    return { approvedHeads: [], pillarTerms: [], productTitles: [] };
  }
}
async function fetchExistingTerms() {
  const client4 = getWriteClient2();
  if (!client4) return /* @__PURE__ */ new Set();
  try {
    const rows = await client4.fetch(`*[_type == "seoKeyword"][].term`);
    return new Set((rows ?? []).map((t) => t.toLowerCase()));
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
async function fetchVocabulary() {
  try {
    return await getAskEmmaVocabulary();
  } catch {
    return { mood: [], audience: [], matters: [] };
  }
}
async function fetchClusterCatalog() {
  const client4 = getWriteClient2();
  if (!client4) return [];
  try {
    return await client4.fetch(
      `*[_type == "seoCluster" && status != "archived"]{ "slug": slug.current, pillarTerm, title }`
    ) ?? [];
  } catch {
    return [];
  }
}
async function classifyBatch(batch, vocab, clusters) {
  if (!ANTHROPIC_KEY) {
    return batch.map((b) => ({
      term: b.term,
      kind: b.term.split(/\s+/).length >= 4 ? "long-tail" : "head",
      intent: "informational",
      productTypeDials: [],
      moodTags: [],
      audienceTags: [],
      mattersTags: [],
      relevanceScore: 0.5,
      clusterSlug: null,
      flagged: false
    }));
  }
  const client4 = new Anthropic2({ apiKey: ANTHROPIC_KEY });
  const clustersList = clusters.map((c) => `${c.slug} (${c.pillarTerm})`).join(", ");
  const sys = `You classify SEO keyword candidates for an editorially-curated sexual-wellness storefront. Use only the controlled vocabularies provided. Flag conservatively but accurately \u2014 only the three valid policy categories below, never adjacent worries.`;
  const user = `Catalog: ${CATALOG_SUMMARY}

Existing clusters: ${clustersList || "(none yet \u2014 propose new ones with kebab-case slugs)"}
Mood vocabulary: ${vocab.mood.join(", ") || "(empty)"}
Audience vocabulary: ${vocab.audience.join(", ") || "(empty)"}
Matters vocabulary: ${vocab.matters.join(", ") || "(empty)"}
Product type dials (closed list): air-pulsation, vibrator, wand, lube, wear

CLUSTER ASSIGNMENT RULES (strict \u2014 prevents cluster proliferation):
- ALWAYS try to match an existing cluster first. Use clusterSlug from the list above.
- ONLY propose a new cluster when no existing cluster is even loosely related. Aim for 5+ keywords per cluster.
- Use proposedClusterTitle ONLY when clusterSlug is null AND you're confident the term opens a genuinely new topic.
- Single-keyword clusters are forbidden. If you can't find 4+ likely siblings for a proposed cluster, leave clusterSlug null with no proposal.

FLAGGING RULES (strict \u2014 only these three categories warrant flagged=true):
1. Off-brand COMPETITOR NAME \u2014 a real competing product/brand/retailer is named: KY, Womanizer, We-Vibe, Lelo, Magic Wand, Hitachi, Lovense, Whisper, Petal Pull, Velvet Noir, Lovehoney, Adam & Eve, Babeland, Fifty Shades, Target, Walmart, Amazon, CVS, etc. ALSO flag generic-sounding model names like "Wand 2" if they read as competitor SKUs.
2. Regulated MEDICAL/EFFICACY CLAIM \u2014 terms framing products as treating a condition: "for dryness", "for menopause", "doctor recommended", "therapeutic", "health benefits", "treats X", "cures X", "prescription". Frequency-of-use ("how often should you use X") and product-education ("what does X do") are NOT medical claims.
3. EXPLICITLY GRAPHIC term outside the tasteful catalog \u2014 explicit anatomical slang or fetish-specific terms the catalog doesn't carry.

DO NOT FLAG these (common false positives):
- Category descriptors: "best wand vibrator", "luxury prostate massager", "best vibrator brands for beginners", "body-safe silicone dildo brands". The word "brands" by itself is not a competitor name. xdipx WANTS to rank for these.
- Comparison-shaped terms ("X vs Y") UNLESS they actually name a competitor brand.
- DIY/curiosity questions ("how to make personal lubricant") \u2014 those users are still in-market.
- Functional questions ("how does X work", "what is X used for") \u2014 informational intent, not medical claims.
- Generic relationship/benefit language ("improve relationships") \u2014 that's marketing copy, not a health claim.
- Out-of-catalog product types (e.g. "thrusting stroker" if you don't carry strokers). Set status to rejected via low relevanceScore (< 0.3) \u2014 DO NOT flag.

For each candidate, return one JSON object with:
- term: string (echo exactly)
- kind: "head" | "long-tail" | "question" | "branded"
- intent: "informational" | "transactional" | "navigational" | "commercial"
- productTypeDials: array of closed-list values (empty if not specific)
- moodTags / audienceTags / mattersTags: arrays of slugs from the provided vocabulary (empty if none fit)
- relevanceScore: 0\u20131 (how well this fits the xdipx catalog and audience). Use < 0.3 for terms outside the catalog (e.g. wrong product category) \u2014 those will be filtered out without needing a flag.
- clusterSlug: existing slug from the list above, or null if a new cluster fits better
- proposedClusterTitle: short Title Case label IF clusterSlug is null AND you can name 4+ likely siblings
- flagged: true ONLY for the three valid categories above; false otherwise
- flagReason: one-line explanation when flagged=true, naming which of the three categories applies

Candidates:
${batch.map((b, i) => `${i + 1}. ${b.term}`).join("\n")}

Return a JSON array of objects. JSON only \u2014 no prose, no fences.`;
  try {
    const msg = await client4.messages.create({
      model: MODEL_FAST2,
      max_tokens: 4096,
      system: sys,
      messages: [{ role: "user", content: user }]
    });
    const block = msg.content[0];
    if (block?.type !== "text") return [];
    const uClass = msg.usage;
    void Promise.resolve().then(() => (init_token_log_server(), token_log_server_exports)).then(
      ({ logApiTokens: logApiTokens2 }) => logApiTokens2({
        feature: "seo-research",
        model: MODEL_FAST2,
        source: "sync",
        caller: "seo-research/classifyBatch",
        inputTokens: uClass.input_tokens,
        outputTokens: uClass.output_tokens,
        cacheCreationTokens: uClass.cache_creation_input_tokens ?? 0,
        cacheReadTokens: uClass.cache_read_input_tokens ?? 0
      })
    ).catch((err) => console.error("[seo-research] classifyBatch token-log failed (ignored):", err));
    const raw = block.text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x) => !!x && typeof x === "object" && typeof x.term === "string");
  } catch (err) {
    console.error("[seo-research] classifyBatch error:", err);
    return [];
  }
}
async function ensureCluster(slug, pillarTerm, title) {
  const client4 = getWriteClient2();
  if (!client4) return null;
  try {
    const id = `seoCluster.${slugify(slug)}`;
    await client4.createIfNotExists({
      _id: id,
      _type: "seoCluster",
      slug: { _type: "slug", current: slugify(slug) },
      title,
      pillarTerm,
      status: "active"
    });
    return id;
  } catch (err) {
    console.error(`[seo-research] ensureCluster failed for ${slug}:`, err);
    return null;
  }
}
async function writeCandidates(items) {
  const client4 = getWriteClient2();
  if (!client4) return { attempted: 0, written: 0, approved: 0, pending: 0, rejected: 0, errors: 0 };
  const summary = { attempted: items.length, written: 0, approved: 0, pending: 0, rejected: 0, errors: 0 };
  const now = (/* @__PURE__ */ new Date()).toISOString();
  for (const it of items) {
    let status;
    if (it.relevanceScore < AUTO_REJECT_THRESHOLD) {
      status = "rejected";
    } else if (!it.flagged && it.relevanceScore >= AUTO_APPROVE_THRESHOLD && (it.volume ?? 0) >= AUTO_APPROVE_MIN_VOLUME) {
      status = "approved";
    } else {
      status = "pending";
    }
    let clusterRef;
    if (it.clusterSlug) {
      clusterRef = { _type: "reference", _ref: `seoCluster.${slugify(it.clusterSlug)}` };
    } else if (it.proposedClusterTitle) {
      const newSlug = slugify(it.proposedClusterTitle);
      const id = await ensureCluster(newSlug, it.term, it.proposedClusterTitle);
      if (id) clusterRef = { _type: "reference", _ref: id };
    }
    const docId = termToDocId(it.term);
    const doc = {
      _id: docId,
      _type: "seoKeyword",
      term: it.term,
      kind: it.kind,
      intent: it.intent,
      productTypeDials: it.productTypeDials,
      moodTags: it.moodTags,
      audienceTags: it.audienceTags,
      mattersTags: it.mattersTags,
      relevanceScore: it.relevanceScore,
      status,
      flagged: it.flagged,
      firstSeenAt: now,
      lastResearchedAt: now,
      sources: [it.source]
    };
    if (typeof it.volume === "number") doc.volume = it.volume;
    if (typeof it.difficulty === "number") doc.difficulty = it.difficulty;
    if (typeof it.cpc === "number") doc.cpc = it.cpc;
    if (it.flagReason) doc.flagReason = it.flagReason;
    if (clusterRef) doc.cluster = clusterRef;
    try {
      await client4.createIfNotExists(doc);
      summary.written++;
      if (status === "approved") summary.approved++;
      else if (status === "rejected") summary.rejected++;
      else summary.pending++;
    } catch (err) {
      summary.errors++;
      console.error(`[seo-research] write failed for "${it.term}":`, err);
    }
  }
  return summary;
}
async function runKeywordResearch(opts) {
  const start = Date.now();
  const useDFS = !!dfsAuthHeader();
  console.log(`[seo-research] starting run \xB7 source=${useDFS ? "dataforseo" : "llm-only"}`);
  const sources = await gatherSeeds();
  const baseSeeds = [
    ...opts?.manualSeeds ?? [],
    ...sources.pillarTerms,
    ...sources.approvedHeads,
    ...sources.productTitles
  ];
  const seeds = Array.from(new Set(baseSeeds.map((s) => s.trim()).filter(Boolean))).slice(0, opts?.maxSeeds ?? RESEARCH_LIMIT);
  console.log(`[seo-research] seeds=${seeds.length}: ${seeds.slice(0, 5).join(", ")}${seeds.length > 5 ? "\u2026" : ""}`);
  const rawByTerm = /* @__PURE__ */ new Map();
  for (let s = 0; s < seeds.length; s++) {
    const seed = seeds[s];
    console.log(`[seo-research] expanding seed ${s + 1}/${seeds.length}: "${seed}"`);
    const fromDFS = useDFS ? await dfsRelatedKeywords(seed) : [];
    const merged = fromDFS.length > 0 ? fromDFS : await llmSeedExpansion(seed);
    console.log(`[seo-research]   \u2192 ${merged.length} candidates from ${fromDFS.length > 0 ? "dfs" : "llm"}`);
    for (const c of merged) {
      const key = c.term.toLowerCase();
      const prev = rawByTerm.get(key);
      if (!prev) {
        rawByTerm.set(key, c);
        continue;
      }
      const prevHasData = typeof prev.volume === "number";
      const cHasData = typeof c.volume === "number";
      if (cHasData && !prevHasData) rawByTerm.set(key, c);
    }
  }
  console.log(`[seo-research] total unique candidates: ${rawByTerm.size}`);
  const existing = await fetchExistingTerms();
  const fresh = [];
  for (const c of rawByTerm.values()) {
    if (!existing.has(c.term.toLowerCase())) fresh.push(c);
  }
  console.log(`[seo-research] new (after dedupe): ${fresh.length} (existing bank size: ${existing.size})`);
  const [vocab, clusters] = await Promise.all([fetchVocabulary(), fetchClusterCatalog()]);
  console.log(`[seo-research] classifying ${fresh.length} candidates in batches of 12 (vocab: mood=${vocab.mood.length} audience=${vocab.audience.length} matters=${vocab.matters.length})`);
  const scored = [];
  for (let i = 0; i < fresh.length; i += 12) {
    const batch = fresh.slice(i, i + 12);
    const batchNum = Math.floor(i / 12) + 1;
    const totalBatches = Math.ceil(fresh.length / 12);
    console.log(`[seo-research] classify batch ${batchNum}/${totalBatches} (${batch.length} items)`);
    const classified = await classifyBatch(
      batch.map((b) => {
        const out = { term: b.term };
        if (typeof b.volume === "number") out.volume = b.volume;
        if (typeof b.difficulty === "number") out.difficulty = b.difficulty;
        return out;
      }),
      vocab,
      clusters
    );
    const byTerm = new Map(classified.map((c) => [c.term.toLowerCase(), c]));
    for (const raw of batch) {
      const c = byTerm.get(raw.term.toLowerCase());
      if (!c) continue;
      const merged = {
        term: c.term,
        source: raw.source,
        kind: c.kind,
        intent: c.intent,
        productTypeDials: c.productTypeDials ?? [],
        moodTags: c.moodTags ?? [],
        audienceTags: c.audienceTags ?? [],
        mattersTags: c.mattersTags ?? [],
        relevanceScore: typeof c.relevanceScore === "number" ? c.relevanceScore : 0.5,
        clusterSlug: c.clusterSlug,
        flagged: !!c.flagged
      };
      if (typeof raw.volume === "number") merged.volume = raw.volume;
      if (typeof raw.difficulty === "number") merged.difficulty = raw.difficulty;
      if (typeof raw.cpc === "number") merged.cpc = raw.cpc;
      if (c.proposedClusterTitle) merged.proposedClusterTitle = c.proposedClusterTitle;
      if (c.flagReason) merged.flagReason = c.flagReason;
      scored.push(merged);
    }
  }
  console.log(`[seo-research] writing ${scored.length} scored candidates to Sanity`);
  const writeSummary = await writeCandidates(scored);
  console.log(`[seo-research] write complete: written=${writeSummary.written} approved=${writeSummary.approved} pending=${writeSummary.pending} rejected=${writeSummary.rejected} errors=${writeSummary.errors}`);
  return {
    seedsUsed: seeds.length,
    candidatesFound: rawByTerm.size,
    newCandidates: fresh.length,
    written: writeSummary.written,
    approved: writeSummary.approved,
    pending: writeSummary.pending,
    rejected: writeSummary.rejected,
    errors: writeSummary.errors,
    source: useDFS ? "dataforseo" : "llm-only",
    durationMs: Date.now() - start
  };
}
var projectId6, dataset6, apiVersion6, MODEL_FAST2, RESEARCH_LIMIT, ANTHROPIC_KEY, DFS_LOGIN, DFS_PASSWORD, DFS_AUTH_B64, DFS_BASE, CATALOG_SUMMARY, AUTO_REJECT_THRESHOLD, AUTO_APPROVE_THRESHOLD, AUTO_APPROVE_MIN_VOLUME;
var init_seo_research_server = __esm({
  "app/lib/seo-research.server.ts"() {
    "use strict";
    init_ask_emma_vocab_server();
    projectId6 = process.env["SANITY_PROJECT_ID"];
    dataset6 = process.env["SANITY_DATASET"] ?? "production";
    apiVersion6 = "2024-10-01";
    MODEL_FAST2 = "claude-haiku-4-5-20251001";
    RESEARCH_LIMIT = 80;
    ANTHROPIC_KEY = process.env["ANTHROPIC_API_KEY"]?.trim();
    DFS_LOGIN = process.env["DATAFORSEO_LOGIN"];
    DFS_PASSWORD = process.env["DATAFORSEO_PASSWORD"];
    DFS_AUTH_B64 = process.env["DATAFORSEO_AUTH"];
    DFS_BASE = "https://api.dataforseo.com/v3";
    CATALOG_SUMMARY = `xdipx.com is an editorially-curated sexual-wellness storefront. Categories include personal lubricants, intimate-massage devices (wand, vibrator, air-pulsation), wear, and accessories. Tasteful, never clinical, never sleazy. Audience is curious adults \u2014 first-time buyers and experienced users. Editorial voice (Emma) is playful, warm, and discreet.`;
    AUTO_REJECT_THRESHOLD = 0.3;
    AUTO_APPROVE_THRESHOLD = 0.85;
    AUTO_APPROVE_MIN_VOLUME = 50;
  }
});

// app/lib/log-monitor.server.ts
var log_monitor_server_exports = {};
__export(log_monitor_server_exports, {
  runLogMonitor: () => runLogMonitor
});
import Anthropic3 from "@anthropic-ai/sdk";
async function fetchRecentLogs({ windowMinutes }) {
  const token = process.env["VERCEL_TOKEN"];
  const projectId9 = process.env["VERCEL_PROJECT_ID"];
  const teamId = process.env["VERCEL_TEAM_ID"];
  if (!token || !projectId9) {
    throw new Error("VERCEL_TOKEN and VERCEL_PROJECT_ID must be set");
  }
  const teamQs = teamId ? `&teamId=${encodeURIComponent(teamId)}` : "";
  const since = Date.now() - windowMinutes * 6e4;
  const deploymentsUrl = `https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(projectId9)}&target=production&limit=1${teamQs}`;
  const depRes = await fetch(deploymentsUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!depRes.ok) {
    throw new Error(`Vercel deployments fetch ${depRes.status}: ${await depRes.text()}`);
  }
  const depJson = await depRes.json();
  const deployment = depJson.deployments?.[0];
  if (!deployment) return [];
  const eventsUrl = `https://api.vercel.com/v3/deployments/${deployment.uid}/events?since=${since}&limit=500&direction=backward${teamQs}`;
  const evRes = await fetch(eventsUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!evRes.ok) {
    throw new Error(`Vercel events fetch ${evRes.status}: ${await evRes.text()}`);
  }
  const events = await evRes.json();
  return events.filter((e) => typeof (e.text ?? e.payload?.text) === "string").map((e) => ({
    timestamp: new Date(e.created ?? e.date ?? Date.now()).toISOString(),
    level: e.payload?.level ?? e.type ?? "info",
    message: (e.text ?? e.payload?.text ?? "").slice(0, 2e3),
    source: e.payload?.source ?? "function",
    deployment: e.deploymentId ?? deployment.uid
  }));
}
async function classifyLogs(logs) {
  if (logs.length === 0) return { groups: [], suppressedNoiseCount: 0 };
  const userPayload = `Window: ${logs[0]?.timestamp} to ${logs[logs.length - 1]?.timestamp}
Total lines: ${logs.length}

` + logs.map((l) => `[${l.timestamp}] ${l.level} ${l.source}: ${l.message}`).join("\n");
  const msg = await anthropic.messages.create({
    model: MODEL2,
    max_tokens: 4096,
    system: SYSTEM_PROMPT2,
    tools: [REPORT_TOOL],
    tool_choice: { type: "tool", name: "report_groups" },
    messages: [{ role: "user", content: userPayload }]
  });
  const block = msg.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("log-monitor: Claude did not return tool_use block");
  }
  const uMon = msg.usage;
  void Promise.resolve().then(() => (init_token_log_server(), token_log_server_exports)).then(
    ({ logApiTokens: logApiTokens2 }) => logApiTokens2({
      feature: "log-monitor",
      model: MODEL2,
      source: "sync",
      caller: "log-monitor/analyzeLogWindow",
      inputTokens: uMon.input_tokens,
      outputTokens: uMon.output_tokens,
      cacheCreationTokens: uMon.cache_creation_input_tokens ?? 0,
      cacheReadTokens: uMon.cache_read_input_tokens ?? 0
    })
  ).catch((err) => console.error("[log-monitor] token-log failed (ignored):", err));
  return block.input;
}
async function openIssuesForP0(groups, windowMinutes) {
  const p0 = groups.filter((g) => g.priority === "P0");
  if (p0.length === 0) return [];
  const token = process.env["GITHUB_TOKEN"];
  const owner = process.env["GITHUB_OWNER"];
  const repo = process.env["GITHUB_REPO"];
  if (!token || !owner || !repo) {
    console.warn("[log-monitor] GITHUB_TOKEN/OWNER/REPO not set, skipping issue creation");
    return [];
  }
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json"
  };
  const opened = [];
  for (const group of p0) {
    const title = `[P0] ${group.title}`;
    const searchQs = encodeURIComponent(`repo:${owner}/${repo} is:issue is:open in:title "${title}"`);
    const search = await fetch(`https://api.github.com/search/issues?q=${searchQs}`, { headers });
    if (!search.ok) {
      console.error(`[log-monitor] GitHub search ${search.status}: ${await search.text()}`);
      continue;
    }
    const searchJson = await search.json();
    const existing = searchJson.items?.[0];
    const body = `**Occurrences:** ${group.occurrences} in the last ${windowMinutes} min
**First seen:** ${group.firstSeen}
**Likely cause:** ${group.likelyCause}
**Owner:** \`${group.owner}\`

\`\`\`
` + group.excerpt + "\n```\n\n_Opened by `/cron/log-monitor` autonomous sweep._";
    if (existing) {
      const comment = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues/${existing.number}/comments`,
        { method: "POST", headers, body: JSON.stringify({ body: `Recurrence:

${body}` }) }
      );
      if (comment.ok) opened.push(existing.html_url);
      else console.error(`[log-monitor] GitHub comment ${comment.status}: ${await comment.text()}`);
      continue;
    }
    const create = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title, body, labels: ["log-monitor", "P0"] })
    });
    if (create.ok) {
      const json2 = await create.json();
      opened.push(json2.html_url);
    } else {
      console.error(`[log-monitor] GitHub create ${create.status}: ${await create.text()}`);
    }
  }
  return opened;
}
async function runLogMonitor({ windowMinutes = 15 } = {}) {
  const logs = await fetchRecentLogs({ windowMinutes });
  const report = await classifyLogs(logs);
  const issuesOpened = await openIssuesForP0(report.groups, windowMinutes);
  return {
    windowMinutes,
    logCount: logs.length,
    p0: report.groups.filter((g) => g.priority === "P0").length,
    p1: report.groups.filter((g) => g.priority === "P1").length,
    p2: report.groups.filter((g) => g.priority === "P2").length,
    suppressed: report.suppressedNoiseCount,
    issuesOpened
  };
}
var MODEL2, anthropic, SYSTEM_PROMPT2, REPORT_TOOL;
var init_log_monitor_server = __esm({
  "app/lib/log-monitor.server.ts"() {
    "use strict";
    MODEL2 = "claude-haiku-4-5-20251001";
    anthropic = new Anthropic3({ apiKey: process.env["ANTHROPIC_API_KEY"]?.trim() });
    SYSTEM_PROMPT2 = `You read Vercel function logs and find issues worth fixing. You are a classifier \u2014 fast, ruthless about ignoring noise. You do not fix issues; you rank them.

Real signal (always investigate):
- FUNCTION_INVOCATION_FAILED \u2014 Vercel function crashed. Almost always env-var drift, missing build artifact, or uncaught exception at module load.
- 500 from any /api/* or webhook route.
- Unhandled promise rejection, TypeError, ReferenceError in server logs.
- Cannot find module \u2014 missing import or broken build.
- Repeated identical errors (3+ in a 5-minute window).
- ETIMEDOUT / ECONNRESET to Shopify, Klaviyo, Anthropic, or Twilio sustained over multiple requests.
- IVR 403 Forbidden on /twilio/* endpoints.
- Voice webhook returns 500 \u2014 voicemail fallback may be masking real failure.

Noise (suppress unless overwhelming):
- 404s to /wp-admin, /.env, /.git, /phpmyadmin (script kiddies).
- 404s to /favicon.ico from old user-agents.
- OPTIONS preflight 204s.
- Healthcheck pings (/api/health, Vercel internal).
- Expected validation rejects (4xx on /api/waitlist from missing fields).
- One-off 504s during a known cold-start window.

Past incidents to pattern-match:
- Missing build/server/index.js artifact after Vercel build.
- Production env missing vars that preview had.
- DATABASE_URL set to empty string on a preview branch overriding the correct value.
- Trust bar Sanity query returning null due to GROQ select() breaking dereferencing.

Ranking:
- P0 \u2014 site-wide outage, payment/checkout broken, IVR down, customer-facing 500s in critical paths.
- P1 \u2014 single feature broken, high-volume but non-critical errors, webhook failures.
- P2 \u2014 low-volume errors, edge cases, deprecation warnings.

Group identical stack traces into one entry with occurrence count. Do not over-report. If everything is quiet, return zero groups. Owners: rr7-engineer (RR7/Express/general), ivr-ops (Twilio/voice), shopify-ops (Shopify/webhooks), sanity-content-builder (Sanity/GROQ).`;
    REPORT_TOOL = {
      name: "report_groups",
      description: "Return classified log groups ranked by impact.",
      input_schema: {
        type: "object",
        properties: {
          groups: {
            type: "array",
            items: {
              type: "object",
              properties: {
                priority: { type: "string", enum: ["P0", "P1", "P2"] },
                title: { type: "string" },
                occurrences: { type: "number" },
                firstSeen: { type: "string", description: "ISO-8601 timestamp of first occurrence in window" },
                owner: { type: "string", description: "Subagent owner: rr7-engineer | ivr-ops | shopify-ops | sanity-content-builder" },
                excerpt: { type: "string", description: "One representative log line or stack trace, max 800 chars" },
                likelyCause: { type: "string" }
              },
              required: ["priority", "title", "occurrences", "firstSeen", "owner", "excerpt", "likelyCause"]
            }
          },
          suppressedNoiseCount: { type: "number" }
        },
        required: ["groups", "suppressedNoiseCount"]
      }
    };
  }
});

// app/lib/nalpac-feeds.server.ts
import { parse as parse2 } from "csv-parse/sync";
function feedUrl(name) {
  const envKey = `NALPAC_FEED_${name.toUpperCase()}_URL`;
  const override = process.env[envKey];
  if (override) return override;
  const fileMap = {
    main: "nal-product-attributes-main",
    sale: "nal-on-sale",
    new: "nal-new-products",
    top100: "nal-top-100"
  };
  return `${BASE_URL}/${fileMap[name]}.csv`;
}
async function fetchAndParse(name, force) {
  const cacheKey3 = `pricing:nalpac:feed:${name}`;
  if (!force) {
    const cached2 = await kvGet(cacheKey3);
    if (cached2) return cached2;
  }
  const res = await fetch(feedUrl(name));
  if (!res.ok) throw new Error(`Nalpac ${name} feed HTTP ${res.status}`);
  const csv = await res.text();
  const rows = parse2(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });
  await kvSet(cacheKey3, rows, FEED_TTL2);
  return rows;
}
function parseNum(val) {
  if (!val) return 0;
  const n = parseFloat(val.replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}
function safeText(val) {
  if (!val) return null;
  const cleaned = cleanDescription(val);
  return cleaned || null;
}
function findSalePrice(row, msrp) {
  const candidates = ["Sale Price", "Promo Price", "On Sale Price"];
  for (const col of candidates) {
    if (col in row) {
      const sp = parseNum(row[col]);
      if (sp > 0 && sp < msrp) return sp;
    }
  }
  return null;
}
function skuOf(row) {
  return (row["SKU"] ?? row["Sku"] ?? "").trim();
}
function snapshotFromMain(row) {
  const msrp = parseNum(row["MSRP"]);
  const wholesale = parseNum(row["Wholesale"] ?? row["Cost"]);
  const rawMap = parseNum(row["MAP"]);
  const qtyRaw = row["Total qty available"] ?? row["Qty"] ?? row["Quantity"];
  const qty = qtyRaw !== void 0 ? parseInt(qtyRaw, 10) : null;
  return {
    sku: skuOf(row),
    vendor: safeText(row["Vendor"] ?? row["Brand"]),
    productTitle: safeText(row["Product Title"]),
    msrp,
    wholesale,
    mapPrice: rawMap > 0 ? rawMap : null,
    qty: qty !== null && !isNaN(qty) ? qty : null,
    inSaleFeed: false,
    inNewFeed: false,
    inTop100Feed: false,
    nalpacDiscountPct: null,
    raw: { mainRow: row }
  };
}
function snapshotFromSale(row) {
  const msrp = parseNum(row["MSRP"]);
  const wholesale = parseNum(row["Wholesale"] ?? row["Cost"]);
  const rawMap = parseNum(row["MAP"]);
  const salePrice = findSalePrice(row, msrp);
  return {
    sku: skuOf(row),
    vendor: safeText(row["Vendor"] ?? row["Brand"]),
    productTitle: safeText(row["Product Title"]),
    msrp,
    wholesale,
    mapPrice: rawMap > 0 ? rawMap : null,
    qty: null,
    inSaleFeed: true,
    inNewFeed: false,
    inTop100Feed: false,
    nalpacDiscountPct: salePrice !== null && msrp > 0 ? (msrp - salePrice) / msrp : null,
    raw: { saleRow: row }
  };
}
async function fetchAllNalpacFeeds(opts = {}) {
  const force = opts.force ?? false;
  const errors = [];
  const [mainResult, saleResult, newResult, top100Result] = await Promise.allSettled([
    fetchAndParse("main", force),
    fetchAndParse("sale", force),
    fetchAndParse("new", force),
    fetchAndParse("top100", force)
  ]);
  if (mainResult.status === "rejected") {
    throw new Error(`Nalpac main feed unavailable: ${mainResult.reason instanceof Error ? mainResult.reason.message : String(mainResult.reason)}`);
  }
  const mainRows = mainResult.value;
  const saleRows = saleResult.status === "fulfilled" ? saleResult.value : (errors.push(`sale feed: ${saleResult.reason instanceof Error ? saleResult.reason.message : String(saleResult.reason)}`), []);
  const newRows = newResult.status === "fulfilled" ? newResult.value : (errors.push(`new feed: ${newResult.reason instanceof Error ? newResult.reason.message : String(newResult.reason)}`), []);
  const top100Rows = top100Result.status === "fulfilled" ? top100Result.value : (errors.push(`top100 feed: ${top100Result.reason instanceof Error ? top100Result.reason.message : String(top100Result.reason)}`), []);
  const snapshots = /* @__PURE__ */ new Map();
  for (const row of mainRows) {
    const sku = skuOf(row);
    if (!sku) continue;
    snapshots.set(sku, snapshotFromMain(row));
  }
  const saleIndex = /* @__PURE__ */ new Map();
  for (const row of saleRows) {
    const sku = skuOf(row);
    if (!sku) continue;
    saleIndex.set(sku, row);
  }
  const newSkus = new Set(newRows.map(skuOf).filter(Boolean));
  const top100Skus = new Set(top100Rows.map(skuOf).filter(Boolean));
  for (const [sku, snap] of snapshots) {
    const saleRow = saleIndex.get(sku);
    if (saleRow) {
      const salePrice = findSalePrice(saleRow, snap.msrp);
      snap.inSaleFeed = true;
      snap.nalpacDiscountPct = salePrice !== null && snap.msrp > 0 ? (snap.msrp - salePrice) / snap.msrp : null;
      snap.raw.saleRow = saleRow;
      saleIndex.delete(sku);
    }
    if (newSkus.has(sku)) snap.inNewFeed = true;
    if (top100Skus.has(sku)) snap.inTop100Feed = true;
  }
  for (const [sku, row] of saleIndex) {
    if (!sku) continue;
    const snap = snapshotFromSale(row);
    if (newSkus.has(sku)) snap.inNewFeed = true;
    if (top100Skus.has(sku)) snap.inTop100Feed = true;
    snapshots.set(sku, snap);
  }
  return {
    fetchedAt: /* @__PURE__ */ new Date(),
    snapshots,
    counts: {
      main: mainRows.length,
      sale: saleRows.length,
      new: newRows.length,
      top100: top100Rows.length,
      merged: snapshots.size
    },
    errors
  };
}
var BASE_URL, FEED_TTL2;
var init_nalpac_feeds_server = __esm({
  "app/lib/nalpac-feeds.server.ts"() {
    "use strict";
    init_feed_processor_server();
    init_kv_server();
    BASE_URL = "https://productfeeds.wyomind.com/feeds/1s6o37vbh23";
    FEED_TTL2 = 6 * 60 * 60;
  }
});

// app/lib/pricing-engine.server.ts
function round22(n) {
  return Math.round(n * 100) / 100;
}
function isMapRestricted(vendor) {
  if (!vendor) return false;
  const trimmed = vendor.trim().toLowerCase();
  return MAP_RESTRICTED_VENDORS.some((v) => v.toLowerCase() === trimmed);
}
function marginPct(price, wholesale) {
  if (price <= 0) return 0;
  return (price - wholesale) / price;
}
function buildResult(tier, newPrice, msrp, wholesale, currentPrice, mapRespected, reason, flags, effectiveMarginFloor) {
  const finalPrice = round22(newPrice);
  const newCompareAt = round22(msrp);
  const margin = marginPct(finalPrice, wholesale);
  const flagsCopy = [...flags];
  if (margin < effectiveMarginFloor && !flagsCopy.includes("below-floor")) {
    flagsCopy.push("below-floor");
  }
  const delta = round22(finalPrice - currentPrice);
  const deltaPct = currentPrice > 0 ? round22(delta / currentPrice) : 0;
  return { tier, newPrice: finalPrice, newCompareAt, marginPct: margin, reason, mapRespected, flags: flagsCopy, delta, deltaPct };
}
function computeTargetPrice(snapshot, rules) {
  const { wholesale, msrp, mapPrice, currentPrice, inSaleFeed, nalpacDiscountPct, vendor, productType } = snapshot;
  const effectiveMarginFloor = rules?.marginFloor ?? MARGIN_FLOOR;
  const floorMultiplier = 1 / (1 - effectiveMarginFloor);
  const floor = wholesale * floorMultiplier;
  const typeOverride = productType ? rules?.perTypeOverrides?.[productType] : void 0;
  const effectiveHighDiscount = typeOverride?.highMarginDiscount ?? rules?.highMarginDiscount ?? HIGH_MARGIN_DISCOUNT;
  const effectiveMediumDiscount = typeOverride?.mediumMarginDiscount ?? rules?.mediumMarginDiscount ?? MEDIUM_MARGIN_DISCOUNT;
  const effectiveSaleSweetener = rules?.saleSweetener ?? SALE_FLOW_SWEETENER;
  if (wholesale <= 0 || msrp <= 0) {
    const flags2 = [];
    if (wholesale <= 0) flags2.push("no-wholesale");
    if (msrp <= 0) flags2.push("no-msrp");
    const reason2 = `Missing required data: ${flags2.join(", ")}. No price change applied.`;
    return buildResult("refuse-missing-data", currentPrice, msrp > 0 ? msrp : currentPrice, wholesale, currentPrice, true, reason2, flags2, effectiveMarginFloor);
  }
  if (isMapRestricted(vendor)) {
    if (mapPrice == null || mapPrice <= 0) {
      return buildResult(
        "refuse-missing-data",
        currentPrice,
        msrp,
        wholesale,
        currentPrice,
        false,
        `Vendor ${vendor} is MAP-restricted but no MAP price is set. No price change applied.`,
        ["no-map-on-restricted"],
        effectiveMarginFloor
      );
    }
    const candidate2 = Math.max(mapPrice, floor);
    const mapRespected = mapPrice >= floor;
    const flags2 = [];
    const reason2 = `MAP-restricted vendor. newPrice = max(MAP $${mapPrice}, floor $${round22(floor)}) = $${round22(candidate2)}.`;
    const result2 = buildResult("map-locked", candidate2, msrp, wholesale, currentPrice, mapRespected, reason2, flags2, effectiveMarginFloor);
    if (Math.abs(result2.newPrice - currentPrice) < 0.01) {
      return { ...result2, tier: "no-change-needed", reason: "Already at target." };
    }
    return result2;
  }
  let tier;
  let candidate;
  const flags = [];
  if (inSaleFeed && nalpacDiscountPct != null && nalpacDiscountPct > 0) {
    tier = "sale-flow-through";
    const target = msrp * (1 - nalpacDiscountPct - effectiveSaleSweetener);
    candidate = Math.max(target, floor);
    if (candidate > target) flags.push("below-floor");
    const reason2 = `Sale feed at ${Math.round(nalpacDiscountPct * 100)}% off + ${Math.round(effectiveSaleSweetener * 100)}pt sweetener. Target $${round22(target)}, floor $${round22(floor)}.`;
    const result2 = buildResult(tier, candidate, msrp, wholesale, currentPrice, true, reason2, flags, effectiveMarginFloor);
    return applyPostRules(result2, currentPrice, wholesale, msrp, effectiveMarginFloor);
  }
  if (msrp >= 2 * wholesale) {
    tier = "high-margin";
    const target = msrp * (1 - effectiveHighDiscount);
    candidate = Math.max(target, floor);
    if (candidate > target) flags.push("below-floor");
    const reason2 = `High margin (MSRP/wholesale ratio ${round22(msrp / wholesale)}x). ${Math.round(effectiveHighDiscount * 100)}% off MSRP = $${round22(target)}, floor $${round22(floor)}.`;
    const result2 = buildResult(tier, candidate, msrp, wholesale, currentPrice, true, reason2, flags, effectiveMarginFloor);
    return applyPostRules(result2, currentPrice, wholesale, msrp, effectiveMarginFloor);
  }
  if (msrp >= 1.5 * wholesale) {
    tier = "medium-margin";
    const target = msrp * (1 - effectiveMediumDiscount);
    candidate = Math.max(target, floor);
    if (candidate > target) flags.push("below-floor");
    const reason2 = `Medium margin (MSRP/wholesale ratio ${round22(msrp / wholesale)}x). ${Math.round(effectiveMediumDiscount * 100)}% off MSRP = $${round22(target)}, floor $${round22(floor)}.`;
    const result2 = buildResult(tier, candidate, msrp, wholesale, currentPrice, true, reason2, flags, effectiveMarginFloor);
    return applyPostRules(result2, currentPrice, wholesale, msrp, effectiveMarginFloor);
  }
  tier = "thin-margin";
  candidate = floor;
  flags.push("thin-margin");
  const reason = `Thin margin (MSRP/wholesale ratio ${round22(msrp / wholesale)}x). Pricing at floor $${round22(floor)}. Likely not worth carrying as a deal.`;
  const result = buildResult(tier, candidate, msrp, wholesale, currentPrice, true, reason, flags, effectiveMarginFloor);
  return applyPostRules(result, currentPrice, wholesale, msrp, effectiveMarginFloor);
}
function applyPostRules(result, currentPrice, wholesale, msrp, effectiveMarginFloor) {
  const { newPrice } = result;
  if (Math.abs(newPrice - currentPrice) < 0.01) {
    return { ...result, tier: "no-change-needed", reason: "Already at target." };
  }
  if (newPrice > currentPrice && result.tier !== "map-locked") {
    const currentMargin = marginPct(currentPrice, wholesale);
    if (currentMargin >= effectiveMarginFloor) {
      const revertedMargin = marginPct(currentPrice, wholesale);
      return {
        ...result,
        tier: "no-change-needed",
        newPrice: currentPrice,
        newCompareAt: round22(msrp),
        marginPct: revertedMargin,
        reason: `Wholesale rose, margin still above ${Math.round(effectiveMarginFloor * 100)}%, no change.`,
        flags: [...result.flags, "increase-absorbed"],
        delta: 0,
        deltaPct: 0
      };
    }
  }
  return result;
}
var MAP_RESTRICTED_VENDORS, MARGIN_FLOOR, HIGH_MARGIN_DISCOUNT, MEDIUM_MARGIN_DISCOUNT, SALE_FLOW_SWEETENER;
var init_pricing_engine_server = __esm({
  "app/lib/pricing-engine.server.ts"() {
    "use strict";
    MAP_RESTRICTED_VENDORS = ["Lovense", "Playground"];
    MARGIN_FLOOR = 0.2;
    HIGH_MARGIN_DISCOUNT = 0.35;
    MEDIUM_MARGIN_DISCOUNT = 0.2;
    SALE_FLOW_SWEETENER = 0.05;
  }
});

// app/lib/pricing-report.server.ts
var init_pricing_report_server = __esm({
  "app/lib/pricing-report.server.ts"() {
    "use strict";
    init_claude_server();
  }
});

// app/lib/pricing-agent.server.ts
import { eq as eq11 } from "drizzle-orm";
var init_pricing_agent_server = __esm({
  "app/lib/pricing-agent.server.ts"() {
    "use strict";
    init_db_server();
    init_schema();
    init_kv_server();
    init_nalpac_feeds_server();
    init_shopify_server();
    init_pricing_engine_server();
    init_pricing_report_server();
  }
});

// app/lib/pricing-apply.server.ts
var init_pricing_apply_server = __esm({
  "app/lib/pricing-apply.server.ts"() {
    "use strict";
    init_shopify_server();
  }
});

// app/lib/pricing-webhook.server.ts
import { eq as eq12, sql as sql5 } from "drizzle-orm";
async function setPipelineSetting(key, value) {
  await db.insert(pipelineSettings).values({ key, value }).onConflictDoUpdate({
    target: pipelineSettings.key,
    set: { value, updatedAt: /* @__PURE__ */ new Date() }
  });
}
var init_pricing_webhook_server = __esm({
  "app/lib/pricing-webhook.server.ts"() {
    "use strict";
    init_db_server();
    init_schema();
    init_kv_server();
    init_shopify_server();
    init_pricing_engine_server();
    init_pricing_agent_server();
    init_pricing_apply_server();
  }
});

// app/lib/dial-registry.server.ts
import { createClient as createClient7 } from "@sanity/client";
function client3(write = false) {
  if (!projectId7) return null;
  const token = process.env["SANITY_API_TOKEN"];
  return createClient7({
    projectId: projectId7,
    dataset: dataset7,
    apiVersion: apiVersion7,
    useCdn: !write,
    ...token ? { token } : {}
  });
}
async function getDialRegistry() {
  const c = client3(false);
  if (!c) return { ...FALLBACK2 };
  try {
    const projection = REGISTRY_FIELD_NAMES.join(", ");
    const doc = await c.fetch(
      `*[_id == $id][0]{ ${projection} }`,
      { id: SINGLETON_ID2 }
    );
    const out = {};
    for (const type of Object.keys(TYPE_TO_FIELD)) {
      const field = TYPE_TO_FIELD[type];
      let labels = doc?.[field] ?? [];
      if (type === "vibrator") {
        labels = [
          ...labels,
          ...doc?.["airPulsation"] ?? [],
          ...doc?.["wand"] ?? []
        ];
        labels = Array.from(new Set(labels));
      }
      if (labels.length > 0) {
        out[type] = labels;
      } else if (FALLBACK2[type]) {
        out[type] = FALLBACK2[type];
      }
    }
    return out;
  } catch (err) {
    console.error("[dial-registry] fetch failed, using fallback:", err);
    return { ...FALLBACK2 };
  }
}
async function getDialLabelsForType(type) {
  const reg = await getDialRegistry();
  return reg[type] ?? [];
}
async function getDialTaxonomy() {
  const empty = {};
  const c = client3(false);
  if (!c) return empty;
  try {
    const projection = REGISTRY_FIELD_NAMES.join(", ");
    const doc = await c.fetch(
      `*[_id == $id][0]{ ${projection} }`,
      { id: TAXONOMY_SINGLETON_ID }
    );
    if (!doc) return empty;
    const out = {};
    for (const type of Object.keys(TYPE_TO_FIELD)) {
      const field = TYPE_TO_FIELD[type];
      let entries = Array.isArray(doc[field]) ? doc[field] : [];
      if (type === "vibrator") {
        const merged = [
          ...entries,
          ...Array.isArray(doc["airPulsation"]) ? doc["airPulsation"] : [],
          ...Array.isArray(doc["wand"]) ? doc["wand"] : []
        ];
        const seen = /* @__PURE__ */ new Set();
        entries = [];
        for (const entry of merged) {
          if (!entry?.label || seen.has(entry.label)) continue;
          seen.add(entry.label);
          entries.push(entry);
        }
      }
      if (entries.length > 0) out[type] = entries;
    }
    return out;
  } catch (err) {
    console.error("[dial-registry] taxonomy fetch failed, returning empty:", err);
    return empty;
  }
}
async function appendDialLabel(type, label) {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("label cannot be empty");
  const c = client3(true);
  if (!c) throw new Error("Sanity client unavailable \u2014 set SANITY_PROJECT_ID and SANITY_API_TOKEN");
  const current = await getDialLabelsForType(type);
  const exists = current.some((x) => x.toLowerCase() === trimmed.toLowerCase());
  if (exists) return current;
  const field = TYPE_TO_FIELD[type];
  if (!field) {
    throw new Error(`No Sanity dialRegistry field mapped for product type "${type}". Run the Sanity dialRegistry migration before appending labels for this type.`);
  }
  const next = [...current, trimmed];
  await c.patch(SINGLETON_ID2).set({ [field]: next }).commit();
  return next;
}
var projectId7, dataset7, apiVersion7, SINGLETON_ID2, TAXONOMY_SINGLETON_ID, TYPE_TO_FIELD, REGISTRY_FIELD_NAMES, FALLBACK2;
var init_dial_registry_server = __esm({
  "app/lib/dial-registry.server.ts"() {
    "use strict";
    projectId7 = process.env["SANITY_PROJECT_ID"];
    dataset7 = process.env["SANITY_DATASET"] ?? "production";
    apiVersion7 = "2024-10-01";
    SINGLETON_ID2 = "singleton.dialRegistry";
    TAXONOMY_SINGLETON_ID = "singleton.dialTaxonomy";
    TYPE_TO_FIELD = {
      vibrator: "vibrator",
      dildo: "dildo",
      anal: "anal",
      bondage: "bondage",
      "cock-ring": "cockRing",
      stroker: "stroker",
      couples: "couples",
      harness: "harness",
      extender: "extender",
      pump: "pump",
      lube: "lube",
      massage: "massage",
      enhancer: "enhancer",
      wear: "wear",
      condom: "condom",
      wellness: "wellness",
      novelty: "novelty",
      "book-media": "bookMedia",
      "sex-machine": "sexMachine"
    };
    REGISTRY_FIELD_NAMES = [
      ...Object.values(TYPE_TO_FIELD),
      "airPulsation",
      "wand"
    ];
    FALLBACK2 = {
      vibrator: ["Intensity", "Quietness", "Pattern variety", "Buildup speed", "Battery life", "Learning curve"],
      lube: ["Slipperiness", "Longevity", "Taste-safe", "Body-safe", "Tidy-up", "Skin feel"],
      wear: ["Fit", "Softness", "Washability", "Discretion", "Adjustability", "Occasion"]
    };
  }
});

// app/lib/imagen.server.ts
import { GoogleGenAI } from "@google/genai";
function getMoodDescription(categories) {
  for (const cat of categories) {
    const mood = MOOD_MAP[cat];
    if (mood) return mood;
  }
  return "warm abstract lifestyle, soft lighting, premium wellness aesthetic";
}
function buildClient() {
  const project = process.env["GOOGLE_CLOUD_PROJECT_ID"] ?? "";
  const location = process.env["GOOGLE_CLOUD_LOCATION"] ?? "us-central1";
  const raw = process.env["GOOGLE_SERVICE_ACCOUNT_JSON"];
  if (raw) {
    const key = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    return new GoogleGenAI({
      vertexai: true,
      project,
      location,
      googleAuthOptions: {
        credentials: {
          client_email: key.client_email,
          private_key: key.private_key
        },
        scopes: ["https://www.googleapis.com/auth/cloud-platform"]
      }
    });
  }
  return new GoogleGenAI({ vertexai: true, project, location });
}
async function generateOne(ai, parts) {
  const response = await ai.models.generateContent({
    model: MODEL3,
    contents: [{ role: "user", parts }],
    config: { responseModalities: ["IMAGE"] }
  });
  const candidate = response.candidates?.[0];
  if (!candidate) throw new Error("No candidates returned from Gemini image API");
  if (candidate.finishReason === "SAFETY") {
    throw new Error("Image blocked by safety filters");
  }
  for (const part of candidate.content?.parts ?? []) {
    if (part.inlineData?.data) {
      return Buffer.from(part.inlineData.data, "base64");
    }
  }
  throw new Error(
    `Gemini returned no image data (finishReason: ${candidate.finishReason ?? "unknown"}). Prompt may have been filtered.`
  );
}
async function generateMoodImage(opts) {
  const project = process.env["GOOGLE_CLOUD_PROJECT_ID"];
  if (!project) throw new Error("GOOGLE_CLOUD_PROJECT_ID not set");
  const ai = buildClient();
  const mood = getMoodDescription(opts.categories);
  const count = Math.min(Math.max(1, opts.count ?? 2), 4);
  const basePrompt = opts.prompt ?? `Abstract lifestyle photography for a premium wellness product.
Mood: warm, curious, inviting. Soft golden-hour lighting.
Colors: coral red, warm orange, purple accents, cream background.
No faces. No people. No product shown directly.
Suggest the feeling of: ${mood}.
Style: editorial, tasteful, evocative but not explicit.`;
  const parts = [];
  if (opts.originalImageBuffer) {
    parts.push({ inlineData: { mimeType: "image/jpeg", data: opts.originalImageBuffer.toString("base64") } });
    parts.push({ text: `${basePrompt} Keep the product identical. Only change the environment, lighting, or background as described.` });
  } else {
    const refs = opts.referenceImageBuffers;
    if (refs && refs.length > 0) {
      for (const ref of refs) {
        parts.push({ inlineData: { mimeType: "image/jpeg", data: ref.toString("base64") } });
      }
      const plural = refs.length > 1 ? "reference images" : "reference image";
      parts.push({
        text: `${basePrompt} Reproduce the exact same physical product${refs.length > 1 ? "s" : ""} shown in the ${plural} \u2014 same shape, color, finish, and details. Place ${refs.length > 1 ? "them" : "it"} faithfully in the new scene without altering the product${refs.length > 1 ? "s themselves" : " itself"}.`
      });
    } else {
      parts.push({ text: basePrompt });
    }
  }
  const results = await Promise.allSettled(
    Array.from({ length: count }, () => generateOne(ai, parts))
  );
  const buffers = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      buffers.push(result.value);
    } else {
      console.warn("[imagen] One generation failed:", result.reason instanceof Error ? result.reason.message : result.reason);
    }
  }
  if (buffers.length === 0) {
    const firstError = results.find((r) => r.status === "rejected");
    const reason = firstError?.reason instanceof Error ? firstError.reason.message : String(firstError?.reason);
    throw new Error(`All image generations failed: ${reason}`);
  }
  return buffers;
}
var MOOD_MAP, MODEL3;
var init_imagen_server = __esm({
  "app/lib/imagen.server.ts"() {
    "use strict";
    MOOD_MAP = {
      "Water-Based": "silky smooth liquid over smooth stones, clean and natural",
      "Silicone-Based": "gleaming geometric shapes, premium and sleek",
      "Wands": "sleek modern sculpture in warm light, powerful and elegant",
      "Dual Action and Rabbits": "two flowers blooming simultaneously, movement and softness",
      "Plugs and Probes": "smooth geometric form, subtle curves in purple shadow",
      "Restraints": "soft ribbons loosely draped, playful not threatening",
      "Toy Cleaners": "fresh botanical ingredients, clean spa aesthetic",
      "Bullets and Eggs": "small smooth river pebbles, delicate and curious",
      "Vagina Strokers": "soft fabric texture, modern minimal studio",
      "Couples and Wearable": "two intertwined abstract forms, warm connection",
      "Air Pulse and Suction": "gentle wind through tall grass, soft and airy",
      "Remote": "wireless signal ripples in water, playful and techy",
      "Finger and Clit": "rose petal curves in warm light, soft and inviting"
    };
    MODEL3 = process.env["GEMINI_IMAGE_MODEL"] ?? "gemini-2.5-flash-image";
  }
});

// app/lib/llm-client.server.ts
import Anthropic4 from "@anthropic-ai/sdk";
var init_llm_client_server = __esm({
  "app/lib/llm-client.server.ts"() {
    "use strict";
  }
});

// app/lib/emma-orchestrator.server.ts
function makeDealContext(state) {
  return {
    // Use the augmented title once generateProductTitle has run; fall back
    // to the caller-supplied seoTitle until then. This way Emma's Take and
    // friends speak in terms of the final shopper-facing title.
    seoTitle: state.writes.productTitle ?? state.input.seoTitle,
    tagline: state.writes.tagline ?? "",
    fullStory: state.writes.descriptionHtml ?? "",
    ...state.writes.descriptionHtml ? { descriptionHtml: state.writes.descriptionHtml } : {},
    ...state.writes.careInstructions ? { careInstructions: state.writes.careInstructions } : {},
    brand: state.input.product.brand,
    category: state.input.category,
    ...state.writes.productTypeDial ? { productTypeDial: state.writes.productTypeDial } : {},
    specifications: state.writes.specifications ?? [],
    dealPrice: state.input.product.dealPrice,
    msrp: state.input.product.msrp,
    mapRestricted: false
  };
}
function enrichProduct(state, product) {
  const enriched = {
    title: state.writes.productTitle ?? product.title,
    brand: product.brand,
    description: product.description,
    categories: product.categories,
    dealPrice: product.dealPrice,
    msrp: product.msrp
  };
  if (state.writes.productTypeDial) enriched.productTypeDial = state.writes.productTypeDial;
  if (state.writes.moodTags?.length) enriched.moodTags = state.writes.moodTags;
  if (state.writes.audienceTags?.length) enriched.audienceTags = state.writes.audienceTags;
  if (state.writes.mattersTags?.length) enriched.mattersTags = state.writes.mattersTags;
  return enriched;
}
async function executeTool(name, state) {
  const { product } = state.input;
  const dealCtx = makeDealContext(state);
  switch (name) {
    case "classifyProductTypeDial": {
      const taxonomy = await inferProductTaxonomy({
        title: product.title,
        brand: product.brand,
        description: product.description,
        categories: product.categories,
        ...state.input.llmClient ? { llmClient: state.input.llmClient } : {}
      });
      state.writes.productTypeDial = taxonomy.type;
      state.writes.productSubtypeDial = taxonomy.subtype;
      const summary = taxonomy.subtype ? `productTypeDial=${taxonomy.type}/${taxonomy.subtype}` : `productTypeDial=${taxonomy.type}`;
      return { ok: true, summary };
    }
    case "generateProductTitle": {
      const dial = state.writes.productTypeDial ?? "vibrator";
      const titleResult = await generateProductTitle({
        rawTitle: product.title,
        brand: product.brand,
        rawDescription: product.description,
        productTypeDial: dial,
        ...state.input.llmClient ? { llmClient: state.input.llmClient } : {}
      });
      state.writes.productTitle = titleResult.title;
      state.writes.productTitleAugmented = titleResult.augmented;
      state.writes.originalTitle = titleResult.originalTitle;
      return {
        ok: true,
        summary: titleResult.augmented ? `title augmented: "${titleResult.originalTitle}" \u2192 "${titleResult.title}" (${titleResult.reason})` : `title preserved: "${titleResult.title}" (${titleResult.reason})`
      };
    }
    case "proposePairingWhy": {
      const candidates = state.input.pairingCandidates ?? [];
      if (candidates.length === 0) {
        return { ok: true, summary: "no pairing candidates \u2014 skipped" };
      }
      try {
        const dial = state.writes.productTypeDial ?? "vibrator";
        const result = await generatePairingWhy({
          primary: {
            title: product.title,
            brand: product.brand,
            productTypeDial: dial,
            ...state.writes.tagline ? { tagline: state.writes.tagline } : {},
            description: product.description
          },
          candidates: candidates.map((c) => {
            const ci = {
              productId: c.productId,
              title: c.title,
              price: c.price
            };
            if (c.brand) ci.brand = c.brand;
            if (c.productTypeDial) ci.productTypeDial = c.productTypeDial;
            return ci;
          }),
          ...state.input.llmClient ? { llmClient: state.input.llmClient } : {}
        });
        if (result.accessoryProductIds.length > 0) {
          state.writes.accessoryProductIds = result.accessoryProductIds;
          state.writes.pairingWhy = result.pairingWhy;
          return { ok: true, summary: `pairings=${result.accessoryProductIds.length}` };
        }
        return { ok: true, summary: "no pairings strong enough \u2014 skipped" };
      } catch (err) {
        return { ok: false, summary: `pairings skipped: ${err instanceof Error ? err.message : "error"}` };
      }
    }
    case "generateProductCopyBundle": {
      const bundle = await generateProductCopyBundle({
        product: enrichProduct(state, product),
        ...state.input.llmClient ? { llmClient: state.input.llmClient } : {}
      });
      state.writes.tagline = bundle.tagline;
      state.writes.seoMetaDescription = bundle.seoMeta;
      state.writes.specifications = bundle.specifications;
      return {
        ok: !!bundle.tagline && !!bundle.seoMeta,
        summary: `bundle tagline=${bundle.tagline.length} seoMeta=${bundle.seoMeta.length} specs=${bundle.specifications.length}`
      };
    }
    case "generateEmmaTake": {
      const html = await generateEmmaTake({ deal: dealCtx, ...state.input.llmClient ? { llmClient: state.input.llmClient } : {} });
      state.writes.descriptionHtml = html;
      return { ok: !!html, summary: `emmaTake len=${html.length}` };
    }
    case "generateCareInstructions": {
      try {
        const bullets = await generateCareInstructions({ deal: dealCtx, ...state.input.llmClient ? { llmClient: state.input.llmClient } : {} });
        state.writes.careInstructions = bullets;
        return { ok: true, summary: `care=${bullets.length}` };
      } catch (err) {
        return { ok: false, summary: `care skipped: ${err instanceof Error ? err.message : "error"}` };
      }
    }
    case "generateSensationDialV2": {
      const type = state.writes.productTypeDial ?? "vibrator";
      const preferredLabels = state.dialRegistry[type] ?? [];
      const taxonomy = state.dialTaxonomy[type] ?? [];
      const dial = await generateSensationDialV2({
        deal: { ...dealCtx, productTypeDial: type },
        preferredLabels,
        ...taxonomy.length > 0 ? { taxonomy } : {},
        ...state.input.llmClient ? { llmClient: state.input.llmClient } : {}
      });
      state.writes.sensationDialV2 = dial;
      const proposed = dial.items.filter((i) => i.proposed && typeof i.label === "string");
      let appended = 0;
      for (const item of proposed) {
        try {
          const next = await appendDialLabel(type, item.label);
          if (next.length !== (state.dialRegistry[type]?.length ?? 0)) {
            state.dialRegistry[type] = next;
            appended++;
          }
        } catch (err) {
          console.warn(`[emma-orchestrator] appendDialLabel(${type}, "${item.label}") failed:`, err instanceof Error ? err.message : err);
        }
      }
      return { ok: true, summary: `dial items=${dial.items.length}${appended > 0 ? ` appended=${appended}` : ""}` };
    }
    case "generateBoxContents": {
      const r = await generateCopy({ type: "box_contents", product: enrichProduct(state, product) }, state.input.llmClient);
      const bc = r.content ?? [];
      if (bc.length > 0) state.writes.boxContents = bc;
      return { ok: true, summary: `boxContents=${bc.length}` };
    }
    case "generateAskEmmaTagsAll": {
      const result = await generateAskEmmaTagsAll({
        deal: dealCtx,
        vocabularies: {
          mood: state.vocab.mood,
          audience: state.vocab.audience,
          matters: state.vocab.matters
        },
        ...state.input.llmClient ? { llmClient: state.input.llmClient } : {}
      });
      state.writes.moodTags = result.moodTags;
      state.writes.audienceTags = result.audienceTags;
      state.writes.mattersTags = result.mattersTags;
      return {
        ok: true,
        summary: `mood=${result.moodTags.length} audience=${result.audienceTags.length} matters=${result.mattersTags.length}`
      };
    }
    case "generateEmmaHero": {
      const hero = await generateEmmaHero({
        deal: {
          seoTitle: dealCtx.seoTitle,
          tagline: dealCtx.tagline,
          fullStory: dealCtx.fullStory,
          brand: dealCtx.brand,
          category: dealCtx.category,
          dealPrice: dealCtx.dealPrice,
          msrp: dealCtx.msrp,
          mapRestricted: dealCtx.mapRestricted
        },
        ...state.input.llmClient ? { llmClient: state.input.llmClient } : {}
      });
      state.writes.emmaHero = hero;
      return { ok: true, summary: `emmaHero variant=${hero.variant}` };
    }
    case "generateMoodImage": {
      if (process.env.EMMA_SKIP_IMAGE === "1") {
        return { ok: true, summary: "moodImage skipped (EMMA_SKIP_IMAGE=1)" };
      }
      try {
        const buffers = await generateMoodImage({
          categories: product.categories,
          count: 1
        });
        const buf = buffers[0];
        if (!buf) return { ok: false, summary: "no image buffer returned" };
        const slug = product.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
        const url = await uploadMoodImageToShopifyFiles(buf, `mood-${slug}-${Date.now()}.jpg`);
        state.writes.moodImageUrl = url;
        return { ok: true, summary: `moodImage url=${url.slice(0, 80)}` };
      } catch (err) {
        return { ok: false, summary: `moodImage skipped: ${err instanceof Error ? err.message : "error"}` };
      }
    }
    case "generateIvrAll": {
      const ivr = await generateIvrAll({ deal: dealCtx, ...state.input.llmClient ? { llmClient: state.input.llmClient } : {} });
      state.writes.ivrExperience = ivr.experience;
      state.writes.ivrUseCase = ivr.useCases;
      state.writes.ivrFeatures = ivr.features;
      return {
        ok: true,
        summary: `ivr exp=[${ivr.experience.join(",")}] uc=${ivr.useCases.length} feat=${ivr.features.length}`
      };
    }
    case "generateProductFaqs": {
      const faqs = await generateProductFaqs({ deal: dealCtx, ...state.input.llmClient ? { llmClient: state.input.llmClient } : {} });
      state.writes.productFaqs = faqs;
      return { ok: faqs.length > 0, summary: `productFaqs=${faqs.length}` };
    }
    case "finish": {
      state.finished = true;
      return { ok: true, summary: "orchestrator complete" };
    }
    default:
      return { ok: false, summary: `unknown tool: ${name}` };
  }
}
function assembleWrites(partial, telemetry) {
  if (telemetry.toolCalls.length === 0) {
    throw new Error("orchestrator: 0 tool calls \u2014 LLM client returned empty content (check llm-client adapter)");
  }
  if (!partial.tagline?.trim()) {
    throw new Error("orchestrator: tagline tool did not run or returned empty \u2014 refusing to ship a fallback");
  }
  return {
    productTypeDial: partial.productTypeDial ?? "vibrator",
    tagline: partial.tagline,
    seoMetaDescription: partial.seoMetaDescription ?? "",
    descriptionHtml: partial.descriptionHtml ?? "",
    moodTags: partial.moodTags ?? [],
    audienceTags: partial.audienceTags ?? [],
    mattersTags: partial.mattersTags ?? [],
    ...partial.productSubtypeDial !== void 0 ? { productSubtypeDial: partial.productSubtypeDial } : {},
    ...partial.productTitle !== void 0 ? { productTitle: partial.productTitle } : {},
    ...partial.productTitleAugmented !== void 0 ? { productTitleAugmented: partial.productTitleAugmented } : {},
    ...partial.originalTitle !== void 0 ? { originalTitle: partial.originalTitle } : {},
    ...partial.boxContents !== void 0 ? { boxContents: partial.boxContents } : {},
    ...partial.specifications !== void 0 ? { specifications: partial.specifications } : {},
    ...partial.careInstructions !== void 0 ? { careInstructions: partial.careInstructions } : {},
    ...partial.sensationDialV2 !== void 0 ? { sensationDialV2: partial.sensationDialV2 } : {},
    ...partial.emmaHero !== void 0 ? { emmaHero: partial.emmaHero } : {},
    ...partial.moodImageUrl !== void 0 ? { moodImageUrl: partial.moodImageUrl } : {},
    ...partial.accessoryProductIds !== void 0 ? { accessoryProductIds: partial.accessoryProductIds } : {},
    ...partial.pairingWhy !== void 0 ? { pairingWhy: partial.pairingWhy } : {},
    ...partial.ivrExperience !== void 0 ? { ivrExperience: partial.ivrExperience } : {},
    ...partial.ivrUseCase !== void 0 ? { ivrUseCase: partial.ivrUseCase } : {},
    ...partial.ivrFeatures !== void 0 ? { ivrFeatures: partial.ivrFeatures } : {},
    ...partial.productFaqs !== void 0 ? { productFaqs: partial.productFaqs } : {}
  };
}
function buildUserPrompt(input) {
  return `Generate the full PDP content for this product:

Title: ${input.product.title}
Brand: ${input.product.brand}
Categories: ${input.product.categories.join(", ") || "(none)"}
Description (truncated): ${input.product.description.slice(0, 800)}

SEO title (already set, for context): ${input.seoTitle}
Pricing context (do not echo): deal $${input.product.dealPrice} / msrp $${input.product.msrp}

Start with classifyProductTypeDial, then run every other applicable tool exactly once, then call finish.`;
}
var TOOLS, SYSTEM;
var init_emma_orchestrator_server = __esm({
  "app/lib/emma-orchestrator.server.ts"() {
    "use strict";
    init_claude_server();
    init_dial_registry_server();
    init_ask_emma_vocab_server();
    init_imagen_server();
    init_shopify_server();
    init_llm_client_server();
    init_models_server();
    TOOLS = [
      {
        name: "classifyProductTypeDial",
        description: "Classify the product into a hierarchical taxonomy \u2014 top-level type AND per-parent subtype in one call. Top-level types: vibrator, dildo, anal, bondage, cock-ring, stroker, couples, harness, extender, pump, lube, massage, enhancer, wear, condom, wellness, novelty, book-media, sex-machine. Always call this FIRST so other tools have the right type.",
        input_schema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "generateAskEmmaTagsAll",
        description: "Generate Title Case Ask Emma tags for ALL THREE axes (mood / audience / matters) in one combined Haiku call. Replaces the three single-axis tools. Always call this. Run BEFORE copy tools so keyword targeting can filter on these tags. Backfill will not invent new vocab; tags are restricted to the curated lists.",
        input_schema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "generateProductTitle",
        description: 'Decide whether to augment the manufacturer title with one SEO descriptor (e.g. "Eclipse 7" \u2192 "Eclipse 7 Wand Vibrator"), or leave it alone if it already names the category. Run AFTER classifyProductTypeDial + tag tools so the descriptor matches keyword bank targets. Always call this.',
        input_schema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "generateProductCopyBundle",
        description: 'Generate the product tagline, SEO meta description, AND "Label: Value" specifications bullets in a SINGLE Haiku call. Replaces the three legacy tools (generateTagline + generateSeoMeta + generateSpecifications) \u2014 they shared the same product context and keyword block. Always call this.',
        input_schema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "generateEmmaTake",
        description: "Generate Emma's first-person take (becomes Shopify body_html / Emma's take tab). Always call this.",
        input_schema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "generateCareInstructions",
        description: "Generate 3\u20135 short care bullets. Call this for product types where care matters: vibrator, wand, air-pulsation, wear. SKIP for lube unless the lube has a real care/storage note.",
        input_schema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "generateSensationDialV2",
        description: "Generate the 5\u20136 dimension sensation dial scored 1\u20135. Always call this AFTER classifyProductTypeDial.",
        input_schema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "generateBoxContents",
        description: 'Generate "what is in the box" bullets. Call this for hardware (vibrator, wand, air-pulsation). SKIP for lube. SKIP for wear unless the wear product has packaging contents worth listing.',
        input_schema: { type: "object", properties: {}, required: [] }
      },
      // Phase 1 rebuild — these tools were removed from the import orchestrator's
      // tool list:
      //   - generateEmmaHero (E1/E2): deal-cycle artifact, regenerated per
      //     deal slot rotation. Out of import scope.
      //   - generateMoodImage: image generation is Phase 2+ scope.
      //   - proposePairingWhy (F1/F2): pairings are deal-cycle, curated when
      //     a product enters the homepage deal slot against the freshest
      //     catalog state.
      // The corresponding case branches and underlying generator functions are
      // preserved so the deal-cycle pipeline can call them directly. Import path
      // never schedules them.
      {
        name: "generateIvrAll",
        description: "Pick experience levels, use-case slugs, AND feature slugs in a SINGLE Haiku call \u2014 replaces the three legacy IVR tools (generateIvrExperience + generateIvrUseCase + generateIvrFeatures). Used by Emma chat/IVR/SMS to match buyer intent and speak features aloud. Always call this AFTER classifyProductTypeDial and generateEmmaTake so context is rich.",
        input_schema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "generateProductFaqs",
        description: "Generate 4\u20136 FAQ pairs (general / care / usage / compatibility) for the PDP and FAQPage JSON-LD. Always call this AFTER generateEmmaTake \u2014 answers benefit from the product story being set. Sanity-only field; no Shopify metafield.",
        input_schema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "finish",
        description: "Call this last \u2014 when every applicable tool above has been called. Takes no arguments; orchestrator returns the consolidated writes.",
        input_schema: { type: "object", properties: {}, required: [] }
      }
    ];
    SYSTEM = `You are Emma's content brain for xdipx.com \u2014 an editorially-curated sexual-wellness storefront. Given one product, you decide which content generators to run to fully populate its PDP and Emma's voice surfaces (chat / IVR / SMS), then call them via tools.

Required for every product (run in this exact phase order):

Phase 1 \u2014 classify (must complete BEFORE anything else):
  1. classifyProductTypeDial

Phase 2 \u2014 tag the product (must complete BEFORE copy generators so the SEO keyword bank can filter approved terms by these tags \u2014 without this, copy is generic):
  2. generateAskEmmaTagsAll  (single Haiku call, all three axes \u2014 mood / audience / matters)

Phase 3 \u2014 title decision (uses dial + tags to pick a descriptor when needed):
  3. generateProductTitle

Phase 4 \u2014 copy generators (these benefit from keyword targeting via the tags above):
  4. generateProductCopyBundle  (single Haiku call: tagline + seoMeta + specifications together)
  5. generateEmmaTake

Phase 5 \u2014 dial + hero + image (independent, run after copy is set):
  6. generateSensationDialV2 (must be AFTER classifyProductTypeDial)
  7. generateEmmaHero
  8. generateMoodImage

Phase 6 \u2014 pairings (run AFTER copy bundle + emmaTake exist so the pairing-why blurbs have richer context):
  9. proposePairingWhy (SKIP if no pairing candidates were provided)

Phase 7 \u2014 IVR / voice surfaces (run AFTER generateEmmaTake \u2014 they need rich context):
  10. generateIvrAll  (single Haiku call: experience + useCases + features together)

Phase 8 \u2014 PDP FAQs (run LAST \u2014 must be AFTER generateEmmaTake AND generateCareInstructions so the differentiation context is populated; H1 answers must NOT restate descriptionHtml or careInstructions):
  11. generateProductFaqs

Conditional:
- generateCareInstructions: call for every product type. The underlying generator branches on productTypeDial \u2014 hardware gets 3\u20135 maintenance bullets, consumables (lube, edible wear) get 2\u20133 playful storage/usage bullets.
- generateBoxContents: skip for lube; usually skip for wear.

When every applicable tool above has been called, call \`finish\` with no arguments. Do NOT re-emit content \u2014 the orchestrator already has it.

Be efficient. Each tool is a single call. Do NOT call the same tool twice.`;
  }
});

// app/lib/enricher-brief.server.ts
import { eq as eq13 } from "drizzle-orm";
async function adminGraphQLWithRetry(query, variables, attempt = 0) {
  try {
    return await adminGraphQL(query, variables);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isRateLimit = msg.includes("429") || msg.toLowerCase().includes("throttled");
    if (!isRateLimit || attempt >= 4) throw err;
    const delayMs = 1500 * Math.pow(2, attempt);
    console.warn(`[enricher-brief] rate-limited; backing off ${delayMs}ms (attempt ${attempt + 1}/5)`);
    await new Promise((r) => setTimeout(r, delayMs));
    return adminGraphQLWithRetry(query, variables, attempt + 1);
  }
}
async function fetchProductSnapshot(numericId) {
  try {
    const data = await adminGraphQLWithRetry(`
      query EnricherSnapshot($id: ID!) {
        product(id: $id) {
          id
          title
          handle
          vendor
          descriptionHtml
          status
          productType
          updatedAt
          media(first: 5) {
            edges {
              node {
                ... on MediaImage {
                  preview { image { url } }
                }
              }
            }
          }
          metafields(first: 100) {
            edges { node { namespace key value } }
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                metafield(namespace: "custom", key: "original_description") {
                  value
                }
              }
            }
          }
        }
      }
    `, { id: `gid://shopify/Product/${numericId}` });
    const product = data.product;
    if (!product) return null;
    const metafields = {};
    for (const e of product.metafields.edges) {
      metafields[`${e.node.namespace}.${e.node.key}`] = e.node.value;
    }
    const aggregated = aggregateVariantDescriptions(product.variants.edges.map((e) => e.node));
    const snap = {
      id: String(product.id.split("/").pop()),
      title: product.title,
      handle: product.handle,
      vendor: product.vendor,
      body_html: product.descriptionHtml,
      status: product.status.toLowerCase(),
      // GraphQL returns 'DRAFT' uppercase; normalise
      product_type: product.productType,
      updated_at: product.updatedAt,
      metafields,
      images: product.media.edges.map((e) => e.node.preview?.image?.url).filter((u) => !!u).map((src) => ({ src }))
    };
    const aggregatedDescription = aggregated ?? metafields["custom.original_description"] ?? void 0;
    if (aggregatedDescription) snap.aggregatedDescription = aggregatedDescription;
    return snap;
  } catch (err) {
    console.warn(`[enricher-brief] fetchProductSnapshot ${numericId} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}
function aggregateVariantDescriptions(variants) {
  if (variants.length === 0) return void 0;
  const seen = /* @__PURE__ */ new Set();
  const pieces = [];
  for (const v of variants) {
    const value = v.metafield?.value?.trim();
    if (!value) continue;
    const norm = value.toLowerCase().replace(/\s+/g, " ").slice(0, 200);
    if (seen.has(norm)) continue;
    seen.add(norm);
    const piece = v.title && v.title !== "Default Title" ? `[${v.title}] ${value}` : value;
    pieces.push(piece);
  }
  if (pieces.length === 0) return void 0;
  let aggregated = pieces.join("\n\n");
  if (aggregated.length > VARIANT_DESC_AGGREGATE_CAP) {
    aggregated = aggregated.slice(0, VARIANT_DESC_AGGREGATE_CAP) + "\n\u2026[truncated]";
  }
  return aggregated;
}
async function gatherProductBrief(numericProductId) {
  const snap = await fetchProductSnapshot(numericProductId);
  if (!snap) return null;
  const histRows = await db.select({
    sku: dealHistory.sku,
    brand: dealHistory.brand,
    categories: dealHistory.categories
  }).from(dealHistory).where(eq13(dealHistory.shopifyProductId, numericProductId)).limit(1);
  const hist = histRows[0];
  const sku = hist?.sku;
  const brand = hist?.brand ?? snap.vendor ?? "";
  const categories = hist?.categories ?? [];
  const msrp = Number(snap.metafields["xdipx.original_price"]) || 0;
  const dealPrice = Number(snap.metafields["xdipx.map_price"]) || msrp;
  const pairingCandidates = await getPairingCandidates({
    shopifyProductId: numericProductId,
    subCategories: categories
  }).catch(() => []);
  const rawDescription = snap.aggregatedDescription ?? (snap.body_html ?? "").replace(/<[^>]+>/g, " ").slice(0, 2e3);
  const brief = {
    shopifyProductId: numericProductId,
    rawTitle: snap.title,
    brand,
    vendor: snap.vendor,
    rawDescription,
    categories,
    dealPrice,
    msrp,
    existingMetafields: snap.metafields,
    pairingCandidates: pairingCandidates.map((c) => {
      const pc = {
        productId: c.productId,
        title: c.title
      };
      if (c.brand) pc.brand = c.brand;
      if (c.productTypeDial) pc.productTypeDial = c.productTypeDial;
      if (typeof c.price === "number") pc.price = c.price;
      return pc;
    })
  };
  if (sku) brief.sku = sku;
  return brief;
}
var VARIANT_DESC_AGGREGATE_CAP;
var init_enricher_brief_server = __esm({
  "app/lib/enricher-brief.server.ts"() {
    "use strict";
    init_db_server();
    init_schema();
    init_shopify_server();
    init_dial_registry_server();
    init_ask_emma_vocab_server();
    VARIANT_DESC_AGGREGATE_CAP = 6e3;
  }
});

// app/lib/import-enrich.server.ts
var import_enrich_server_exports = {};
__export(import_enrich_server_exports, {
  applyFullEnrichmentWrites: () => applyFullEnrichmentWrites,
  collectEnrichmentBatch: () => collectEnrichmentBatch,
  publishEnrichedProducts: () => publishEnrichedProducts,
  runImportEnrichTick: () => runImportEnrichTick,
  submitEnrichmentBatch: () => submitEnrichmentBatch
});
import { and as and3, asc as asc3, eq as eq14, inArray as inArray3, isNull as isNull2, sql as sql6 } from "drizzle-orm";
function normalizeIvrExperience(raw) {
  const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return arr.filter((v) => typeof v === "string" && VALID_IVR_EXPERIENCE.has(v));
}
async function isEnrichEnabled() {
  return await getPipelineSetting("import_enrich_enabled") === "true";
}
async function getBatchCap() {
  const raw = await getPipelineSetting("import_enrich_batch_cap");
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BATCH_CAP;
}
function inferCategoryFallback(stored) {
  if (!stored) return ["for-him", "for-her"];
  if (stored.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const valid = /* @__PURE__ */ new Set(["for-him", "for-her", "couples"]);
        return parsed.filter((s) => typeof s === "string" && valid.has(s));
      }
    } catch {
    }
  }
  if (stored === "both") return ["for-him", "for-her"];
  if (stored === "for-him" || stored === "for-her" || stored === "couples") return [stored];
  return ["for-him", "for-her"];
}
function stripDashes(s) {
  return s.replace(/\s*—\s*/g, ", ").replace(/\s*–\s*/g, "-");
}
async function applyFullEnrichmentWrites(numericProductId, writes) {
  const snap = await fetchProductSnapshot(numericProductId);
  if (!snap) throw new Error(`fetchProductSnapshot returned null for ${numericProductId}`);
  const category = inferCategoryFallback(snap.metafields["xdipx.category"]);
  const histRows = await db.select({ categories: dealHistory.categories }).from(dealHistory).where(eq14(dealHistory.shopifyProductId, numericProductId)).limit(1);
  const editorialTags = (histRows[0]?.categories ?? []).filter(
    (c) => !!c && c !== "(uncategorized)"
  );
  const sTagline = ed(writes.tagline);
  const sSeo = ed(writes.seoMetaDescription);
  const sDesc = ed(writes.descriptionHtml);
  const sSpecs = edA(writes.specifications);
  const sCare = edA(writes.careInstructions);
  const sBox = edA(writes.boxContents);
  const section = deriveSection({
    productType: snap.product_type,
    title: snap.title,
    productTypeDial: writes.productTypeDial
  });
  const doc = {
    shopifyProductId: numericProductId,
    category,
    sectionTags: [section],
    tagline: sTagline,
    seoMetaDescription: sSeo,
    descriptionHtml: sDesc,
    moodTags: writes.moodTags,
    audienceTags: writes.audienceTags,
    mattersTags: writes.mattersTags,
    productTypeDial: writes.productTypeDial
  };
  if (writes.productTitleAugmented && writes.productTitle) {
    doc.title = ed(writes.productTitle);
    doc.seoTitle = ed(writes.productTitle);
  }
  if (writes.originalTitle) doc.originalTitle = ed(writes.originalTitle);
  if (writes.productSubtypeDial != null) doc.productSubtypeDial = writes.productSubtypeDial;
  if (writes.sensationDialV2) doc.sensationDialV2 = writes.sensationDialV2;
  if (sSpecs?.length) doc.specifications = sSpecs;
  if (sCare?.length) doc.careInstructions = sCare;
  if (sBox?.length) doc.boxContents = sBox;
  if (writes.emmaHero) doc.emmaHero = writes.emmaHero;
  if (writes.moodImageUrl) doc.moodImageUrl = writes.moodImageUrl;
  await pushProductToShopify(doc);
  try {
    const gid = `gid://shopify/Product/${numericProductId}`;
    const upsertParams = {
      handle: snap.handle,
      shopifyProductId: gid,
      title: doc.title ?? snap.title,
      vendor: snap.vendor,
      category,
      tagline: sTagline,
      description: sDesc,
      seoDescription: sSeo,
      productTypeDial: writes.productTypeDial,
      moodTags: writes.moodTags,
      audienceTags: writes.audienceTags,
      mattersTags: writes.mattersTags
    };
    if (editorialTags.length) upsertParams.tags = editorialTags;
    if (doc.seoTitle) upsertParams.seoTitle = doc.seoTitle;
    if (writes.productSubtypeDial != null) upsertParams.productSubtypeDial = writes.productSubtypeDial;
    if (writes.sensationDialV2) upsertParams.sensationDialV2 = writes.sensationDialV2;
    if (sSpecs?.length) upsertParams.specifications = sSpecs;
    if (sCare?.length) upsertParams.careInstructions = sCare;
    if (sBox?.length) upsertParams.boxContents = sBox;
    const ivrExperience = normalizeIvrExperience(writes.ivrExperience);
    if (ivrExperience.length) upsertParams.ivrExperience = ivrExperience;
    if (writes.ivrUseCase?.length) upsertParams.ivrUseCase = writes.ivrUseCase;
    if (writes.ivrFeatures?.length) upsertParams.ivrFeatures = writes.ivrFeatures;
    if (writes.productFaqs?.length) upsertParams.productFaqs = writes.productFaqs;
    if (writes.originalTitle) upsertParams.originalTitle = writes.originalTitle;
    if (writes.moodImageUrl) upsertParams.moodImageUrl = writes.moodImageUrl;
    const firstImage = snap.images[0]?.src;
    if (firstImage) upsertParams.imageUrl = firstImage;
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await upsertProductPage(upsertParams);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt === 1) await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (lastErr) {
      console.error(`[import-enrich] sanity upsert failed for ${numericProductId}:`, lastErr);
    }
  } catch (err) {
    console.error(`[import-enrich] sanity mirror error for ${numericProductId}:`, err);
  }
}
async function submitEnrichmentBatch(cap) {
  const rows = await db.select({ id: importCandidates.id, productId: dealHistory.shopifyProductId, sku: importCandidates.masterKey }).from(importCandidates).innerJoin(dealHistory, eq14(importCandidates.dealHistoryId, dealHistory.id)).where(and3(
    eq14(importCandidates.status, "imported"),
    isNull2(importCandidates.enrichedAt),
    isNull2(importCandidates.enrichBatchId)
  )).orderBy(asc3(importCandidates.id)).limit(cap);
  const valid = rows.filter((r) => Boolean(r.productId));
  if (valid.length === 0) return { submitted: 0, reason: "no_unenriched" };
  const products = [];
  const candidateIds = [];
  for (const r of valid) {
    const brief = await gatherProductBrief(r.productId);
    if (!brief) {
      console.warn(`[import-enrich] no brief for product ${r.productId} (candidate ${r.id}) -- skipping`);
      continue;
    }
    const sku = brief.sku ?? r.sku;
    const product = {
      title: brief.rawTitle,
      brand: brief.brand,
      description: brief.rawDescription,
      categories: brief.categories,
      dealPrice: brief.dealPrice,
      msrp: brief.msrp
    };
    const validCategoryValues = /* @__PURE__ */ new Set(["for-him", "for-her", "couples"]);
    const category = brief.categories.filter(
      (c) => validCategoryValues.has(c)
    );
    const effectiveCategory = category.length > 0 ? category : ["for-him", "for-her"];
    const pairingCandidates = brief.pairingCandidates.filter((pc) => typeof pc.price === "number").map((pc) => {
      const candidate = {
        productId: pc.productId,
        handle: pc.productId.replace("gid://shopify/Product/", ""),
        title: pc.title,
        price: pc.price
      };
      if (pc.brand) candidate.brand = pc.brand;
      if (pc.productTypeDial) candidate.productTypeDial = pc.productTypeDial;
      return candidate;
    });
    const input = pairingCandidates.length > 0 ? {
      product,
      // Use rawTitle as seoTitle; the orchestrator's generateProductTitle tool
      // will augment it if needed (same as the bulk-import path).
      seoTitle: brief.rawTitle,
      category: effectiveCategory,
      pairingCandidates
    } : {
      product,
      seoTitle: brief.rawTitle,
      category: effectiveCategory
    };
    products.push({ productId: `gid://shopify/Product/${r.productId}`, sku, input });
    candidateIds.push(r.id);
  }
  if (products.length === 0) return { submitted: 0, reason: "no_briefs" };
  const { jobId } = await enqueueBatchJob({
    jobType: "full-enrichment",
    source: "import-product",
    products
  });
  await db.update(importCandidates).set({ enrichBatchId: jobId, updatedAt: /* @__PURE__ */ new Date() }).where(inArray3(importCandidates.id, candidateIds));
  console.log(`[import-enrich] enqueued orchestrator job ${jobId} for ${products.length} product(s)`);
  return { submitted: products.length, batchId: jobId };
}
async function collectEnrichmentBatch() {
  const pendingCandidates = await db.select({
    id: importCandidates.id,
    jobId: importCandidates.enrichBatchId
  }).from(importCandidates).where(and3(
    eq14(importCandidates.status, "imported"),
    isNull2(importCandidates.enrichedAt),
    sql6`${importCandidates.enrichBatchId} IS NOT NULL`
  )).orderBy(asc3(importCandidates.id));
  if (pendingCandidates.length === 0) {
    return { enriched: 0, failed: 0, stillPending: 0 };
  }
  const jobIds = [...new Set(pendingCandidates.map((c) => c.jobId))];
  const jobRows = await db.select({ jobId: batchJobs.jobId, status: batchJobs.status }).from(batchJobs).where(inArray3(batchJobs.jobId, jobIds));
  const jobStatus = new Map(jobRows.map((r) => [r.jobId, r.status]));
  let enrichedTotal = 0;
  let failedTotal = 0;
  let stillPending = 0;
  for (const candidate of pendingCandidates) {
    const jobId = candidate.jobId;
    const status = jobStatus.get(jobId);
    if (!status || status === "queued" || status === "submitted" || status === "processing" || status === "applying") {
      stillPending++;
      continue;
    }
    if (status === "done") {
      await db.update(importCandidates).set({ enrichedAt: /* @__PURE__ */ new Date(), updatedAt: /* @__PURE__ */ new Date() }).where(eq14(importCandidates.id, candidate.id));
      enrichedTotal++;
      console.log(`[import-enrich] candidate ${candidate.id} job ${jobId} done -- stamped enriched_at`);
    } else {
      await db.update(importCandidates).set({ enrichedAt: /* @__PURE__ */ new Date(), updatedAt: /* @__PURE__ */ new Date() }).where(eq14(importCandidates.id, candidate.id));
      failedTotal++;
      console.warn(
        `[import-enrich] candidate ${candidate.id} job ${jobId} failed -- stamping enriched_at to unblock queue (partial writes may apply)`
      );
    }
  }
  return { enriched: enrichedTotal, failed: failedTotal, stillPending };
}
async function publishEnrichedProducts() {
  const rows = await db.select({ id: importCandidates.id, productId: dealHistory.shopifyProductId }).from(importCandidates).innerJoin(dealHistory, eq14(importCandidates.dealHistoryId, dealHistory.id)).where(and3(
    eq14(importCandidates.status, "imported"),
    sql6`${importCandidates.enrichedAt} IS NOT NULL`,
    isNull2(importCandidates.publishedAt)
  ));
  let published = 0;
  let failed = 0;
  for (const r of rows) {
    if (!r.productId) continue;
    try {
      await activateShopifyProduct(r.productId);
      await db.update(importCandidates).set({ publishedAt: /* @__PURE__ */ new Date(), updatedAt: /* @__PURE__ */ new Date() }).where(eq14(importCandidates.id, r.id));
      published++;
    } catch (err) {
      console.error(`[import-enrich] publish failed for product ${r.productId} (candidate ${r.id}):`, err);
      failed++;
    }
  }
  return { published, failed };
}
async function runImportEnrichTick(opts = {}) {
  if (!await isEnrichEnabled()) {
    return { ok: true, skipped: true, reason: "disabled" };
  }
  void opts;
  const collect = await collectEnrichmentBatch();
  const publish = await publishEnrichedProducts();
  let submit = { submitted: 0, reason: "batch_in_flight" };
  const inflightRow = await db.select({ c: sql6`count(*)::int` }).from(batchJobs).where(and3(
    eq14(batchJobs.source, "import-product"),
    inArray3(batchJobs.status, ["queued", "submitted", "processing", "applying"])
  ));
  const inflightCount = Number(inflightRow[0]?.c ?? 0);
  if (inflightCount === 0) {
    submit = await submitEnrichmentBatch(await getBatchCap());
  }
  return { ok: true, collect, publish, submit };
}
var VALID_IVR_EXPERIENCE, DEFAULT_BATCH_CAP, ed, edA;
var init_import_enrich_server = __esm({
  "app/lib/import-enrich.server.ts"() {
    "use strict";
    init_db_server();
    init_schema();
    init_enricher_brief_server();
    init_batch_orchestrator_server();
    init_shopify_server();
    init_sanity_server();
    init_feed_processor_server();
    init_claude_server();
    VALID_IVR_EXPERIENCE = new Set(IVR_EXPERIENCE_LEVELS);
    DEFAULT_BATCH_CAP = 10;
    ed = (s) => s == null ? s : stripDashes(s);
    edA = (a) => a?.map(stripDashes);
  }
});

// app/lib/field-regen-runner.server.ts
var field_regen_runner_server_exports = {};
__export(field_regen_runner_server_exports, {
  advanceFieldRegenJob: () => advanceFieldRegenJob,
  enqueueFieldRegenJob: () => enqueueFieldRegenJob
});
import Anthropic5 from "@anthropic-ai/sdk";
import { eq as eq15 } from "drizzle-orm";
function toDbRunnerState(rs) {
  return rs;
}
function getClient2() {
  return new Anthropic5({ apiKey: process.env["ANTHROPIC_API_KEY"]?.trim() });
}
function buildCustomId(jobId, fieldKey) {
  return `${jobId}::${fieldKey}`;
}
function stripFences2(raw) {
  return raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
}
function buildCopyFieldUserPrompt(type, product, keywordBlock) {
  const productContextBase = `Product: ${product.title}
Brand: ${product.brand}
Description: ${product.description}
Categories: ${product.categories.join(", ")}`;
  const productContext = keywordBlock ? `${productContextBase}

${keywordBlock}` : productContextBase;
  switch (type) {
    case "tagline":
      return {
        model: MODEL_FAST3,
        maxTokens: 512,
        prompt: `Write 3 one-sentence taglines for the following product. Emma voice \u2014 observational, casual, lightly witty. Think: a trusted friend who's recommending it, not a stand-up comedian. Avoid punchline-shaped puns and ad-copy zingers. Fragments are welcome ("the one I keep recommending", "earns its spot daily", "quietly indispensable"). First person OK. Max 12 words each. NO em-dashes. NO \u2665 glyph (reserve it for CTAs and asides). If any keyword targets in the prompt do not fit this product, IGNORE them silently \u2014 write from product details only. Never narrate a mismatch, never preface, never explain. Return as a JSON array of strings (no markdown).

${productContext}`
      };
    case "full_story":
      return {
        model: MODEL4,
        maxTokens: 1024,
        prompt: `Write a short, punchy product description in xdipx brand voice. Return valid HTML only \u2014 use <p> tags for paragraphs, <strong> for emphasis, <em> for playful asides, <ul>/<li> for bullets. No <html>, <head>, <body> tags. No headings.

Format: EXACTLY 2 short paragraphs (3\u20134 sentences each) followed by a <ul> with 6\u201310 benefit bullets.

Tone: funny, cheeky, a little raunchy \u2014 innuendo is welcome, tasteful dirty jokes are great, but nothing gross or clinical. Think: your funniest friend who sells pleasure products and has zero shame. Make the reader smile AND want to buy.

Do NOT include: price, shipping, dimensions, materials, or any technical specs (those live in a separate Specs tab).
Do NOT start with the product name.

${productContext}`
      };
    case "both_ways":
      return {
        model: MODEL4,
        maxTokens: 1024,
        prompt: `Write two sections for the xdipx "Both Ways \u2665" tab (60\u201390 words each). Return valid HTML \u2014 use <p> tags, <strong> for emphasis, <em> for playful asides. No headings. Return as JSON with keys "forHim" and "forHer", each containing an HTML string.

STRATEGY \u2014 read the product categories carefully:

If the product is primarily FOR HER (vibrators, rabbits, clit stimulators, air pulse, etc.):
- "forHer": Genuine, warm, compelling sell written directly TO women. Speak to her pleasure, her curiosity, her experience. Make her feel seen and excited. This is the hero section.
- "forHim": Humorous angle \u2014 he can't use it directly but here's why he should buy it anyway.

If the product is primarily FOR HIM (strokers, masturbators, prostate toys, etc.):
- "forHim": Genuine, warm, compelling sell written directly TO men.
- "forHer": Humorous angle \u2014 she can't use it directly but here's why she should be excited about it.

If the product works for both or is a couples toy: write genuine, enthusiastic content for each.

${productContext}`
      };
    case "seo_meta":
      return {
        model: MODEL_FAST3,
        maxTokens: 512,
        prompt: `Write a 140\u2013155 character SEO meta description for this product. This shows in Google SERP and link previews \u2014 drives click-through.

Two anchors to include (Emma voice within these constraints):
  (a) Trust beat: "Ships discreetly" \u2014 keeps the discretion signal in SERP
  (b) Benefit beat in light Emma voice \u2014 fragment OK, first-person OK, no marketing fluff

NEVER mention price, discount, or any dollar amount. Prices change; this copy is durable.

If any keyword targets in this prompt don't actually fit the product, IGNORE them silently and write the description from the product details only \u2014 never narrate the mismatch, never preface, never explain. Output exactly the description and nothing else.

Voice: light Emma \u2014 observational, warm, specific. Not a generic SEO template. Brand mentions written as "XDIPX" (uppercase). NO em-dashes ("\u2014" or "\u2013"). Return ONLY the meta description text \u2014 no quotes, no labels.

${productContext}`
      };
    case "specifications":
      return {
        model: MODEL_FAST3,
        maxTokens: 1024,
        prompt: `Extract the technical specifications from this product description as a JSON array of "Label: Value" bullet pairs. Each entry is a single short string with the label, a colon, and the value (e.g. "Color: Black", "Material: Body-safe silicone", "Battery life: 90 minutes per charge").

Include only objective facts surfaced in the description: dimensions, materials, power source, charge time, run time, waterproofing, colors, weight, controls, country of origin. Skip categories the source doesn't mention \u2014 better fewer accurate specs than padded ones. NEVER include price, discount, or dollar amounts.

Voice: factual and concise. No fluff, no marketing copy, no Emma asides. Each value 4\u201380 chars.

Return ONLY a JSON array of strings, max 12 entries. No markdown, no prose, no wrapper.

Example: ["Color: Black", "Material: Nylon straps with padded cuffs", "Includes: 4 cuffs and restraint straps", "Fit: Universal mattress sizes"]

${productContext}`
      };
    case "box_contents":
      return {
        model: MODEL_FAST3,
        maxTokens: 512,
        prompt: `Extract what is physically included in the box for this product from the description below. Return a JSON array of short strings (one item per element), e.g. ["1x vibrator", "1x USB charging cable", "1x storage pouch"]. If the description doesn't mention box contents, infer the most likely inclusions based on the product type. Return only the JSON array, no markdown.

${productContext}`
      };
    case "bullets":
      return {
        model: MODEL_FAST3,
        maxTokens: 512,
        prompt: `Write 4\u20136 feature bullet points for this product. Short, specific, benefit-first. No fluff. Return as a JSON array of strings.

${productContext}`
      };
    default:
      return {
        model: MODEL_FAST3,
        maxTokens: 512,
        prompt: `Write copy for copy type "${type}" for this product in xdipx brand voice. Return JSON.

${productContext}`
      };
  }
}
function buildEmmaHeroUserPrompt(ctx) {
  const { deal, variant } = ctx;
  const discountPct = deal.msrp > 0 && deal.dealPrice > 0 ? Math.round((deal.msrp - deal.dealPrice) / deal.msrp * 100) : 0;
  const mapLine = deal.mapRestricted ? "MAP-restricted \u2014 no discount claims, no percent-off language, no struck prices." : discountPct > 0 ? `Currently ${discountPct}% off MSRP \u2014 you may allude to value, but never in "buy now" or countdown language.` : "";
  const prompt = `Write the Emma hero block for the homepage of xdipx.com. Variant: "${variant}".

Product context (do NOT echo \u2014 rewrite in Emma's voice):
- Title: ${deal.seoTitle}
- Brand: ${deal.brand}
- Category: ${deal.category.join(", ")}
${deal.tagline ? `- Existing tagline (for context only): ${deal.tagline}` : ""}
${deal.fullStory ? `- Full story (context only, strip HTML): ${deal.fullStory.replace(/<[^>]+>/g, " ").slice(0, 400)}` : ""}
${mapLine}

Return ONLY this JSON (no markdown):
{
  "eyebrow":   "A DYNAMIC FEELING in Emma's own voice \u2014 2\u20134 words, first-person, informal. Examples: 'Kinda obsessed', 'Low-key amazed', 'Still thinking about this', 'Quietly sold', 'Actually impressed'. No period. Do NOT use 'Currently loving' or generic editorial phrases like 'This week's pick'. Must feel like a quick reaction, not a label.",
  "headline":  "ONE sentence (8\u201314 words) that explains WHY Emma is featuring this pick right now \u2014 the reason it earned the slot. First-person, specific, warm. Never starts with the product name. Never 'buy now'. Example shape: 'Something about how quiet this one is just broke my brain.'",
  "body":      "1\u20132 short sentences (25\u201345 words total) \u2014 the highlights a shopper should know. What it feels like, what stands out, what surprised her. Tight and specific. No marketing bloat. No clinical language.",
  "aside":     "'\u2014 Emma \xB7 <3\u20136 word aside>', e.g. '\u2014 Emma \xB7 still on my desk'"${variant === "quote" ? `,
  "pullQuote": "one short pull-quote (6\u201312 words) \u2014 in quotes \u2014 a friend-to-friend endorsement. No price or discount language."` : ""}
}`;
  return { prompt, model: MODEL4, maxTokens: 800 };
}
function buildEmmaTakeUserPrompt(ctx) {
  const { deal } = ctx;
  const prompt = `Write Emma's "take" on this product. It appears at the top of the PDP \u2014 a friend-to-friend honest read. This is THE customer-facing voice surface; treat it accordingly.

Product:
- Title: ${deal.seoTitle}
- Brand: ${deal.brand}
- Category: ${deal.category.join(", ")}
${deal.productTypeDial ? `- Type: ${deal.productTypeDial}` : ""}
${deal.tagline ? `- Tagline (context only \u2014 DO NOT echo in first sentence): ${deal.tagline}` : ""}
${deal.fullStory ? `- Existing story (context, strip HTML): ${deal.fullStory.replace(/<[^>]+>/g, " ").slice(0, 600)}` : ""}

Cover, in this order, in your own voice (no headings, just flowing paragraphs):
1. Who this clicks for \u2014 what they're after, what they'll like.
2. Why it's worth exploring \u2014 what makes it intriguing, approachable, or fun to try. POSITIVE INVITATION. NEVER tell anyone to skip this product. NEVER gatekeep.
3. How to get the most out of it \u2014 a tip Emma would whisper to a friend.

Constraints:
- Under 100 words total. One paragraph (or two very short ones, max). The PDP shows this above a "...more" expand fold; staying tight means readers see all three beats without clicking.
- Return clean HTML \u2014 only <p>, <em>, <strong> tags. No headings, no <ul>, no inline styles, no class attrs.
- First-person Emma voice throughout. Present tense. No "Buy now". No countdowns. No clinical language.
- Do NOT mention price, MAP, or discounts.
- Do NOT echo the product title OR tagline in the first sentence.
- "sex" and "sexy" are allowed where contextually relevant to the product and customer discovery (e.g. "sex toy", "safer sex", "sexy gift"). Default to "intimate"/"pleasure"/"wellness" for general voice.
- NO em-dashes ("\u2014" or "\u2013"). Use periods, commas, or parentheses.

Return ONLY the HTML \u2014 no markdown, no fences, no preamble.`;
  return { prompt, model: MODEL4, maxTokens: 800 };
}
async function advanceFieldRegenJob(job) {
  const outcome = {};
  const rs = job.runnerState;
  const meta = rs["__meta"];
  switch (job.status) {
    case "queued": {
      const context = meta?.context ?? job.products[0]?.input;
      if (!context) {
        throw new Error(`[field-regen] job ${job.jobId}: no context in runnerState['__meta'] or products[0].input`);
      }
      let systemBlocks;
      if (context.kind === "copy-fields") {
        systemBlocks = [{ text: BRAND_VOICE_SYSTEM_PROMPT, cache: true }];
      } else {
        const brandVoice = await getPipelineSetting("brandVoice") ?? void 0;
        systemBlocks = [...await buildEmmaSystemBlocks(brandVoice)];
      }
      const fieldPrompts = [];
      if (context.kind === "copy-fields") {
        for (const type of context.fields) {
          const { prompt, model, maxTokens } = buildCopyFieldUserPrompt(type, context.product, "");
          fieldPrompts.push({ fieldKey: type, prompt, model, maxTokens });
        }
      } else if (context.kind === "emma-hero") {
        const { prompt, model, maxTokens } = buildEmmaHeroUserPrompt(context);
        fieldPrompts.push({ fieldKey: "emma-hero", prompt, model, maxTokens });
      } else {
        const { prompt, model, maxTokens } = buildEmmaTakeUserPrompt(context);
        fieldPrompts.push({ fieldKey: "emma-take", prompt, model, maxTokens });
      }
      const newRunnerState = {
        "__meta": {
          jobKind: "field-regen",
          context,
          systemBlocks,
          fields: fieldPrompts.map((f) => f.fieldKey)
        }
      };
      for (const f of fieldPrompts) {
        newRunnerState[f.fieldKey] = {
          prompt: f.prompt,
          model: f.model,
          maxTokens: f.maxTokens
        };
      }
      await db.update(batchJobs).set({ runnerState: toDbRunnerState(newRunnerState), updatedAt: /* @__PURE__ */ new Date() }).where(eq15(batchJobs.jobId, job.jobId));
      const client4 = getClient2();
      const requests = [];
      const systemParam = systemBlocks.map((b) => ({
        type: "text",
        text: b.text,
        ...b.cache ? { cache_control: { type: "ephemeral" } } : {}
      }));
      for (const f of fieldPrompts) {
        requests.push({
          custom_id: buildCustomId(job.jobId, f.fieldKey),
          params: {
            model: f.model,
            max_tokens: f.maxTokens,
            system: systemParam,
            messages: [{ role: "user", content: f.prompt }]
          }
        });
      }
      const batch = await client4.messages.batches.create({ requests });
      const batchIds = [batch.id];
      await db.update(batchJobs).set({
        status: "submitted",
        currentBatchId: batch.id,
        batchIds,
        runnerState: toDbRunnerState(newRunnerState),
        submittedAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      }).where(eq15(batchJobs.jobId, job.jobId));
      outcome.submitted = true;
      console.log(`[field-regen] job ${job.jobId} submitted batch ${batch.id} (${requests.length} requests)`);
      break;
    }
    case "submitted":
    case "processing": {
      if (!job.currentBatchId) {
        console.error(`[field-regen] job ${job.jobId} in ${job.status} with no currentBatchId`);
        break;
      }
      const client4 = getClient2();
      const batch = await client4.messages.batches.retrieve(job.currentBatchId);
      if (batch.processing_status !== "ended") {
        await db.update(batchJobs).set({ status: "processing", updatedAt: /* @__PURE__ */ new Date() }).where(eq15(batchJobs.jobId, job.jobId));
        break;
      }
      const responses = /* @__PURE__ */ new Map();
      const stream = await client4.messages.batches.results(job.currentBatchId);
      for await (const entry of stream) {
        responses.set(entry.custom_id, entry);
      }
      const updatedRs = { ...rs };
      const metaState = updatedRs["__meta"];
      let inputTokens = 0, outputTokens = 0, cacheCreation = 0, cacheRead = 0;
      for (const fieldKey of metaState.fields) {
        const customId = buildCustomId(job.jobId, fieldKey);
        const entry = responses.get(customId);
        const fs = updatedRs[fieldKey];
        if (!fs) continue;
        if (!entry || entry.result.type !== "succeeded") {
          const errMsg = entry ? `batch result type: ${entry.result.type}` : "no result for custom_id";
          updatedRs[fieldKey] = { ...fs, error: errMsg };
          continue;
        }
        const msg = entry.result.message;
        const block = msg.content[0];
        const rawText = block?.type === "text" ? block.text : "";
        const u = msg.usage;
        inputTokens += u.input_tokens;
        outputTokens += u.output_tokens;
        cacheCreation += u.cache_creation_input_tokens ?? 0;
        cacheRead += u.cache_read_input_tokens ?? 0;
        const result = parseFieldResult(fieldKey, rawText, metaState.context);
        updatedRs[fieldKey] = { ...fs, rawText, result };
      }
      if (inputTokens > 0) {
        void logApiTokens({
          feature: "copy-gen",
          model: MODEL4,
          source: "batch",
          batchId: job.currentBatchId,
          requestCount: metaState.fields.length,
          inputTokens,
          outputTokens,
          cacheCreationTokens: cacheCreation,
          cacheReadTokens: cacheRead,
          caller: "field-regen"
        });
      }
      await db.update(batchJobs).set({
        status: "applying",
        currentBatchId: null,
        runnerState: toDbRunnerState(updatedRs),
        updatedAt: /* @__PURE__ */ new Date()
      }).where(eq15(batchJobs.jobId, job.jobId));
      break;
    }
    case "applying": {
      const metaState = rs["__meta"];
      if (!metaState) {
        throw new Error(`[field-regen] job ${job.jobId}: missing __meta in runnerState during applying`);
      }
      const ctx = metaState.context;
      const updatedRs = { ...rs };
      let appliedCount = 0;
      let anyError = false;
      for (const fieldKey of metaState.fields) {
        const fs = updatedRs[fieldKey];
        if (!fs || fs.applied) continue;
        if (fs.error) {
          anyError = true;
          continue;
        }
        try {
          await applyFieldResult(fieldKey, fs.result, ctx);
          updatedRs[fieldKey] = { ...fs, applied: true };
          appliedCount++;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          updatedRs[fieldKey] = { ...fs, error: `apply failed: ${errMsg}` };
          anyError = true;
        }
      }
      outcome.applied = appliedCount;
      const allDone = metaState.fields.every((k) => {
        const fs = updatedRs[k];
        return fs?.applied || fs?.error;
      });
      if (allDone) {
        const finalStatus = anyError ? "failed" : "done";
        await db.update(batchJobs).set({
          status: finalStatus,
          runnerState: toDbRunnerState(updatedRs),
          completedAt: /* @__PURE__ */ new Date(),
          updatedAt: /* @__PURE__ */ new Date()
        }).where(eq15(batchJobs.jobId, job.jobId));
        if (finalStatus === "done") outcome.done = true;
        else outcome.failed = true;
      } else {
        await db.update(batchJobs).set({ runnerState: toDbRunnerState(updatedRs), updatedAt: /* @__PURE__ */ new Date() }).where(eq15(batchJobs.jobId, job.jobId));
      }
      break;
    }
    case "done":
    case "failed":
      break;
  }
  return outcome;
}
function parseFieldResult(fieldKey, rawText, ctx) {
  const stripped = stripFences2(rawText);
  if (ctx.kind === "emma-hero" && fieldKey === "emma-hero") {
    try {
      return JSON.parse(stripped);
    } catch {
      return { rawText };
    }
  }
  if (ctx.kind === "emma-take" && fieldKey === "emma-take") {
    return stripped;
  }
  switch (fieldKey) {
    case "tagline":
    case "bullets":
    case "box_contents":
    case "specifications": {
      try {
        const parsed = JSON.parse(stripped);
        if (Array.isArray(parsed)) return parsed;
      } catch {
      }
      return [stripped];
    }
    case "both_ways": {
      try {
        const parsed = JSON.parse(stripped);
        if (parsed.forHim && parsed.forHer) return parsed;
      } catch {
      }
      return { forHim: "<p>Content unavailable.</p>", forHer: "<p>Content unavailable.</p>" };
    }
    case "seo_meta":
    case "full_story":
    default:
      return stripped;
  }
}
async function applyFieldResult(fieldKey, result, ctx) {
  const productId = ctx.productId;
  if (ctx.kind === "emma-hero" && fieldKey === "emma-hero") {
    const copy = result;
    if (!copy.eyebrow || !copy.headline || !copy.body || !copy.aside) {
      throw new Error("emma-hero: incomplete parsed fields");
    }
    await updateProductMetafield(productId, "emma_hero", JSON.stringify({ ...copy, generatedAt: (/* @__PURE__ */ new Date()).toISOString() }), "json");
    if (copy.aside) {
      await updateProductMetafield(productId, "tagline", copy.aside, "single_line_text_field");
    }
    return;
  }
  if (ctx.kind === "emma-take" && fieldKey === "emma-take") {
    if (ctx.dryRun) return;
    await updateProductDescriptionHtml(productId, result);
    return;
  }
  const type = fieldKey;
  switch (type) {
    case "tagline": {
      const arr = Array.isArray(result) ? result : [result];
      const val = arr[0]?.trim() ?? "";
      if (val) await updateProductMetafield(productId, "tagline", val, "single_line_text_field");
      break;
    }
    case "full_story": {
      const html = result;
      if (html) await updateProductMetafield(productId, "full_story", html, "multi_line_text_field");
      break;
    }
    case "both_ways": {
      const bw = result;
      if (bw.forHim) await updateProductMetafield(productId, "works_for_him", bw.forHim, "multi_line_text_field");
      if (bw.forHer) await updateProductMetafield(productId, "works_for_her", bw.forHer, "multi_line_text_field");
      break;
    }
    case "seo_meta": {
      const meta = result;
      if (meta) await updateProductMetafield(productId, "seo_meta_description", meta, "multi_line_text_field");
      break;
    }
    case "specifications": {
      const specs = Array.isArray(result) ? result : [];
      await updateProductMetafield(productId, "specifications", JSON.stringify(specs), "json");
      break;
    }
    case "box_contents": {
      const items = Array.isArray(result) ? result : [];
      await updateProductMetafield(productId, "box_contents", JSON.stringify(items), "json");
      break;
    }
    case "bullets": {
      break;
    }
    default:
      console.warn(`[field-regen] no apply handler for field type "${type}" \u2014 skipping`);
  }
}
async function enqueueFieldRegenJob(context) {
  const { enqueueBatchJob: enqueueBatchJob2 } = await Promise.resolve().then(() => (init_batch_orchestrator_server(), batch_orchestrator_server_exports));
  const sku = context.sku;
  const productId = context.productId;
  const sourceMap = {
    "copy-fields": "regen-fields",
    "emma-hero": "regen-emma-hero",
    "emma-take": "regen-emma-take"
  };
  const result = await enqueueBatchJob2({
    jobType: "field-regen",
    source: sourceMap[context.kind],
    products: [{ productId, sku, input: context }],
    maxTurns: 1
    // field-regen is always a single-shot; maxTurns=1 satisfies the schema, not used by runner
  });
  const brandVoice = context.kind !== "copy-fields" ? await getPipelineSetting("brandVoice") ?? void 0 : void 0;
  const systemBlocks = context.kind === "copy-fields" ? [{ text: BRAND_VOICE_SYSTEM_PROMPT, cache: true }] : [...await buildEmmaSystemBlocks(brandVoice)];
  const fields = context.kind === "copy-fields" ? context.fields.map((f) => f) : context.kind === "emma-hero" ? ["emma-hero"] : ["emma-take"];
  const meta = { jobKind: "field-regen", context, systemBlocks, fields };
  const runnerState = { "__meta": meta };
  await db.update(batchJobs).set({ runnerState: toDbRunnerState(runnerState), updatedAt: /* @__PURE__ */ new Date() }).where(eq15(batchJobs.jobId, result.jobId));
  return result;
}
var MODEL4, MODEL_FAST3;
var init_field_regen_runner_server = __esm({
  "app/lib/field-regen-runner.server.ts"() {
    "use strict";
    init_db_server();
    init_schema();
    init_token_log_server();
    init_shopify_server();
    init_claude_server();
    init_feed_processor_server();
    init_models_server();
    MODEL4 = SONNET;
    MODEL_FAST3 = "claude-haiku-4-5-20251001";
  }
});

// app/lib/batch-orchestrator.server.ts
var batch_orchestrator_server_exports = {};
__export(batch_orchestrator_server_exports, {
  advanceInflightJobs: () => advanceInflightJobs,
  enqueueBatchJob: () => enqueueBatchJob,
  getBatchJobById: () => getBatchJobById,
  listRecentBatchJobs: () => listRecentBatchJobs
});
import { randomUUID as randomUUID2 } from "node:crypto";
import Anthropic6 from "@anthropic-ai/sdk";
import { eq as eq16, inArray as inArray4 } from "drizzle-orm";
function getClient3() {
  return new Anthropic6({ apiKey: process.env["ANTHROPIC_API_KEY"]?.trim() });
}
async function enqueueBatchJob(args) {
  const jobId = randomUUID2();
  const products = args.products.map((p) => {
    const { llmClient: _omit, ...inputWithoutClient } = p.input;
    return {
      productId: p.productId,
      sku: p.sku,
      input: inputWithoutClient,
      via: "batch"
    };
  });
  const skuList = products.map((p) => p.sku);
  await db.insert(batchJobs).values({
    jobId,
    jobType: args.jobType,
    status: "queued",
    source: args.source,
    skuList,
    products,
    turn: 0,
    maxTurns: args.maxTurns ?? 24,
    batchIds: [],
    runnerState: {},
    appliedSkus: [],
    ...args.gatesDealId !== void 0 ? { gatesDealId: args.gatesDealId } : {}
  });
  try {
    const summary = {
      jobId,
      jobType: args.jobType,
      status: "queued",
      source: args.source,
      skuList,
      turn: 0,
      maxTurns: args.maxTurns ?? 24,
      currentBatchId: null,
      gatesDealId: args.gatesDealId ?? null,
      appliedSkus: [],
      productStatuses: Object.fromEntries(products.map((p) => [p.sku, "running"]))
    };
    await kvSet(KV_KEYS.enrichmentJob(jobId), summary, KV_TTL_SECONDS2);
  } catch (err) {
    console.warn("[batch-orchestrator] KV mirror failed (non-fatal):", err);
  }
  console.log(`[batch-orchestrator] enqueued job ${jobId} type=${args.jobType} skus=[${skuList.join(",")}]`);
  return { jobId };
}
async function advanceInflightJobs(opts = {}) {
  const maxJobs = opts.maxJobs ?? 10;
  const rows = await db.select().from(batchJobs).where(inArray4(batchJobs.status, ["queued", "submitted", "processing", "applying"])).orderBy(batchJobs.updatedAt).limit(maxJobs);
  const result = { advanced: 0, submitted: 0, applied: 0, done: 0, failed: 0 };
  for (const job of rows) {
    try {
      const outcome = await advanceJob(job);
      result.advanced++;
      if (outcome.submitted) result.submitted++;
      if (outcome.applied) result.applied += outcome.applied;
      if (outcome.done) result.done++;
      if (outcome.failed) result.failed++;
    } catch (err) {
      console.error(`[batch-orchestrator] advanceJob ${job.jobId} threw:`, err);
      await db.update(batchJobs).set({ status: "failed", error: String(err), failedAt: /* @__PURE__ */ new Date(), updatedAt: /* @__PURE__ */ new Date() }).where(eq16(batchJobs.jobId, job.jobId));
      result.failed++;
    }
  }
  return result;
}
async function advanceJob(job) {
  if (job.jobType === "field-regen") {
    const { advanceFieldRegenJob: advanceFieldRegenJob2 } = await Promise.resolve().then(() => (init_field_regen_runner_server(), field_regen_runner_server_exports));
    const r = await advanceFieldRegenJob2(job);
    const out = {};
    if (r.submitted !== void 0) out.submitted = r.submitted;
    if (r.applied !== void 0) out.applied = r.applied;
    if (r.done !== void 0) out.done = r.done;
    if (r.failed !== void 0) out.failed = r.failed;
    return out;
  }
  const outcome = {};
  switch (job.status) {
    case "queued": {
      const runnerState = {};
      for (const p of job.products) {
        runnerState[p.productId] = freshRunnerState(p, job.jobId);
      }
      await db.update(batchJobs).set({ runnerState, updatedAt: /* @__PURE__ */ new Date() }).where(eq16(batchJobs.jobId, job.jobId));
      const updatedJob = { ...job, runnerState };
      await submitTurnBatch(updatedJob);
      outcome.submitted = true;
      break;
    }
    case "submitted":
    case "processing": {
      if (!job.currentBatchId) {
        console.error(`[batch-orchestrator] job ${job.jobId} in ${job.status} with no currentBatchId`);
        break;
      }
      const client4 = getClient3();
      const batch = await client4.messages.batches.retrieve(job.currentBatchId);
      if (batch.processing_status !== "ended") {
        await db.update(batchJobs).set({ status: "processing", updatedAt: /* @__PURE__ */ new Date() }).where(eq16(batchJobs.jobId, job.jobId));
        break;
      }
      const responses = /* @__PURE__ */ new Map();
      const stream = await client4.messages.batches.results(job.currentBatchId);
      for await (const entry of stream) {
        responses.set(entry.custom_id, entry);
      }
      const [sharedDialRegistry, sharedDialTaxonomy, sharedVocab] = await Promise.all([
        getDialRegistry(),
        getDialTaxonomy(),
        getAskEmmaVocabulary()
      ]);
      const runnerState = { ...job.runnerState };
      let turnInputTokens = 0;
      let turnOutputTokens = 0;
      let turnCacheCreation = 0;
      let turnCacheRead = 0;
      let turnCount = 0;
      for (const p of job.products) {
        const ps = runnerState[p.productId];
        if (!ps || ps.finished) continue;
        if (ps.lastProcessedBatchId === job.currentBatchId) continue;
        const cid = buildCustomId2(job.jobId, p.productId);
        const entry = responses.get(cid);
        if (!entry || entry.result.type !== "succeeded") {
          if (entry?.result.type === "expired") {
            if (ps.requestRetries < 2) {
              runnerState[p.productId] = {
                ...ps,
                requestRetries: ps.requestRetries + 1,
                messages: [{ role: "user", content: buildUserPrompt(p.input) }],
                turns: 0,
                lastProcessedBatchId: job.currentBatchId
              };
            } else {
              runnerState[p.productId] = {
                ...ps,
                status: "error",
                error: `expired x${ps.requestRetries + 1}`,
                finished: true,
                lastProcessedBatchId: job.currentBatchId
              };
            }
          } else if ((entry?.result.type === "errored" || entry?.result.type === "canceled") && ps.requestRetries < 2) {
            runnerState[p.productId] = {
              ...ps,
              requestRetries: ps.requestRetries + 1,
              lastProcessedBatchId: job.currentBatchId
            };
          } else {
            const errDesc = entry ? `batch ${entry.result.type}: ${entry.result.type === "errored" ? entry.result.error.error.message : entry.result.type}` : "no result for custom_id";
            runnerState[p.productId] = {
              ...ps,
              status: "error",
              error: errDesc,
              finished: true,
              lastProcessedBatchId: job.currentBatchId
            };
          }
          await db.update(batchJobs).set({ runnerState, updatedAt: /* @__PURE__ */ new Date() }).where(eq16(batchJobs.jobId, job.jobId));
          continue;
        }
        const msg = entry.result.message;
        const u = msg.usage;
        turnInputTokens += u.input_tokens;
        turnOutputTokens += u.output_tokens;
        turnCacheCreation += u.cache_creation_input_tokens ?? 0;
        turnCacheRead += u.cache_read_input_tokens ?? 0;
        turnCount++;
        const updatedMessages = [...ps.messages, { role: "assistant", content: msg.content }];
        const toolUses = msg.content.filter((b) => b.type === "tool_use");
        if (toolUses.length === 0) {
          runnerState[p.productId] = {
            ...ps,
            messages: updatedMessages,
            finished: true,
            status: "done",
            lastProcessedBatchId: job.currentBatchId
          };
          await db.update(batchJobs).set({ runnerState, updatedAt: /* @__PURE__ */ new Date() }).where(eq16(batchJobs.jobId, job.jobId));
          continue;
        }
        const state = stateFor(ps, p, {
          dialRegistry: structuredClone(sharedDialRegistry),
          dialTaxonomy: structuredClone(sharedDialTaxonomy),
          vocab: structuredClone(sharedVocab)
        });
        const toolResults = [];
        for (const tu of toolUses) {
          if (ps.calledTools.includes(tu.name)) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify({ ok: false, summary: `${tu.name} already called -- skipping duplicate` })
            });
            continue;
          }
          ps.calledTools.push(tu.name);
          const start = Date.now();
          let ok = false;
          let summary = "";
          let errorMsg;
          drainToolTokens();
          try {
            const r = await executeTool(tu.name, state);
            ok = r.ok;
            summary = r.summary;
          } catch (err) {
            errorMsg = err instanceof Error ? err.message : String(err);
            summary = `tool error: ${errorMsg}`;
          } finally {
            const tt = drainToolTokens();
            ps.telemetry = ps.telemetry;
            const tel = ps.telemetry;
            tel.totalInputTokens = (tel.totalInputTokens ?? 0) + tt.input;
            tel.totalOutputTokens = (tel.totalOutputTokens ?? 0) + tt.output;
            tel.totalCacheCreationTokens = (tel.totalCacheCreationTokens ?? 0) + tt.cacheCreation;
            tel.totalCacheReadTokens = (tel.totalCacheReadTokens ?? 0) + tt.cacheRead;
            const toolCalls = Array.isArray(tel.toolCalls) ? tel.toolCalls : [];
            toolCalls.push({
              name: tu.name,
              durationMs: Date.now() - start,
              inputTokens: tt.input,
              outputTokens: tt.output,
              ok,
              ...errorMsg ? { error: errorMsg } : {}
            });
            tel.toolCalls = toolCalls;
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify({ ok, summary }),
            ...errorMsg ? { is_error: true } : {}
          });
          if (state.finished) ps.finished = true;
        }
        if (state.dialRegistry) {
          Object.assign(sharedDialRegistry, state.dialRegistry);
        }
        ps.writes = state.writes;
        const finalMessages = [
          ...updatedMessages,
          { role: "user", content: toolResults }
        ];
        if (msg.stop_reason === "end_turn") ps.finished = true;
        if (ps.finished) ps.status = "done";
        runnerState[p.productId] = {
          ...ps,
          messages: finalMessages,
          lastProcessedBatchId: job.currentBatchId
        };
        await db.update(batchJobs).set({ runnerState, updatedAt: /* @__PURE__ */ new Date() }).where(eq16(batchJobs.jobId, job.jobId));
      }
      if (turnCount > 0) {
        void logApiTokens({
          feature: "enrichment",
          model: MODEL5,
          source: "batch",
          batchId: job.currentBatchId,
          requestCount: turnCount,
          inputTokens: turnInputTokens,
          outputTokens: turnOutputTokens,
          cacheCreationTokens: turnCacheCreation,
          cacheReadTokens: turnCacheRead
        });
      }
      const nowTurn = job.turn + 1;
      for (const p of job.products) {
        const ps = runnerState[p.productId];
        if (ps && !ps.finished && ps.status === "running" && ps.turns >= job.maxTurns) {
          runnerState[p.productId] = { ...ps, finished: true, status: "done" };
        }
      }
      const stillRunning = job.products.filter((p) => {
        const ps = runnerState[p.productId];
        return ps && !ps.finished && ps.status === "running" && ps.turns < job.maxTurns;
      });
      if (stillRunning.length === 0) {
        await db.update(batchJobs).set({
          status: "applying",
          currentBatchId: null,
          turn: nowTurn,
          runnerState,
          updatedAt: /* @__PURE__ */ new Date()
        }).where(eq16(batchJobs.jobId, job.jobId));
      } else {
        const updatedJob = {
          ...job,
          turn: nowTurn,
          runnerState,
          currentBatchId: null
        };
        await submitTurnBatch(updatedJob);
        outcome.submitted = true;
      }
      break;
    }
    case "applying": {
      const runnerState = { ...job.runnerState };
      const appliedSkus = [...job.appliedSkus ?? []];
      const results = [...job.results ?? []];
      let appliedThisTick = 0;
      for (const p of job.products) {
        const ps = runnerState[p.productId];
        if (!ps || !ps.finished) continue;
        if (ps.status === "error" && !ps.writes) continue;
        if (appliedSkus.includes(p.sku)) continue;
        try {
          const numericId = p.productId.replace("gid://shopify/Product/", "");
          const writes = assembleWrites(
            ps.writes,
            ps.telemetry
          );
          await applyFullEnrichmentWrites(numericId, writes);
          appliedSkus.push(p.sku);
          appliedThisTick++;
          const idx = results.findIndex((r) => r.productId === p.productId);
          const resultEntry = { productId: p.productId, sku: p.sku, ok: true, writesApplied: true };
          if (idx >= 0) results[idx] = resultEntry;
          else results.push(resultEntry);
          runnerState[p.productId] = { ...ps, applyRetries: 0 };
          await db.update(batchJobs).set({ appliedSkus, results, runnerState, updatedAt: /* @__PURE__ */ new Date() }).where(eq16(batchJobs.jobId, job.jobId));
        } catch (err) {
          const applyRetries = (ps.applyRetries ?? 0) + 1;
          const errMsg = err instanceof Error ? err.message : String(err);
          runnerState[p.productId] = { ...ps, applyRetries };
          const idx = results.findIndex((r) => r.productId === p.productId);
          const resultEntry = {
            productId: p.productId,
            sku: p.sku,
            ok: false,
            applyRetries,
            error: errMsg
          };
          if (idx >= 0) results[idx] = resultEntry;
          else results.push(resultEntry);
          if (applyRetries >= 3) {
            runnerState[p.productId] = {
              ...ps,
              applyRetries,
              status: "error",
              error: `apply-permafail: ${errMsg}`
            };
          }
          await db.update(batchJobs).set({ results, runnerState, updatedAt: /* @__PURE__ */ new Date() }).where(eq16(batchJobs.jobId, job.jobId));
        }
      }
      outcome.applied = appliedThisTick;
      const pending = job.products.filter((p) => {
        const ps = runnerState[p.productId];
        if (!ps) return false;
        if (ps.status === "error") return false;
        return !appliedSkus.includes(p.sku);
      });
      if (pending.length === 0) {
        if (job.gatesDealId) {
          await maybeActivateGatedDeal(job.jobId, job.gatesDealId);
        }
        const anyHardError = Object.values(runnerState).some((ps) => ps.status === "error");
        const finalStatus = anyHardError ? "failed" : "done";
        await db.update(batchJobs).set({
          status: finalStatus,
          results,
          runnerState,
          appliedSkus,
          completedAt: /* @__PURE__ */ new Date(),
          updatedAt: /* @__PURE__ */ new Date()
        }).where(eq16(batchJobs.jobId, job.jobId));
        if (finalStatus === "done") outcome.done = true;
        else outcome.failed = true;
      }
      break;
    }
    case "done":
    case "failed":
      break;
  }
  try {
    const fresh = await db.select().from(batchJobs).where(eq16(batchJobs.jobId, job.jobId)).limit(1);
    const row = fresh[0];
    if (row) {
      const productStatuses = {};
      for (const p of row.products) {
        const ps = row.runnerState[p.productId];
        productStatuses[p.sku] = ps?.status ?? "running";
      }
      const summary = {
        jobId: row.jobId,
        jobType: row.jobType,
        status: row.status,
        source: row.source,
        skuList: row.skuList,
        turn: row.turn,
        maxTurns: row.maxTurns,
        currentBatchId: row.currentBatchId ?? null,
        gatesDealId: row.gatesDealId ?? null,
        appliedSkus: row.appliedSkus ?? [],
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        completedAt: row.completedAt ?? null,
        failedAt: row.failedAt ?? null,
        results: row.results ?? null,
        error: row.error ?? null,
        productStatuses
      };
      await kvSet(KV_KEYS.enrichmentJob(job.jobId), summary, KV_TTL_SECONDS2);
    }
  } catch (err) {
    console.warn("[batch-orchestrator] KV mirror update failed (non-fatal):", err);
  }
  return outcome;
}
async function submitTurnBatch(job) {
  const runnerState = { ...job.runnerState };
  const toSubmit = job.products.filter((p) => {
    const ps = runnerState[p.productId];
    return ps && !ps.finished && ps.status === "running" && ps.turns < job.maxTurns;
  });
  if (toSubmit.length === 0) return;
  const requests = [];
  for (const p of toSubmit) {
    const ps = runnerState[p.productId];
    if (!ps) continue;
    const newTurns = ps.turns + 1;
    runnerState[p.productId] = { ...ps, turns: newTurns };
    requests.push({
      custom_id: buildCustomId2(job.jobId, p.productId),
      params: {
        model: MODEL5,
        max_tokens: 4096,
        // Ephemeral cache on tools + system: cache write on first request,
        // reads on subsequent requests within TTL across parallel batch requests.
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: TOOLS,
        messages: ps.messages
      }
    });
  }
  if (requests.length === 0) return;
  const client4 = getClient3();
  const batch = await client4.messages.batches.create({ requests });
  const isFirstSubmit = !job.submittedAt;
  const batchIds = [...Array.isArray(job.batchIds) ? job.batchIds : [], batch.id];
  await db.update(batchJobs).set({
    status: "submitted",
    currentBatchId: batch.id,
    batchIds,
    runnerState,
    updatedAt: /* @__PURE__ */ new Date(),
    ...isFirstSubmit ? { submittedAt: /* @__PURE__ */ new Date() } : {}
  }).where(eq16(batchJobs.jobId, job.jobId));
  console.log(`[batch-orchestrator] job ${job.jobId} turn ${job.turn + 1}: submitted batch ${batch.id} (${requests.length} requests)`);
}
function buildCustomId2(jobId, productId) {
  return `${jobId}__${productId}`;
}
function freshRunnerState(p, jobId) {
  const input = p.input;
  return {
    productId: p.productId,
    sku: p.sku,
    messages: [{ role: "user", content: buildUserPrompt(input) }],
    calledTools: [],
    writes: {},
    telemetry: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      durationMs: 0,
      turns: 0,
      toolCalls: []
    },
    finished: false,
    turns: 0,
    status: "running",
    lastBatchCustomId: buildCustomId2(jobId, p.productId),
    requestRetries: 0,
    applyRetries: 0
  };
}
function stateFor(ps, p, taxonomy) {
  const { llmClient: _omit, ...inputWithoutClient } = p.input;
  const input = inputWithoutClient;
  return {
    input,
    dialRegistry: taxonomy.dialRegistry,
    dialTaxonomy: taxonomy.dialTaxonomy,
    vocab: taxonomy.vocab,
    writes: ps.writes,
    telemetry: ps.telemetry,
    finished: ps.finished
  };
}
async function maybeActivateGatedDeal(jobId, gatesDealId) {
  try {
    const { dealHistory: dealHistory2 } = await Promise.resolve().then(() => (init_schema(), schema_exports));
    const { eq: eq20 } = await import("drizzle-orm");
    const rows = await db.select().from(dealHistory2).where(eq20(dealHistory2.id, gatesDealId)).limit(1);
    const deal = rows[0];
    if (!deal) {
      console.warn(`[batch-orchestrator] maybeActivateGatedDeal: deal ${gatesDealId} not found`);
      return;
    }
    if (deal.status === "live") {
      return;
    }
    const { activateDeal: activateDeal2 } = await Promise.resolve().then(() => (init_deal_rotator_server(), deal_rotator_server_exports));
    await activateDeal2({
      id: deal.id,
      shopifyProductId: deal.shopifyProductId,
      sku: deal.sku,
      seoTitle: deal.seoTitle,
      dealPrice: deal.dealPrice ?? null,
      msrp: deal.msrp ?? null,
      wholesaleCost: deal.wholesaleCost ?? null
    });
    console.log(`[batch-orchestrator] job ${jobId} gated deal ${gatesDealId} activated`);
  } catch (err) {
    console.error(`[batch-orchestrator] maybeActivateGatedDeal for job ${jobId} deal ${gatesDealId} failed:`, err);
  }
}
async function getBatchJobById(jobId) {
  const rows = await db.select().from(batchJobs).where(eq16(batchJobs.jobId, jobId)).limit(1);
  return rows[0] ?? null;
}
async function listRecentBatchJobs(limit = 50) {
  return db.select().from(batchJobs).orderBy(batchJobs.createdAt).limit(limit);
}
var MODEL5, KV_TTL_SECONDS2;
var init_batch_orchestrator_server = __esm({
  "app/lib/batch-orchestrator.server.ts"() {
    "use strict";
    init_db_server();
    init_schema();
    init_emma_orchestrator_server();
    init_dial_registry_server();
    init_ask_emma_vocab_server();
    init_import_enrich_server();
    init_token_log_server();
    init_kv_server();
    init_claude_server();
    init_models_server();
    MODEL5 = SONNET;
    KV_TTL_SECONDS2 = 24 * 60 * 60;
  }
});

// app/lib/bulk-import.server.ts
var bulk_import_server_exports = {};
__export(bulk_import_server_exports, {
  importNewProduct: () => importNewProduct,
  importProductGroup: () => importProductGroup,
  importProductGroupRaw: () => importProductGroupRaw,
  isSkuAlreadyImported: () => isSkuAlreadyImported,
  parseBulkImportCSV: () => parseBulkImportCSV
});
import { parse as parse3 } from "csv-parse/sync";
import { eq as eq17, max } from "drizzle-orm";
function inferCategory(categories) {
  const forHimCats = ["Vagina Strokers", "Body Molds", "Prostate Toys", "Masturbators", "Hands-Free Masturbators"];
  const forHerCats = ["Dual Action and Rabbits", "Finger and Clit", "Air Pulse and Suction", "Bullets and Eggs"];
  const coupleCats = ["Couples and Wearable", "Remote", "Top Couples Toys", "Restraints"];
  const out = [];
  if (categories.some((c) => forHimCats.includes(c))) out.push("for-him");
  if (categories.some((c) => forHerCats.includes(c))) out.push("for-her");
  if (categories.some((c) => coupleCats.includes(c))) out.push("couples");
  return out.length > 0 ? out : ["for-him", "for-her"];
}
function editorialTagsFrom(categories) {
  return categories.filter((c) => c && c !== UNCATEGORIZED_SENTINEL);
}
function computeDealPrice(wholesale, msrp, map) {
  if (map === 0) return Math.round(Math.max(wholesale * 1.4, msrp * 0.55) * 100) / 100;
  if (map < msrp) return Math.round(map * 100) / 100;
  return Math.round(msrp * 100) / 100;
}
function getImages2(row) {
  const imgs = [];
  for (let i = 1; i <= 10; i++) {
    const url = row[`Image ${i}`];
    if (url?.trim()) imgs.push(url.trim());
  }
  return imgs;
}
function parseBulkImportCSV(csvText) {
  const rows = parse3(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });
  const parseErrors = [];
  for (const row of rows) {
    if (row["Master SKU"]) {
      row["Master SKU"] = row["Master SKU"].replace(/\.0$/, "");
    }
  }
  const masterRows = rows.filter((r) => !r["Master SKU"]);
  const childRows = rows.filter((r) => !!r["Master SKU"]);
  const groups = [];
  for (const master of masterRows) {
    const masterSku = master.SKU;
    const children = childRows.filter((r) => r["Master SKU"] === masterSku);
    if (children.length === 0 && !master["Variant Option Value"] && !master["Variant Option Value 2"]) {
      groups.push({ masterRow: master, variants: [], isSingleVariant: true });
      continue;
    }
    const allVariantRows = master["Variant Option Value"] ? [master, ...children] : children;
    const optionNames1 = new Set(allVariantRows.map((r) => r["Variant Option Name"]).filter(Boolean));
    if (optionNames1.size > 1) {
      parseErrors.push({
        sku: masterSku,
        message: `Inconsistent Variant Option Name: ${[...optionNames1].join(", ")}`
      });
      continue;
    }
    const optionNames2 = new Set(allVariantRows.map((r) => r["Variant Option Name 2"]).filter(Boolean));
    if (optionNames2.size > 1) {
      parseErrors.push({
        sku: masterSku,
        message: `Inconsistent Variant Option Name 2: ${[...optionNames2].join(", ")}`
      });
      continue;
    }
    const hasAxis2Name = optionNames2.size === 1;
    if (hasAxis2Name) {
      for (const r of allVariantRows) {
        if (!r["Variant Option Value 2"]) {
          parseErrors.push({
            sku: masterSku,
            message: `Row SKU ${r.SKU} is missing Variant Option Value 2 but other rows in this group supply one`
          });
        }
      }
      if (parseErrors.some((e) => e.sku === masterSku)) continue;
    } else {
      for (const r of allVariantRows) {
        if (r["Variant Option Value 2"]) {
          parseErrors.push({
            sku: masterSku,
            message: `Row SKU ${r.SKU} supplies Variant Option Value 2 but Variant Option Name 2 is missing or inconsistent`
          });
        }
      }
      if (parseErrors.some((e) => e.sku === masterSku)) continue;
    }
    const variants = allVariantRows.map((r) => {
      const wholesale = parseFloat(r.Wholesale) || 0;
      const msrp = parseFloat(r.MSRP) || 0;
      const map = parseFloat(r.MAP ?? "0") || 0;
      const qty = parseInt(r["Total qty available"]) || 0;
      const value1 = r["Variant Option Value"] || r.SKU;
      const optionValues = hasAxis2Name ? [value1, r["Variant Option Value 2"]] : [value1];
      return {
        sku: r.SKU,
        optionValues,
        price: computeDealPrice(wholesale, msrp, map),
        compareAtPrice: msrp,
        qty,
        wholesale,
        images: getImages2(r)
      };
    });
    groups.push({ masterRow: master, variants, isSingleVariant: false });
  }
  return { groups, parseErrors };
}
async function isSkuAlreadyImported(sku) {
  const rows = await db.select({ sku: dealHistory.sku }).from(dealHistory).where(eq17(dealHistory.sku, sku)).limit(1);
  return rows.length > 0;
}
async function importProductGroup(group) {
  const { masterRow, variants, isSingleVariant } = group;
  const masterSku = masterRow.SKU;
  try {
    if (isDiscontinued({
      "Sub-Category": masterRow["Sub-Category"] ?? "",
      "Product Title": masterRow["Product Title"] ?? "",
      "Product Description": masterRow["Product Description"] ?? ""
    })) {
      console.info(`[bulk-import] ${masterSku} skipped: discontinued`);
      return { success: false, sku: masterSku, skipped: true, error: "discontinued by manufacturer" };
    }
    if (await isSkuAlreadyImported(masterSku)) {
      return { success: false, sku: masterSku, skipped: true };
    }
    const wholesale = parseFloat(masterRow.Wholesale) || 0;
    const msrp = parseFloat(masterRow.MSRP) || 0;
    const map = parseFloat(masterRow.MAP ?? "0") || 0;
    const qty = parseInt(masterRow["Total qty available"]) || 0;
    const images = getImages2(masterRow);
    const rawDesc = masterRow["Product Description"] ?? "";
    const cleanedDesc = cleanDescription(rawDesc);
    const description = cleanedDesc || `${masterRow.Brand} ${masterRow["Product Title"]}`;
    const categories = masterRow["Sub-Category"] ? masterRow["Sub-Category"].split(",").map((c) => c.trim()).filter(Boolean) : [];
    const dealPrice = computeDealPrice(wholesale, msrp, map);
    const category = inferCategory(categories);
    let numericId;
    const existingGid = await findProductBySKU(masterSku);
    if (existingGid) {
      numericId = existingGid.replace("gid://shopify/Product/", "");
    } else if (isSingleVariant) {
      const productScore = {
        sku: masterSku,
        title: masterRow["Product Title"],
        brand: masterRow.Brand,
        description,
        score: 0,
        msrp,
        wholesaleCost: wholesale,
        mapPrice: map,
        dealPrice,
        discountPct: msrp > 0 ? (msrp - dealPrice) / msrp * 100 : 0,
        profitPerUnit: dealPrice - wholesale,
        qty,
        mapType: map === 0 ? "no-map" : map < msrp ? "below-msrp" : "equals-msrp",
        images,
        categories
      };
      const handle = slugifyHandle(masterRow["Product Title"]);
      numericId = await createShopifyProductFromFeed(productScore, handle);
    } else {
      const name1 = group.masterRow["Variant Option Name"] || "Option";
      const name2 = group.masterRow["Variant Option Name 2"];
      const optionNames = name2 ? [name1, name2] : [name1];
      const handle = slugifyHandle(masterRow["Product Title"]);
      numericId = await createShopifyProductWithVariants(
        {
          title: masterRow["Product Title"],
          brand: masterRow.Brand,
          sku: masterSku,
          images,
          msrp,
          categories
        },
        variants,
        optionNames,
        handle
      );
    }
    const seoTitle = await generateSEOTitle(masterRow["Product Title"], masterRow.Brand);
    const pairingCandidates = await getPairingCandidates({
      shopifyProductId: numericId,
      category,
      subCategories: categories
    }).catch((err) => {
      console.warn(`[bulk-import] ${masterSku} pairing-candidates lookup failed:`, err instanceof Error ? err.message : err);
      return [];
    });
    const [{ maxSort = 0 } = {}] = await db.select({ maxSort: max(dealHistory.sortOrder) }).from(dealHistory);
    const nextSortOrder = (maxSort ?? 0) + 1;
    const [insertedDeal] = await db.insert(dealHistory).values({
      sku: masterSku,
      seoTitle,
      brand: masterRow.Brand,
      categories,
      dealDate: "2099-12-31",
      wholesaleCost: wholesale.toFixed(2),
      dealPrice: dealPrice.toFixed(2),
      msrp: msrp.toFixed(2),
      mapPrice: map.toFixed(2),
      unitsAvailable: qty,
      dealScore: null,
      status: "queued",
      sortOrder: nextSortOrder,
      shopifyProductId: numericId
    }).onConflictDoNothing().returning({ id: dealHistory.id });
    const gid = `gid://shopify/Product/${numericId}`;
    const stagedDealId = insertedDeal?.id;
    const { jobId } = await enqueueBatchJob({
      jobType: "full-enrichment",
      source: "bulk-import",
      products: [{
        productId: gid,
        sku: masterSku,
        input: {
          product: {
            title: masterRow["Product Title"],
            brand: masterRow.Brand,
            description,
            categories,
            dealPrice,
            msrp
          },
          seoTitle,
          category,
          pairingCandidates
        }
      }],
      ...stagedDealId !== void 0 ? { gatesDealId: stagedDealId } : {}
    });
    console.info(`[bulk-import] ${masterSku} enrichment enqueued jobId=${jobId} gatesDealId=${stagedDealId ?? "none"} (async via batch poller)`);
    await pushProductToShopify({
      shopifyProductId: numericId,
      seoTitle,
      tags: editorialTagsFrom(categories),
      category,
      sectionTags: [deriveSection({ productTypeDial: void 0, categories, title: masterRow["Product Title"] })],
      dealStatus: "pending_approval",
      dealDate: "2099-12-31",
      originalPrice: msrp,
      wholesaleCost: wholesale,
      mapPrice: map,
      nalpacSku: masterSku,
      rawDescription: cleanedDesc || void 0
    });
    const warnings = [];
    try {
      const handle = await getProductHandleById(numericId);
      if (!handle) {
        const msg = "could not resolve Shopify handle \u2014 skipping Sanity sync";
        console.warn(`[bulk-import] ${masterSku} ${msg}`);
        warnings.push({ stage: "sanity", message: msg });
      } else {
        const upsertParams = {
          handle,
          shopifyProductId: gid,
          title: masterRow["Product Title"],
          vendor: masterRow.Brand,
          tags: editorialTagsFrom(categories),
          description,
          seoTitle,
          category
          // Enriched fields (tagline, moodTags, productTypeDial, IVR, FAQs)
          // are written by applyFullEnrichmentWrites once the batch job completes.
        };
        if (images[0]) upsertParams.imageUrl = images[0];
        let lastErr;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const { created } = await upsertProductPage(upsertParams);
            console.info(`[bulk-import] ${masterSku} sanity: ${created ? "created" : "updated"} productPage-${handle}`);
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            if (attempt === 1) {
              console.warn(`[bulk-import] ${masterSku} sanity sync attempt 1 failed, retrying in 500ms:`, err instanceof Error ? err.message : err);
              await new Promise((r) => setTimeout(r, 500));
            }
          }
        }
        if (lastErr) {
          const msg = `sanity sync failed after retry: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`;
          console.error(`[bulk-import] ${masterSku} ${msg}`);
          warnings.push({ stage: "sanity", message: msg });
        }
      }
    } catch (err) {
      const msg = `sanity sync threw unexpectedly: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[bulk-import] ${masterSku} ${msg}`);
      warnings.push({ stage: "sanity", message: msg });
    }
    return {
      success: true,
      sku: masterSku,
      shopifyProductId: numericId,
      jobId,
      ...warnings.length > 0 ? { warnings } : {}
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[bulk-import] Failed SKU ${masterSku}:`, message);
    return { success: false, sku: masterSku, error: message };
  }
}
async function importProductGroupRaw(group) {
  const { masterRow, variants, isSingleVariant } = group;
  const masterSku = masterRow.SKU;
  try {
    if (isDiscontinued({
      "Sub-Category": masterRow["Sub-Category"] ?? "",
      "Product Title": masterRow["Product Title"] ?? "",
      "Product Description": masterRow["Product Description"] ?? ""
    })) {
      return { success: false, sku: masterSku, skipped: true, error: "discontinued by manufacturer" };
    }
    if (await isSkuAlreadyImported(masterSku)) {
      return { success: false, sku: masterSku, skipped: true };
    }
    const wholesale = parseFloat(masterRow.Wholesale) || 0;
    const msrp = parseFloat(masterRow.MSRP) || 0;
    const map = parseFloat(masterRow.MAP ?? "0") || 0;
    const qty = parseInt(masterRow["Total qty available"]) || 0;
    const images = getImages2(masterRow);
    const rawDesc = masterRow["Product Description"] ?? "";
    const cleanedDesc = cleanDescription(rawDesc);
    const description = cleanedDesc || `${masterRow.Brand} ${masterRow["Product Title"]}`;
    const categories = masterRow["Sub-Category"] ? masterRow["Sub-Category"].split(",").map((c) => c.trim()).filter(Boolean) : [];
    const dealPrice = computeDealPrice(wholesale, msrp, map);
    const category = inferCategory(categories);
    let numericId;
    const existingGid = await findProductBySKU(masterSku);
    if (existingGid) {
      numericId = existingGid.replace("gid://shopify/Product/", "");
    } else if (isSingleVariant) {
      const productScore = {
        sku: masterSku,
        title: masterRow["Product Title"],
        brand: masterRow.Brand,
        description,
        score: 0,
        msrp,
        wholesaleCost: wholesale,
        mapPrice: map,
        dealPrice,
        discountPct: msrp > 0 ? (msrp - dealPrice) / msrp * 100 : 0,
        profitPerUnit: dealPrice - wholesale,
        qty,
        mapType: map === 0 ? "no-map" : map < msrp ? "below-msrp" : "equals-msrp",
        images,
        categories
      };
      const handle = slugifyHandle(masterRow["Product Title"]);
      numericId = await createShopifyProductFromFeed(productScore, handle);
    } else {
      const name1 = group.masterRow["Variant Option Name"] || "Option";
      const name2 = group.masterRow["Variant Option Name 2"];
      const optionNames = name2 ? [name1, name2] : [name1];
      const handle = slugifyHandle(masterRow["Product Title"]);
      numericId = await createShopifyProductWithVariants(
        {
          title: masterRow["Product Title"],
          brand: masterRow.Brand,
          sku: masterSku,
          images,
          msrp,
          categories
        },
        variants,
        optionNames,
        handle
      );
    }
    await pushProductToShopify({
      shopifyProductId: numericId,
      tags: editorialTagsFrom(categories),
      category,
      sectionTags: [deriveSection({ categories, title: masterRow["Product Title"] })],
      dealStatus: "pending_approval",
      dealDate: "2099-12-31",
      originalPrice: msrp,
      wholesaleCost: wholesale,
      mapPrice: map,
      nalpacSku: masterSku,
      rawDescription: cleanedDesc || void 0,
      requireTagline: false
    });
    const [{ maxSort = 0 } = {}] = await db.select({ maxSort: max(dealHistory.sortOrder) }).from(dealHistory);
    const nextSortOrder = (maxSort ?? 0) + 1;
    await db.insert(dealHistory).values({
      sku: masterSku,
      seoTitle: masterRow["Product Title"],
      // raw title until enrichment runs
      brand: masterRow.Brand,
      categories,
      dealDate: "2099-12-31",
      wholesaleCost: wholesale.toFixed(2),
      dealPrice: dealPrice.toFixed(2),
      msrp: msrp.toFixed(2),
      mapPrice: map.toFixed(2),
      unitsAvailable: qty,
      dealScore: null,
      status: "queued",
      sortOrder: nextSortOrder,
      shopifyProductId: numericId
    }).onConflictDoNothing();
    const warnings = [];
    try {
      await activateProductInventoryAtLocations(numericId);
    } catch (err) {
      warnings.push({ stage: "inventory-locations", message: err instanceof Error ? err.message : String(err) });
    }
    try {
      await publishProductToXdipxChannels(numericId);
    } catch (err) {
      warnings.push({ stage: "publish-channels", message: err instanceof Error ? err.message : String(err) });
    }
    try {
      const handle = await getProductHandleById(numericId);
      if (!handle) {
        warnings.push({ stage: "sanity", message: "could not resolve Shopify handle \u2014 skipping Sanity sync" });
      } else {
        const gid = `gid://shopify/Product/${numericId}`;
        const upsertParams = {
          handle,
          shopifyProductId: gid,
          title: masterRow["Product Title"],
          vendor: masterRow.Brand,
          tags: editorialTagsFrom(categories),
          description,
          category
        };
        if (images[0]) upsertParams.imageUrl = images[0];
        let lastErr;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            await upsertProductPage(upsertParams);
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            if (attempt === 1) await new Promise((r) => setTimeout(r, 500));
          }
        }
        if (lastErr) {
          warnings.push({ stage: "sanity", message: `sanity sync failed after retry: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}` });
        }
      }
    } catch (err) {
      warnings.push({ stage: "sanity", message: err instanceof Error ? err.message : String(err) });
    }
    return {
      success: true,
      sku: masterSku,
      shopifyProductId: numericId,
      ...warnings.length > 0 ? { warnings } : {}
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[bulk-import-raw] Failed SKU ${masterSku}:`, message);
    return { success: false, sku: masterSku, error: message };
  }
}
async function importNewProduct(input) {
  const { source, handle, rawProduct, voiceProfile } = input;
  const sku = rawProduct.sku;
  const warnings = [];
  if (isDiscontinued({
    "Sub-Category": rawProduct.categories.join(", "),
    "Product Title": rawProduct.title,
    "Product Description": rawProduct.rawDescription ?? rawProduct.description
  })) {
    throw new Error(`importNewProduct: ${sku} is flagged discontinued by manufacturer`);
  }
  const existingGid = await findProductBySKU(sku);
  if (existingGid) {
    const existingId = existingGid.replace("gid://shopify/Product/", "");
    return {
      shopifyProductId: existingId,
      gid: existingGid,
      handle,
      // caller's input handle — may differ from the actual Shopify handle, intentional
      warnings: [{ stage: "duplicate", message: `SKU ${sku} already imported as ${existingGid}; not re-creating` }]
    };
  }
  const productScore = {
    sku,
    title: rawProduct.title,
    brand: rawProduct.brand,
    description: rawProduct.description,
    score: 0,
    msrp: rawProduct.msrp,
    wholesaleCost: rawProduct.wholesaleCost,
    mapPrice: rawProduct.mapPrice ?? 0,
    dealPrice: rawProduct.dealPrice,
    discountPct: rawProduct.msrp > 0 ? (rawProduct.msrp - rawProduct.dealPrice) / rawProduct.msrp * 100 : 0,
    profitPerUnit: rawProduct.dealPrice - rawProduct.wholesaleCost,
    qty: rawProduct.qty ?? 0,
    mapType: (rawProduct.mapPrice ?? 0) === 0 ? "no-map" : (rawProduct.mapPrice ?? 0) < rawProduct.msrp ? "below-msrp" : "equals-msrp",
    images: rawProduct.images ?? [],
    categories: rawProduct.categories
  };
  const numericId = await createShopifyProductFromFeed(productScore, handle);
  const gid = `gid://shopify/Product/${numericId}`;
  const seoTitle = await generateSEOTitle(rawProduct.title, rawProduct.brand);
  const category = inferCategory(rawProduct.categories);
  const pairingCandidates = await getPairingCandidates({
    shopifyProductId: numericId,
    category,
    subCategories: rawProduct.categories
  }).catch((err) => {
    console.warn(`[importNewProduct] ${sku} pairing-candidates lookup failed:`, err instanceof Error ? err.message : err);
    return [];
  });
  await pushProductToShopify({
    shopifyProductId: numericId,
    seoTitle,
    tags: editorialTagsFrom(rawProduct.categories),
    category,
    dealStatus: "pending_approval",
    dealDate: "2099-12-31",
    originalPrice: rawProduct.msrp,
    wholesaleCost: rawProduct.wholesaleCost,
    mapPrice: rawProduct.mapPrice ?? 0,
    nalpacSku: sku,
    rawDescription: rawProduct.rawDescription ?? rawProduct.description
  });
  const [{ maxSort = 0 } = {}] = await db.select({ maxSort: max(dealHistory.sortOrder) }).from(dealHistory);
  const nextSortOrder = (maxSort ?? 0) + 1;
  const [insertedDeal] = await db.insert(dealHistory).values({
    sku,
    seoTitle,
    brand: rawProduct.brand,
    categories: rawProduct.categories,
    dealDate: "2099-12-31",
    wholesaleCost: rawProduct.wholesaleCost.toFixed(2),
    dealPrice: rawProduct.dealPrice.toFixed(2),
    msrp: rawProduct.msrp.toFixed(2),
    mapPrice: (rawProduct.mapPrice ?? 0).toFixed(2),
    unitsAvailable: rawProduct.qty ?? 0,
    dealScore: null,
    status: "queued",
    sortOrder: nextSortOrder,
    shopifyProductId: numericId
  }).onConflictDoNothing().returning({ id: dealHistory.id });
  const stagedDealId = insertedDeal?.id;
  const { jobId } = await enqueueBatchJob({
    jobType: "full-enrichment",
    source: "import-product",
    products: [{
      productId: gid,
      sku,
      input: {
        product: {
          title: rawProduct.title,
          brand: rawProduct.brand,
          description: rawProduct.description,
          categories: rawProduct.categories,
          dealPrice: rawProduct.dealPrice,
          msrp: rawProduct.msrp
        },
        seoTitle,
        category,
        pairingCandidates
      }
    }],
    ...stagedDealId !== void 0 ? { gatesDealId: stagedDealId } : {}
  });
  console.info(`[importNewProduct] ${sku} (source=${source}) enrichment enqueued jobId=${jobId} gatesDealId=${stagedDealId ?? "none"} voiceHash=${voiceProfile?.hash ?? "default"}`);
  try {
    const upsertParams = {
      handle,
      shopifyProductId: gid,
      title: rawProduct.title,
      vendor: rawProduct.brand,
      tags: editorialTagsFrom(rawProduct.categories),
      description: rawProduct.description,
      seoTitle,
      category
    };
    if (rawProduct.images?.[0]) upsertParams.imageUrl = rawProduct.images[0];
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await upsertProductPage(upsertParams);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt === 1) await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (lastErr) {
      const msg = `sanity sync failed after retry: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`;
      warnings.push({ stage: "sanity", message: msg });
    }
  } catch (err) {
    warnings.push({ stage: "sanity", message: err instanceof Error ? err.message : String(err) });
  }
  return { shopifyProductId: numericId, gid, handle, jobId, status: "enriching", warnings };
}
var init_bulk_import_server = __esm({
  "app/lib/bulk-import.server.ts"() {
    "use strict";
    init_db_server();
    init_schema();
    init_claude_server();
    init_batch_orchestrator_server();
    init_feed_processor_server();
    init_master_collapse_server();
    init_shopify_server();
    init_sanity_server();
  }
});

// app/lib/import-monitor.server.ts
var import_monitor_server_exports = {};
__export(import_monitor_server_exports, {
  approveAndImport: () => approveAndImport,
  getCatalogOpportunities: () => getCatalogOpportunities,
  getImportCandidatesByStatus: () => getImportCandidatesByStatus,
  getRecentImportRuns: () => getRecentImportRuns,
  runImportMonitor: () => runImportMonitor,
  stageMasterCandidatesBySkus: () => stageMasterCandidatesBySkus,
  updateCandidateStatus: () => updateCandidateStatus
});
import { and as and4, eq as eq18, inArray as inArray5, sql as sql7 } from "drizzle-orm";
function buildMasterUpsertPayload(master, carriedBrands, todayStr, overrides) {
  const brand = master.brand.toLowerCase().trim();
  let tier = "D";
  let gapReason = "";
  if (master.inTop100Feed) {
    tier = "A";
    gapReason = "In Nalpac top-100 feed, not yet in catalog";
  } else if (carriedBrands.has(brand) && master.marginMsrpPct >= 0.45) {
    tier = "B";
    gapReason = `Brand "${master.brand}" already carried; margin ${(master.marginMsrpPct * 100).toFixed(0)}%, ${master.inStockVariants} variant(s) in stock`;
  } else if (master.inNewFeed) {
    tier = "C";
    gapReason = `In Nalpac new-products feed; margin ${(master.marginMsrpPct * 100).toFixed(0)}%, ${master.inStockVariants} variant(s) in stock`;
  } else {
    tier = "D";
    gapReason = `Brand opportunity: "${master.brand}" has ${master.variantCount} qualifying variant(s) not in catalog; margin ${(master.marginMsrpPct * 100).toFixed(0)}%`;
  }
  if (overrides?.gapReason) gapReason = overrides.gapReason;
  const score2 = gapScore(master);
  const repSku = master.skus[0] ?? "";
  const pricingSnap = {
    sku: repSku,
    vendor: master.brand,
    msrp: master.msrp,
    wholesale: master.wholesale,
    mapPrice: master.map > 0 ? master.map : null,
    currentPrice: master.msrp,
    currentCompareAt: null,
    inSaleFeed: master.inSaleFeed,
    nalpacDiscountPct: null
  };
  const priceResult = computeTargetPrice(pricingSnap);
  const proposedPrice = priceResult.newPrice;
  const marginPct2 = priceResult.marginPct * 100;
  const profitPerUnit = proposedPrice - master.wholesale;
  const imageCount = master.sampleImage ? 1 : 0;
  const { axes } = detectAxes(master);
  const upsertPayload = {
    sku: repSku,
    brand: master.brand,
    productTitle: master.displayTitle,
    baseTitle: master.baseTitle,
    categories: [master.category],
    tier,
    gapReason,
    dealScore: score2.toFixed(3),
    msrp: master.msrp.toFixed(2),
    wholesaleCost: master.wholesale.toFixed(2),
    mapPrice: master.map > 0 ? master.map.toFixed(2) : null,
    proposedPrice: proposedPrice.toFixed(2),
    marginPct: marginPct2.toFixed(2),
    profitPerUnit: profitPerUnit.toFixed(2),
    qtyAvailable: master.totalQty,
    totalQty: master.totalQty,
    imageCount,
    inTop100Feed: master.inTop100Feed,
    inNewFeed: master.inNewFeed,
    inSaleFeed: master.inSaleFeed,
    masterKey: master.masterKey,
    variantSkus: master.skus,
    variantCount: master.variantCount,
    inStockVariants: master.inStockVariants,
    colors: master.colors,
    sizes: master.sizes,
    volumes: master.fluidOz,
    axes,
    needsReview: needsReview(master),
    upc: master.upcs[0] ?? null,
    sampleImage: master.sampleImage || null,
    runDate: todayStr,
    lastSeenAt: /* @__PURE__ */ new Date(),
    updatedAt: /* @__PURE__ */ new Date()
  };
  return { tier, gapReason, score: score2, upsertPayload };
}
async function runImportMonitor(opts = {}) {
  const source = opts.source ?? "cron";
  const todayStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const insertedRuns = await db.insert(importMonitorRuns).values({
    runDate: todayStr,
    source,
    feedsOk: false
  }).returning({ id: importMonitorRuns.id });
  const runId = insertedRuns[0]?.id;
  if (runId == null) {
    return {
      feedsOk: false,
      candidatesFound: 0,
      candidatesNew: 0,
      candidatesResurfaced: 0,
      autoImported: 0,
      error: "failed to insert importMonitorRuns row"
    };
  }
  try {
    const feedResult = await fetchAllNalpacFeeds();
    const feedsOk = feedResult.errors.length === 0;
    if (!feedsOk) {
      console.warn("[import-monitor] feed errors:", feedResult.errors);
    }
    const carriedRows = await db.selectDistinct({ sku: dealHistory.sku, brand: dealHistory.brand }).from(dealHistory);
    const carriedSkus = new Set(carriedRows.map((r) => r.sku));
    const carriedBrands = new Set(
      carriedRows.map((r) => r.brand?.toLowerCase().trim()).filter(Boolean)
    );
    const currentFeedSkus = [...feedResult.snapshots.keys()];
    const priorFeedSkus = await kvGet(KV_FEED_SKUS);
    const priorSet = new Set(priorFeedSkus ?? []);
    const _addedSkus = new Set(currentFeedSkus.filter((s) => !priorSet.has(s)));
    void _addedSkus;
    await kvSet(KV_FEED_SKUS, currentFeedSkus, 25 * 60 * 60);
    const allMasters = collapseMasters(feedResult.snapshots);
    const eligibleMasters = allMasters.filter((master) => {
      const anyCarried = master.skus.some((s) => carriedSkus.has(s));
      if (anyCarried) return false;
      const { ok } = isEligible(master);
      return ok;
    });
    const [watchScoreDeltaStr, watchPriceDropPctStr, phase, maxCandidatesStr] = await Promise.all([
      getPipelineSetting("import_monitor_watch_score_delta"),
      getPipelineSetting("import_monitor_watch_price_drop_pct"),
      getPipelineSetting("import_monitor_phase"),
      getPipelineSetting("import_monitor_max_candidates")
    ]);
    const watchScoreDelta = parseFloat(watchScoreDeltaStr ?? "0.10");
    const watchPriceDropPct = parseFloat(watchPriceDropPctStr ?? "0.10");
    const monitorPhase = phase ?? "1";
    const maxCandidates = Math.max(1, parseInt(maxCandidatesStr ?? "300", 10) || 300);
    const enriched = eligibleMasters.map((master) => {
      const { tier, gapReason, score: score2, upsertPayload } = buildMasterUpsertPayload(
        master,
        carriedBrands,
        todayStr
      );
      return { master, tier, gapReason, score: score2, upsertPayload };
    });
    const sorted = enriched.sort((a, b) => b.score - a.score);
    const guaranteed = sorted.filter((e) => e.master.inTop100Feed || e.master.inNewFeed);
    const rest = sorted.filter((e) => !(e.master.inTop100Feed || e.master.inNewFeed));
    const restSlots = Math.max(0, maxCandidates - guaranteed.length);
    const capped = [...guaranteed, ...rest.slice(0, restSlots)];
    console.info(
      `[import-monitor] collapsed=${allMasters.length} eligible=${eligibleMasters.length} guaranteed=${guaranteed.length} capped=${capped.length} (max=${maxCandidates})`
    );
    const cappedKeys = capped.map((c) => c.master.masterKey).filter(Boolean);
    const existingRows = cappedKeys.length > 0 ? await db.select({
      masterKey: importCandidates.masterKey,
      status: importCandidates.status,
      watchScore: importCandidates.watchScore,
      watchPrice: importCandidates.watchPrice
    }).from(importCandidates).where(inArray5(importCandidates.masterKey, cappedKeys)) : [];
    const existingByKey = new Map(existingRows.map((r) => [r.masterKey ?? "", r]));
    let candidatesNew = 0;
    let candidatesResurfaced = 0;
    let candidatesFound = 0;
    for (const { master, score: score2, upsertPayload } of capped) {
      const masterKey = master.masterKey;
      const proposedPrice = parseFloat(upsertPayload.proposedPrice);
      const existing = existingByKey.get(masterKey);
      if (!existing) {
        await db.insert(importCandidates).values({
          ...upsertPayload,
          status: "pending",
          firstSeenAt: /* @__PURE__ */ new Date()
        }).onConflictDoNothing();
        candidatesNew++;
        candidatesFound++;
      } else if (existing.status === "rejected" || existing.status === "imported") {
        await db.update(importCandidates).set({ lastSeenAt: /* @__PURE__ */ new Date(), updatedAt: /* @__PURE__ */ new Date() }).where(eq18(importCandidates.masterKey, masterKey));
      } else if (existing.status === "watching") {
        const priorScore = parseFloat(existing.watchScore ?? "0");
        const priorPrice = parseFloat(existing.watchPrice ?? "0");
        const scoreImproved = score2 >= priorScore + watchScoreDelta;
        const priceDropped = priorPrice > 0 && proposedPrice <= priorPrice * (1 - watchPriceDropPct);
        if (scoreImproved || priceDropped) {
          await db.update(importCandidates).set({ ...upsertPayload, status: "pending" }).where(eq18(importCandidates.masterKey, masterKey));
          candidatesResurfaced++;
          candidatesFound++;
        } else {
          await db.update(importCandidates).set({ lastSeenAt: /* @__PURE__ */ new Date(), updatedAt: /* @__PURE__ */ new Date() }).where(eq18(importCandidates.masterKey, masterKey));
        }
      } else {
        await db.update(importCandidates).set(upsertPayload).where(eq18(importCandidates.masterKey, masterKey));
        candidatesFound++;
      }
    }
    let autoImported = 0;
    if (monitorPhase === "2") {
      autoImported = await autoImportPhase2(cappedKeys, carriedBrands, todayStr);
    } else if (monitorPhase !== "1") {
      console.log(`[import-monitor] phase ${monitorPhase} auto-approve not yet implemented; treating as phase 1`);
    }
    await db.update(importMonitorRuns).set({
      finishedAt: /* @__PURE__ */ new Date(),
      feedsOk,
      candidatesFound,
      candidatesNew,
      candidatesResurfaced,
      autoImported
    }).where(eq18(importMonitorRuns.id, runId));
    await setPipelineSetting("import_monitor_last_run_at", (/* @__PURE__ */ new Date()).toISOString());
    console.info(
      `[import-monitor] done: feedsOk=${feedsOk} found=${candidatesFound} new=${candidatesNew} resurfaced=${candidatesResurfaced}`
    );
    return { feedsOk, candidatesFound, candidatesNew, candidatesResurfaced, autoImported };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[import-monitor] run failed:", errorMessage);
    await db.update(importMonitorRuns).set({
      finishedAt: /* @__PURE__ */ new Date(),
      feedsOk: false,
      errorMessage
    }).where(eq18(importMonitorRuns.id, runId)).catch((e) => console.error("[import-monitor] could not write error to run row:", e));
    return {
      feedsOk: false,
      candidatesFound: 0,
      candidatesNew: 0,
      candidatesResurfaced: 0,
      autoImported: 0,
      error: errorMessage
    };
  }
}
async function autoImportPhase2(cappedKeys, carriedBrands, todayStr) {
  const enabled = await getPipelineSetting("import_monitor_enabled");
  if (enabled === "false") {
    console.info("[import-monitor] phase 2 auto-import skipped: monitor disabled");
    return 0;
  }
  if (cappedKeys.length === 0) return 0;
  const [minMarkupStr, minQtyStr, minGapStr, requireCarriedStr, maxPerDayStr] = await Promise.all([
    getPipelineSetting("monitor_p2_min_markup_pct"),
    getPipelineSetting("monitor_p2_min_qty"),
    getPipelineSetting("monitor_p2_min_gap_score"),
    getPipelineSetting("monitor_p2_require_carried_brand"),
    getPipelineSetting("monitor_p2_max_auto_imports_per_day")
  ]);
  const minMarkupPct = parseFloat(minMarkupStr ?? "0.08");
  const minQty = parseInt(minQtyStr ?? "30", 10) || 30;
  const minGapScore = parseFloat(minGapStr ?? "3.0");
  const requireCarried = (requireCarriedStr ?? "true") !== "false";
  const maxPerDay = Math.max(0, parseInt(maxPerDayStr ?? "8", 10) || 0);
  if (maxPerDay <= 0) return 0;
  const importedTodayRows = await db.select({ cnt: sql7`count(*)::int` }).from(importCandidates).where(and4(eq18(importCandidates.status, "imported"), eq18(importCandidates.runDate, todayStr)));
  const importedToday = importedTodayRows[0]?.cnt ?? 0;
  const remaining = maxPerDay - importedToday;
  if (remaining <= 0) {
    console.info(`[import-monitor] phase 2 daily cap reached (${importedToday}/${maxPerDay})`);
    return 0;
  }
  const pending = await db.select({
    id: importCandidates.id,
    tier: importCandidates.tier,
    brand: importCandidates.brand,
    wholesaleCost: importCandidates.wholesaleCost,
    totalQty: importCandidates.totalQty,
    dealScore: importCandidates.dealScore,
    mapPrice: importCandidates.mapPrice,
    proposedPrice: importCandidates.proposedPrice,
    needsReview: importCandidates.needsReview
  }).from(importCandidates).where(and4(
    eq18(importCandidates.status, "pending"),
    inArray5(importCandidates.masterKey, cappedKeys)
  )).orderBy(importCandidates.tier, sql7`${importCandidates.dealScore} DESC NULLS LAST`);
  const gated = pending.filter((c) => {
    const tierOk = c.tier === "A" || c.tier === "B";
    if (!tierOk || c.needsReview) return false;
    const carriedOk = requireCarried ? carriedBrands.has((c.brand ?? "").toLowerCase().trim()) : true;
    if (!carriedOk) return false;
    const wholesale = parseFloat(c.wholesaleCost ?? "0");
    const gap = parseFloat(c.dealScore ?? "0");
    const qty = c.totalQty ?? 0;
    const map = parseFloat(c.mapPrice ?? "0");
    const price = parseFloat(c.proposedPrice ?? "0");
    const mapOk = !(map > 0 && price < map);
    const markupOk = wholesale > 0 && price >= wholesale * (1 + minMarkupPct);
    return markupOk && qty >= minQty && gap >= minGapScore && mapOk;
  });
  let imported = 0;
  for (const c of gated) {
    if (imported >= remaining) break;
    try {
      const r = await approveAndImport(c.id);
      if (r.ok && !r.skipped) {
        imported++;
        console.info(`[import-monitor] phase 2 auto-imported candidate ${c.id} (tier ${c.tier})`);
      } else if (!r.ok) {
        console.warn(`[import-monitor] phase 2 auto-import failed for candidate ${c.id}: ${r.error}`);
      }
    } catch (err) {
      console.error(`[import-monitor] phase 2 auto-import threw for candidate ${c.id}:`, err);
    }
  }
  console.info(`[import-monitor] phase 2 auto-imported ${imported} (cap ${maxPerDay}, ${importedToday} prior today)`);
  return imported;
}
async function stageMasterCandidatesBySkus(skus, opts) {
  const todayStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const gapReason = opts?.reason ?? "Staged by PM agent";
  const feedResult = await fetchAllNalpacFeeds();
  const allMasters = collapseMasters(feedResult.snapshots);
  const carriedRows = await db.selectDistinct({ sku: dealHistory.sku, brand: dealHistory.brand }).from(dealHistory);
  const carriedSkus = new Set(carriedRows.map((r) => r.sku));
  const carriedBrands = new Set(
    carriedRows.map((r) => r.brand?.toLowerCase().trim()).filter(Boolean)
  );
  const skuToMaster = /* @__PURE__ */ new Map();
  for (const master of allMasters) {
    for (const sku of master.skus) {
      skuToMaster.set(sku, master);
    }
  }
  const notFound = [];
  const mastersToDo = /* @__PURE__ */ new Set();
  const masterByKey = /* @__PURE__ */ new Map();
  for (const sku of skus) {
    const master = skuToMaster.get(sku);
    if (!master) {
      notFound.push(sku);
    } else {
      mastersToDo.add(master.masterKey);
      masterByKey.set(master.masterKey, master);
    }
  }
  const masterKeys = [...mastersToDo];
  const existingRows = masterKeys.length > 0 ? await db.select({ masterKey: importCandidates.masterKey, status: importCandidates.status }).from(importCandidates).where(inArray5(importCandidates.masterKey, masterKeys)) : [];
  const existingByKey = new Map(existingRows.map((r) => [r.masterKey ?? "", r.status]));
  let staged = 0;
  let skippedCarried = 0;
  for (const masterKey of mastersToDo) {
    const master = masterByKey.get(masterKey);
    if (master.skus.some((s) => carriedSkus.has(s))) {
      skippedCarried++;
      continue;
    }
    const existingStatus = existingByKey.get(masterKey);
    if (existingStatus === "rejected" || existingStatus === "imported") {
      continue;
    }
    const { upsertPayload } = buildMasterUpsertPayload(
      master,
      carriedBrands,
      todayStr,
      { gapReason }
    );
    if (!existingStatus) {
      await db.insert(importCandidates).values({
        ...upsertPayload,
        status: "pending",
        firstSeenAt: /* @__PURE__ */ new Date()
      }).onConflictDoNothing();
      staged++;
    } else if (existingStatus === "watching") {
      await db.update(importCandidates).set({ ...upsertPayload, status: "pending" }).where(eq18(importCandidates.masterKey, masterKey));
      staged++;
    } else {
      await db.update(importCandidates).set(upsertPayload).where(eq18(importCandidates.masterKey, masterKey));
      staged++;
    }
  }
  return { staged, skippedCarried, notFound };
}
async function getImportCandidatesByStatus(statuses, limit) {
  if (statuses.length === 0) return [];
  const query = db.select().from(importCandidates).where(inArray5(importCandidates.status, statuses)).orderBy(
    importCandidates.tier,
    sql7`${importCandidates.dealScore} DESC NULLS LAST`
  );
  if (limit != null) return query.limit(limit);
  return query;
}
async function getCatalogOpportunities() {
  const brandRows = await db.select({ brand: dealHistory.brand }).from(dealHistory).where(sql7`${dealHistory.brand} IS NOT NULL`);
  const brandCount = /* @__PURE__ */ new Map();
  for (const r of brandRows) {
    if (!r.brand) continue;
    brandCount.set(r.brand, (brandCount.get(r.brand) ?? 0) + 1);
  }
  const brandCoverage = [...brandCount.entries()].map(([brand, carried]) => ({ brand, carried })).sort((a, b) => b.carried - a.carried);
  const catRows = await db.select({ categories: dealHistory.categories }).from(dealHistory).where(sql7`${dealHistory.categories} IS NOT NULL`);
  const catCount = /* @__PURE__ */ new Map();
  for (const r of catRows) {
    for (const cat of r.categories ?? []) {
      catCount.set(cat, (catCount.get(cat) ?? 0) + 1);
    }
  }
  const categoryCoverage = [...catCount.entries()].map(([category, carried]) => ({ category, carried })).sort((a, b) => b.carried - a.carried);
  const pendingRows = await db.select({
    brand: importCandidates.brand,
    tier: importCandidates.tier,
    dealScore: importCandidates.dealScore
  }).from(importCandidates).where(inArray5(importCandidates.status, ["pending", "watching"]));
  const oppMap = /* @__PURE__ */ new Map();
  for (const r of pendingRows) {
    if (!r.brand) continue;
    if (!oppMap.has(r.brand)) oppMap.set(r.brand, { tier: r.tier ?? "D", scores: [] });
    const entry = oppMap.get(r.brand);
    if ((r.tier ?? "D") < entry.tier) entry.tier = r.tier ?? "D";
    if (r.dealScore != null) entry.scores.push(parseFloat(r.dealScore));
  }
  const brandOpportunities = [...oppMap.entries()].map(([brand, { tier, scores }]) => ({
    brand,
    tier,
    count: scores.length,
    avgScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
  })).sort((a, b) => a.tier.localeCompare(b.tier) || b.avgScore - a.avgScore);
  return { brandCoverage, categoryCoverage, brandOpportunities };
}
async function getRecentImportRuns(limit) {
  return db.select().from(importMonitorRuns).orderBy(sql7`${importMonitorRuns.startedAt} DESC`).limit(limit);
}
async function updateCandidateStatus(id, status, opts = {}) {
  const now = /* @__PURE__ */ new Date();
  const base = {
    status,
    reviewedAt: now,
    reviewedBy: opts.reviewedBy,
    rejectionReason: opts.rejectionReason,
    updatedAt: now
  };
  if (status === "watching") {
    const rows = await db.select({ dealScore: importCandidates.dealScore, proposedPrice: importCandidates.proposedPrice }).from(importCandidates).where(eq18(importCandidates.id, id)).limit(1);
    if (rows[0]) {
      base.watchScore = rows[0].dealScore;
      base.watchPrice = rows[0].proposedPrice;
    }
  }
  await db.update(importCandidates).set(base).where(eq18(importCandidates.id, id));
}
async function approveAndImport(id) {
  const rows = await db.select().from(importCandidates).where(eq18(importCandidates.id, id)).limit(1);
  const candidate = rows[0];
  if (!candidate) {
    return { ok: false, error: `candidate ${id} not found` };
  }
  const repSku = candidate.sku;
  if (await isSkuAlreadyImported(repSku)) {
    await db.update(importCandidates).set({ status: "imported", updatedAt: /* @__PURE__ */ new Date() }).where(eq18(importCandidates.id, id));
    return { ok: true, skipped: true };
  }
  const feedResult = await fetchAllNalpacFeeds();
  const masters = collapseMasters(feedResult.snapshots);
  const master = masters.find((m) => m.masterKey === candidate.masterKey);
  if (!master) {
    return { ok: false, error: "master no longer in feed" };
  }
  const { axes, variantRows } = detectAxes(master);
  const { importProductGroupRaw: importProductGroupRaw2 } = await Promise.resolve().then(() => (init_bulk_import_server(), bulk_import_server_exports));
  const repSnap = master.snapshots[0];
  const repRow = repSnap.raw.mainRow ?? repSnap.raw.saleRow ?? {};
  const masterRowBase = {
    SKU: repSku,
    "UPC/barcode": master.upcs[0] ?? "",
    "Product Title": master.displayTitle,
    "Product Description": repRow["Product Description"] ?? "",
    Wholesale: String(master.wholesale),
    MSRP: String(master.msrp),
    MAP: master.map > 0 ? String(master.map) : "0",
    "Nalpac qty available": String(master.totalQty),
    "Entrenue qty available": "0",
    "Total qty available": String(master.totalQty),
    "Fluid Oz": master.fluidOz[0] ?? "",
    Brand: master.brand,
    Material: repRow["Material"] ?? "",
    Color: master.colors[0] ?? "",
    "Main Category": repRow["Main Category"] ?? "",
    "Sub-Category": master.category,
    Size: master.sizes[0] ?? "",
    "Image 1": repRow["Image 1"] ?? master.sampleImage ?? "",
    "Image 2": repRow["Image 2"] ?? "",
    "Image 3": repRow["Image 3"] ?? "",
    "Image 4": repRow["Image 4"] ?? "",
    "Image 5": repRow["Image 5"] ?? "",
    "Image 6": repRow["Image 6"] ?? "",
    "Image 7": repRow["Image 7"] ?? "",
    "Image 8": repRow["Image 8"] ?? "",
    "Image 9": repRow["Image 9"] ?? "",
    "Image 10": repRow["Image 10"] ?? "",
    "Master SKU": "",
    "Variant Option Name": axes[0]?.name ?? "",
    "Variant Option Value": variantRows[0]?.optionValues[0] ?? "",
    "Variant Option Name 2": axes[1]?.name ?? "",
    "Variant Option Value 2": variantRows[0]?.optionValues[1] ?? "",
    "Nav Category": "",
    "Nav Path": "",
    Collections: "",
    MPN: ""
  };
  let group;
  if (variantRows.length <= 1 || axes.length === 0) {
    group = { masterRow: masterRowBase, variants: [], isSingleVariant: true };
  } else {
    const variants = variantRows.map((vr) => ({
      sku: vr.sku,
      optionValues: vr.optionValues,
      price: vr.price,
      compareAtPrice: vr.compareAtPrice,
      qty: vr.qty,
      wholesale: vr.wholesale,
      images: vr.images
    }));
    group = { masterRow: masterRowBase, variants, isSingleVariant: false };
  }
  const result = await importProductGroupRaw2(group);
  if (!result.success && !result.skipped) {
    return { ok: false, error: result.error ?? "importProductGroupRaw failed" };
  }
  const dhRows = await db.select({ id: dealHistory.id }).from(dealHistory).where(eq18(dealHistory.sku, repSku)).limit(1);
  const dealHistoryId = dhRows[0]?.id;
  await db.update(importCandidates).set({
    status: "imported",
    dealHistoryId: dealHistoryId ?? null,
    updatedAt: /* @__PURE__ */ new Date()
  }).where(eq18(importCandidates.id, id));
  return {
    ok: true,
    ...result.shopifyProductId !== void 0 ? { shopifyProductId: result.shopifyProductId } : {},
    ...dealHistoryId !== void 0 ? { dealHistoryId } : {}
  };
}
var KV_FEED_SKUS;
var init_import_monitor_server = __esm({
  "app/lib/import-monitor.server.ts"() {
    "use strict";
    init_db_server();
    init_schema();
    init_kv_server();
    init_nalpac_feeds_server();
    init_feed_processor_server();
    init_pricing_webhook_server();
    init_pricing_engine_server();
    init_bulk_import_server();
    init_master_collapse_server();
    KV_FEED_SKUS = "monitor:feed-skus";
  }
});

// server/index.ts
init_sentry_server();
import "dotenv/config";
import express from "express";
import compression from "compression";
import { createRequestHandler } from "@react-router/express";

// server/cron.ts
import { Router } from "express";
import { timingSafeEqual } from "node:crypto";

// server/cron.pricing-batch-recompute.ts
async function handlePricingBatchRecompute(_req, res) {
  try {
    const { recomputeCatalog: recomputeCatalog2 } = await Promise.resolve().then(() => (init_pricing_apply_v2_server(), pricing_apply_v2_server_exports));
    const result = await recomputeCatalog2({ trigger: "batch" });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron:pricing-batch-recompute]", err);
    res.status(500).json({ error: String(err) });
  }
}

// server/cron.ts
function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
async function drainMetaCapiFailures() {
  const MAX_ATTEMPTS2 = 5;
  try {
    const { db: db2 } = await Promise.resolve().then(() => (init_db_server(), db_server_exports));
    const { metaCapiFailures: metaCapiFailures2 } = await Promise.resolve().then(() => (init_schema(), schema_exports));
    const { sendCapiEvent: sendCapiEvent2 } = await Promise.resolve().then(() => (init_meta_capi_server(), meta_capi_server_exports));
    const { and: and5, eq: eq20, isNull: isNull3, lt } = await import("drizzle-orm");
    const rows = await db2.select().from(metaCapiFailures2).where(and5(isNull3(metaCapiFailures2.resolvedAt), lt(metaCapiFailures2.attempts, MAX_ATTEMPTS2))).limit(100);
    let resolved = 0;
    for (const row of rows) {
      const result = await sendCapiEvent2(row.payload, { consentGranted: false });
      if (result.ok) {
        await db2.update(metaCapiFailures2).set({ resolvedAt: /* @__PURE__ */ new Date(), attempts: row.attempts + 1 }).where(eq20(metaCapiFailures2.id, row.id));
        resolved++;
      } else {
        await db2.update(metaCapiFailures2).set({ attempts: row.attempts + 1, lastError: result.error ?? "unknown" }).where(eq20(metaCapiFailures2.id, row.id));
      }
    }
    return resolved;
  } catch (err) {
    console.error("[cron:profit-summary] CAPI drain error:", err);
    return 0;
  }
}
function createCronRoutes() {
  const router = Router();
  const guard = (req, res, next) => {
    const expected = process.env["CRON_SECRET"];
    const headerSecret = req.headers["x-cron-secret"];
    const authHeader = req.headers["authorization"];
    const bearer = typeof authHeader === "string" && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : void 0;
    const provided = typeof headerSecret === "string" ? headerSecret : bearer;
    if (typeof expected !== "string" || expected.length === 0 || typeof provided !== "string" || !safeEqual(provided, expected)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
  const cronRoute = (path, handler) => router.route(path).get(guard, handler).post(guard, handler);
  cronRoute("/daily-feed-processor", async (_req, res) => {
    try {
      const { dailyFeedProcessor: dailyFeedProcessor2 } = await Promise.resolve().then(() => (init_feed_processor_server(), feed_processor_server_exports));
      const result = await dailyFeedProcessor2();
      res.json({ ok: true, topCandidates: result.topCandidates.length, needsImagen: result.needsImagen.length });
    } catch (err) {
      console.error("[cron:daily-feed-processor]", err);
      res.status(500).json({ error: String(err) });
    }
  });
  cronRoute("/deal-activator", async (_req, res) => {
    try {
      const { rotateDeal: rotateDeal2 } = await Promise.resolve().then(() => (init_deal_rotator_server(), deal_rotator_server_exports));
      const result = await rotateDeal2();
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[cron:deal-activator]", err);
      res.status(500).json({ error: String(err) });
    }
  });
  cronRoute("/homepage-healthcheck", async (_req, res) => {
    try {
      const { runHomepageHealthcheck: runHomepageHealthcheck2 } = await Promise.resolve().then(() => (init_homepage_healthcheck_server(), homepage_healthcheck_server_exports));
      const result = await runHomepageHealthcheck2();
      res.status(result.ok ? 200 : 503).json(result);
    } catch (err) {
      console.error("[cron:homepage-healthcheck]", err);
      res.status(500).json({ error: String(err) });
    }
  });
  cronRoute("/profit-summary", async (_req, res) => {
    try {
      const { writeProfitSummary: writeProfitSummary2 } = await Promise.resolve().then(() => (init_profit_server(), profit_server_exports));
      await writeProfitSummary2();
      const capiRetried = await drainMetaCapiFailures();
      res.json({ ok: true, capiRetried });
    } catch (err) {
      console.error("[cron:profit-summary]", err);
      res.status(500).json({ error: String(err) });
    }
  });
  cronRoute("/review-reminders", async (_req, res) => {
    try {
      const { getReviewSettings: getReviewSettings2, getPendingReminderInvites: getPendingReminderInvites2, markReminderSent: markReminderSent2 } = await Promise.resolve().then(() => (init_reviews_server(), reviews_server_exports));
      const settings = await getReviewSettings2();
      if (!settings.remindersEnabled) {
        res.json({ ok: true, skipped: true, reason: "reminders disabled" });
        return;
      }
      const invites = await getPendingReminderInvites2();
      let sent = 0;
      for (const invite of invites) {
        try {
          const { trackEvent: trackEvent2 } = await Promise.resolve().then(() => (init_klaviyo_server(), klaviyo_server_exports));
          await trackEvent2(invite.reviewerEmail, "Review Reminder Sent", {
            orderId: invite.shopifyOrderId,
            productId: invite.shopifyProductId,
            inviteToken: invite.inviteToken,
            reviewerName: invite.reviewerName,
            reminderDate: (/* @__PURE__ */ new Date()).toISOString()
          });
          await markReminderSent2(invite.id);
          sent++;
        } catch (err) {
          console.error("[cron:review-reminders] Failed for invite", invite.id, err);
        }
      }
      res.json({ ok: true, total: invites.length, sent });
    } catch (err) {
      console.error("[cron:review-reminders]", err);
      res.status(500).json({ error: String(err) });
    }
  });
  router.post("/regenerate-emma-rail", guard, async (req, res) => {
    try {
      const railId = typeof req.body?.railId === "string" ? req.body.railId : null;
      if (!railId) {
        res.status(400).json({ error: "railId required" });
        return;
      }
      const trigger = req.body?.trigger === "brief_change" || req.body?.trigger === "agent" ? req.body.trigger : "admin";
      let dealHandle = typeof req.body?.dealHandle === "string" ? req.body.dealHandle : null;
      if (!dealHandle) {
        const { getDailyDeal: getDailyDeal2 } = await Promise.resolve().then(() => (init_shopify_server(), shopify_server_exports));
        const live = await getDailyDeal2().catch(() => null);
        dealHandle = live?.handle ?? null;
      }
      if (!dealHandle) {
        res.status(400).json({ error: "no_live_deal" });
        return;
      }
      const { regenerateRailById: regenerateRailById2 } = await Promise.resolve().then(() => (init_emma_rails_server(), emma_rails_server_exports));
      const result = await regenerateRailById2(railId, dealHandle, trigger);
      res.json({ ok: result.ok, ...result });
    } catch (err) {
      console.error("[cron:regenerate-emma-rail]", err);
      res.status(500).json({ error: String(err) });
    }
  });
  cronRoute("/keyword-research", async (req, res) => {
    try {
      const { runKeywordResearch: runKeywordResearch2 } = await Promise.resolve().then(() => (init_seo_research_server(), seo_research_server_exports));
      const opts = {};
      const rawMaxSeeds = req.body?.maxSeeds ?? (req.query["maxSeeds"] ? Number(req.query["maxSeeds"]) : void 0);
      if (typeof rawMaxSeeds === "number" && !isNaN(rawMaxSeeds)) opts.maxSeeds = rawMaxSeeds;
      const rawManualSeeds = req.body?.manualSeeds ?? (typeof req.query["manualSeeds"] === "string" ? req.query["manualSeeds"].split(",").map((s) => s.trim()).filter(Boolean) : void 0);
      if (Array.isArray(rawManualSeeds)) {
        opts.manualSeeds = rawManualSeeds.filter((s) => typeof s === "string");
      }
      const result = await runKeywordResearch2(opts);
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[cron:keyword-research]", err);
      res.status(500).json({ error: String(err) });
    }
  });
  cronRoute("/log-monitor", async (req, res) => {
    try {
      const { runLogMonitor: runLogMonitor2 } = await Promise.resolve().then(() => (init_log_monitor_server(), log_monitor_server_exports));
      const rawWindow = req.body?.windowMinutes ?? (req.query["windowMinutes"] ? Number(req.query["windowMinutes"]) : void 0);
      const windowMinutes = typeof rawWindow === "number" && !isNaN(rawWindow) ? rawWindow : 15;
      const result = await runLogMonitor2({ windowMinutes });
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[cron:log-monitor]", err);
      res.status(500).json({ error: String(err) });
    }
  });
  cronRoute("/pricing-batch-recompute", handlePricingBatchRecompute);
  cronRoute("/import-monitor", async (_req, res) => {
    try {
      const { getPipelineSetting: getPipelineSetting2 } = await Promise.resolve().then(() => (init_feed_processor_server(), feed_processor_server_exports));
      const enabled = await getPipelineSetting2("import_monitor_enabled");
      if (enabled === "false") {
        res.json({ ok: true, skipped: true, reason: "monitor_disabled" });
        return;
      }
      const runDaysSetting = await getPipelineSetting2("import_monitor_run_days");
      const runDays = (runDaysSetting ?? "0,1,2,3,4,5,6").split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
      const todayUtcDay = (/* @__PURE__ */ new Date()).getUTCDay();
      if (!runDays.includes(todayUtcDay)) {
        res.json({ ok: true, skipped: true, reason: `not_scheduled_today (day=${todayUtcDay})` });
        return;
      }
      const { runImportMonitor: runImportMonitor2 } = await Promise.resolve().then(() => (init_import_monitor_server(), import_monitor_server_exports));
      const result = await runImportMonitor2({ source: "cron" });
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[cron:import-monitor]", err);
      res.status(500).json({ error: String(err) });
    }
  });
  cronRoute("/import-enrich", async (_req, res) => {
    const { kvSetNX: kvSetNX2, kvDel: kvDel2 } = await Promise.resolve().then(() => (init_kv_server(), kv_server_exports));
    const acquired = await kvSetNX2("lock:import-enrich", String(Date.now()), 110);
    if (!acquired) {
      res.json({ ok: true, skipped: "locked" });
      return;
    }
    try {
      const { runImportEnrichTick: runImportEnrichTick2 } = await Promise.resolve().then(() => (init_import_enrich_server(), import_enrich_server_exports));
      const result = await runImportEnrichTick2({ source: "cron" });
      res.json(result);
    } catch (err) {
      console.error("[cron:import-enrich]", err);
      res.status(500).json({ error: String(err) });
    } finally {
      await kvDel2("lock:import-enrich");
    }
  });
  cronRoute("/enrichment-batch-poller", async (_req, res) => {
    const { kvSetNX: kvSetNX2, kvDel: kvDel2 } = await Promise.resolve().then(() => (init_kv_server(), kv_server_exports));
    const acquired = await kvSetNX2("lock:enrichment-poller", String(Date.now()), 110);
    if (!acquired) {
      res.json({ ok: true, skipped: "locked" });
      return;
    }
    try {
      const { advanceInflightJobs: advanceInflightJobs2 } = await Promise.resolve().then(() => (init_batch_orchestrator_server(), batch_orchestrator_server_exports));
      const result = await advanceInflightJobs2({ maxJobs: 10, perJobBudgetMs: 8e3 });
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[cron:enrichment-batch-poller]", err);
      res.status(500).json({ error: String(err) });
    } finally {
      await kvDel2("lock:enrichment-poller");
    }
  });
  cronRoute("/aeo-surface-check", async (_req, res) => {
    const siteUrl = process.env["BASE_URL"] ?? process.env["SITE_URL"] ?? "";
    if (!siteUrl) {
      console.error("[cron:aeo-surface-check] BASE_URL / SITE_URL not set \u2014 skipping");
      res.json({ ok: true, skipped: true, reason: "BASE_URL not set" });
      return;
    }
    const results = [];
    try {
      const llmsRes = await fetch(`${siteUrl}/llms.txt`, { headers: { "Cache-Control": "no-cache" } });
      if (!llmsRes.ok) {
        console.error(`[cron:aeo-surface-check] /llms.txt returned ${llmsRes.status}`);
        res.json({ ok: false, llmsStatus: llmsRes.status, results });
        return;
      }
      const llmsText = await llmsRes.text();
      const mdUrls = [...llmsText.matchAll(/https:\/\/[^\s)]+\.md/g)].map((m) => m[0]).filter((u, i, arr) => arr.indexOf(u) === i).slice(0, 5);
      await Promise.allSettled(
        mdUrls.map(async (url) => {
          try {
            const r = await fetch(url, { headers: { "Cache-Control": "no-cache" } });
            const ct = r.headers.get("content-type") ?? "";
            const ok = r.ok && ct.includes("text/markdown");
            if (!ok) {
              console.error(
                `[cron:aeo-surface-check] ${url} returned status=${r.status} content-type="${ct}"`
              );
            }
            results.push({ url, status: r.status, ok });
          } catch (err) {
            console.error(`[cron:aeo-surface-check] fetch failed for ${url}:`, err);
            results.push({ url, status: 0, ok: false, error: String(err) });
          }
        })
      );
      const failures = results.filter((r) => !r.ok);
      if (failures.length > 0) {
        console.error(
          `[cron:aeo-surface-check] ${failures.length} of ${results.length} .md URLs failed`,
          failures
        );
      }
      res.json({ ok: failures.length === 0, checked: results.length, failures: failures.length, results });
    } catch (err) {
      console.error("[cron:aeo-surface-check]", err);
      res.status(500).json({ error: String(err) });
    }
  });
  cronRoute("/inventory-check", async (_req, res) => {
    try {
      const { isLiveDealSoldOut: isLiveDealSoldOut2, rotateDeal: rotateDeal2 } = await Promise.resolve().then(() => (init_deal_rotator_server(), deal_rotator_server_exports));
      const { soldOut } = await isLiveDealSoldOut2();
      if (soldOut) {
        console.log("[cron:inventory-check] Live deal sold out \u2014 rotating");
        const result = await rotateDeal2();
        res.json({ ok: true, rotated: true, ...result });
      } else {
        res.json({ ok: true, rotated: false });
      }
    } catch (err) {
      console.error("[cron:inventory-check]", err);
      res.status(500).json({ error: String(err) });
    }
  });
  router.post("/warm-discovery-index", guard, async (_req, res) => {
    try {
      const {
        buildDiscoveryIndex: buildDiscoveryIndex2,
        computeVocab: computeVocab2,
        writeDiscoveryIndexDurable: writeDiscoveryIndexDurable2
      } = await Promise.resolve().then(() => (init_discovery_server(), discovery_server_exports));
      const fresh = await buildDiscoveryIndex2();
      if (fresh.length > 0) {
        const vocab = computeVocab2(fresh);
        await writeDiscoveryIndexDurable2(fresh, vocab);
        console.log(`[cron:warm-discovery-index] wrote ${fresh.length} products to KV + Neon`);
      }
      res.json({ ok: true, count: fresh.length });
    } catch (err) {
      console.error("[cron:warm-discovery-index]", err);
      res.status(500).json({ error: String(err) });
    }
  });
  cronRoute("/warm-homepage", async (_req, res) => {
    try {
      const { warmHomepagePayloadA: warmHomepagePayloadA2 } = await Promise.resolve().then(() => (init_homepage_payload_server(), homepage_payload_server_exports));
      const p = await warmHomepagePayloadA2({ force: true });
      res.json({
        ok: true,
        degraded: p.degraded,
        bytes: JSON.stringify(p).length,
        sections: p.sections.length,
        rails: p.rails.length
      });
    } catch (err) {
      console.error("[cron:warm-homepage]", err);
      res.status(500).json({ error: String(err) });
    }
  });
  router.post("/warm", guard, async (_req, res) => {
    try {
      const baseUrl = process.env["BASE_URL"] ?? "";
      const cronSecret = process.env["CRON_SECRET"] ?? "";
      let discoveryCount = 0;
      if (baseUrl && cronSecret) {
        try {
          const r = await fetch(`${baseUrl}/cron/warm-discovery-index`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${cronSecret}` }
          });
          if (r.ok) {
            const body = await r.json();
            discoveryCount = body.count ?? 0;
          }
        } catch (err) {
          console.warn("[cron:warm] discovery rebuild fetch failed:", err);
        }
      }
      let homepageBytes = 0;
      let homepageRails = 0;
      try {
        const { warmHomepagePayloadA: warmHomepagePayloadA2 } = await Promise.resolve().then(() => (init_homepage_payload_server(), homepage_payload_server_exports));
        const p = await warmHomepagePayloadA2({ force: false });
        homepageBytes = JSON.stringify(p).length;
        homepageRails = p.rails.length;
      } catch (err) {
        console.warn("[cron:warm] homepage payload warm failed:", err);
      }
      let liveHandle = null;
      try {
        const { kvGet: kvGet2, KV_KEYS: KV_KEYS2 } = await Promise.resolve().then(() => (init_kv_server(), kv_server_exports));
        liveHandle = await kvGet2(KV_KEYS2.liveDealHandle) ?? null;
      } catch (err) {
        console.warn("[cron:warm] could not resolve live deal handle:", err);
      }
      const pagesWarmed = [];
      if (baseUrl) {
        const targets = ["/", liveHandle ? `/products/${liveHandle}` : null].filter(Boolean);
        await Promise.allSettled(
          targets.map(async (path) => {
            const url = `${baseUrl}${path}`;
            try {
              await fetch(url, {
                headers: { "Cache-Control": "no-cache" }
              });
              pagesWarmed.push(url);
            } catch (err) {
              console.warn(`[cron:warm] CDN warm failed for ${url}:`, err);
            }
          })
        );
      }
      res.json({ ok: true, discoveryProducts: discoveryCount, pagesWarmed, homepageBytes, homepageRails });
    } catch (err) {
      console.error("[cron:warm]", err);
      res.status(500).json({ error: String(err) });
    }
  });
  return router;
}

// server/webhooks.js
init_db_server();
init_schema();
init_shopify_server();
import { Router as Router2 } from "express";
import crypto3 from "node:crypto";
import { eq as eq19 } from "drizzle-orm";
function verifyShopifyWebhook(req) {
  const secret = process.env["SHOPIFY_WEBHOOK_SECRET"];
  if (!secret)
    return false;
  const hmac = req.headers["x-shopify-hmac-sha256"];
  const body = req.body;
  const digest = crypto3.createHmac("sha256", secret).update(body).digest("base64");
  return crypto3.timingSafeEqual(Buffer.from(hmac ?? ""), Buffer.from(digest));
}
async function handleOrderCreated(order) {
  for (const lineItem of order.line_items) {
    const cost = await getWholesaleCostBySKU(lineItem.sku).catch(() => 0);
    const profit = parseFloat(lineItem.price) - cost;
    await shopifyAdmin(`/orders/${order.id}/metafields.json`, "POST", {
      metafield: {
        namespace: "xdipx",
        key: `profit_${lineItem.sku}`,
        value: JSON.stringify({
          sku: lineItem.sku,
          wholesale_cost: cost,
          deal_price: parseFloat(lineItem.price),
          profit_per_unit: profit,
          quantity: lineItem.quantity,
          total_profit: profit * lineItem.quantity
        }),
        type: "json"
      }
    }).catch((err) => console.error("[webhook] metafield write failed:", err));
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    await db.update(dealHistory).set({
      unitsSold: db.$count(dealHistory, eq19(dealHistory.sku, lineItem.sku)),
      // increment handled via raw SQL
      totalRevenue: String(parseFloat(lineItem.price) * lineItem.quantity),
      totalProfit: String(profit * lineItem.quantity)
    }).where(eq19(dealHistory.sku, lineItem.sku)).catch(() => {
    });
  }
  const refCode = order.note_attributes?.find((a) => a.name === "ref_source")?.value;
  if (refCode) {
    await db.insert(referrals).values({
      refCode,
      referrerType: "affiliate",
      referredCustomerId: order.customer?.id ? String(order.customer.id) : null,
      firstOrderId: String(order.id),
      firstOrderValue: order.total_price
    }).catch(() => {
    });
  }
  const tosVersion = order.note_attributes?.find((a) => a.name === "tos_version")?.value;
  if (tosVersion && order.customer?.id) {
    const { logTosAcceptance: logTosAcceptance2 } = await Promise.resolve().then(() => (init_consent_server(), consent_server_exports));
    const fakeRequest = new Request("https://xdipx.com");
    await logTosAcceptance2(fakeRequest, {
      customerId: String(order.customer.id),
      email: order.email,
      tosVersion,
      method: "checkout"
    }).catch(() => {
    });
  }
}
async function handleOrderFulfilled(order) {
  if (!order.email || order.line_items.length === 0)
    return;
  const { getReviewSettings: getReviewSettings2, createInvite: createInvite2 } = await Promise.resolve().then(() => (init_reviews_server(), reviews_server_exports));
  const settings = await getReviewSettings2();
  const delayMs = settings.inviteDelayDays * 24 * 60 * 60 * 1e3;
  setTimeout(async () => {
    for (const lineItem of order.line_items) {
      if (!lineItem.sku)
        continue;
      const searchRes = await shopifyAdmin(`/products.json?limit=1&sku=${encodeURIComponent(lineItem.sku)}`, "GET").catch(() => null);
      const productId = searchRes?.products?.[0]?.id;
      if (!productId)
        continue;
      const shopifyProductId = `gid://shopify/Product/${productId}`;
      const reviewerName = [
        order.customer?.first_name,
        order.customer?.last_name
      ].filter(Boolean).join(" ") || "Customer";
      await createInvite2({
        shopifyOrderId: String(order.id),
        shopifyCustomerId: order.customer?.id ? String(order.customer.id) : void 0,
        shopifyProductId,
        reviewerEmail: order.email,
        reviewerName
      }).catch((err) => console.error("[webhook:invite-create]", err));
      const { trackEvent: trackEvent2 } = await Promise.resolve().then(() => (init_klaviyo_server(), klaviyo_server_exports));
      await trackEvent2(order.email, "Review Invite Sent", {
        orderId: order.id,
        productId: shopifyProductId,
        productName: lineItem.title,
        inviteDate: (/* @__PURE__ */ new Date()).toISOString()
      }).catch(() => {
      });
    }
  }, delayMs);
}
async function handleProductCreated(product) {
  const { upsertProductPage: upsertProductPage2 } = await Promise.resolve().then(() => (init_sanity_server(), sanity_server_exports));
  const gid = `gid://shopify/Product/${product.id}`;
  const result = await upsertProductPage2({
    handle: product.handle,
    shopifyProductId: gid,
    title: product.title,
    imageUrl: product.images?.[0]?.src
  });
  console.log(`[webhook:product-created] ${product.handle} \u2192 ${result.created ? "created in Sanity" : "already exists"}`);
}
async function handleInventoryUpdate(level) {
  if (level.available > 0)
    return;
  const { isLiveDealSoldOut: isLiveDealSoldOut2, rotateDeal: rotateDeal2 } = await Promise.resolve().then(() => (init_deal_rotator_server(), deal_rotator_server_exports));
  const { soldOut } = await isLiveDealSoldOut2();
  if (soldOut) {
    console.log("[webhook:inventory-update] Live deal sold out \u2014 rotating to next deal");
    const result = await rotateDeal2();
    console.log("[webhook:inventory-update] Rotation result:", result);
  }
}
function createWebhookRoutes() {
  const router = Router2();
  router.post("/order-created", async (req, res) => {
    if (!verifyShopifyWebhook(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const order = JSON.parse(req.body.toString());
    res.json({ ok: true });
    handleOrderCreated(order).catch((err) => console.error("[webhook:order-created]", err));
  });
  router.post("/order-fulfilled", async (req, res) => {
    if (!verifyShopifyWebhook(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const order = JSON.parse(req.body.toString());
    res.json({ ok: true });
    handleOrderFulfilled(order).catch((err) => console.error("[webhook:order-fulfilled]", err));
  });
  router.post("/product-created", async (req, res) => {
    if (!verifyShopifyWebhook(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const product = JSON.parse(req.body.toString());
    res.json({ ok: true });
    handleProductCreated(product).catch((err) => console.error("[webhook:product-created]", err));
  });
  router.post("/inventory-update", async (req, res) => {
    if (!verifyShopifyWebhook(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const level = JSON.parse(req.body.toString());
    res.json({ ok: true });
    handleInventoryUpdate(level).catch((err) => console.error("[webhook:inventory-update]", err));
  });
  return router;
}

// server/mcp-route.ts
import { Router as Router3 } from "express";
import { timingSafeEqual as timingSafeEqual2 } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// app/lib/mcp-seo-bank.server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createClient as createClient8 } from "@sanity/client";
var projectId8 = process.env["SANITY_PROJECT_ID"];
var dataset8 = process.env["SANITY_DATASET"] ?? "production";
var apiVersion8 = "2024-10-01";
function getWriteClient3() {
  if (!projectId8) return null;
  return createClient8({
    projectId: projectId8,
    dataset: dataset8,
    apiVersion: apiVersion8,
    useCdn: false,
    token: process.env["SANITY_API_TOKEN"],
    perspective: "raw"
  });
}
function textResult(text2) {
  return { content: [{ type: "text", text: text2 }] };
}
function jsonResult(value) {
  return textResult(JSON.stringify(value, null, 2));
}
async function resolveKeywordId(idOrTerm) {
  const client4 = getWriteClient3();
  if (!client4) return null;
  if (idOrTerm.startsWith("seoKeyword.")) return idOrTerm;
  const row = await client4.fetch(
    `*[_type == "seoKeyword" && lower(term) == lower($term)][0]{ _id }`,
    { term: idOrTerm }
  );
  return row?._id ?? null;
}
function buildMcpServer() {
  const server = new McpServer({ name: "xdipx-seo-bank", version: "0.1.0" });
  server.registerTool(
    "list_keywords",
    {
      title: "List keywords",
      description: "Browse the SEO keyword bank with filters. Defaults to pending status so the agent triages the gray zone first. Returns the term, status, kind, intent, volume, difficulty, relevanceScore, cluster slug, and tag arrays. Useful for: triage, finding gaps, locating duplicates.",
      inputSchema: {
        status: z.enum(["pending", "approved", "rejected", "archived"]).optional().describe('Defaults to "pending".'),
        kind: z.enum(["head", "long-tail", "question", "branded"]).optional(),
        intent: z.enum(["informational", "transactional", "navigational", "commercial"]).optional(),
        clusterSlug: z.string().optional().describe("Filter to one cluster by slug."),
        minVolume: z.number().optional(),
        maxDifficulty: z.number().optional(),
        flagged: z.boolean().optional(),
        search: z.string().optional().describe("Substring match on the term."),
        limit: z.number().min(1).max(200).optional().describe("Defaults to 50."),
        offset: z.number().min(0).optional()
      }
    },
    async (args) => {
      const client4 = getWriteClient3();
      if (!client4) return textResult("Sanity not configured.");
      const status = args.status ?? "pending";
      const limit = args.limit ?? 50;
      const offset = args.offset ?? 0;
      const filters = [`_type == "seoKeyword"`, `status == $status`];
      const params = { status, limit, offset };
      if (args.kind) {
        filters.push(`kind == $kind`);
        params.kind = args.kind;
      }
      if (args.intent) {
        filters.push(`intent == $intent`);
        params.intent = args.intent;
      }
      if (args.clusterSlug) {
        filters.push(`cluster->slug.current == $clusterSlug`);
        params.clusterSlug = args.clusterSlug;
      }
      if (args.minVolume != null) {
        filters.push(`volume >= $minVolume`);
        params.minVolume = args.minVolume;
      }
      if (args.maxDifficulty != null) {
        filters.push(`difficulty <= $maxDifficulty`);
        params.maxDifficulty = args.maxDifficulty;
      }
      if (args.flagged != null) {
        filters.push(`flagged == $flagged`);
        params.flagged = args.flagged;
      }
      if (args.search) {
        filters.push(`term match $search`);
        params.search = `*${args.search}*`;
      }
      const groq = `*[${filters.join(" && ")}] | order(coalesce(relevanceScore, 0) desc, coalesce(volume, 0) desc) [$offset...$offset + $limit] {
        _id, term, kind, intent, volume, difficulty, cpc, relevanceScore,
        productTypeDials, moodTags, audienceTags, mattersTags, contentTypes,
        status, flagged, flagReason,
        "cluster": cluster->{ "slug": slug.current, title, pillarTerm }
      }`;
      const rows = await client4.fetch(groq, params);
      const total = await client4.fetch(`count(*[${filters.join(" && ")}])`, params);
      return jsonResult({ total, returned: Array.isArray(rows) ? rows.length : 0, offset, limit, keywords: rows });
    }
  );
  server.registerTool(
    "approve_keyword",
    {
      title: "Approve keyword",
      description: 'Flip a keyword to status="approved" AND clear flagged=false (approval implicitly unflags \u2014 the gen-time filter requires both `status="approved"` AND `flagged != true`, so an approved-but-still-flagged keyword would be silently excluded). Pass either the Sanity _id (preferred) or the term string. The optional reason is stored on the doc\'s notes field for audit.',
      inputSchema: {
        idOrTerm: z.string().describe("Sanity _id or the exact term."),
        reason: z.string().optional()
      }
    },
    async (args) => {
      const client4 = getWriteClient3();
      if (!client4) return textResult("Sanity not configured.");
      const id = await resolveKeywordId(args.idOrTerm);
      if (!id) return textResult(`No keyword found for "${args.idOrTerm}".`);
      const patch = { status: "approved", flagged: false };
      if (args.reason) patch.notes = args.reason;
      await client4.patch(id).set(patch).commit();
      return textResult(`\u2713 approved (unflagged) \xB7 ${id}`);
    }
  );
  server.registerTool(
    "reject_keyword",
    {
      title: "Reject keyword",
      description: 'Flip a keyword to status="rejected". Rejected terms are excluded from generation and added to the <avoid> list passed to Claude during copy generation. Use for: off-brand, competitor brand names, genuinely irrelevant terms, "not in catalog" mismatches. Does NOT change the flagged field \u2014 if a term is rejected AND flagged, it just stays both. Optional reason \u2192 notes for audit.',
      inputSchema: {
        idOrTerm: z.string(),
        reason: z.string().optional()
      }
    },
    async (args) => {
      const client4 = getWriteClient3();
      if (!client4) return textResult("Sanity not configured.");
      const id = await resolveKeywordId(args.idOrTerm);
      if (!id) return textResult(`No keyword found for "${args.idOrTerm}".`);
      const patch = { status: "rejected" };
      if (args.reason) patch.notes = args.reason;
      await client4.patch(id).set(patch).commit();
      return textResult(`\u2717 rejected \xB7 ${id}`);
    }
  );
  server.registerTool(
    "flag_keyword",
    {
      title: "Flag keyword",
      description: 'Set flagged=true on a keyword. Flagged terms are excluded from generation regardless of status. ONLY use for the three valid policy categories: (1) off-brand competitor name (KY, Womanizer, We-Vibe, etc.), (2) regulated medical/efficacy claim ("treats X", "doctor recommended"), (3) explicit-only term outside the tasteful catalog. NOT for "not in catalog" mismatches (use reject_keyword for those) or "borders on competitor comparison" softness (those are usually category descriptors that should be approved). Use unflag_keyword to undo.',
      inputSchema: {
        idOrTerm: z.string(),
        reason: z.string().describe("One-line reason. Must fit one of the three policy categories above.")
      }
    },
    async (args) => {
      const client4 = getWriteClient3();
      if (!client4) return textResult("Sanity not configured.");
      const id = await resolveKeywordId(args.idOrTerm);
      if (!id) return textResult(`No keyword found for "${args.idOrTerm}".`);
      await client4.patch(id).set({ flagged: true, flagReason: args.reason }).commit();
      return textResult(`\u2691 flagged \xB7 ${id} \xB7 ${args.reason}`);
    }
  );
  server.registerTool(
    "unflag_keyword",
    {
      title: "Unflag keyword",
      description: "Clear flagged=false on a keyword without changing its status (use approve_keyword if you also want to approve in one shot \u2014 that does both). Use this when the keyword was over-flagged but you want to leave it in pending for further review, OR to clear a flag on an already-approved keyword that approve_keyword may have missed (older code paths). Optional reason replaces flagReason for audit.",
      inputSchema: {
        idOrTerm: z.string(),
        reason: z.string().optional().describe('Replaces flagReason on the doc, e.g. "false-positive: category descriptor".')
      }
    },
    async (args) => {
      const client4 = getWriteClient3();
      if (!client4) return textResult("Sanity not configured.");
      const id = await resolveKeywordId(args.idOrTerm);
      if (!id) return textResult(`No keyword found for "${args.idOrTerm}".`);
      const patch = { flagged: false };
      patch.flagReason = args.reason ?? null;
      await client4.patch(id).set(patch).commit();
      return textResult(`\u2713 unflagged \xB7 ${id}`);
    }
  );
  server.registerTool(
    "bulk_update_status",
    {
      title: "Bulk update status (mixed verdicts)",
      description: 'Apply MIXED status updates to up to 50 keywords in one tool call. Each update is an independent { idOrTerm, status, reason? } object \u2014 so a single call can approve some, reject others, and pending the rest. Much faster than per-keyword calls. When an update sets status="approved", flagged is also cleared on that doc (matches approve_keyword behavior). Other statuses leave flagged untouched. Returns per-update success/failure. Use this for triage batches; use unflag_keyword separately if you want to clear flags without any status change.',
      inputSchema: {
        updates: z.array(z.object({
          idOrTerm: z.string().describe("Sanity _id or exact term."),
          status: z.enum(["approved", "rejected", "pending", "archived"]),
          reason: z.string().optional().describe("Stored on the doc's notes field.")
        })).min(1).max(50)
      }
    },
    async (args) => {
      const client4 = getWriteClient3();
      if (!client4) return textResult("Sanity not configured.");
      const results = [];
      for (const u of args.updates) {
        try {
          const id = await resolveKeywordId(u.idOrTerm);
          if (!id) {
            results.push({ idOrTerm: u.idOrTerm, status: u.status, resolvedId: null, ok: false, error: "not found" });
            continue;
          }
          const patch = { status: u.status };
          if (u.status === "approved") patch.flagged = false;
          if (u.reason) patch.notes = u.reason;
          await client4.patch(id).set(patch).commit();
          results.push({ idOrTerm: u.idOrTerm, status: u.status, resolvedId: id, ok: true });
        } catch (err) {
          results.push({
            idOrTerm: u.idOrTerm,
            status: u.status,
            resolvedId: null,
            ok: false,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
      const byStatus = {};
      for (const r of results) {
        if (r.ok) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      }
      const summary = {
        total: results.length,
        ok: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        byStatus
      };
      return jsonResult({ summary, results });
    }
  );
  server.registerTool(
    "bank_stats",
    {
      title: "Bank statistics",
      description: "Summary of the keyword bank: total keywords, counts by status, count of clusters, count of flagged terms, and the most-recent research run timestamp. Cheap call \u2014 useful as a sanity check before / after triage sessions.",
      inputSchema: {}
    },
    async () => {
      const client4 = getWriteClient3();
      if (!client4) return textResult("Sanity not configured.");
      const stats = await client4.fetch(`{
        "total":    count(*[_type == "seoKeyword"]),
        "approved": count(*[_type == "seoKeyword" && status == "approved"]),
        "pending":  count(*[_type == "seoKeyword" && status == "pending"]),
        "rejected": count(*[_type == "seoKeyword" && status == "rejected"]),
        "archived": count(*[_type == "seoKeyword" && status == "archived"]),
        "flagged":  count(*[_type == "seoKeyword" && flagged == true]),
        "clusters": count(*[_type == "seoCluster" && status != "archived"]),
        "lastResearched": *[_type == "seoKeyword"] | order(lastResearchedAt desc)[0].lastResearchedAt
      }`);
      return jsonResult(stats);
    }
  );
  server.registerTool(
    "trigger_research",
    {
      title: "Trigger keyword research",
      description: "Run the SEO research pipeline on demand (DataForSEO + LLM clusterer + Sanity write). Defaults to pulling seeds from existing clusters + approved heads + product titles. Pass manualSeeds to research specific terms. Costs ~$0.05 per seed when DataForSEO is configured. Returns a summary including how many candidates were written.",
      inputSchema: {
        manualSeeds: z.array(z.string()).optional().describe("Specific terms to seed the run with. Each gets its own related-keywords expansion."),
        maxSeeds: z.number().min(1).max(80).optional().describe("Cap the seed count. Defaults to 80.")
      }
    },
    async (args) => {
      const cronSecret = process.env["CRON_SECRET"];
      const baseUrl = process.env["MCP_CRON_BASE_URL"] ?? `http://localhost:${process.env["PORT"] ?? 3e3}`;
      if (!cronSecret) return textResult("CRON_SECRET not set \u2014 cannot trigger research.");
      const body = {};
      if (args.manualSeeds?.length) body.manualSeeds = args.manualSeeds;
      if (typeof args.maxSeeds === "number") body.maxSeeds = args.maxSeeds;
      try {
        const res = await fetch(`${baseUrl}/cron/keyword-research`, {
          method: "POST",
          headers: { "x-cron-secret": cronSecret, "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({ raw: "unparseable response" }));
        if (!res.ok) return jsonResult({ ok: false, status: res.status, ...data });
        return jsonResult(data);
      } catch (err) {
        return textResult(`Research call failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );
  return server;
}

// server/mcp-route.ts
function safeBearerCheck(req) {
  const expected = process.env["MCP_BEARER_TOKEN"];
  if (!expected || expected.length === 0) return false;
  const auth = req.headers["authorization"];
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) return false;
  const provided = auth.slice("Bearer ".length).trim();
  if (provided.length !== expected.length) return false;
  return timingSafeEqual2(Buffer.from(provided), Buffer.from(expected));
}
function createMcpRoutes() {
  const router = Router3();
  router.get("/health", (_req, res) => {
    const enabled = !!process.env["MCP_BEARER_TOKEN"];
    res.json({ ok: true, enabled, server: "xdipx-seo-bank", version: "0.1.0" });
  });
  router.all("/seo-bank", async (req, res) => {
    if (!process.env["MCP_BEARER_TOKEN"]) {
      res.status(503).json({ error: "MCP not configured (MCP_BEARER_TOKEN unset)" });
      return;
    }
    if (!safeBearerCheck(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: void 0 });
      const server = buildMcpServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[mcp:seo-bank]", err);
      if (!res.headersSent) {
        res.status(500).json({ error: String(err) });
      }
    }
  });
  return router;
}

// app/lib/env.server.ts
var isProd = process.env["NODE_ENV"] === "production";
var REQUIRED_IN_PRODUCTION = [
  "SESSION_SECRET",
  "CRON_SECRET",
  "SHOPIFY_WEBHOOK_SECRET",
  "SHOPIFY_STORE_DOMAIN",
  "SHOPIFY_STOREFRONT_TOKEN",
  "DATABASE_URL",
  "ANTHROPIC_API_KEY",
  "APP_URL",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "IVR_WS_URL",
  "IVR_WS_SECRET",
  "ELEVENLABS_VOICE_ID_IVR",
  "INTERNAL_API_SECRET",
  "META_PIXEL_ID",
  "META_CAPI_TOKEN"
];
function validateStartupEnv() {
  if (!isProd) return;
  const missing = REQUIRED_IN_PRODUCTION.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`[env] Missing required env vars in production: ${missing.join(", ")}`);
  }
}

// server/index.ts
initSentryServer();
var isProduction = process.env["NODE_ENV"] === "production";
validateStartupEnv();
var viteDevServer = isProduction ? void 0 : await import("vite").then(
  (vite) => vite.createServer({
    server: { middlewareMode: true },
    appType: "custom"
  })
);
var app = express();
app.use(compression());
if (!viteDevServer) {
  app.use(
    "/assets",
    express.static("build/client/assets", { immutable: true, maxAge: "1y" })
  );
  app.use(express.static("build/client", { maxAge: "1h" }));
}
if (viteDevServer) {
  app.use(viteDevServer.middlewares);
}
app.use("/cron", express.json({ limit: "64kb" }), createCronRoutes());
app.use("/mcp", express.json({ limit: "1mb" }), createMcpRoutes());
app.use(
  "/webhooks",
  express.raw({ type: "application/json", limit: "1mb" }),
  createWebhookRoutes()
);
var STUDIO_ORIGINS = new Set(
  (process.env["STUDIO_ALLOWED_ORIGINS"] ?? "http://localhost:3333").split(",").map((o) => o.trim()).filter(Boolean)
);
app.use("/api/", (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && STUDIO_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-studio-secret");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});
var build = viteDevServer ? () => viteDevServer.ssrLoadModule(
  "virtual:react-router/server-build"
) : await import(
  // @ts-expect-error — resolved at runtime after `react-router build`
  "../build/server/index.js"
);
app.all(
  "*",
  createRequestHandler({
    build,
    getLoadContext() {
      return {};
    }
  })
);
var port = process.env["PORT"] ?? 3e3;
app.listen(port, () => {
  console.log(`
\u{1F30A} xdipx running on http://localhost:${port}
`);
});
var index_default = app;
export {
  index_default as default
};

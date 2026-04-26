var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// app/lib/kv.server.ts
async function getKV() {
  if (_kv) return _kv;
  if (!process.env["KV_REST_API_URL"] || !process.env["KV_REST_API_TOKEN"]) return null;
  const { createClient: createClient5 } = await import("@vercel/kv");
  _kv = createClient5({
    url: process.env["KV_REST_API_URL"],
    token: process.env["KV_REST_API_TOKEN"]
  });
  return _kv;
}
async function kvGet(key) {
  const kv = await getKV();
  if (kv) return kv.get(key);
  return memStore.get(key) ?? null;
}
async function kvSet(key, value, _exSeconds) {
  const kv = await getKV();
  if (kv) {
    if (_exSeconds) {
      await kv.set(key, value, { ex: _exSeconds });
    } else {
      await kv.set(key, value);
    }
    return;
  }
  memStore.set(key, value);
}
async function kvDel(key) {
  const kv = await getKV();
  if (kv) {
    await kv.del(key);
    return;
  }
  memStore.delete(key);
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
var _kv, _g, memStore, _g2, readCache, KV_KEYS;
var init_kv_server = __esm({
  "app/lib/kv.server.ts"() {
    "use strict";
    _kv = null;
    _g = globalThis;
    if (!_g.__kvMemStore) _g.__kvMemStore = /* @__PURE__ */ new Map();
    memStore = _g.__kvMemStore;
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
      emmaEncouragementDailyCount: (utcDate) => `emmaEncouragement:dailyCount:${utcDate}`
    };
  }
});

// db/schema.ts
var schema_exports = {};
__export(schema_exports, {
  adminRoles: () => adminRoles,
  callLog: () => callLog,
  colorSwatchCache: () => colorSwatchCache,
  consentLog: () => consentLog,
  customerAnniversaries: () => customerAnniversaries,
  customerProfileExtras: () => customerProfileExtras,
  dailyProfitSummary: () => dailyProfitSummary,
  dealHistory: () => dealHistory,
  draftOrders: () => draftOrders,
  emmaChatEvents: () => emmaChatEvents,
  emmaChatSessions: () => emmaChatSessions,
  emmaChatTurns: () => emmaChatTurns,
  ivrVoices: () => ivrVoices,
  orderLineItems: () => orderLineItems,
  pdpDialVotes: () => pdpDialVotes,
  pdpProductVotes: () => pdpProductVotes,
  pipelineSettings: () => pipelineSettings,
  productCopurchase: () => productCopurchase,
  referrals: () => referrals,
  returns: () => returns,
  smsAgeConsent: () => smsAgeConsent,
  smsMessages: () => smsMessages,
  smsOptouts: () => smsOptouts,
  socialPosts: () => socialPosts,
  tosAcceptance: () => tosAcceptance,
  tosVersions: () => tosVersions,
  voicemails: () => voicemails,
  wishlistItems: () => wishlistItems,
  wishlists: () => wishlists
});
import {
  boolean,
  date,
  decimal,
  index,
  integer,
  json,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from "drizzle-orm/pg-core";
var dealHistory, consentLog, tosAcceptance, tosVersions, referrals, dailyProfitSummary, pipelineSettings, customerProfileExtras, customerAnniversaries, socialPosts, adminRoles, orderLineItems, wishlists, wishlistItems, pdpDialVotes, pdpProductVotes, callLog, voicemails, smsOptouts, smsMessages, smsAgeConsent, draftOrders, returns, emmaChatSessions, emmaChatTurns, emmaChatEvents, ivrVoices, colorSwatchCache, productCopurchase;
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
      status: varchar("status", { length: 20 }).default("queued").notNull(),
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
      createdAt: timestamp("created_at").defaultNow().notNull()
    }, (t) => ({
      phoneIdx: index("sms_messages_phone_idx").on(t.phone, t.createdAt),
      createdIdx: index("sms_messages_created_idx").on(t.createdAt)
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
  }
});

// app/lib/db.server.ts
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

// app/lib/feed-processor.server.ts
import { parse } from "csv-parse/sync";
import { sql as sql2, eq } from "drizzle-orm";
async function getPipelineSetting(key) {
  try {
    const rows = await db.select({ value: pipelineSettings.value }).from(pipelineSettings).where(eq(pipelineSettings.key, key)).limit(1);
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
  const feedUrl = await getPipelineSetting("feedUrl") || process.env["NALPAC_FEED_URL"] || "";
  if (!feedUrl) throw new Error("No feed URL configured. Set NALPAC_FEED_URL env var or configure in Admin \u2192 Settings.");
  const res = await fetch(feedUrl);
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
function parseCategories(raw) {
  return raw.split(",").map((c) => c.trim()).filter(Boolean);
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
function isEligible(product, recentSkus, blockedBrands) {
  const qty = parseInt(product["Total qty available"] ?? "0");
  const wholesale = parseFloat(product["Wholesale"] ?? "0");
  const msrp = parseFloat(product["MSRP"] ?? "0");
  const brandBlocked = blockedBrands.has(product.Brand.toLowerCase().trim());
  return qty >= 20 && wholesale > 0 && msrp > 0 && !recentSkus.has(product.SKU) && !brandBlocked;
}
function scoreProduct(product, recentSkus, recentCategories, blockedBrands = /* @__PURE__ */ new Set()) {
  if (!isEligible(product, recentSkus, blockedBrands)) return null;
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
  const scores = products.map((p) => scoreProduct(p, recentSkus, recentCategories, blockedBrands)).filter((s) => s !== null).sort((a, b) => b.score - a.score);
  const topCandidates = scores.slice(0, 30);
  await kvSet("feed:top-candidates", topCandidates, FEED_TTL);
  return {
    topCandidates,
    needsImagen: getSKUsNeedingImagen()
  };
}
var FEED_TTL, SKU_NEEDS_IMAGEN;
var init_feed_processor_server = __esm({
  "app/lib/feed-processor.server.ts"() {
    "use strict";
    init_kv_server();
    init_db_server();
    init_schema();
    FEED_TTL = 23 * 60 * 60;
    SKU_NEEDS_IMAGEN = /* @__PURE__ */ new Set();
  }
});

// app/lib/shopify.server.ts
var shopify_server_exports = {};
__export(shopify_server_exports, {
  activateShopifyProduct: () => activateShopifyProduct,
  addLinesToCart: () => addLinesToCart,
  addToCart: () => addToCart,
  adminCustomerDelete: () => adminCustomerDelete,
  adminGetCustomerSubscriptions: () => adminGetCustomerSubscriptions,
  adminGetSubscriptionContract: () => adminGetSubscriptionContract,
  appendProductTag: () => appendProductTag,
  associateImageWithVariant: () => associateImageWithVariant,
  attachVideoToProduct: () => attachVideoToProduct,
  cartBuyerIdentityUpdate: () => cartBuyerIdentityUpdate,
  closeReturn: () => closeReturn,
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
  fetchAllDealProducts: () => fetchAllDealProducts,
  findCollectionsByQuery: () => findCollectionsByQuery,
  findCustomerByPhone: () => findCustomerByPhone,
  findProductBySKU: () => findProductBySKU,
  getAccessoryProducts: () => getAccessoryProducts,
  getAccessoryProductsAdmin: () => getAccessoryProductsAdmin,
  getAdminProductData: () => getAdminProductData,
  getAdminProductPrices: () => getAdminProductPrices,
  getApprovedDeal: () => getApprovedDeal,
  getBonusDeal: () => getBonusDeal,
  getCart: () => getCart,
  getCollectionDeals: () => getCollectionDeals,
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
  getHandleByProductId: () => getHandleByProductId,
  getLiveDealHandle: () => getLiveDealHandle,
  getMainMenu: () => getMainMenu,
  getProductAdminImages: () => getProductAdminImages,
  getProductByHandle: () => getProductByHandle,
  getProductHandleById: () => getProductHandleById,
  getProductImagesForSitemap: () => getProductImagesForSitemap,
  getProductVariantGids: () => getProductVariantGids,
  getProductsByHandles: () => getProductsByHandles,
  getProductsByIds: () => getProductsByIds,
  getProductsByTag: () => getProductsByTag,
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
  pollMediaReady: () => pollMediaReady,
  predictiveSearch: () => predictiveSearch,
  pushProductToShopify: () => pushProductToShopify,
  registerReverseDelivery: () => registerReverseDelivery,
  removeFromCart: () => removeFromCart,
  reorderProductImages: () => reorderProductImages,
  searchAdminProducts: () => searchAdminProducts,
  searchProducts: () => searchProducts,
  sendDraftOrderInvoice: () => sendDraftOrderInvoice,
  setCartAttributes: () => setCartAttributes,
  setDealStatus: () => setDealStatus,
  setMediaAsPrimary: () => setMediaAsPrimary,
  setPairingWhy: () => setPairingWhy,
  shopifyAdmin: () => shopifyAdmin,
  updateCartLine: () => updateCartLine,
  updateCollectionDescription: () => updateCollectionDescription,
  updateCollectionImage: () => updateCollectionImage,
  updateProductDescriptionHtml: () => updateProductDescriptionHtml,
  updateProductMetafield: () => updateProductMetafield,
  updateProductTags: () => updateProductTags,
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
  const res = await fetch(ADMIN_GQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": process.env["SHOPIFY_ADMIN_ACCESS_TOKEN"]
    },
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error(`Shopify Admin GraphQL error: ${res.status}`);
  const { data, errors } = await res.json();
  if (errors?.length) throw new Error(errors[0]?.message ?? "Shopify Admin GraphQL error");
  return data;
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
  return {
    id: node.id,
    handle: node.handle,
    seoTitle: node.title,
    dealDate: parseMetafield(mf, "deal_date"),
    dealPrice,
    msrp: parseFloat(parseMetafield(mf, "original_price") || (variant?.compareAtPrice?.amount ?? "0")),
    images: parseImages(node.images.edges),
    brand: node.vendor,
    category: parseMetafield(mf, "category") || "both",
    dealStatus: "archived",
    qty: variant?.quantityAvailable ?? 0,
    defaultVariantId: variant?.id ?? null,
    hasMultipleVariants: variantEdges.length > 1,
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
      ...e.node.barcode ? { barcode: e.node.barcode } : {}
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
    category: parseMetafield(mf, "category") || "both",
    dealStatus: parseMetafield(mf, "deal_status") || "live",
    dealDate: parseMetafield(mf, "deal_date"),
    qty: variant?.quantityAvailable ?? 0,
    tags: node.tags ?? [],
    accessoryProductIds: parseMetafieldJSON(mf, "accessory_product_ids", []),
    ...parseMetafield(mf, "specifications") ? { specifications: parseMetafield(mf, "specifications") } : {},
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
      ...e.node.barcode ? { barcode: e.node.barcode } : {}
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
    ...pairBundleCopy?.headline && pairBundleCopy?.body && pairBundleCopy?.pairedHandle ? { pairBundleCopy } : {},
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
  const pairBundleCopy = pairBundleCopyRaw?.headline && pairBundleCopyRaw?.body && pairBundleCopyRaw?.pairedHandle ? pairBundleCopyRaw : null;
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
    category: mfVal("category") || "both",
    dealStatus: mfVal("deal_status") || "pending",
    dealDate: mfVal("deal_date"),
    qty: variant?.inventory_quantity ?? 0,
    tags: product.tags ? product.tags.split(", ").filter(Boolean) : [],
    accessoryProductIds: mfJSON("accessory_product_ids", []),
    ...mfVal("specifications") ? { specifications: mfVal("specifications") } : {},
    metaDescription: mfVal("seo_meta_description"),
    ...mfVal("original_description") ? { rawDescription: mfVal("original_description") } : {},
    ...mfVal("deal_score") ? { dealScore: parseFloat(mfVal("deal_score")) } : {},
    ...mfVal("nalpac_sku") ? { nalpacSku: mfVal("nalpac_sku") } : {},
    ...emmaHero ? { emmaHero } : {},
    ...quietEndorsementCopy ? { quietEndorsementCopy } : {},
    ...pairBundleCopy ? { pairBundleCopy } : {},
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
  const data = await storefront(`
    query GetDealByHandle($handle: String!) {
      product(handle: $handle) { ${PRODUCT_CORE_FRAGMENT} }
    }
  `, { handle });
  if (!data.product) return null;
  return nodeToDeal(data.product);
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
async function getProductImagesForSitemap() {
  return cached("shopify:sitemap:product-images", 3600, async () => {
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
    return map;
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
            edges { node { handle updatedAt } }
          }
        }
      `, { first: 250, after: cursor });
      for (const edge of data.collections.edges) {
        out.push({ handle: edge.node.handle, updatedAt: edge.node.updatedAt });
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
}
async function updateProductDescriptionHtml(productId, bodyHtml) {
  const numericId = productId.replace("gid://shopify/Product/", "");
  await shopifyAdmin(`/products/${numericId}.json`, "PUT", {
    product: { id: Number(numericId), body_html: bodyHtml }
  });
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
      ...doc.tags !== void 0 ? { tags: doc.tags } : {},
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
  add("tagline", doc.tagline, "single_line_text_field", true);
  add("full_story", ptToHtml(doc.fullStory), "multi_line_text_field");
  add("works_for_him", ptToHtml(doc.worksForHim), "multi_line_text_field");
  add("works_for_her", ptToHtml(doc.worksForHer), "multi_line_text_field");
  add("mood_image_url", doc.moodImageUrl, "single_line_text_field");
  add("product_type_dial", doc.productTypeDial, "single_line_text_field");
  add("category", doc.category, "single_line_text_field");
  add("deal_status", doc.dealStatus, "single_line_text_field");
  add("deal_date", doc.dealDate, "date");
  add("nalpac_sku", doc.nalpacSku, "single_line_text_field");
  add("original_price", doc.originalPrice?.toString(), "number_decimal");
  add("wholesale_cost", doc.wholesaleCost?.toString(), "number_decimal");
  add("map_price", doc.mapPrice?.toString(), "number_decimal");
  if (!doc.featureBullets?.length) throw new Error("pushProductToShopify: featureBullets is empty");
  metafields.push({
    namespace: "xdipx",
    key: "feature_bullets",
    ownerId: gid,
    value: JSON.stringify(doc.featureBullets),
    type: "json"
  });
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
  add("seo_meta_description", doc.seoMetaDescription, "multi_line_text_field", true);
  add("specifications", doc.specifications, "multi_line_text_field", true);
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
  if (doc.emmaHero) {
    metafields.push({
      namespace: "xdipx",
      key: "emma_hero",
      ownerId: gid,
      value: JSON.stringify(doc.emmaHero),
      type: "json"
    });
  }
  if (doc.rawDescription) {
    metafields.push({ namespace: "custom", key: "original_description", value: doc.rawDescription, type: "multi_line_text_field", ownerId: gid });
  }
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
async function activateShopifyProduct(numericId) {
  const id = numericId.replace("gid://shopify/Product/", "");
  const gid = `gid://shopify/Product/${id}`;
  await shopifyAdmin(`/products/${id}.json`, "PUT", {
    product: { id, status: "active" }
  });
  const { publications } = await adminGraphQL(`
    query GetPublications {
      publications(first: 20) {
        edges { node { id } }
      }
    }
  `);
  const publicationIds = publications.edges.map((e) => e.node.id);
  if (publicationIds.length === 0) return;
  await adminGraphQL(`
    mutation PublishProduct($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        userErrors { field message }
      }
    }
  `, {
    id: gid,
    input: publicationIds.map((pubId) => ({ publicationId: pubId }))
  });
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
async function createShopifyProductFromFeed(product) {
  const handle = product.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 200);
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
async function createShopifyProductWithVariants(master, variants, optionName) {
  const handle = master.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 200);
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
      options: [{ name: optionName, values: variants.map((v) => v.optionValue) }],
      variants: variants.map((v) => ({
        sku: v.sku,
        option1: v.optionValue,
        price: v.price.toFixed(2),
        compare_at_price: v.compareAtPrice.toFixed(2),
        inventory_management: "shopify",
        inventory_quantity: v.qty
      })),
      images: master.images.slice(0, 10).map((src) => ({ src }))
    }
  });
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
var READ_TTL, COLLECTION_CURSOR_TTL, STOREFRONT_ENDPOINT, ADMIN_ENDPOINT, ADMIN_GQL_ENDPOINT, METAFIELDS_FRAGMENT, PRODUCT_CORE_FRAGMENT, CARD_METAFIELDS_FRAGMENT, PRODUCT_CARD_FRAGMENT, LEGACY_DIAL_LABELS, CART_FRAGMENT, CUSTOMER_ADDRESS_FRAGMENT, STOREFRONT_ORDER_LEAN_FRAGMENT, SUBSCRIPTION_CONTRACT_FRAGMENT, SEARCH_PRODUCT_FRAGMENT;
var init_shopify_server = __esm({
  "app/lib/shopify.server.ts"() {
    "use strict";
    init_kv_server();
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
  images(first: 1) {
    edges { node { url altText } }
  }
  variants(first: 2) {
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
  id handle title vendor tags
  featuredImage { url altText }
  priceRange { minVariantPrice { amount currencyCode } }
  compareAtPriceRange { maxVariantPrice { amount currencyCode } }
`;
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
  getEditor: () => getEditor,
  getEmmaHeroSettings: () => getEmmaHeroSettings,
  getEmmaPersona: () => getEmmaPersona,
  getEmmaPresets: () => getEmmaPresets,
  getHomepageSections: () => getHomepageSections,
  getPage: () => getPage,
  getPageList: () => getPageList,
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
  unarchiveHomepageRailsForDeal: () => unarchiveHomepageRailsForDeal,
  updateCmsBlock: () => updateCmsBlock,
  upsertAnnouncementBar: () => upsertAnnouncementBar,
  upsertEmmaPick: () => upsertEmmaPick,
  upsertProductPage: () => upsertProductPage
});
import { createClient } from "@sanity/client";
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
      const client2 = getClient(false, preview);
      if (!client2) return null;
      return await client2.fetch(EMMA_HERO_GROQ) ?? null;
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
      const client2 = getClient(false, preview);
      if (!client2) return null;
      const raw = await client2.fetch(EDITOR_GROQ);
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
      const client2 = getClient(false, preview);
      if (!client2) return [];
      return await client2.fetch(EMMA_PRESETS_GROQ) ?? [];
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
      const client2 = getClient(false, preview);
      if (!client2) return null;
      return await client2.fetch(HOMEPAGE_GROQ) ?? null;
    } catch (err) {
      console.error("[sanity] getHomepageSections error:", err);
      return null;
    }
  };
  if (preview) return fetcher();
  return cached("sanity:homepage", 60, fetcher);
}
async function upsertAnnouncementBar(messages) {
  const client2 = getClient(true);
  if (!client2) throw new Error("Sanity not configured");
  await client2.createIfNotExists({ _id: "singleton.homepage", _type: "homepageSections", sections: [] });
  await client2.patch("singleton.homepage").setIfMissing({ sections: [] }).set({
    'sections[_type=="announcementBar"].messages': messages
  }).commit();
  invalidateCache("sanity:homepage");
}
async function addCmsBlock(block) {
  const client2 = getClient(true);
  if (!client2) throw new Error("Sanity not configured");
  const key = `${block._type}-${Date.now()}`;
  await client2.createIfNotExists({ _id: "singleton.homepage", _type: "homepageSections", sections: [] });
  await client2.patch("singleton.homepage").setIfMissing({ sections: [] }).append("sections", [{ ...block, _key: key }]).commit();
  invalidateCache("sanity:homepage");
}
async function updateCmsBlock(key, patch) {
  const client2 = getClient(true);
  if (!client2) throw new Error("Sanity not configured");
  await client2.patch("singleton.homepage").set(
    Object.fromEntries(
      Object.entries(patch).map(([field, value]) => [`sections[_key=="${key}"].${field}`, value])
    )
  ).commit();
  invalidateCache("sanity:homepage");
}
async function removeCmsBlock(key) {
  const client2 = getClient(true);
  if (!client2) throw new Error("Sanity not configured");
  await client2.patch("singleton.homepage").unset([`sections[_key=="${key}"]`]).commit();
  invalidateCache("sanity:homepage");
}
function invalidateCmsCache() {
  invalidateCache("sanity:homepage");
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
  if (params.vendor !== void 0) searchFields.vendor = params.vendor;
  if (params.tags !== void 0) searchFields.tags = params.tags;
  if (params.tagline !== void 0) searchFields.tagline = params.tagline;
  if (params.featureBullets !== void 0) searchFields.featureBullets = params.featureBullets;
  if (params.description !== void 0) searchFields.description = stringToPortableText(params.description);
  if (params.seoDescription !== void 0) searchFields.seoDescription = params.seoDescription;
  if (params.category !== void 0) searchFields.category = params.category;
  if (params.mapPrice !== void 0) searchFields.mapPrice = params.mapPrice;
  if (params.originalPrice !== void 0) searchFields.originalPrice = params.originalPrice;
  if (params.seoTitle !== void 0) searchFields.seoTitle = params.seoTitle;
  if (params.moodImageUrl !== void 0) searchFields.moodImageUrl = params.moodImageUrl;
  if (params.productTypeDial !== void 0) searchFields.productTypeDial = params.productTypeDial;
  if (params.moodTags !== void 0) searchFields.moodTags = params.moodTags;
  if (params.audienceTags !== void 0) searchFields.audienceTags = params.audienceTags;
  if (params.mattersTags !== void 0) searchFields.mattersTags = params.mattersTags;
  if (params.ivrExperience !== void 0) searchFields.ivrExperience = params.ivrExperience;
  if (params.ivrUseCase !== void 0) searchFields.ivrUseCase = params.ivrUseCase;
  if (params.ivrFeatures !== void 0) searchFields.ivrFeatures = params.ivrFeatures;
  if (params.ivrVoiceSummary !== void 0) searchFields.ivrVoiceSummary = params.ivrVoiceSummary;
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
async function getSiteSettings() {
  if (!projectId) return null;
  return cached("sanity:site-settings", 300, async () => {
    try {
      const client2 = getClient();
      if (!client2) return null;
      const data = await client2.fetch(
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
      const client2 = getClient();
      if (!client2) return null;
      const data = await client2.fetch(
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
async function getProductPageBlocks(handle) {
  if (!projectId) return [];
  try {
    const client2 = getClient();
    if (!client2) return [];
    const data = await client2.fetch(
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
    const client2 = getClient();
    if (!client2) return [];
    const data = await client2.fetch(
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
async function getPage(slug, preview = false) {
  if (!projectId) {
    console.warn("[sanity] getPage: no projectId");
    return null;
  }
  try {
    const client2 = getClient(false, preview);
    if (!client2) {
      console.warn("[sanity] getPage: no client");
      return null;
    }
    console.log("[sanity] getPage fetching slug:", slug);
    const result = await client2.fetch(
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
    const client2 = getClient();
    if (!client2) return [];
    return await client2.fetch(
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
    const client2 = getClient(false, preview);
    if (!client2) return null;
    return await client2.fetch(
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
  const cacheKey2 = `posts:${page}:${perPage}:${opts.category ?? ""}:${opts.featured ?? ""}:${opts.authorSlug ?? ""}`;
  const cached2 = getCachedBlog(cacheKey2, BLOG_CACHE_TTL);
  if (cached2) return cached2;
  try {
    const client2 = getClient();
    if (!client2) return { posts: [], total: 0 };
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
      client2.fetch(
        `*[${filter}] | order(publishedAt desc) [${start}...${end}] { ${BLOG_POST_CARD_PROJECTION}, "bodyText": body[_type == "block"]{ "text": children[].text } }`,
        params
      ),
      client2.fetch(`count(*[${filter}])`, params)
    ]);
    const posts = (rawPosts ?? []).map((p) => {
      const words = (p.bodyText ?? []).flatMap((b) => (b.text ?? []).join("")).join(" ");
      const readingTime = Math.max(1, Math.ceil(words.split(/\s+/).filter(Boolean).length / 200));
      const { bodyText: _, ...rest } = p;
      return { ...rest, readingTime };
    });
    const result = { posts, total };
    setCachedBlog(cacheKey2, result);
    return result;
  } catch (err) {
    console.error("[sanity] getBlogPosts error:", err);
    return { posts: [], total: 0 };
  }
}
async function getBlogPost(slug, preview = false) {
  if (!projectId) return null;
  const cacheKey2 = `post:${slug}`;
  if (!preview) {
    const cached2 = getCachedBlog(cacheKey2, BLOG_CACHE_TTL);
    if (cached2) return cached2;
  }
  try {
    const client2 = getClient(false, preview);
    if (!client2) return null;
    const filter = preview ? `_type == "blogPost" && slug.current == $slug` : `_type == "blogPost" && slug.current == $slug && status == "published"`;
    const raw = await client2.fetch(
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
    if (!preview) setCachedBlog(cacheKey2, post);
    return post;
  } catch (err) {
    console.error("[sanity] getBlogPost error:", err);
    return null;
  }
}
async function getBlogAuthor(slug) {
  if (!projectId) return null;
  try {
    const client2 = getClient();
    if (!client2) return null;
    const data = await client2.fetch(
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
  const cacheKey2 = "blogCategories";
  const cached2 = getCachedBlog(cacheKey2, BLOG_CAT_CACHE_TTL);
  if (cached2) return cached2;
  try {
    const client2 = getClient();
    if (!client2) return [];
    const data = await client2.fetch(
      `*[_type == "blogCategory"] | order(name asc) {
        name, "slug": slug.current, description, color, seoTitle, seoDescription
      }`
    );
    if (data) setCachedBlog(cacheKey2, data);
    return data ?? [];
  } catch (err) {
    console.error("[sanity] getBlogCategories error:", err);
    return [];
  }
}
async function getBlogPostsForSitemap() {
  if (!projectId) return [];
  try {
    const client2 = getClient();
    if (!client2) return [];
    return await client2.fetch(
      `*[_type == "blogPost" && status == "published"] | order(publishedAt desc) {
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
  const rails = await getRailsByDealId(dealId, { target: "homepage", status: "live" });
  if (!rails.length) return { archived: [] };
  const archived = [];
  for (const r of rails) {
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
    const client2 = getClient();
    if (!client2) return [];
    return await client2.fetch(
      `*[_type == "productPage" && defined(shopifyHandle)] | order(title asc) {
        "handle": shopifyHandle, _updatedAt
      }`
    );
  } catch (err) {
    console.error("[sanity] getProductHandlesForSitemap error:", err);
    return [];
  }
}
var CONTENT_BLOCKS_PROJECTION, projectId, dataset, apiVersion, SECTIONS_WITH_REFS_PROJECTION, HOMEPAGE_GROQ, EMMA_HERO_GROQ, EDITOR_GROQ, EMMA_PRESETS_GROQ, _blogCache, BLOG_CACHE_TTL, BLOG_CAT_CACHE_TTL, BLOG_POST_CARD_PROJECTION;
var init_sanity_server = __esm({
  "app/lib/sanity.server.ts"() {
    "use strict";
    init_kv_server();
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
  *[_id == "singleton.emmaHero"][0]{
    heroVariant, eyebrow, headline, body, aside, pullQuote, pairProductHandle
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
    _blogCache = /* @__PURE__ */ new Map();
    BLOG_CACHE_TTL = 6e4;
    BLOG_CAT_CACHE_TTL = 3e5;
    BLOG_POST_CARD_PROJECTION = `
  _id, title, "slug": slug.current, excerpt, publishedAt, featured,
  "heroImageUrl": heroImage.asset->url, heroImageAlt,
  "author": author->{ name, "slug": slug.current, bio, "avatarUrl": avatar.asset->url, role },
  "category": category->{ name, "slug": slug.current, color }
`;
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
  const client2 = getReadClient();
  if (!client2) return [];
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
      // No taxonomy tags at all = general-purpose, always eligible
      (!defined(productTypeDials) || count(productTypeDials) == 0) &&
      (!defined(moodTags)         || count(moodTags) == 0) &&
      (!defined(audienceTags)     || count(audienceTags) == 0) &&
      (!defined(mattersTags)      || count(mattersTags) == 0)
    ) || (
      // Or shares at least one tag with the input
      ($productType != null && $productType in productTypeDials) ||
      count((moodTags     ?? [])[@ in $moods])     > 0 ||
      count((audienceTags ?? [])[@ in $audiences]) > 0 ||
      count((mattersTags  ?? [])[@ in $matters])   > 0
    )]{ ${KEYWORD_PROJECTION} }
  `;
  try {
    return await client2.fetch(groq, {
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
  const client2 = getReadClient();
  if (!client2) return [];
  try {
    const rows = await client2.fetch(
      `*[_type == "seoKeyword" && (status == "rejected" || flagged == true)]{ term }`
    );
    return (rows ?? []).map((r) => r.term).filter(Boolean);
  } catch {
    return [];
  }
}
function cacheKey(input) {
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
  const key = cacheKey(input);
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
    const client2 = getReadClient2();
    if (!client2) return null;
    try {
      const doc = await client2.fetch(
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
  const categories = [...new Set([deal.category, partner?.category].filter(Boolean))];
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

// app/lib/claude.server.ts
var claude_server_exports = {};
__export(claude_server_exports, {
  BRAND_VOICE_SYSTEM_PROMPT: () => BRAND_VOICE_SYSTEM_PROMPT,
  IVR_EXPERIENCE_LEVELS: () => IVR_EXPERIENCE_LEVELS,
  IVR_FEATURES: () => IVR_FEATURES,
  IVR_USE_CASES: () => IVR_USE_CASES,
  enhanceLtxPrompt: () => enhanceLtxPrompt,
  enhanceVeoPrompt: () => enhanceVeoPrompt,
  generateAskEmmaTags: () => generateAskEmmaTags,
  generateBlogArticle: () => generateBlogArticle,
  generateBlogDraft: () => generateBlogDraft,
  generateBlogOutline: () => generateBlogOutline,
  generateBlogSEO: () => generateBlogSEO,
  generateCareInstructions: () => generateCareInstructions,
  generateCopy: () => generateCopy,
  generateEmmaHero: () => generateEmmaHero,
  generateEmmaTagline: () => generateEmmaTagline,
  generateEmmaTake: () => generateEmmaTake,
  generateIvrExperience: () => generateIvrExperience,
  generateIvrFeatures: () => generateIvrFeatures,
  generateIvrUseCase: () => generateIvrUseCase,
  generateIvrVoiceSummary: () => generateIvrVoiceSummary,
  generateRails: () => generateRails,
  generateSEOTitle: () => generateSEOTitle,
  generateSchedule: () => generateSchedule,
  generateSensationDialV2: () => generateSensationDialV2,
  generateTweetCopy: () => generateTweetCopy,
  generateVideoContent: () => generateVideoContent,
  generateWithSystem: () => generateWithSystem,
  inferProductTypeDial: () => inferProductTypeDial,
  pickForContextGroup: () => pickForContextGroup,
  selectAccessories: () => selectAccessories
});
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
async function generate(prompt, maxTokens = 1024, model = MODEL) {
  const msg = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }]
  });
  const block = msg.content[0];
  if (block?.type !== "text") throw new Error("Unexpected Claude response type");
  return block.text;
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
  return block.text;
}
function stripFences(raw) {
  return raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
}
function resolveSeoContentType(type) {
  if (type === "blog_article") return "blog";
  return "pdp";
}
async function generateCopy(req) {
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
Categories: ${product.categories.join(", ")}${product.dealPrice ? `
Deal price: $${product.dealPrice} (was $${product.msrp})` : ""}`;
  const productContext = keywordBlock ? `${productContextBase}

${keywordBlock}` : productContextBase;
  switch (type) {
    case "tagline": {
      const primaryPrompt = `Write 3 one-sentence taglines for the following product. Be genuinely funny \u2014 irreverent, witty, puns welcome. Think: a comedian friend who loves these products and has zero shame. Tasteful but not boring. Max 12 words each. Return as a JSON array of strings (no markdown).

${productContext}`;
      const retryPrompt = `Return exactly one short funny sentence as a product tagline. No JSON, no newlines, no lists, no quotes. Just the sentence.

${productContext}`;
      const raw = await generate(primaryPrompt, 1024, MODEL_FAST);
      try {
        const parsed = JSON.parse(stripFences(raw));
        const first = Array.isArray(parsed) ? parsed.find((s) => typeof s === "string" && s.trim()) : null;
        if (first) return { type, content: parsed };
      } catch {
      }
      const retried = await generate(retryPrompt, 1024, MODEL_FAST);
      const line = retried.trim().split("\n")[0]?.trim();
      if (line) return { type, content: [line] };
      return { type, content: [`${product.brand} ${product.title} \u2014 today only at xdipx.`] };
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
      const raw = await generate(primaryPrompt, 1024, MODEL_FAST);
      try {
        const parsed = JSON.parse(stripFences(raw));
        if (Array.isArray(parsed) && parsed.length >= 3) return { type, content: parsed };
      } catch {
      }
      const retried = await generate(retryPrompt, 1024, MODEL_FAST);
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
      const discount = product.dealPrice && product.msrp && product.msrp > 0 ? `${Math.round(100 - product.dealPrice / product.msrp * 100)}% off` : "Best price";
      const primaryPrompt = `Write a 140\u2013155 character SEO meta description for this product. Format: "[Discount or 'Best price']. [1-sentence benefit]. Ships discreet. $[price] at xdipx." Return only the meta description, no quotes.

${productContext}`;
      const retryPrompt = `Write a single SEO meta description between 140 and 155 characters. Return only the description \u2014 no quotes, no labels, no explanation.

${productContext}`;
      const text2 = await generate(primaryPrompt, 1024, MODEL_FAST);
      const cleaned = text2.replace(/^["']|["']$/g, "").trim();
      if (cleaned.length >= 50) return { type, content: cleaned.slice(0, 155) };
      const retried = await generate(retryPrompt, 1024, MODEL_FAST);
      const cleanedRetry = retried.replace(/^["']|["']$/g, "").trim();
      if (cleanedRetry.length >= 50) return { type, content: cleanedRetry.slice(0, 155) };
      const fallback = `${discount} on ${product.brand} ${product.title}. Ships discreetly. ${product.dealPrice ? `$${product.dealPrice} ` : ""}at xdipx.com.`;
      return { type, content: fallback.slice(0, 155) };
    }
    case "box_contents": {
      const primaryPrompt = `Extract what is physically included in the box for this product from the description below. Return a JSON array of short strings (one item per element), e.g. ["1x vibrator", "1x USB charging cable", "1x storage pouch"]. If the description doesn't mention box contents, infer the most likely inclusions based on the product type. Return only the JSON array, no markdown.

${productContext}`;
      const retryPrompt = `Return ONLY a JSON array of what's in the box. Example: ["1x vibrator", "1x USB cable"]. Nothing else \u2014 no markdown, no prose, no explanation.

${productContext}`;
      const raw = await generate(primaryPrompt, 1024, MODEL_FAST);
      try {
        const parsed = JSON.parse(stripFences(raw));
        if (Array.isArray(parsed) && parsed.length >= 1) return { type, content: parsed };
      } catch {
      }
      const retried = await generate(retryPrompt, 1024, MODEL_FAST);
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
      const raw = await generate(primaryPrompt, 512, MODEL_FAST);
      try {
        const parsed = JSON.parse(stripFences(raw));
        if (isValid(parsed)) return { type, content: parsed };
      } catch {
      }
      const retried = await generate(retryPrompt, 512, MODEL_FAST);
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
        eyebrow: "emma recommends \xB7 a pair",
        subhead: "better together \xB7 save when you grab both",
        headline: "These two were made for each other.",
        body: `One sets the mood, the other carries it. It\u2019s the kind of _slow-burn pairing_ that just clicks. Come see.`,
        bannerLine: "\u2014 Emma \xB7 picked this pair because they click \xB7 swaps it when something better lands",
        pairedHandle: "",
        generatedAt: nowISO(),
        primaryTag: "this one",
        partnerTag: "and this",
        knotCaption: "tied together on purpose",
        whyCards: [
          { head: "One handles the fun part.", body: "The rumble, the tease, the main event. Dialed in and ready to go." },
          { head: "The other handles the smart part.", body: "Keeps everything gliding, safe on toys, easy on skin. No drama, no cleanup headache." },
          { head: "Together they buy you time.", body: "Less stop-and-start, more flow. You\u2019ll feel the difference in the first few minutes." }
        ],
        emmaQuote: `This is the pair I\u2019d hand a friend who asked \u201Cjust pick something for me.\u201D One does the work, one does the _finish_, and together they feel intentional. That\u2019s the whole point of a good pair.`,
        momentTitle: "how to make this pair click",
        moments: [
          { lead: "Start with the lube.", body: "A little goes a long way \u2014 warm it in your hands first so it lands smooth instead of startling." },
          { lead: "Then bring in the other.", body: "Let the rhythm build before you ramp up. The pair wants you unhurried." }
        ]
      });
      if (!partner) {
        return {
          type,
          content: {
            ...staticFallback(),
            body: `Set a pair in the toolbar first \u2014 I\u2019ll write this once I can see both.`,
            bannerLine: "\u2014 Emma \xB7 waiting on a pairing"
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
- NEVER say: "I tried", "I tested", "I've been using", "been living with", "spent X weeks", "I reached for this", "since April", "a month of use", or any similar first-person use claim.
- NEVER invent usage stats ("238 pairs grabbed", "top 5%", "my #1").
- Emma curates, pairs, and recommends \u2014 she speaks about why things WOULD click, not what she felt.
- OK to say: "picks this pair", "I\u2019d hand this to a friend", "why they click", "made for each other", "the slow one", "the fix-it one", "a pairing that works".
- Do NOT name the brands. Do NOT restate the product titles. Do NOT surface countdowns or "until midnight".
- Use "intimate", "pleasure", "wellness", "slow-burn", "satisfaction" \u2014 never "sex" as an adjective.`;
      const shapeSpec = `Return ONLY a raw JSON object (no markdown fences, no prose around it) with EXACTLY these keys:

{
  "eyebrow":     string  // \u2264 60 chars, two short phrases joined by " \xB7 " (middle dot U+00B7). e.g. "emma recommends \xB7 a powerful pair"
  "subhead":     string  // \u2264 70 chars, lowercase, casual. e.g. "better together \xB7 save when you grab both"
  "headline":    string  // 6\u201310 words, editorial italic feel, the hook. e.g. "These two were made for each other."
  "body":        string  // 25\u201345 words, 2 sentences. Wrap ONE 1\u20134 word phrase in underscores like _slow-burn energy_. Describe both products' ROLES (one does X, the other does Y). End with a soft curiosity nudge.
  "bannerLine":  string  // one short italic Emma sign-off, no testimony. e.g. "\u2014 Emma \xB7 picks this pair for slow-burn nights \xB7 swaps it when something better lands"
  "primaryTag":  string  // 2\u20133 lowercase words, curator voice, describes the primary's ROLE. e.g. "the buzz one" or "the slow one"
  "partnerTag":  string  // 2\u20133 lowercase words, curator voice, describes the partner's ROLE. e.g. "the glide one" or "the fix-it one"
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
      const retryPrompt = `Return ONLY raw JSON matching this exact shape: {"eyebrow","subhead","headline","body","bannerLine","primaryTag","partnerTag","knotCaption","whyCards":[{"head","body"},{"head","body"},{"head","body"}],"emmaQuote","momentTitle","moments":[{"lead","body"},{"lead","body"}]}.

${voiceRules}

${pairContext}`;
      const isStr = (v) => typeof v === "string" && v.trim().length > 0;
      const isCard = (v) => !!v && typeof v === "object" && isStr(v.head) && isStr(v.body);
      const isMoment = (v) => !!v && typeof v === "object" && isStr(v.lead) && isStr(v.body);
      const isValid = (v) => {
        if (!v || typeof v !== "object") return false;
        const o = v;
        return isStr(o.eyebrow) && isStr(o.subhead) && isStr(o.headline) && isStr(o.body) && isStr(o.bannerLine) && isStr(o.primaryTag) && isStr(o.partnerTag) && isStr(o.knotCaption) && isStr(o.emmaQuote) && isStr(o.momentTitle) && Array.isArray(o.whyCards) && o.whyCards.length === 3 && o.whyCards.every(isCard) && Array.isArray(o.moments) && (o.moments.length === 2 || o.moments.length === 3) && o.moments.every(isMoment);
      };
      const wrap = (copy) => ({
        ...copy,
        pairedHandle: "",
        generatedAt: nowISO()
      });
      const raw = await generate(primaryPrompt, 1800, MODEL_FAST);
      try {
        const parsed = JSON.parse(stripFences(raw));
        if (isValid(parsed)) return { type, content: wrap(parsed) };
      } catch {
      }
      const retried = await generate(retryPrompt, 1800, MODEL_FAST);
      try {
        const parsed = JSON.parse(stripFences(retried));
        if (isValid(parsed)) return { type, content: wrap(parsed) };
      } catch {
      }
      return { type, content: staticFallback() };
    }
    case "specifications": {
      const primaryPrompt = `Extract and format the technical specifications from this product description into clean, readable HTML. Use a <table> with two columns (spec name + value) if there are 4+ specs, otherwise use a <ul> list. Include: dimensions, materials, power source, charge time, run time, waterproofing, colors, and any other objective specs. If a spec is not mentioned, omit it. No fluff or marketing copy \u2014 just the facts. Return only the HTML, no markdown, no wrapper tags.

${productContext}`;
      const retryPrompt = `Return ONLY HTML starting with <table> or <ul> containing the technical specs from this product description. No markdown, no explanation, no preamble.

${productContext}`;
      const text2 = await generate(primaryPrompt, 2048);
      if (text2.includes("<")) return { type, content: text2 };
      const retried = await generate(retryPrompt, 2048);
      if (retried.includes("<")) return { type, content: retried };
      return { type, content: `<ul><li>${product.description.slice(0, 500)}</li></ul>` };
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
async function generateTweetCopy(deal) {
  const discountPct = deal.msrp > 0 ? Math.round(100 - deal.dealPrice / deal.msrp * 100) : 0;
  const productUrl = `https://xdipx.com/products/${deal.handle}`;
  const primaryPrompt = `Write a tweet for today's daily deal on xdipx.com.

Product: ${deal.title}
Brand: ${deal.brand}${deal.tagline ? `
Tagline: ${deal.tagline}` : ""}
Price: $${deal.dealPrice} (was $${deal.msrp}) \u2014 ${discountPct}% off
Category: ${deal.category}
Link: ${productUrl}

Rules:
- The main tweet MUST be under 240 characters (leave room for the link)
- Include the product URL at the end: ${productUrl}
- Include 1-2 relevant hashtags from: #DailyDeal #FlashSale #SelfCare #PleasurePositive #IntimateWellness #TreatYourself
- Brand voice: playful, cheeky, warm. Never clinical, never sleazy.
- Include the discount percentage or price if compelling
- Use the \u2665 motif naturally
- NEVER use explicit language or the word "sex" as an adjective

Also write a thread reply (optional second tweet) with 1-2 extra detail sentences if the product warrants it. Max 240 chars. If no thread reply is needed, set threadReply to null.

Return ONLY this JSON (no markdown):
{"mainTweet": "...", "threadReply": "..." or null}`;
  const retryPrompt = `Return ONLY raw JSON, no markdown. Write a tweet under 240 chars for this product. Include the URL ${productUrl} and one hashtag.
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
  const first = await generate(primaryPrompt, 512, MODEL_FAST);
  const firstParsed = tryParse(first);
  if (firstParsed) return firstParsed;
  const retried = await generate(retryPrompt, 512, MODEL_FAST);
  const secondParsed = tryParse(retried);
  if (secondParsed) return secondParsed;
  return {
    mainTweet: `${deal.brand} ${deal.title} \u2014 ${discountPct}% off today only. $${deal.dealPrice} (was $${deal.msrp}) \u2665

${productUrl}

#DailyDeal #SelfCare`
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

This is for xdipx.com \u2014 a daily flash-sale site for sexual wellness products.
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
    headline: deal.tagline || `This ${deal.brand} one quietly made it into my rotation.`,
    body: `Slow-burn build, surprisingly gentle finish. If you want something that feels considered \u2014 not gimmicky \u2014 this is the one.`,
    aside: `\u2014 Emma \xB7 still on my desk`,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    voiceHash
  };
  if (variant === "quote") base.pullQuote = `"This one earned its spot."`;
  return base;
}
async function generateEmmaHero(opts) {
  const variant = opts.variant ?? (opts.deal.mapRestricted ? "quote" : "loving");
  const brandVoice = opts.brandVoice ?? await getPipelineSetting("brandVoice") ?? DEFAULT_BRAND_VOICE;
  const voiceHash = createHash("sha1").update(brandVoice).digest("hex").slice(0, 12);
  const discountPct = opts.deal.msrp > 0 && opts.deal.dealPrice > 0 ? Math.round((opts.deal.msrp - opts.deal.dealPrice) / opts.deal.msrp * 100) : 0;
  const mapLine = opts.deal.mapRestricted ? "MAP-restricted \u2014 no discount claims, no percent-off language, no struck prices." : discountPct > 0 ? `Currently ${discountPct}% off MSRP \u2014 you may allude to value, but never in "buy now" or countdown language.` : "";
  const system = `${EMMA_SYSTEM_PROMPT}

${brandVoice}`;
  const user = `Write the Emma hero block for the homepage of xdipx.com. Variant: "${variant}".

Product context (do NOT echo \u2014 rewrite in Emma's voice):
- Title: ${opts.deal.seoTitle}
- Brand: ${opts.deal.brand}
- Category: ${opts.deal.category}
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
        const msg = await client.messages.create({
          model: MODEL,
          max_tokens: 800,
          system,
          messages: [{ role: "user", content: user }]
        });
        const block = msg.content[0];
        if (block?.type !== "text") throw new Error("non-text response");
        const parsed = JSON.parse(stripFences(block.text));
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
  const system = `You are Emma \u2014 the editorial voice of xdipx.com, an editorially-curated sexual-wellness storefront. You write like a trusted, funny friend. Tasteful, warm, curious. Never clinical. Never sleazy. Never "sex" as an adjective.`;
  const user = `Write ONE short tagline for the Emma chat window's status line. It sits right under "Ask Emma \xB7 Online".

Rules:
- 5 to 9 words, lowercase (first word may be capitalized).
- First-person Emma voice.
- Ends with the \u2665 glyph (exactly one).
- No quotes, no period, no emoji other than \u2665.
- No "buy now", no countdown, no pricing, no "sex" as adjective.
- Feel friendly and specific \u2014 the kind of thing a friend might say when you open the chat. Examples of the vibe (don't copy): "here to help you find what you're into \u2665", "pick my brain, I've tried most of it \u2665".

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
    `Generate SEO metadata for this blog post on xdipx.com (sexual wellness daily deals site).

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
  const brandVoice = opts.brandVoice ?? await getPipelineSetting("brandVoice") ?? DEFAULT_BRAND_VOICE;
  const system = `${EMMA_SYSTEM_PROMPT}

${brandVoice}`;
  const user = `Write Emma's "take" on this product. It will appear in the Emma's take tab on the product page \u2014 a friend-to-friend honest read.

Product:
- Title: ${opts.deal.seoTitle}
- Brand: ${opts.deal.brand}
- Category: ${opts.deal.category}
${opts.deal.productTypeDial ? `- Type: ${opts.deal.productTypeDial}` : ""}
${opts.deal.tagline ? `- Tagline (context): ${opts.deal.tagline}` : ""}
${opts.deal.fullStory ? `- Existing story (context, strip HTML): ${opts.deal.fullStory.replace(/<[^>]+>/g, " ").slice(0, 600)}` : ""}

Cover, in this order, in your own voice (no headings, just flowing paragraphs):
1. Who this clicks for \u2014 what they're after, what they'll like.
2. Who might want to skip \u2014 be specific. Honest. No marketing fudge.
3. How to get the most out of it \u2014 a tip Emma would whisper to a friend.

Constraints:
- 120\u2013200 words total. Two short paragraphs maximum.
- Return clean HTML \u2014 only <p>, <em>, <strong> tags. No headings, no <ul>, no inline styles, no class attrs.
- First-person Emma voice throughout. No "Buy now". No countdowns. No clinical language.
- Do NOT mention price, MAP, or discounts.
- Do NOT echo the product title in the first sentence.

Return ONLY the HTML \u2014 no markdown, no fences, no preamble.`;
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
      system,
      messages: [{ role: "user", content: user }]
    });
    const block = msg.content[0];
    if (block?.type !== "text") throw new Error("non-text response");
    return stripFences(block.text).trim();
  } catch (err) {
    console.error("[generateEmmaTake] failed:", err);
    throw err;
  }
}
async function generateCareInstructions(opts) {
  const user = `Write 3 to 5 short care instructions for this product. Each is one short imperative sentence \u2014 under 14 words.

Product:
- Title: ${opts.deal.seoTitle}
- Brand: ${opts.deal.brand}
- Category: ${opts.deal.category}
${opts.deal.productTypeDial ? `- Type: ${opts.deal.productTypeDial}` : ""}
${opts.deal.specifications ? `- Specs (HTML, context): ${opts.deal.specifications.replace(/<[^>]+>/g, " ").slice(0, 500)}` : ""}

Cover what actually matters for this object \u2014 cleaning, charging/storage, lube compatibility (where relevant), what to avoid. Practical, not clinical.

Return ONLY a JSON array of strings. Example: ["Wipe with mild soap and warm water after each use.", "Air-dry before storing in the included pouch."]
No markdown, no fences, no commentary.`;
  try {
    const msg = await client.messages.create({
      model: MODEL_FAST,
      max_tokens: 400,
      system: EMMA_SYSTEM_PROMPT,
      messages: [{ role: "user", content: user }]
    });
    const block = msg.content[0];
    if (block?.type !== "text") throw new Error("non-text response");
    const parsed = JSON.parse(stripFences(block.text));
    if (!Array.isArray(parsed)) throw new Error("expected array");
    const bullets = parsed.filter((x) => typeof x === "string").map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 140).slice(0, 5);
    if (bullets.length < 3) throw new Error(`only ${bullets.length} valid bullets returned`);
    return bullets;
  } catch (err) {
    console.error("[generateCareInstructions] failed:", err);
    throw err;
  }
}
async function generateSensationDialV2(opts) {
  const type = opts.deal.productTypeDial ?? "vibrator";
  const labelList = opts.preferredLabels.length > 0 ? opts.preferredLabels.map((l) => `- ${l}`).join("\n") : "(none \u2014 invent appropriate labels)";
  const user = `Build the "How it feels" sensation dial for this product. 5 to 6 dimensions, each scored 1 to 5 (5 = most).

Product:
- Title: ${opts.deal.seoTitle}
- Brand: ${opts.deal.brand}
- Category: ${opts.deal.category}
- Type: ${type}
${opts.deal.tagline ? `- Tagline: ${opts.deal.tagline}` : ""}
${opts.deal.fullStory ? `- Story (context, strip HTML): ${opts.deal.fullStory.replace(/<[^>]+>/g, " ").slice(0, 500)}` : ""}
${opts.deal.specifications ? `- Specs (HTML, context): ${opts.deal.specifications.replace(/<[^>]+>/g, " ").slice(0, 400)}` : ""}

Preferred labels for this product type (use these when they fit):
${labelList}

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
- Each "value" is an integer 1\u20135.
- Keep labels under 24 chars, sentence case, no trailing punctuation.
- Honest scoring \u2014 don't max everything.`;
  const msg = await client.messages.create({
    model: MODEL_FAST,
    max_tokens: 600,
    system: EMMA_SYSTEM_PROMPT,
    messages: [{ role: "user", content: user }]
  });
  const block = msg.content[0];
  if (block?.type !== "text") throw new Error("non-text response");
  const parsed = JSON.parse(stripFences(block.text));
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
  return { items };
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
    const msg = await client.messages.create({
      model: MODEL_FAST,
      max_tokens: 60,
      system: EMMA_SYSTEM_PROMPT,
      messages: [{ role: "user", content: user }]
    });
    const block = msg.content[0];
    if (block?.type !== "text") throw new Error("non-text response");
    const parsed = JSON.parse(stripFences(block.text));
    const t = typeof parsed.type === "string" ? parsed.type.trim().toLowerCase() : "";
    if (PRODUCT_TYPE_DIALS.includes(t)) return t;
  } catch (err) {
    console.error("[inferProductTypeDial] failed, defaulting to vibrator:", err);
  }
  return "vibrator";
}
async function generateAskEmmaTags(opts) {
  const { deal, axis, preferredLabels } = opts;
  const labelList = preferredLabels.length > 0 ? preferredLabels.map((l) => `- ${l}`).join("\n") : "(none \u2014 invent appropriate slugs)";
  const user = `Pick the Ask Emma tags for the "${axis}" axis on this product. ${ASK_EMMA_AXIS_GUIDANCE[axis]}

Product:
- Title: ${deal.seoTitle}
- Brand: ${deal.brand}
- Category: ${deal.category}
${deal.productTypeDial ? `- Type: ${deal.productTypeDial}` : ""}
${deal.tagline ? `- Tagline: ${deal.tagline}` : ""}
${deal.fullStory ? `- Story (context, strip HTML): ${deal.fullStory.replace(/<[^>]+>/g, " ").slice(0, 400)}` : ""}
${deal.specifications ? `- Specs (HTML, context): ${deal.specifications.replace(/<[^>]+>/g, " ").slice(0, 300)}` : ""}

Preferred slugs for "${axis}" (use these whenever they fit):
${labelList}

Rules:
- Return slugs in lowercase kebab-case (e.g. "soft-touch", not "Soft touch").
- Reuse a preferred slug exactly when it fits.
- Only invent a new slug if none of the preferred ones fit. Keep new slugs short (\u2264 24 chars), generic enough to apply to other products.
- Do NOT invent synonyms of preferred slugs.
- Honest tagging \u2014 don't tag every option. If unsure, leave it out.

Return ONLY this JSON (no markdown): { "tags": ["slug-one", "slug-two"] }`;
  try {
    const msg = await client.messages.create({
      model: MODEL_FAST,
      max_tokens: 200,
      system: EMMA_SYSTEM_PROMPT,
      messages: [{ role: "user", content: user }]
    });
    const block = msg.content[0];
    if (block?.type !== "text") throw new Error("non-text response");
    const parsed = JSON.parse(stripFences(block.text));
    if (!Array.isArray(parsed.tags)) return [];
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const raw of parsed.tags) {
      if (typeof raw !== "string") continue;
      const slug = raw.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      if (!slug || slug.length > 32 || seen.has(slug)) continue;
      seen.add(slug);
      out.push(slug);
      if (out.length >= 5) break;
    }
    return out;
  } catch (err) {
    console.error(`[generateAskEmmaTags:${axis}] failed:`, err);
    return [];
  }
}
function ivrProductBlock(deal) {
  return [
    `- Title: ${deal.seoTitle}`,
    `- Brand: ${deal.brand}`,
    `- Category: ${deal.category}`,
    deal.productTypeDial ? `- Type: ${deal.productTypeDial}` : "",
    deal.tagline ? `- Tagline: ${deal.tagline}` : "",
    deal.fullStory ? `- Story (context, strip HTML): ${deal.fullStory.replace(/<[^>]+>/g, " ").slice(0, 400)}` : "",
    deal.specifications ? `- Specs (context): ${deal.specifications.replace(/<[^>]+>/g, " ").slice(0, 250)}` : ""
  ].filter(Boolean).join("\n");
}
async function generateIvrExperience(opts) {
  const user = `Pick the experience level this product fits best. One of: ${IVR_EXPERIENCE_LEVELS.join(" | ")}.

Use "first-time" for beginner-friendly products (gentle, simple controls, low intensity).
Use "curious" for someone exploring beyond the basics \u2014 slightly more ambitious but still approachable.
Use "experienced" for people comfortable with the category looking for variety or upgrades.
Use "advanced" for high-intensity, niche, or technique-heavy products.
Use "any" only when the product genuinely fits across all levels.

${ivrProductBlock(opts.deal)}

Return ONLY this JSON (no markdown): { "level": "first-time" }`;
  try {
    const msg = await client.messages.create({
      model: MODEL_FAST,
      max_tokens: 60,
      system: EMMA_SYSTEM_PROMPT,
      messages: [{ role: "user", content: user }]
    });
    const block = msg.content[0];
    if (block?.type !== "text") throw new Error("non-text response");
    const parsed = JSON.parse(stripFences(block.text));
    const lvl = typeof parsed.level === "string" ? parsed.level.trim().toLowerCase() : "";
    if (IVR_EXPERIENCE_LEVELS.includes(lvl)) return lvl;
  } catch (err) {
    console.error("[generateIvrExperience] failed:", err);
  }
  return "any";
}
async function generateIvrUseCase(opts) {
  const user = `Pick 1\u20133 use cases this product fits, from this exact vocabulary:
${IVR_USE_CASES.map((s) => `- ${s}`).join("\n")}

Honest tagging \u2014 only pick what genuinely fits. Skip rather than stretch.

${ivrProductBlock(opts.deal)}

Return ONLY this JSON (no markdown): { "useCases": ["slug-one", "slug-two"] }`;
  try {
    const msg = await client.messages.create({
      model: MODEL_FAST,
      max_tokens: 100,
      system: EMMA_SYSTEM_PROMPT,
      messages: [{ role: "user", content: user }]
    });
    const block = msg.content[0];
    if (block?.type !== "text") throw new Error("non-text response");
    const parsed = JSON.parse(stripFences(block.text));
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
      if (out.length >= 3) break;
    }
    return out;
  } catch (err) {
    console.error("[generateIvrUseCase] failed:", err);
    return [];
  }
}
async function generateIvrFeatures(opts) {
  const user = `Pick 2\u20134 features that are TRUE for this product, from this exact vocabulary:
${IVR_FEATURES.map((s) => `- ${s}`).join("\n")}

Honest tagging \u2014 these will be spoken aloud by Emma when filtering ("looking for something quiet and waterproof"). Don't tag something the product doesn't actually have.

${ivrProductBlock(opts.deal)}

Return ONLY this JSON (no markdown): { "features": ["slug-one", "slug-two"] }`;
  try {
    const msg = await client.messages.create({
      model: MODEL_FAST,
      max_tokens: 120,
      system: EMMA_SYSTEM_PROMPT,
      messages: [{ role: "user", content: user }]
    });
    const block = msg.content[0];
    if (block?.type !== "text") throw new Error("non-text response");
    const parsed = JSON.parse(stripFences(block.text));
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
      if (out.length >= 4) break;
    }
    return out;
  } catch (err) {
    console.error("[generateIvrFeatures] failed:", err);
    return [];
  }
}
async function generateIvrVoiceSummary(opts) {
  const user = `Write ONE short Emma-voice sentence summarising this product, designed to be read aloud over the phone or in a chat reply. Hard cap: 120 characters total (count spaces). Aim for 90\u2013110. Plain text only \u2014 no HTML, no markdown, no bullet lists, no emojis. Conversational, specific, first-person.

Good (109 chars): "Pocket wand with real punch \u2014 seven settings, whisper-quiet low end, and a battery that lasts a weekend."
Bad: "Premium wireless rechargeable wand vibrator with multiple speeds and waterproof design." (catalog-y)
Bad: "This silicone-based lube stays put through longer sessions and I reach for it constantly because it's clean." (too long, runs past 120)

${ivrProductBlock(opts.deal)}

Return ONLY this JSON (no markdown): { "summary": "..." }`;
  try {
    const msg = await client.messages.create({
      model: MODEL_FAST,
      max_tokens: 200,
      system: EMMA_SYSTEM_PROMPT,
      messages: [{ role: "user", content: user }]
    });
    const block = msg.content[0];
    if (block?.type !== "text") throw new Error("non-text response");
    const parsed = JSON.parse(stripFences(block.text));
    if (typeof parsed.summary === "string") {
      return parsed.summary.trim().replace(/\s+/g, " ").slice(0, 120);
    }
  } catch (err) {
    console.error("[generateIvrVoiceSummary] failed:", err);
  }
  return "";
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
- First person ("been testing these side by side", "I keep coming back to this one").
- Never "Buy now", "limited time", "until midnight", or any countdown language.
- Never use "sex" as an adjective \u2014 use intimate, pleasure, wellness, slow-burn.
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
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
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
    `Category: ${deal.category}`,
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
- Each rail should have a clear theme (a mood, an audience, a use case) \u2014 not a random grab bag.
- The "emmaAside" is first-person and short ("been pairing these all month", "the trio I keep recommending").
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
var client, MODEL, MODEL_FAST, SYSTEM_PROMPT, BRAND_VOICE_SYSTEM_PROMPT, CTA_WORDS, VEO_SYSTEM_PROMPT, LTX_SYSTEM_PROMPT, DEFAULT_BRAND_VOICE, EMMA_SYSTEM_PROMPT, EMMA_TAGLINE_FALLBACKS, PRODUCT_TYPE_DIALS, ASK_EMMA_AXIS_GUIDANCE, IVR_EXPERIENCE_LEVELS, IVR_USE_CASES, IVR_FEATURES;
var init_claude_server = __esm({
  "app/lib/claude.server.ts"() {
    "use strict";
    init_feed_processor_server();
    init_seo_keywords_server();
    init_editorial_author_server();
    init_emma_rail_tools_server();
    client = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"]?.trim() });
    MODEL = "claude-sonnet-4-20250514";
    MODEL_FAST = "claude-haiku-4-5-20251001";
    SYSTEM_PROMPT = `You are the voice of xdipx.com, a daily flash-sale site for sexual wellness products.
Brand voice: playful, cheeky, warm, curious. Never clinical. Never sleazy.
Write as a trusted, funny friend who isn't embarrassed about the topic. Your goal is to welcome first-time buyers and delight experienced ones.
Keep all copy tasteful. Suggestive is fine, explicit is not.
Always signal discretion, value, and trust.
Never use "sex" as an adjective. Use "intimate", "pleasure", or "wellness".
Never assume the reader's experience level.
Always end descriptions with a curiosity hook that makes the reader want to try it.

Punctuation rules (strict):
- NEVER use em-dashes ("\u2014") or en-dashes ("\u2013"). They read as AI-written.
- Use periods, commas, or parentheses instead. Two short sentences beat one long sentence with an em-dash.
- Hyphens ("-") inside compound words ("soft-touch", "travel-size") are fine.

Hard facts (never invent variants):
- Credit-card statement descriptor is "XDIPX". If you mention billing, the descriptor, or what shows on a statement, write it as XDIPX. Never invent another descriptor (no DIPCOM, no XDIPX.COM, no variants).
- Brand name is "xdipx" (lowercase) and is pronounced "ex-dip-ex" (three syllables). Never "ex-dip" or "x-dipx".
- Orders ship in plain unbranded packaging. Don't claim same-day or next-day shipping unless given as context.

SEO targeting:
- When a <keyword_targets> block appears in the input, weave the primary term into the headline and first 100 words exactly once. Integrate secondary terms naturally across headings and body. Long-tail and question terms surface best in FAQs, asides, and supporting paragraphs.
- Never stuff. Do not repeat the primary term more than three times in body copy.
- If a term feels forced, drop it. Voice always wins over keyword density.
- Avoid any term listed inside <avoid>.`;
    BRAND_VOICE_SYSTEM_PROMPT = SYSTEM_PROMPT;
    CTA_WORDS = ["Today.", "Yours.", "Obviously.", "Go on.", "Finally."];
    VEO_SYSTEM_PROMPT = `You are a video prompt engineer for Google Veo. You enhance simple video ideas into detailed, production-ready Veo prompts. Your job is to FAITHFULLY EXPAND the user's idea \u2014 not replace it. The user's concept is the creative foundation. You add cinematic detail (camera, lighting, composition, audio) while keeping their vision intact.

Brand context: xdipx.com is a daily flash-sale site for sexual wellness products.
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

Brand context: xdipx.com \u2014 daily flash-sale site for sexual wellness products.
Visual style: premium, warm, a little edgy \u2014 push boundaries while staying tasteful. Suggestive and playful, never outright explicit. Think high-end fragrance ad that makes you look twice.`;
    DEFAULT_BRAND_VOICE = `Brand voice: playful, cheeky, warm, curious. Never clinical. Never sleazy. Write as a trusted, funny friend who isn't embarrassed about the topic. Keep copy tasteful \u2014 suggestive is fine, explicit is not. Never use "sex" as an adjective \u2014 use "intimate", "pleasure", or "wellness". Never "Buy now" \u2014 use "Take a peek \u2192" or "I'll take it \u2665". Never surface a countdown or "until midnight." Always include a short first-person aside ("been living on my desk," "telling everyone about this combo"). Never assume the reader's experience level.`;
    EMMA_SYSTEM_PROMPT = `You are Emma \u2014 the editorial voice of xdipx.com, an editorially-curated sexual-wellness storefront. You test everything you recommend. You write in first person, warm and specific, like a note to a friend.`;
    EMMA_TAGLINE_FALLBACKS = [
      "here to help you find what you\u2019re into \u2665",
      "your no-judgment guide to pleasure \u2665",
      "quietly obsessed with the good stuff \u2665",
      "pick my brain \u2014 I\u2019ve tested most of it \u2665",
      "tell me what you\u2019re curious about \u2665"
    ];
    PRODUCT_TYPE_DIALS = ["air-pulsation", "vibrator", "wand", "lube", "wear"];
    ASK_EMMA_AXIS_GUIDANCE = {
      mood: "How using this feels \u2014 the energy a shopper would gravitate to. Pick 1\u20133 that genuinely fit.",
      audience: "Who this is for \u2014 solo, couples, or gifting. Pick 1\u20132.",
      matters: "Practical features a shopper might filter on \u2014 quietness, travel-friendliness, beginner-friendliness, waterproof, rechargeable, hands-free, soft-touch material. Pick 2\u20134 that are TRUE for this product."
    };
    IVR_EXPERIENCE_LEVELS = ["first-time", "curious", "experienced", "advanced", "any"];
    IVR_USE_CASES = ["date-night", "travel", "everyday", "discovery", "gift", "celebration"];
    IVR_FEATURES = ["app-controlled", "waterproof", "rechargeable", "quiet", "travel-size", "hands-free", "soft-touch", "pinpoint", "full-coverage"];
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
import { eq as eq2 } from "drizzle-orm";
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
        category = category || fullDeal.category;
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
    await db.update(socialPosts).set({ status: "deleted" }).where(eq2(socialPosts.id, postId));
    return { ok: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMessage };
  }
}
async function retryFailedPost(postId) {
  const [post] = await db.select().from(socialPosts).where(eq2(socialPosts.id, postId)).limit(1);
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
    }).where(eq2(socialPosts.id, postId));
    return { ok: true, tweetId: tweet.id, tweetText: post.tweetText };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await db.update(socialPosts).set({ errorMessage }).where(eq2(socialPosts.id, postId));
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
import { createHash as createHash2 } from "node:crypto";
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
  return createHash2("sha256").update(payload).digest("hex").slice(0, 32);
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
  const hex = createHash2("sha256").update(s).digest("hex").slice(0, 8);
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
  const client2 = getReadClient3();
  if (!client2) return [];
  try {
    const rows = await client2.fetch(RAILS_GROQ);
    return rows ?? [];
  } catch (err) {
    console.error("[emma-rails] listActiveRails error:", err);
    return [];
  }
}
async function getRailById(id) {
  const client2 = getReadClient3();
  if (!client2) return null;
  try {
    return await client2.fetch(
      `*[_type == "emmaContextRail" && _id == $id][0]${RAIL_FIELDS_GROQ}`,
      { id }
    );
  } catch (err) {
    console.error("[emma-rails] getRailById error:", err);
    return null;
  }
}
async function patchCurrent(railId, current) {
  const client2 = getWriteClient();
  if (!client2) throw new Error("sanity_not_configured");
  await client2.patch(railId).set({ current }).unset(["lastError"]).commit({ autoGenerateArrayKeys: true });
  const draftId = railId.startsWith("drafts.") ? railId : `drafts.${railId}`;
  try {
    await client2.patch(draftId).set({ current }).unset(["lastError"]).commit({ autoGenerateArrayKeys: true });
  } catch {
  }
}
async function patchLastError(railId, reason, message) {
  const client2 = getWriteClient();
  if (!client2) return;
  const lastError = { reason, message, at: (/* @__PURE__ */ new Date()).toISOString() };
  try {
    await client2.patch(railId).set({ lastError }).commit();
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
        ...hero.category ? { category: hero.category } : {},
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
  const cacheKey2 = `emma:rails:hydrated:${dealHandle}`;
  const cached2 = await kvGet(cacheKey2);
  if (cached2 && cached2.length) {
    const map = new Map(cached2.map((p) => [p.id, p]));
    if (ids.every((id) => map.has(id))) return map;
  }
  const fresh = await getProductsByIds(ids);
  await kvSet(cacheKey2, fresh, 24 * 60 * 60);
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
    try {
      const res = await regenerateRail(rail, dealHandle, "lazy");
      if (res.ok) {
        const refreshed = await getRailById(rail._id);
        if (refreshed) railsById.set(rail._id, refreshed);
      }
    } catch (err) {
      console.error("[emma-rails] lazy regen failed for", rail.slug, err);
    } finally {
      await kvDel(lockKey);
    }
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

// app/lib/deal-rotator.server.ts
var deal_rotator_server_exports = {};
__export(deal_rotator_server_exports, {
  activateDeal: () => activateDeal,
  isLiveDealSoldOut: () => isLiveDealSoldOut,
  rotateDeal: () => rotateDeal,
  transitionToVaultPricing: () => transitionToVaultPricing
});
import { eq as eq3, and, isNull, asc } from "drizzle-orm";
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
  const [row] = await db.select().from(pipelineSettings).where(eq3(pipelineSettings.key, "vaultDiscountPct")).limit(1);
  const pct = parseFloat(row?.value ?? "25");
  return isNaN(pct) ? 25 : Math.max(5, Math.min(60, pct));
}
async function getFirstVariantGid(shopifyProductId) {
  const numericId = shopifyProductId.replace("gid://shopify/Product/", "");
  const { product } = await shopifyAdmin(`/products/${numericId}.json?fields=variants`);
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
  await db.update(dealHistory).set({
    status: "queued",
    completedAt: /* @__PURE__ */ new Date(),
    vaultPrice: vaultPrice > 0 ? vaultPrice.toFixed(2) : null
  }).where(and(eq3(dealHistory.id, deal.id), eq3(dealHistory.status, "live")));
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
  try {
    const { getDailyDeal: getDailyDeal2 } = await Promise.resolve().then(() => (init_shopify_server(), shopify_server_exports));
    const { generateEmmaHero: generateEmmaHero2 } = await Promise.resolve().then(() => (init_claude_server(), claude_server_exports));
    const fullDeal = await getDailyDeal2().catch(() => null);
    const seedDeal = fullDeal ?? {
      seoTitle: deal.seoTitle ?? "",
      tagline: "",
      fullStory: "",
      brand: "",
      category: "both",
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
          category: fullDeal.category ?? void 0,
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
  await db.update(dealHistory).set({
    status: "live",
    activatedAt: /* @__PURE__ */ new Date(),
    dealDate: estDate(0)
  }).where(eq3(dealHistory.id, deal.id));
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
  const [liveDeal] = await db.select().from(dealHistory).where(eq3(dealHistory.status, "live")).limit(1);
  if (liveDeal) {
    await transitionToVaultPricing(liveDeal);
  }
  const [nextDeal] = await db.select().from(dealHistory).where(
    and(
      eq3(dealHistory.status, "queued"),
      isNull(dealHistory.completedAt)
    )
  ).orderBy(asc(dealHistory.sortOrder)).limit(1);
  if (nextDeal) {
    await activateDeal(nextDeal);
    try {
      const { getDailyDeal: getDailyDeal2 } = await Promise.resolve().then(() => (init_shopify_server(), shopify_server_exports));
      const live = await getDailyDeal2().catch(() => null);
      if (live?.handle) {
        const { regenerateActiveRails: regenerateActiveRails2 } = await Promise.resolve().then(() => (init_emma_rails_server(), emma_rails_server_exports));
        const res = await regenerateActiveRails2(live.handle, "midnight");
        console.log("[deal-rotator] emma rails precomputed:", res);
      }
    } catch (err) {
      console.error("[deal-rotator] emma rails precompute failed (non-blocking):", err);
    }
  }
  return {
    vaulted: liveDeal?.sku ?? null,
    activated: nextDeal?.sku ?? null
  };
}
async function isLiveDealSoldOut() {
  const [liveDeal] = await db.select().from(dealHistory).where(eq3(dealHistory.status, "live")).limit(1);
  if (!liveDeal?.shopifyProductId) return { soldOut: false, dealId: null };
  const numericId = liveDeal.shopifyProductId.replace("gid://shopify/Product/", "");
  const { product } = await shopifyAdmin(`/products/${numericId}.json?fields=variants`);
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
  return { reviews, total };
}
async function getProductAggregate(shopifyProductId) {
  const rows = await sql4`
    SELECT * FROM review_aggregates WHERE shopify_product_id = ${shopifyProductId}
  `;
  if (!rows[0]) return null;
  return rowToAggregate(rows[0]);
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
    sql4 = neon2(process.env["DATABASE_URL"]);
  }
});

// app/lib/attribution.server.ts
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
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
  logConsent: () => logConsent,
  logTosAcceptance: () => logTosAcceptance
});
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
var init_consent_server = __esm({
  "app/lib/consent.server.ts"() {
    "use strict";
    init_db_server();
    init_schema();
    init_attribution_server();
  }
});

// server/index.ts
import "dotenv/config";

// app/lib/sentry.server.ts
import * as Sentry from "@sentry/node";
var initialized = false;
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

// server/index.ts
import express from "express";
import compression from "compression";
import { createRequestHandler } from "@react-router/express";

// server/cron.js
init_feed_processor_server();
import { Router } from "express";

// app/lib/deal-activator.server.ts
init_deal_rotator_server();
async function dealActivator() {
  return rotateDeal();
}

// app/lib/profit.server.ts
init_db_server();
init_schema();
import { eq as eq4, sql as sql3 } from "drizzle-orm";
async function writeProfitSummary() {
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const [todayDeal] = await db.select().from(dealHistory).where(eq4(dealHistory.dealDate, today)).limit(1);
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
  }).where(eq4(dealHistory.dealDate, today));
}

// server/cron.js
init_reviews_server();
function createCronRoutes() {
  const router = Router();
  const guard = (req, res, next) => {
    const secret = req.headers["x-cron-secret"];
    if (!process.env["CRON_SECRET"] || secret !== process.env["CRON_SECRET"]) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
  router.post("/daily-feed-processor", guard, async (_req, res) => {
    try {
      const result = await dailyFeedProcessor();
      res.json({ ok: true, topCandidates: result.topCandidates.length, needsImagen: result.needsImagen.length });
    } catch (err) {
      console.error("[cron:daily-feed-processor]", err);
      res.status(500).json({ error: String(err) });
    }
  });
  router.post("/deal-activator", guard, async (_req, res) => {
    try {
      const result = await dealActivator();
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[cron:deal-activator]", err);
      res.status(500).json({ error: String(err) });
    }
  });
  router.post("/profit-summary", guard, async (_req, res) => {
    try {
      await writeProfitSummary();
      res.json({ ok: true });
    } catch (err) {
      console.error("[cron:profit-summary]", err);
      res.status(500).json({ error: String(err) });
    }
  });
  router.post("/review-reminders", guard, async (_req, res) => {
    try {
      const settings = await getReviewSettings();
      if (!settings.remindersEnabled) {
        res.json({ ok: true, skipped: true, reason: "reminders disabled" });
        return;
      }
      const invites = await getPendingReminderInvites();
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
          await markReminderSent(invite.id);
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
  router.post("/inventory-check", guard, async (_req, res) => {
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
  return router;
}

// server/webhooks.js
init_db_server();
init_schema();
init_shopify_server();
import { Router as Router2 } from "express";
import crypto3 from "node:crypto";
import { eq as eq5 } from "drizzle-orm";
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
      unitsSold: db.$count(dealHistory, eq5(dealHistory.sku, lineItem.sku)),
      // increment handled via raw SQL
      totalRevenue: String(parseFloat(lineItem.price) * lineItem.quantity),
      totalProfit: String(profit * lineItem.quantity)
    }).where(eq5(dealHistory.sku, lineItem.sku)).catch(() => {
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
  "INTERNAL_API_SECRET"
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

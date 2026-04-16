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
  const { createClient: createClient2 } = await import("@vercel/kv");
  _kv = createClient2({
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
var _kv, _g, memStore, KV_KEYS;
var init_kv_server = __esm({
  "app/lib/kv.server.ts"() {
    "use strict";
    _kv = null;
    _g = globalThis;
    if (!_g.__kvMemStore) _g.__kvMemStore = /* @__PURE__ */ new Map();
    memStore = _g.__kvMemStore;
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
      collectionCursor: (handle, page) => `vault:cursor:${handle}:p${page}`
    };
  }
});

// db/schema.ts
var schema_exports = {};
__export(schema_exports, {
  adminRoles: () => adminRoles,
  consentLog: () => consentLog,
  customerAnniversaries: () => customerAnniversaries,
  customerProfileExtras: () => customerProfileExtras,
  dailyProfitSummary: () => dailyProfitSummary,
  dealHistory: () => dealHistory,
  orderLineItems: () => orderLineItems,
  pipelineSettings: () => pipelineSettings,
  productCopurchase: () => productCopurchase,
  referrals: () => referrals,
  socialPosts: () => socialPosts,
  tosAcceptance: () => tosAcceptance,
  tosVersions: () => tosVersions,
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
var dealHistory, consentLog, tosAcceptance, tosVersions, referrals, dailyProfitSummary, pipelineSettings, customerProfileExtras, customerAnniversaries, socialPosts, adminRoles, orderLineItems, wishlists, wishlistItems, productCopurchase;
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
      isDefault: boolean("is_default").default(false).notNull(),
      publicSlug: varchar("public_slug", { length: 20 }),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    }, (t) => ({
      slugUnique: uniqueIndex("wishlists_slug_uniq").on(t.publicSlug),
      customerIdx: index("wishlists_customer_idx").on(t.customerGid),
      customerNameUq: uniqueIndex("wishlists_customer_name").on(t.customerGid, t.name)
    }));
    wishlistItems = pgTable("wishlist_items", {
      id: serial("id").primaryKey(),
      wishlistId: integer("wishlist_id").notNull().references(() => wishlists.id, { onDelete: "cascade" }),
      shopifyProductId: varchar("shopify_product_id", { length: 64 }).notNull(),
      handle: varchar("handle", { length: 255 }).notNull(),
      addedAt: timestamp("added_at").defaultNow().notNull()
    }, (t) => ({
      itemUnique: uniqueIndex("wishlist_items_unique").on(t.wishlistId, t.shopifyProductId),
      listIdx: index("wishlist_items_list_idx").on(t.wishlistId)
    }));
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
  createCart: () => createCart,
  createCustomerAccessToken: () => createCustomerAccessToken,
  createDraftProduct: () => createDraftProduct,
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
  fetchAllDealProducts: () => fetchAllDealProducts,
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
  getProductsByHandles: () => getProductsByHandles,
  getProductsByIds: () => getProductsByIds,
  getProductsByTag: () => getProductsByTag,
  getRecentVaultDeals: () => getRecentVaultDeals,
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
  removeFromCart: () => removeFromCart,
  reorderProductImages: () => reorderProductImages,
  searchAdminProducts: () => searchAdminProducts,
  searchProducts: () => searchProducts,
  setDealStatus: () => setDealStatus,
  setMediaAsPrimary: () => setMediaAsPrimary,
  shopifyAdmin: () => shopifyAdmin,
  updateCartLine: () => updateCartLine,
  updateCollectionDescription: () => updateCollectionDescription,
  updateCollectionImage: () => updateCollectionImage,
  updateProductMetafield: () => updateProductMetafield,
  updateProductTags: () => updateProductTags,
  updateVariantPricing: () => updateVariantPricing,
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
  const variant = node.variants.edges[0]?.node;
  const dealPrice = parseFloat(variant?.price.amount ?? "0");
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
    qty: variant?.quantityAvailable ?? 0
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
function nodeToProduct(node) {
  const variant = node.variants.edges[0]?.node;
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
      quantityAvailable: e.node.quantityAvailable
    })),
    price: parseFloat(variant?.price.amount ?? "0"),
    ...variant?.compareAtPrice ? { compareAtPrice: parseFloat(variant.compareAtPrice.amount) } : {},
    brand: node.vendor,
    tags: node.tags
  };
}
function nodeToDeal(node) {
  const mf = node.metafields;
  const variant = node.variants.edges[0]?.node;
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
    featureBullets: parseMetafieldJSON(mf, "feature_bullets", []),
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
      quantityAvailable: e.node.quantityAvailable
    })),
    options: node.options
    // rating populated by Judge.me integration — omitted until available
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
  const data = await storefront(`
    query GetProduct($handle: String!) {
      product(handle: $handle) { ${PRODUCT_CORE_FRAGMENT} }
    }
  `, { handle });
  if (!data.product) return null;
  return nodeToProduct(data.product);
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
    featureBullets: mfJSON("feature_bullets", []),
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
        quantityAvailable: v.inventory_quantity ?? 0
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
  const data = await storefront(`
    query GetProductsByTag($query: String!, $first: Int!) {
      products(first: $first, query: $query) {
        edges { node { ${PRODUCT_CORE_FRAGMENT} } }
      }
    }
  `, { query: `tag:${tag}`, first: limit });
  return data.products.edges.map((e) => nodeToProduct(e.node));
}
async function getCollectionProducts(handle, limit = 8) {
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
}
async function getProductsByHandles(handles) {
  if (handles.length === 0) return [];
  const results = await Promise.all(handles.map((h) => getProductByHandle(h)));
  return results.filter((p) => p !== null);
}
async function getBonusDeal() {
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
async function getCollectionDeals(handle, page = 1, limit = 20) {
  let after = null;
  if (page > 1) {
    const cached = await kvGet(KV_KEYS.collectionCursor(handle, page));
    if (cached) {
      after = cached;
    } else {
      for (let p = 1; p < page; p++) {
        const skip = await storefront(`
          query SkipPage($handle: String!, $first: Int!, $after: String) {
            collection(handle: $handle) {
              products(first: $first, after: $after, sortKey: MANUAL) {
                edges { cursor }
              }
            }
          }
        `, { handle, first: limit, after });
        const edges = skip.collection?.products.edges;
        if (!edges?.length) return { deals: [], hasNextPage: false };
        after = edges[edges.length - 1].cursor;
        await kvSet(KV_KEYS.collectionCursor(handle, p + 1), after, COLLECTION_CURSOR_TTL);
      }
    }
  }
  const data = await storefront(`
    query GetCollectionDeals($handle: String!, $first: Int!, $after: String) {
      collection(handle: $handle) {
        products(first: $first, after: $after, sortKey: MANUAL) {
          pageInfo { hasNextPage }
          edges { cursor node { ${PRODUCT_CARD_FRAGMENT} } }
        }
      }
    }
  `, { handle, first: limit, after });
  if (!data.collection) return { deals: [], hasNextPage: false };
  return {
    deals: data.collection.products.edges.map((e) => nodeToVaultDeal(e.node)),
    hasNextPage: data.collection.products.pageInfo.hasNextPage
  };
}
async function getMainMenu() {
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
}
async function getShopifyCollections() {
  const data = await adminGraphQL(`
    query GetCollections {
      collections(first: 100, sortKey: TITLE) {
        edges { node { handle title } }
      }
    }
  `);
  return data.collections.edges.map((e) => e.node);
}
async function getAccessoryProducts(ids) {
  if (!ids.length) return [];
  const queries = ids.map((id, i) => `p${i}: product(id: "${id}") { ${PRODUCT_CORE_FRAGMENT} }`).join("\n");
  const data = await storefront(`query { ${queries} }`);
  return Object.values(data).filter((n) => n !== null).map((n) => nodeToProduct(n));
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
function rawCartToCart(raw) {
  return {
    id: raw.id,
    checkoutUrl: raw.checkoutUrl,
    totalQuantity: raw.totalQuantity,
    lines: raw.lines.edges.map((e) => ({
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
    })),
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
      ...doc.description !== void 0 ? { descriptionHtml: ptToHtml(doc.description) } : {},
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
  add("full_story", ptToHtml(doc.fullStory), "multi_line_text_field", true);
  add("works_for_him", ptToHtml(doc.worksForHim), "multi_line_text_field", true);
  add("works_for_her", ptToHtml(doc.worksForHer), "multi_line_text_field", true);
  add("mood_image_url", doc.moodImageUrl, "single_line_text_field");
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
  if (!doc.boxContents?.length) throw new Error("pushProductToShopify: boxContents is empty");
  metafields.push({
    namespace: "xdipx",
    key: "box_contents",
    ownerId: gid,
    value: JSON.stringify(doc.boxContents),
    type: "json"
  });
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
  return res.product.id;
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
  return res.product.id;
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
async function uploadThumbnailToProduct(shopifyProductGid, imageBuffer, filename, altText) {
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
  form.append("file", new Blob([imageBuffer], { type: "image/jpeg" }), filename);
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
async function getProductAdminImages(numericId) {
  const id = numericId.replace("gid://shopify/Product/", "");
  const data = await shopifyAdmin(`/products/${id}/images.json?limit=250`);
  return data.images ?? [];
}
async function deleteProductImage(numericProductId, imageId) {
  const id = numericProductId.replace("gid://shopify/Product/", "");
  await shopifyAdmin(`/products/${id}/images/${imageId}.json`, "DELETE");
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
async function updateCollectionImage(collectionId, imageBuffer, filename, alt) {
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
async function updateCollectionDescription(...args) {
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
async function getStorefrontCollections(first = 50) {
  const data = await storefront(`
    query GetStorefrontCollections($first: Int!) {
      collections(first: $first, sortKey: TITLE) {
        edges { node { id handle title } }
      }
    }
  `, { first });
  return data.collections.edges.map((e) => e.node);
}
var COLLECTION_CURSOR_TTL, STOREFRONT_ENDPOINT, ADMIN_ENDPOINT, ADMIN_GQL_ENDPOINT, METAFIELDS_FRAGMENT, PRODUCT_CORE_FRAGMENT, CARD_METAFIELDS_FRAGMENT, PRODUCT_CARD_FRAGMENT, CART_FRAGMENT, CUSTOMER_ADDRESS_FRAGMENT, STOREFRONT_ORDER_LEAN_FRAGMENT, SUBSCRIPTION_CONTRACT_FRAGMENT, SEARCH_PRODUCT_FRAGMENT;
var init_shopify_server = __esm({
  "app/lib/shopify.server.ts"() {
    "use strict";
    init_kv_server();
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
    { namespace: "xdipx", key: "feature_bullets" }
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
    { namespace: "custom", key: "original_description" }
  ]) {
    namespace key value
  }
`;
    PRODUCT_CORE_FRAGMENT = `
  id handle title vendor tags description
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
  ]) {
    namespace key value
  }
`;
    PRODUCT_CARD_FRAGMENT = `
  id handle title vendor tags
  images(first: 1) {
    edges { node { url altText } }
  }
  variants(first: 1) {
    edges {
      node {
        price { amount }
        compareAtPrice { amount }
        quantityAvailable
        availableForSale
      }
    }
  }
  ${CARD_METAFIELDS_FRAGMENT}
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
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      revision: "2024-10-15",
      Authorization: `Klaviyo-API-Key ${process.env["KLAVIYO_API_KEY"]}`
    },
    body: body ? JSON.stringify(body) : void 0
  });
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

// app/lib/claude.server.ts
import Anthropic from "@anthropic-ai/sdk";
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
function stripFences(raw) {
  return raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
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
var client, MODEL, MODEL_FAST, SYSTEM_PROMPT;
var init_claude_server = __esm({
  "app/lib/claude.server.ts"() {
    "use strict";
    client = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });
    MODEL = "claude-sonnet-4-20250514";
    MODEL_FAST = "claude-haiku-4-5-20251001";
    SYSTEM_PROMPT = `You are the voice of xdipx.com \u2014 a daily flash-sale site for sexual wellness products.
Brand voice: playful, cheeky, warm, curious. Never clinical. Never sleazy.
Write as a trusted, funny friend who isn't embarrassed about the topic. Your goal is to welcome first-time buyers and delight experienced ones.
Keep all copy tasteful \u2014 suggestive is fine, explicit is not.
Always signal discretion, value, and trust.
Never use "sex" as an adjective \u2014 use "intimate", "pleasure", or "wellness".
Never assume the reader's experience level.
Always end descriptions with a curiosity hook that makes the reader want to try it.`;
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
    const rid = m["review_id"];
    if (!mediaByReview.has(rid)) mediaByReview.set(rid, []);
    mediaByReview.get(rid).push(rowToMedia(m));
  }
  const attrByReview = /* @__PURE__ */ new Map();
  for (const a of attrRows) {
    const rid = a["review_id"];
    if (!attrByReview.has(rid)) attrByReview.set(rid, []);
    attrByReview.get(rid).push(rowToAttributeRating(a));
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
    const rid = m["review_id"];
    if (!mediaByReview.has(rid)) mediaByReview.set(rid, []);
    mediaByReview.get(rid).push(rowToMedia(m));
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

// app/lib/sanity.server.ts
var sanity_server_exports = {};
__export(sanity_server_exports, {
  addCmsBlock: () => addCmsBlock,
  calculateReadingTime: () => calculateReadingTime,
  getBlogCategories: () => getBlogCategories,
  getBlogHomepage: () => getBlogHomepage,
  getBlogPost: () => getBlogPost,
  getBlogPosts: () => getBlogPosts,
  getBlogPostsForSitemap: () => getBlogPostsForSitemap,
  getHomepageSections: () => getHomepageSections,
  getPage: () => getPage,
  getPageList: () => getPageList,
  getProductHandlesForSitemap: () => getProductHandlesForSitemap,
  getProductPageBlocks: () => getProductPageBlocks,
  getSiteSettings: () => getSiteSettings,
  invalidateBlogCache: () => invalidateBlogCache,
  invalidateCmsCache: () => invalidateCmsCache,
  isPreviewRequest: () => isPreviewRequest,
  removeCmsBlock: () => removeCmsBlock,
  updateCmsBlock: () => updateCmsBlock,
  upsertAnnouncementBar: () => upsertAnnouncementBar,
  upsertProductPage: () => upsertProductPage
});
import { createClient } from "@sanity/client";
function getClient(withToken = false, preview = false) {
  if (!projectId) return null;
  return createClient({ projectId, dataset, apiVersion, useCdn: !withToken && !preview, token: process.env["SANITY_API_TOKEN"], perspective: preview ? "previewDrafts" : "published" });
}
function isPreviewRequest(request) {
  const cookie = request.headers.get("cookie") ?? "";
  return cookie.includes("__sanity_preview=1");
}
async function getHomepageSections(preview = false) {
  if (!projectId) return null;
  if (!preview && _cache && Date.now() - _cache.ts < 6e4) return _cache.data;
  try {
    const client2 = getClient(false, preview);
    if (!client2) return null;
    const data = await client2.fetch(HOMEPAGE_GROQ);
    if (data && !preview) _cache = { data, ts: Date.now() };
    return data ?? null;
  } catch (err) {
    console.error("[sanity] getHomepageSections error:", err);
    return _cache?.data ?? null;
  }
}
async function upsertAnnouncementBar(messages) {
  const client2 = getClient(true);
  if (!client2) throw new Error("Sanity not configured");
  await client2.createIfNotExists({ _id: "singleton.homepage", _type: "homepageSections", sections: [] });
  await client2.patch("singleton.homepage").setIfMissing({ sections: [] }).set({
    'sections[_type=="announcementBar"].messages': messages
  }).commit();
  _cache = null;
}
async function addCmsBlock(block) {
  const client2 = getClient(true);
  if (!client2) throw new Error("Sanity not configured");
  const key = `${block._type}-${Date.now()}`;
  await client2.createIfNotExists({ _id: "singleton.homepage", _type: "homepageSections", sections: [] });
  await client2.patch("singleton.homepage").setIfMissing({ sections: [] }).append("sections", [{ ...block, _key: key }]).commit();
  _cache = null;
}
async function updateCmsBlock(key, patch) {
  const client2 = getClient(true);
  if (!client2) throw new Error("Sanity not configured");
  await client2.patch("singleton.homepage").set(
    Object.fromEntries(
      Object.entries(patch).map(([field, value]) => [`sections[_key=="${key}"].${field}`, value])
    )
  ).commit();
  _cache = null;
}
async function removeCmsBlock(key) {
  const client2 = getClient(true);
  if (!client2) throw new Error("Sanity not configured");
  await client2.patch("singleton.homepage").unset([`sections[_key=="${key}"]`]).commit();
  _cache = null;
}
function invalidateCmsCache() {
  _cache = null;
}
async function uploadImageToSanity(writeClient, imageUrl, filename) {
  if (!writeClient) return null;
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const asset = await writeClient.assets.upload("image", buffer, { filename });
    return asset.url ?? null;
  } catch {
    return null;
  }
}
async function upsertProductPage(params) {
  const writeClient = getClient(true);
  if (!writeClient) throw new Error("Sanity not configured \u2014 SANITY_API_TOKEN or SANITY_PROJECT_ID missing");
  const existing = await writeClient.fetch(
    `*[_type == "productPage" && shopifyHandle == $handle][0]{ _id, previewImageUrl }`,
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
  if (params.description !== void 0) searchFields.description = params.description;
  if (params.seoDescription !== void 0) searchFields.seoDescription = params.seoDescription;
  if (params.featureBullets !== void 0) searchFields.featureBullets = params.featureBullets;
  if (params.category !== void 0) searchFields.category = params.category;
  if (params.price !== void 0) searchFields.price = params.price;
  if (params.compareAtPrice !== void 0) searchFields.compareAtPrice = params.compareAtPrice;
  if (Object.keys(searchFields).length > 0) {
    await writeClient.patch(docId).set(searchFields).commit();
  }
  if (params.imageUrl) {
    const alreadyHasSanityImage = existing?.previewImageUrl?.includes("cdn.sanity.io");
    if (!alreadyHasSanityImage) {
      const sanityUrl = await uploadImageToSanity(
        writeClient,
        params.imageUrl,
        `${params.handle}-preview.jpg`
      );
      if (sanityUrl) {
        await writeClient.patch(docId).set({ previewImageUrl: sanityUrl }).commit();
      }
    }
  }
  return { created };
}
async function getSiteSettings() {
  if (!projectId) return null;
  if (_settingsCache && Date.now() - _settingsCache.ts < 3e5) return _settingsCache.data;
  try {
    const client2 = getClient();
    if (!client2) return null;
    const data = await client2.fetch(
      `*[_id == "singleton.siteSettings"][0]{
        _id,
        "logoUrl": logo.asset->url,
        "logoAlt": logo.alt,
        buyButtonText,
        megaMenuBanners[] { _key, menuLabel, position, link, "imageUrl": image.asset->url, "imageAlt": image.alt },
        socialLinks[],
        footerTagline, footerDiscreetHeading, footerDiscreetBody, footerCopyright, footerDisclaimer,
        footerColumns[] { _key, heading, links[] { _key, label, url } }
      }`
    );
    if (data) _settingsCache = { data, ts: Date.now() };
    return data ?? null;
  } catch (err) {
    console.error("[sanity] getSiteSettings error:", err);
    return _settingsCache?.data ?? null;
  }
}
async function getProductPageBlocks(handle) {
  if (!projectId) return [];
  try {
    const client2 = getClient();
    if (!client2) return [];
    const data = await client2.fetch(
      `*[_type == "productPage" && shopifyHandle == $handle][0]{
        "sections": contentBlocks[active == true] | order(order asc) { ${CONTENT_BLOCKS_PROJECTION} }
      }`,
      { handle }
    );
    return data?.sections ?? [];
  } catch (err) {
    console.error("[sanity] getProductPageBlocks error:", err);
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
  const cacheKey = `posts:${page}:${perPage}:${opts.category ?? ""}:${opts.featured ?? ""}`;
  const cached = getCachedBlog(cacheKey, BLOG_CACHE_TTL);
  if (cached) return cached;
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
    setCachedBlog(cacheKey, result);
    return result;
  } catch (err) {
    console.error("[sanity] getBlogPosts error:", err);
    return { posts: [], total: 0 };
  }
}
async function getBlogPost(slug, preview = false) {
  if (!projectId) return null;
  const cacheKey = `post:${slug}`;
  if (!preview) {
    const cached = getCachedBlog(cacheKey, BLOG_CACHE_TTL);
    if (cached) return cached;
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
    if (!preview) setCachedBlog(cacheKey, post);
    return post;
  } catch (err) {
    console.error("[sanity] getBlogPost error:", err);
    return null;
  }
}
async function getBlogCategories() {
  if (!projectId) return [];
  const cacheKey = "blogCategories";
  const cached = getCachedBlog(cacheKey, BLOG_CAT_CACHE_TTL);
  if (cached) return cached;
  try {
    const client2 = getClient();
    if (!client2) return [];
    const data = await client2.fetch(
      `*[_type == "blogCategory"] | order(name asc) {
        name, "slug": slug.current, description, color, seoTitle, seoDescription
      }`
    );
    if (data) setCachedBlog(cacheKey, data);
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
var CONTENT_BLOCKS_PROJECTION, projectId, dataset, apiVersion, _cache, HOMEPAGE_GROQ, _settingsCache, _blogCache, BLOG_CACHE_TTL, BLOG_CAT_CACHE_TTL, BLOG_POST_CARD_PROJECTION;
var init_sanity_server = __esm({
  "app/lib/sanity.server.ts"() {
    "use strict";
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
  // categoryGrid + testimonials share the field name "items" \u2014 use select() to avoid collision
  "items": select(
    _type == "categoryGrid" => items[]{ label, link, emoji, "image": image{ "url": asset->url, alt } },
    _type == "testimonials"  => items[]{ quote, author, rating, verified }
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
`;
    projectId = process.env["SANITY_PROJECT_ID"];
    dataset = process.env["SANITY_DATASET"] ?? "production";
    apiVersion = "2024-10-01";
    _cache = null;
    HOMEPAGE_GROQ = `
  *[_id == "singleton.homepage"][0]{
    _id,
    "sections": sections[active == true] | order(order asc) { ${CONTENT_BLOCKS_PROJECTION} }
  }
`;
    _settingsCache = null;
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
import { Router } from "express";

// app/lib/feed-processor.server.ts
init_kv_server();
init_db_server();
init_schema();
import { parse } from "csv-parse/sync";
import { sql as sql2, eq } from "drizzle-orm";
var FEED_TTL = 23 * 60 * 60;
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
  const cached = await kvGet(KV_KEYS.feedCache);
  if (cached) return cached;
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
var SKU_NEEDS_IMAGEN = /* @__PURE__ */ new Set();
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
  const score = profScore * 0.35 + dealScore * 0.3 + invScore * 0.2 + imgScore * 0.1 + catScore * 0.05;
  return {
    sku: product.SKU,
    title: cleanDescription(product["Product Title"]),
    brand: product.Brand,
    description: cleanDescription(product["Product Description"] ?? ""),
    score,
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
  "DATABASE_URL"
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

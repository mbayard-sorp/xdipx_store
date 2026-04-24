import { randomBytes } from 'node:crypto'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from './db.server'
import { wishlists, wishlistItems } from '../../db/schema'
import { getProductsByHandles } from './shopify.server'
import type { Product } from '~/types'

const DEFAULT_LIST_NAME = 'Favorites'
const MAX_LISTS_PER_CUSTOMER = 25
const MAX_ITEMS_PER_LIST = 250

export type WishlistRow = typeof wishlists.$inferSelect
export type WishlistItemRow = typeof wishlistItems.$inferSelect

export type WishlistWithCount = WishlistRow & { itemCount: number; previewHandles: string[] }

export type WishlistWithItems = WishlistRow & {
  items: Array<WishlistItemRow & { product: Product | null }>
}

function generateSlug(): string {
  // 8-char url-safe slug; 16^8 collision space is plenty for opt-in shares.
  return randomBytes(6).toString('base64url').slice(0, 8)
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function getHeartedProductIds(customerGid: string): Promise<string[]> {
  const rows = await db
    .select({ shopifyProductId: wishlistItems.shopifyProductId })
    .from(wishlistItems)
    .innerJoin(wishlists, eq(wishlists.id, wishlistItems.wishlistId))
    .where(eq(wishlists.customerGid, customerGid))
  return [...new Set(rows.map(r => r.shopifyProductId))]
}

export async function getListsForCustomer(customerGid: string): Promise<WishlistWithCount[]> {
  const lists = await db
    .select()
    .from(wishlists)
    .where(eq(wishlists.customerGid, customerGid))
    .orderBy(desc(wishlists.isDefault), desc(wishlists.updatedAt))

  if (lists.length === 0) return []

  const listIds = lists.map(l => l.id)
  const items = await db
    .select({
      wishlistId: wishlistItems.wishlistId,
      handle: wishlistItems.handle,
      addedAt: wishlistItems.addedAt,
    })
    .from(wishlistItems)
    .where(inArray(wishlistItems.wishlistId, listIds))
    .orderBy(desc(wishlistItems.addedAt))

  const byList = new Map<number, { count: number; preview: string[] }>()
  for (const it of items) {
    const bucket = byList.get(it.wishlistId) ?? { count: 0, preview: [] }
    bucket.count += 1
    if (bucket.preview.length < 3) bucket.preview.push(it.handle)
    byList.set(it.wishlistId, bucket)
  }

  return lists.map(l => ({
    ...l,
    itemCount: byList.get(l.id)?.count ?? 0,
    previewHandles: byList.get(l.id)?.preview ?? [],
  }))
}

export async function getListWithItems(
  listId: number,
  customerGid: string,
): Promise<WishlistWithItems | null> {
  const list = await db.query.wishlists.findFirst({
    where: and(eq(wishlists.id, listId), eq(wishlists.customerGid, customerGid)),
  })
  if (!list) return null

  const items = await db
    .select()
    .from(wishlistItems)
    .where(eq(wishlistItems.wishlistId, listId))
    .orderBy(desc(wishlistItems.addedAt))

  const handles = items.map(i => i.handle)
  const products = handles.length ? await getProductsByHandles(handles) : []
  const byHandle = new Map(products.map(p => [p.handle, p]))

  return {
    ...list,
    items: items.map(it => ({ ...it, product: byHandle.get(it.handle) ?? null })),
  }
}

/** Unauthenticated read for the public share route. */
export async function getPublicList(slug: string): Promise<
  | (WishlistWithItems & { ownerFirstName: string | null })
  | null
> {
  const list = await db.query.wishlists.findFirst({
    where: eq(wishlists.publicSlug, slug),
  })
  if (!list) return null

  const items = await db
    .select()
    .from(wishlistItems)
    .where(eq(wishlistItems.wishlistId, list.id))
    .orderBy(desc(wishlistItems.addedAt))

  const handles = items.map(i => i.handle)
  const products = handles.length ? await getProductsByHandles(handles) : []
  const byHandle = new Map(products.map(p => [p.handle, p]))

  return {
    ...list,
    items: items.map(it => ({ ...it, product: byHandle.get(it.handle) ?? null })),
    ownerFirstName: null, // Filled by caller if they can fetch it cheaply.
  }
}

export async function isProductHearted(
  customerGid: string,
  shopifyProductId: string,
): Promise<boolean> {
  const row = await db
    .select({ id: wishlistItems.id })
    .from(wishlistItems)
    .innerJoin(wishlists, eq(wishlists.id, wishlistItems.wishlistId))
    .where(
      and(
        eq(wishlists.customerGid, customerGid),
        eq(wishlistItems.shopifyProductId, shopifyProductId),
      ),
    )
    .limit(1)
  return row.length > 0
}

// ── Writes ─────────────────────────────────────────────────────────────────

export async function getOrCreateDefaultList(customerGid: string): Promise<WishlistRow> {
  const existing = await db.query.wishlists.findFirst({
    where: and(eq(wishlists.customerGid, customerGid), eq(wishlists.isDefault, true)),
  })
  if (existing) return existing

  const rows = await db
    .insert(wishlists)
    .values({ customerGid, name: DEFAULT_LIST_NAME, isDefault: true })
    .returning()
  return rows[0]!
}

export async function createList(customerGid: string, name: string): Promise<WishlistRow> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('List name required')
  if (trimmed.length > 100) throw new Error('List name too long')

  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(wishlists)
    .where(eq(wishlists.customerGid, customerGid))
  const count = countRows[0]?.count ?? 0
  if (count >= MAX_LISTS_PER_CUSTOMER) {
    throw new Error(`Max ${MAX_LISTS_PER_CUSTOMER} lists per customer`)
  }

  const rows = await db
    .insert(wishlists)
    .values({ customerGid, name: trimmed, isDefault: false })
    .returning()
  return rows[0]!
}

export async function renameList(
  customerGid: string,
  listId: number,
  name: string,
): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('List name required')
  if (trimmed.length > 100) throw new Error('List name too long')
  await db
    .update(wishlists)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(and(eq(wishlists.id, listId), eq(wishlists.customerGid, customerGid)))
}

export async function deleteList(customerGid: string, listId: number): Promise<void> {
  const list = await db.query.wishlists.findFirst({
    where: and(eq(wishlists.id, listId), eq(wishlists.customerGid, customerGid)),
  })
  if (!list) throw new Error('List not found')
  if (list.isDefault) throw new Error('Cannot delete default list')
  await db.delete(wishlists).where(eq(wishlists.id, listId))
}

export async function setListShared(
  customerGid: string,
  listId: number,
  shared: boolean,
): Promise<WishlistRow> {
  const list = await db.query.wishlists.findFirst({
    where: and(eq(wishlists.id, listId), eq(wishlists.customerGid, customerGid)),
  })
  if (!list) throw new Error('List not found')

  if (shared && !list.publicSlug) {
    // Try up to 5 times in case of slug collision
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const slug = generateSlug()
        const rows = await db
          .update(wishlists)
          .set({ publicSlug: slug, updatedAt: new Date() })
          .where(eq(wishlists.id, listId))
          .returning()
        return rows[0]!
      } catch (err) {
        if (attempt === 4) throw err
      }
    }
  }

  if (!shared && list.publicSlug) {
    const rows = await db
      .update(wishlists)
      .set({ publicSlug: null, updatedAt: new Date() })
      .where(eq(wishlists.id, listId))
      .returning()
    return rows[0]!
  }

  return list
}

/**
 * Add an item to a list. If listId is null, use the default list (creating it
 * if needed). Idempotent on the unique (wishlist_id, shopify_product_id) index.
 */
export async function addItem(
  customerGid: string,
  listId: number | null,
  shopifyProductId: string,
  handle: string,
): Promise<{ list: WishlistRow }> {
  const list = listId
    ? await db.query.wishlists.findFirst({
        where: and(eq(wishlists.id, listId), eq(wishlists.customerGid, customerGid)),
      })
    : await getOrCreateDefaultList(customerGid)
  if (!list) throw new Error('List not found')

  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(wishlistItems)
    .where(eq(wishlistItems.wishlistId, list.id))
  const count = countRows[0]?.count ?? 0
  if (count >= MAX_ITEMS_PER_LIST) {
    throw new Error(`Max ${MAX_ITEMS_PER_LIST} items per list`)
  }

  await db
    .insert(wishlistItems)
    .values({ wishlistId: list.id, shopifyProductId, handle })
    .onConflictDoNothing({ target: [wishlistItems.wishlistId, wishlistItems.shopifyProductId] })

  await db.update(wishlists).set({ updatedAt: new Date() }).where(eq(wishlists.id, list.id))
  return { list }
}

export async function removeItem(
  customerGid: string,
  listId: number | null,
  shopifyProductId: string,
): Promise<void> {
  // If no listId provided, remove the product from EVERY list owned by the customer
  // (used when un-hearting from a product surface that doesn't know which list it lives in).
  if (listId === null) {
    const lists = await db
      .select({ id: wishlists.id })
      .from(wishlists)
      .where(eq(wishlists.customerGid, customerGid))
    if (!lists.length) return
    await db
      .delete(wishlistItems)
      .where(
        and(
          inArray(
            wishlistItems.wishlistId,
            lists.map(l => l.id),
          ),
          eq(wishlistItems.shopifyProductId, shopifyProductId),
        ),
      )
    return
  }

  // Ownership check
  const list = await db.query.wishlists.findFirst({
    where: and(eq(wishlists.id, listId), eq(wishlists.customerGid, customerGid)),
  })
  if (!list) throw new Error('List not found')
  await db
    .delete(wishlistItems)
    .where(
      and(
        eq(wishlistItems.wishlistId, listId),
        eq(wishlistItems.shopifyProductId, shopifyProductId),
      ),
    )
}

export async function moveItem(
  customerGid: string,
  fromListId: number,
  toListId: number,
  shopifyProductId: string,
): Promise<void> {
  const [fromList, toList] = await Promise.all([
    db.query.wishlists.findFirst({
      where: and(eq(wishlists.id, fromListId), eq(wishlists.customerGid, customerGid)),
    }),
    db.query.wishlists.findFirst({
      where: and(eq(wishlists.id, toListId), eq(wishlists.customerGid, customerGid)),
    }),
  ])
  if (!fromList || !toList) throw new Error('List not found')
  if (fromListId === toListId) return

  const item = await db.query.wishlistItems.findFirst({
    where: and(
      eq(wishlistItems.wishlistId, fromListId),
      eq(wishlistItems.shopifyProductId, shopifyProductId),
    ),
  })
  if (!item) return

  await db
    .insert(wishlistItems)
    .values({ wishlistId: toListId, shopifyProductId, handle: item.handle })
    .onConflictDoNothing({ target: [wishlistItems.wishlistId, wishlistItems.shopifyProductId] })

  await db.delete(wishlistItems).where(eq(wishlistItems.id, item.id))
}

export async function setGiftMode(
  customerGid: string,
  listId: number,
  giftMode: boolean,
): Promise<WishlistRow> {
  const list = await db.query.wishlists.findFirst({
    where: and(eq(wishlists.id, listId), eq(wishlists.customerGid, customerGid)),
  })
  if (!list) throw new Error('List not found')
  const rows = await db
    .update(wishlists)
    .set({ giftMode, updatedAt: new Date() })
    .where(eq(wishlists.id, listId))
    .returning()
  return rows[0]!
}

export async function regenerateShareLink(
  customerGid: string,
  listId: number,
): Promise<WishlistRow> {
  const list = await db.query.wishlists.findFirst({
    where: and(eq(wishlists.id, listId), eq(wishlists.customerGid, customerGid)),
  })
  if (!list) throw new Error('List not found')
  if (!list.publicSlug) throw new Error('List is not shared')

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const slug = generateSlug()
      const rows = await db
        .update(wishlists)
        .set({ publicSlug: slug, updatedAt: new Date() })
        .where(eq(wishlists.id, listId))
        .returning()
      return rows[0]!
    } catch (err) {
      if (attempt === 4) throw err
    }
  }
  throw new Error('Could not regenerate link')
}

/**
 * Merge localStorage hearts (captured while logged-out) into the default list.
 * Called after login/register. Idempotent.
 */
export async function mergeLocalHearts(
  customerGid: string,
  items: Array<{ shopifyProductId: string; handle: string }>,
): Promise<{ merged: number }> {
  if (!items.length) return { merged: 0 }
  const defaultList = await getOrCreateDefaultList(customerGid)

  // Deduplicate the inbound payload.
  const byId = new Map<string, { shopifyProductId: string; handle: string }>()
  for (const it of items) {
    if (!it.shopifyProductId || !it.handle) continue
    byId.set(it.shopifyProductId, it)
  }
  const values = [...byId.values()].map(v => ({
    wishlistId: defaultList.id,
    shopifyProductId: v.shopifyProductId,
    handle: v.handle,
  }))
  if (!values.length) return { merged: 0 }

  await db
    .insert(wishlistItems)
    .values(values)
    .onConflictDoNothing({ target: [wishlistItems.wishlistId, wishlistItems.shopifyProductId] })
  return { merged: values.length }
}

/** All handles across every list owned by the customer (for Klaviyo sync). */
export async function getAllHandlesForCustomer(customerGid: string): Promise<string[]> {
  const rows = await db
    .select({ handle: wishlistItems.handle })
    .from(wishlistItems)
    .innerJoin(wishlists, eq(wishlists.id, wishlistItems.wishlistId))
    .where(eq(wishlists.customerGid, customerGid))
  return [...new Set(rows.map(r => r.handle))]
}

/**
 * CustomerAPI — unified abstraction over the two authenticated-customer
 * backends this app supports:
 *
 *   1. Storefront Customer Access Token  (email + password login)
 *   2. Shopify Customer Account API OAuth (Shop-login / passkey)
 *
 * Route code should call `customerAPI({ token, tokenType })` instead of
 * branching on `tokenType` itself, so /account routes stay identical
 * across both session types.
 *
 * Phase 0B scope:
 *   - Storefront path: fully functional (delegates to shopify.server.ts)
 *   - Customer Account API path: read-only profile/orders only.
 *     Mutations return `ACCOUNT_API_NOT_SUPPORTED` so routes can show
 *     a friendly "not available for Shop-login sessions yet" notice.
 *
 * This file is server-only (`.server.ts`) — never import from a client
 * component. Routes pass the token in; we do NOT read customer-session
 * here to keep this module stateless and easy to test.
 */

import * as shopify from './shopify.server'
import * as oauth from './customer-oauth.server'
import type {
  CustomerProfile,
  CustomerAddress,
  CustomerAddressInput,
  CustomerUpdateInput,
  OrderDetail,
  PaginatedOrders,
  StorefrontOrder,
} from './shopify.server'

export type CustomerToken = {
  token: string
  tokenType: 'storefront' | 'account'
}

export interface CustomerAPI {
  tokenType: 'storefront' | 'account'
  /** Lean profile used by the dashboard + layout shell (first 10 orders, all addresses). */
  getProfile(): Promise<CustomerProfile | null>
  /** Paginated order history (for /account/orders). */
  getOrders(opts?: {
    first?: number
    after?: string | null
    query?: string
  }): Promise<PaginatedOrders>
  /** Full order detail with fulfillments/tracking (for /account/orders/:id). */
  getOrder(id: string): Promise<OrderDetail | null>
  /** Full address book (for /account/addresses). */
  getAddresses(): Promise<CustomerAddress[]>
  createAddress(
    input: CustomerAddressInput,
  ): Promise<{ address: CustomerAddress } | { error: string }>
  updateAddress(
    id: string,
    input: CustomerAddressInput,
  ): Promise<{ address: CustomerAddress } | { error: string }>
  deleteAddress(id: string): Promise<{ ok: true } | { error: string }>
  setDefaultAddress(id: string): Promise<{ ok: true } | { error: string }>
  /** Returns updated profile + new access token if Shopify rotated it (email/password change). */
  updateProfile(
    input: CustomerUpdateInput,
  ): Promise<
    | { customer: CustomerProfile; accessToken: string | null }
    | { error: string }
  >
}

const ACCOUNT_API_NOT_SUPPORTED = {
  error: 'Not available for Shop-login sessions yet.',
} as const

export function customerAPI({ token, tokenType }: CustomerToken): CustomerAPI {
  if (tokenType === 'storefront') {
    return {
      tokenType,
      getProfile: () => shopify.getCustomerProfile(token),
      getOrders: (opts = {}) => shopify.getCustomerOrders(token, opts),
      getOrder: (id) => shopify.getCustomerOrder(token, id),
      getAddresses: () => shopify.getCustomerAddresses(token),
      createAddress: (input) => shopify.customerAddressCreate(token, input),
      updateAddress: (id, input) =>
        shopify.customerAddressUpdate(token, id, input),
      deleteAddress: (id) => shopify.customerAddressDelete(token, id),
      setDefaultAddress: (id) =>
        shopify.customerDefaultAddressUpdate(token, id),
      updateProfile: (input) => shopify.customerUpdate(token, input),
    }
  }

  // ── Customer Account API branch ─────────────────────────────────────────
  //
  // Mutations are intentionally unsupported in Phase 0B. The Customer
  // Account API has a separate GraphQL schema (at shopify.com/authentication/
  // <shopId>/graphql) with its own customerUpdate / customerAddress*
  // mutations — wiring them up is out of scope for this phase. Until then,
  // mutation calls return ACCOUNT_API_NOT_SUPPORTED so route code can show
  // a friendly notice instead of crashing. Read-only profile + orders work
  // via `getAccountCustomer` in customer-oauth.server.ts.
  return {
    tokenType,
    getProfile: async () => {
      const c = await oauth.getAccountCustomer(token)
      if (!c) return null
      // Map AccountCustomer → CustomerProfile (lean, read-only for now).
      // AccountCustomer has no phone/acceptsMarketing/createdAt/addresses
      // in the current query — fill in defaults so the type matches.
      return {
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: null,
        acceptsMarketing: false,
        createdAt: '',
        defaultAddressId: null,
        addresses: [],
        orders: c.orders.map(
          (o): StorefrontOrder => ({
            id: o.id,
            orderNumber: o.number,
            processedAt: o.processedAt,
            financialStatus: o.financialStatus,
            fulfillmentStatus: o.fulfillmentStatus,
            totalPrice: o.totalPrice,
            // Customer Account API line items only expose title+quantity
            // in the current query; imageUrl/price are placeholders until
            // the query is expanded to request variant/image/price nodes.
            lineItems: o.lineItems.map((li) => ({
              title: li.title,
              quantity: li.quantity,
              imageUrl: null,
              price: '0',
            })),
          }),
        ),
      }
    },
    getOrders: async () => {
      const c = await oauth.getAccountCustomer(token)
      const orders = (c?.orders ?? []).map(
        (o): StorefrontOrder => ({
          id: o.id,
          orderNumber: o.number,
          processedAt: o.processedAt,
          financialStatus: o.financialStatus,
          fulfillmentStatus: o.fulfillmentStatus,
          totalPrice: o.totalPrice,
          lineItems: o.lineItems.map((li) => ({
            title: li.title,
            quantity: li.quantity,
            imageUrl: null,
            price: '0',
          })),
        }),
      )
      // No pagination on the account-API read path yet — a single page
      // of up to 20 orders (see customer-oauth.server.ts GetCustomerAccount).
      return { orders, pageInfo: { hasNextPage: false, endCursor: null } }
    },
    getOrder: async (_id) => null, // not yet supported
    getAddresses: async () => [],
    createAddress: async () => ACCOUNT_API_NOT_SUPPORTED,
    updateAddress: async () => ACCOUNT_API_NOT_SUPPORTED,
    deleteAddress: async () => ACCOUNT_API_NOT_SUPPORTED,
    setDefaultAddress: async () => ACCOUNT_API_NOT_SUPPORTED,
    updateProfile: async () => ACCOUNT_API_NOT_SUPPORTED,
  }
}

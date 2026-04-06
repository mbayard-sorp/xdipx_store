/**
 * Shopify Customer Account API — OAuth 2.0 PKCE helpers.
 *
 * Required env vars:
 *   SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID  — from Shopify admin → Customer Accounts → Headless
 *   SHOPIFY_SHOP_ID                     — numeric store ID (find via Admin API /shop.json → id)
 *   SHOPIFY_STORE_DOMAIN                — e.g. yourstore.myshopify.com
 *
 * Setup steps in Shopify admin:
 *   1. Go to Settings → Customer accounts
 *   2. Choose "New customer accounts"
 *   3. Under Headless / API access, create a new Client
 *   4. Add your callback URL: https://yourdomain.com/api/customer-callback
 *   5. Copy the Client ID into SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID
 *   6. Find your Shop ID: GET https://yourstore.myshopify.com/admin/api/2024-10/shop.json
 *      and copy the "id" field into SHOPIFY_SHOP_ID
 */

import crypto from 'node:crypto'

const CLIENT_ID   = process.env['SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID'] ?? ''
const SHOP_DOMAIN = process.env['SHOPIFY_STORE_DOMAIN'] ?? ''
const SHOP_ID     = process.env['SHOPIFY_SHOP_ID'] ?? ''

export const SHOP_OAUTH_ENABLED = !!(CLIENT_ID && SHOP_DOMAIN && SHOP_ID)

// ── PKCE helpers ──────────────────────────────────────────────────────────────

export function generateState(): string {
  return crypto.randomBytes(16).toString('hex')
}

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = crypto.createHash('sha256').update(verifier).digest()
  return Buffer.from(hash).toString('base64url')
}

// ── Auth URL ──────────────────────────────────────────────────────────────────

export async function getShopLoginUrl(
  redirectUri: string,
  state: string,
  codeVerifier: string,
): Promise<string> {
  const challenge = await generateCodeChallenge(codeVerifier)
  const params = new URLSearchParams({
    client_id:             CLIENT_ID,
    redirect_uri:          redirectUri,
    response_type:         'code',
    scope:                 'openid email customer-account-api:full',
    code_challenge:        challenge,
    code_challenge_method: 'S256',
    state,
  })
  return `https://${SHOP_DOMAIN}/customer_identity/openid/v2/authorize?${params}`
}

// ── Token exchange ────────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  id_token?: string
}

export async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken: string | null }> {
  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    client_id:     CLIENT_ID,
    redirect_uri:  redirectUri,
    code,
    code_verifier: codeVerifier,
  })

  const res = await fetch(
    `https://${SHOP_DOMAIN}/customer_identity/openid/v2/token`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    },
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Shop OAuth token exchange failed (${res.status}): ${text}`)
  }

  const data = await res.json() as TokenResponse
  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token ?? null,
  }
}

// ── Customer Account API query ────────────────────────────────────────────────

export interface AccountCustomer {
  id: string
  firstName: string
  lastName: string
  email: string
  orders: AccountOrder[]
}

export interface AccountOrder {
  id: string
  number: number
  processedAt: string
  financialStatus: string
  fulfillmentStatus: string
  totalPrice: { amount: string; currencyCode: string }
  lineItems: { title: string; quantity: number }[]
}

export async function getAccountCustomer(accessToken: string): Promise<AccountCustomer | null> {
  if (!SHOP_ID) return null

  const query = `
    query GetCustomerAccount {
      customer {
        id
        firstName
        lastName
        emailAddress { emailAddress }
        orders(first: 20, sortKey: PROCESSED_AT, reverse: true) {
          nodes {
            id
            number
            processedAt
            financialStatus
            fulfillmentStatus
            totalPrice { amount currencyCode }
            lineItems(first: 5) {
              nodes { title quantity }
            }
          }
        }
      }
    }
  `

  const res = await fetch(
    `https://shopify.com/authentication/${SHOP_ID}/graphql`,
    {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        Authorization:   `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query }),
    },
  )

  if (!res.ok) return null

  const { data } = await res.json() as {
    data?: {
      customer?: {
        id: string
        firstName: string
        lastName: string
        emailAddress: { emailAddress: string }
        orders: {
          nodes: {
            id: string; number: number; processedAt: string
            financialStatus: string; fulfillmentStatus: string
            totalPrice: { amount: string; currencyCode: string }
            lineItems: { nodes: { title: string; quantity: number }[] }
          }[]
        }
      }
    }
  }

  const c = data?.customer
  if (!c) return null

  return {
    id:        c.id,
    firstName: c.firstName,
    lastName:  c.lastName,
    email:     c.emailAddress.emailAddress,
    orders:    c.orders.nodes.map(o => ({
      id:                o.id,
      number:            o.number,
      processedAt:       o.processedAt,
      financialStatus:   o.financialStatus,
      fulfillmentStatus: o.fulfillmentStatus,
      totalPrice:        o.totalPrice,
      lineItems:         o.lineItems.nodes,
    })),
  }
}

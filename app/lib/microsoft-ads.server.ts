/**
 * Microsoft Advertising API v13 REST client: the network half. Config, hosts,
 * headers and error parsing are in microsoft-ads-core.ts; tokens come from
 * microsoft-ads-token.server.ts.
 *
 * Every call goes through msAdsCall, which:
 *   - targets sandbox or production per MSADS_ENV (sandbox by default),
 *   - sends the four required headers,
 *   - throws MsAdsApiError on any fault, with Microsoft's codes attached,
 *   - surfaces PartialErrors on 200 responses instead of dropping them,
 *     because a batch call can create two campaigns and silently fail a third.
 *
 * This PR ships the read operations used to verify a connection. Writes
 * (campaign push, pause, budget) come in later PRs and stay behind the
 * ads_spend_enabled valve.
 */

import {
  describeErrors,
  extractErrors,
  isThrottle,
  msAdsConfig,
  requestHeaders,
  serviceUrl,
  type MsAdsErrorItem,
  type MsAdsService,
} from './microsoft-ads-core'
import { getMsAdsAccessToken } from './microsoft-ads-token.server'

const THROTTLE_WAIT_MS = 60_000

export class MsAdsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors: MsAdsErrorItem[],
    readonly trackingId: string | null,
  ) {
    super(message)
    this.name = 'MsAdsApiError'
  }
  get throttled(): boolean {
    return isThrottle(this.errors)
  }
}

export interface MsAdsCallOptions {
  method?:        'POST' | 'PUT' | 'DELETE'
  /** 'account' sends CustomerId + CustomerAccountId; 'user' sends neither (GetUser). */
  scope?:         'account' | 'customer' | 'user'
  /** Wait 60s and retry once on CallRateExceeded. Only for background jobs, never admin pages. */
  retryThrottle?: boolean
}

export interface MsAdsResult<T> {
  data:       T
  /** Items Microsoft rejected inside an otherwise successful call. Always check. */
  partial:    MsAdsErrorItem[]
  trackingId: string | null
}

export async function msAdsCall<T>(
  service: MsAdsService,
  path: string,
  body: unknown,
  opts: MsAdsCallOptions = {},
): Promise<MsAdsResult<T>> {
  const c = msAdsConfig()
  const scope = opts.scope ?? 'account'
  if (!c.developerToken) throw new Error(`Microsoft Ads (${c.env}): developer token is not set`)
  if (scope !== 'user' && !c.customerId) throw new Error(`Microsoft Ads (${c.env}): customer id is not set`)
  if (scope === 'account' && !c.accountId) throw new Error(`Microsoft Ads (${c.env}): account id is not set`)

  const headers = requestHeaders({
    accessToken:    await getMsAdsAccessToken(),
    developerToken: c.developerToken,
    customerId:     scope === 'user' ? undefined : c.customerId,
    accountId:      scope === 'account' ? c.accountId : undefined,
  })

  const res = await fetch(serviceUrl(c.env, service, path), {
    method: opts.method ?? 'POST',
    headers,
    body:   JSON.stringify(body ?? {}),
  })
  const trackingId = res.headers.get('TrackingId')
  const text = await res.text()

  let json: unknown = null
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      throw new MsAdsApiError(`Microsoft Ads ${service}/${path} returned non-JSON (${res.status})`, res.status, [], trackingId)
    }
  }

  const { fault, partial } = extractErrors(json)
  if (!res.ok || fault.length) {
    const err = new MsAdsApiError(
      `Microsoft Ads ${service}/${path} failed (${res.status}): ${describeErrors(fault) || text.slice(0, 200)}`,
      res.status,
      fault,
      trackingId,
    )
    if (err.throttled && opts.retryThrottle) {
      await new Promise(r => setTimeout(r, THROTTLE_WAIT_MS))
      return msAdsCall<T>(service, path, body, { ...opts, retryThrottle: false })
    }
    throw err
  }

  return { data: json as T, partial, trackingId }
}

// -- Reads ------------------------------------------------------------------------

export interface MsAdsUser {
  Id:       string | number
  UserName: string | null
  Name:     { FirstName: string | null; LastName: string | null } | null
  CustomerId: string | number | null
}

export interface MsAdsCustomerRole {
  RoleId:     number
  CustomerId: string | number
  AccountIds: Array<string | number> | null
}

/** The signed-in user and which customers/accounts they can reach. Needs no account ids. */
export async function getMsAdsUser(): Promise<{ user: MsAdsUser; roles: MsAdsCustomerRole[] }> {
  const { data } = await msAdsCall<{ User: MsAdsUser; CustomerRoles: MsAdsCustomerRole[] | null }>(
    'CustomerManagement', 'User/Query', { UserId: null }, { scope: 'user' },
  )
  return { user: data.User, roles: data.CustomerRoles ?? [] }
}

export interface MsAdsAccountInfo {
  Id:                     string | number
  Name:                   string
  Number:                 string
  AccountLifeCycleStatus: string
  PauseReason:            number | null
}

export async function getMsAdsAccounts(customerId: string): Promise<MsAdsAccountInfo[]> {
  const { data } = await msAdsCall<{ AccountsInfo: MsAdsAccountInfo[] | null }>(
    'CustomerManagement', 'AccountsInfo/Query',
    { CustomerId: customerId, OnlyParentAccounts: false },
    { scope: 'user' },
  )
  return data.AccountsInfo ?? []
}

export interface MsAdsCampaignSummary {
  Id:          string | number
  Name:        string
  Status:      string
  DailyBudget: number | null
}

/** Search campaigns in the configured account. */
export async function listMsAdsSearchCampaigns(): Promise<MsAdsCampaignSummary[]> {
  const { data, partial } = await msAdsCall<{ Campaigns: MsAdsCampaignSummary[] | null }>(
    'CampaignManagement', 'Campaigns/QueryByAccountId',
    { AccountId: msAdsConfig().accountId, CampaignType: 'Search' },
  )
  if (partial.length) throw new Error(`Microsoft Ads campaign list had errors: ${describeErrors(partial)}`)
  return data.Campaigns ?? []
}

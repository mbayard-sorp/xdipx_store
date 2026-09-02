/**
 * Which credentials this store runs on, what dies with each, and who owns it.
 *
 * ## Why this exists
 *
 * Nothing probes the validity of any of them. There is no expiry policy, no
 * rotation checklist, and no inventory. The failure mode is not hypothetical
 * and the estate already carries the shape of it in a comment: an expired
 * `IG_GRAPH_ACCESS_TOKEN` is indistinguishable from a takedown to the removal
 * watcher, which is why that watcher has a hand-written guard for exactly this
 * case and files a blocker when every post answers "does not exist" and none
 * answers normally. That guard is the right idea implemented once, for one
 * integration, by someone who happened to think of it. This generalises it.
 *
 * The related tell: the `webhook_registered` probe has existed since it was
 * built and has never been used by a single blocker row. Credential liveness
 * has been checkable all along and nothing checked it.
 *
 * ## Four states, and only one of them files anything
 *
 * `live`         the credential answered an authenticated read.
 * `dead`         it answered authoritatively that it is not valid — a 401 or a
 *                403 from a request that was correctly formed.
 * `unknown`      could not ask: a network error, a timeout, a 5xx, a shape the
 *                checker did not recognise. **Never files a blocker.** This is
 *                #4702 as a rule rather than as a lesson: an integration
 *                unreachable from this process is not proof it is broken, and
 *                the one time that distinction was collapsed it turned six
 *                healthy Shopify webhooks into a P1 owner blocker.
 * `unconfigured` no value in this process's environment. Files only when the
 *                integration is `required`, because several of these are
 *                legitimately unset and a blocker for each would be noise.
 *
 * ## `required` is a judgement, written down
 *
 * It means: the store or the fleet has a lane that silently stops without this.
 * Optional ones are real integrations that simply are not switched on, and an
 * absent value there is a decision, not a defect.
 */

export type CredentialState = 'live' | 'dead' | 'unknown' | 'unconfigured'

export interface Integration {
  /** Stable id. Also the `credential_live` probe argument, so it must not drift. */
  key: string
  label: string
  /** Every env var the check needs. All must be present or the state is `unconfigured`. */
  envVars: readonly string[]
  required: boolean
  /** Lane a failure files at. Never the owner's inbox — invariant 3. */
  ownerTeam: string
  /** What actually stops working. This is what the blocker's `unblocks` says. */
  breaks: string
  /** A failure here is on the path between a visitor and a completed order. */
  moneyPath: boolean
  /** Where the owner goes to renew it. */
  whereToGo: string
}

export const INTEGRATIONS: readonly Integration[] = [
  {
    key: 'shopify-admin',
    label: 'Shopify Admin API',
    envVars: ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ADMIN_ACCESS_TOKEN'],
    required: true,
    ownerTeam: 'product',
    breaks: 'Every write to the catalog: pricing applies, metafield writes, imports, the order webhook’s wholesale-cost stamp.',
    moneyPath: true,
    whereToGo: 'Shopify admin > Settings > Apps and sales channels > Develop apps > the xdipx app > API credentials',
  },
  {
    key: 'shopify-storefront',
    label: 'Shopify Storefront API',
    envVars: ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_STOREFRONT_ACCESS_TOKEN'],
    required: true,
    ownerTeam: 'homepage',
    breaks: 'The storefront itself. Every product page, the cart, and the checkout URL the probe walks.',
    moneyPath: true,
    whereToGo: 'Shopify admin > Settings > Apps and sales channels > Develop apps > the xdipx app > API credentials',
  },
  {
    key: 'instagram',
    label: 'Instagram Graph API',
    envVars: ['IG_GRAPH_ACCESS_TOKEN', 'IG_BUSINESS_ACCOUNT_ID'],
    required: false,
    ownerTeam: 'social',
    breaks:
      'Publishing, engagement capture, and — the expensive one — removal detection. An expired token '
      + 'reads as "this post no longer exists" to the watcher, which is why it halves posting volume '
      + 'on a credential failure unless the hand-written guard catches it.',
    moneyPath: false,
    whereToGo: 'Meta App Dashboard > Instagram > API setup with Instagram business login, then update IG_GRAPH_ACCESS_TOKEN in Vercel',
  },
  {
    key: 'x',
    label: 'X (Twitter) API',
    envVars: ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET'],
    required: false,
    ownerTeam: 'social',
    breaks: 'X publishing, metrics capture, and removal detection, with the same volume-ratchet hazard as Instagram.',
    moneyPath: false,
    whereToGo: 'X developer portal > Projects & Apps > Keys and tokens',
  },
  {
    key: 'klaviyo',
    label: 'Klaviyo',
    envVars: ['KLAVIYO_API_KEY'],
    required: true,
    ownerTeam: 'email',
    breaks: 'Every email event and list write. Subscribes silently stop landing, which looks exactly like nobody subscribing.',
    moneyPath: false,
    whereToGo: 'Klaviyo > Settings > API keys',
  },
  {
    key: 'github',
    label: 'GitHub API',
    envVars: ['GITHUB_TOKEN'],
    required: true,
    ownerTeam: 'strategy',
    breaks: 'The release engine. No PR is read, evaluated or merged, and the whole agent fleet’s output stops reaching production.',
    moneyPath: false,
    whereToGo: 'GitHub > Settings > Developer settings > Personal access tokens',
  },
  {
    key: 'vercel',
    label: 'Vercel API',
    envVars: ['VERCEL_TOKEN', 'VERCEL_PROJECT_ID'],
    required: true,
    ownerTeam: 'strategy',
    breaks:
      'The runtime log read. That is check 4 of the conversion-delivery watcher, which looks for the '
      + 'fallback-stub marker — one of four signals that Purchase delivery is dead.',
    moneyPath: true,
    whereToGo: 'Vercel > Account Settings > Tokens',
  },
  {
    key: 'twilio',
    label: 'Twilio',
    envVars: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
    required: true,
    ownerTeam: 'strategy',
    breaks:
      'SMS in both directions for the IVR and support lanes. Not the owner pager: SMS paging is off by '
      + 'owner decision (2026-09-02), so the owner is paged by email only and this credential is a '
      + 'customer-facing one.',
    moneyPath: false,
    whereToGo: 'Twilio Console > Account > API keys & tokens',
  },
  {
    key: 'runpod',
    label: 'RunPod',
    envVars: ['RUNPOD_API_KEY'],
    required: false,
    ownerTeam: 'video',
    breaks: 'Video rendering, and the hourly stray-pod watch that stops an idle GPU billing by the hour.',
    moneyPath: false,
    whereToGo: 'RunPod console > Settings > API Keys',
  },
]

const BY_KEY = new Map(INTEGRATIONS.map(i => [i.key, i]))

export function integration(key: string): Integration | null {
  return BY_KEY.get(key) ?? null
}

/** A dead or missing-but-required credential is worth an owner blocker. */
export function shouldFile(i: Integration, state: CredentialState): boolean {
  if (state === 'dead') return true
  if (state === 'unconfigured') return i.required
  return false
}

/** Stable dedupe key, so a credential that dies twice is one row, not two. */
export function credentialDedupeKey(key: string): string {
  return `credential-${key}`
}

/**
 * Meta credentials from the environment (plan §3.1: the token strategy lives
 * with the adapter, not the export layer). Read by the Graph client, the
 * adapter and mutate.server.ts. ad-export/meta-push.server.ts re-exports it so
 * older imports keep working.
 */
export interface MetaCredentials { token: string | null; accountId: string | null; pageId: string | null }

export function metaCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): MetaCredentials {
  const clean = (v: string | undefined): string | null => (v && v.trim() ? v.trim() : null)
  const account = clean(env['META_AD_ACCOUNT_ID'])
  return {
    token: clean(env['META_ADS_ACCESS_TOKEN']) ?? clean(env['META_ACCESS_TOKEN']),
    accountId: account ? (account.startsWith('act_') ? account : `act_${account}`) : null,
    pageId: clean(env['META_PAGE_ID']),
  }
}

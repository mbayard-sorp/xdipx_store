# Microsoft Advertising API runbook

Setup and operation of the server-side Microsoft Advertising integration (API v13, REST). PR 1 ships the client, the OAuth connect flow, and the token store. Pushing campaigns, rule actions, and metrics come in later PRs, and every write stays behind the `ads_spend_enabled` valve.

Policy comes first. Microsoft accepts xdipx only through the Adult Advertising Program: text Search ads only, 18+ age targeting, exact-match keywords from Microsoft's approved adult list, and an adults-only line in the copy where space allows. Nothing goes live until the account is accepted. See `docs/ads-policy.md`.

This is separate from the Microsoft Ads MCP connector in claude.ai. That connector is read-only and uses its own public-client Entra app ("Ads MCP App"). The server uses a second, confidential app described below.

## Code map

| File | Role |
|---|---|
| `app/lib/microsoft-ads-core.ts` | Pure: env config, REST hosts, headers, error parsing, token encryption. Tested in `microsoft-ads-core.test.ts`. |
| `app/lib/microsoft-ads-oauth.server.ts` | Authorize URL, code exchange, refresh, CSRF state cookie. |
| `app/lib/microsoft-ads-token.server.ts` | `getMsAdsAccessToken()`, the only source of access tokens. Stores rotated refresh tokens. |
| `app/lib/microsoft-ads.server.ts` | `msAdsCall()` plus the read operations used to verify a connection. |
| `app/routes/api.microsoft-ads-connect.tsx` | Admin-only. Starts the OAuth handshake. |
| `app/routes/api.microsoft-ads-callback.tsx` | Admin-only. Stores the token and shows the reachable customer and account IDs. |
| `db/migrations/125_microsoft_ads_tokens.sql` | Append-only token table, additive. |

There is no official Node SDK, so the client calls REST with `fetch`. Request shapes come from the "Request JSON" tab on each operation's page under learn.microsoft.com/advertising.

## Environments

`MSADS_ENV` selects `sandbox` or `production`. Anything except the exact string `production` is sandbox, so a missing or mistyped value can never reach the real account.

Sandbox and production are separate Microsoft accounts with separate IDs. Tokens are stored per environment, so switching `MSADS_ENV` needs a fresh connect for that environment the first time.

| Variable | Sandbox | Production |
|---|---|---|
| `MSADS_CLIENT_ID` | shared | shared |
| `MSADS_CLIENT_SECRET` | shared | shared |
| `MSADS_TOKEN_KEY` | shared | shared |
| Developer token | `MSADS_SANDBOX_DEVELOPER_TOKEN`, defaults to Microsoft's public `BBD37VB98` | `MSADS_DEVELOPER_TOKEN` |
| Customer ID | `MSADS_SANDBOX_CUSTOMER_ID` | `MSADS_CUSTOMER_ID` |
| Account ID | `MSADS_SANDBOX_ACCOUNT_ID` | `MSADS_ACCOUNT_ID` |
| `MSADS_REDIRECT_URI` | optional override | optional override |

Production IDs for the xdipx account: customer 255065511, account 188472831. They are not secrets.

## One-time setup

1. In portal.azure.com, check that the directory switcher shows your own Default Directory. The owner's Microsoft account is also a guest in three work tenants, and an app registered there belongs to that employer.
2. Microsoft Entra ID, App registrations, New registration. Name `xdipx Ads API`. Supported account types: any organizational directory and personal Microsoft accounts. Redirect URI: platform Web, `https://xdipx.com/api/microsoft-ads-callback`.
3. Copy the Application (client) ID into `MSADS_CLIENT_ID`.
4. Authentication, Web, add `http://localhost:3000/api/microsoft-ads-callback` for local sandbox testing.
5. Certificates & secrets, New client secret, 24 months. Copy the Value column (not the Secret ID) into `MSADS_CLIENT_SECRET`, and set a reminder before it expires.
6. Generate `MSADS_TOKEN_KEY` with `openssl rand -base64 48`.
7. Create a sandbox account at sandbox.bingads.microsoft.com.
8. Add the variables to Vercel from the main checkout (`/Users/mikebayard/Claude/xdipx_store`, linked to the `xdipx` project) and to the main repo's `.env.local`. Start with `MSADS_ENV=sandbox`.
9. Visit `/api/microsoft-ads-connect` signed in as an admin and pick the sandbox Microsoft account. The callback page lists the customer and account IDs that login can reach; copy them into `MSADS_SANDBOX_CUSTOMER_ID` and `MSADS_SANDBOX_ACCOUNT_ID`.

The client secret and `MSADS_TOKEN_KEY` are entered by the owner. Agents never write them.

## How tokens work

The connect flow stores the refresh token AES-256-GCM encrypted in `microsoft_ads_tokens`, keyed by `MSADS_TOKEN_KEY`. Microsoft may return a new refresh token on any refresh; when it does, the new one is written as a new row. The newest successful row per environment is the current token. A failed refresh writes a failure row and leaves the good rows alone.

Access tokens last about an hour and are cached in function memory, so a warm function refreshes at most once an hour.

Rotating `MSADS_TOKEN_KEY` makes every stored token unreadable. Reconnect after changing it.

## When it breaks

| Symptom | Cause | Fix |
|---|---|---|
| "is not connected: Microsoft rejected the stored refresh token (invalid_grant)" | Consent lost: password change, revoked app, or token expiry | Reconnect at `/api/microsoft-ads-connect` |
| "stored token cannot be decrypted" | `MSADS_TOKEN_KEY` changed | Reconnect |
| `AADSTS50011` on the Microsoft page | Redirect URI mismatch | The URI must match the Entra app byte for byte; check `APP_URL` or set `MSADS_REDIRECT_URI` |
| `AADSTS7000215` | Wrong client secret, usually the Secret ID pasted instead of the Value | Create a new secret |
| Error 117 `CallRateExceeded` | Per-minute throttle | Wait 60 seconds. Background jobs pass `retryThrottle: true` |
| Wrong account picked at sign-in | Browser signed in to a work tenant | The connect URL forces the account picker; choose the Ads login |

Check token health with:

```sql
SELECT env, source, success, error, attempted_at
FROM microsoft_ads_tokens ORDER BY attempted_at DESC LIMIT 10;
```

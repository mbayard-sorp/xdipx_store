# Homepage Team Routines — Network & Environment Requirements

The scheduled Claude cloud routines (Routine A — Daily Merchandiser, Routine B —
Design Cycle) call the live site for data and spend logging. If the environment
they run in has outbound HTTPS blocked, the routine cannot start: every call to
the team API returns a proxy `403` (`connect_rejected` at the egress gateway),
and the run never gets a `$RUN_ID`. This doc captures exactly what an
environment needs so the next setup doesn't hit that wall.

## Symptom

- `curl` to `https://xdipx.com/...` exits `56` (failure receiving network data),
  HTTP `000`.
- The agent proxy status (`curl -sS "$HTTPS_PROXY/__agentproxy/status"`) shows
  `recentRelayFailures` with `kind: "connect_rejected"` and
  `detail: "gateway answered 403 to CONNECT (policy denial ...)"` for the host.
- This is an **organization egress-policy denial**, not a TLS or code issue. Do
  not retry or route around it (per `/root/.ccr/README.md`); fix the environment
  policy instead.

## 1. Network egress must be ON

In the environment / sandbox settings (claude.ai → Code), under **Code execution
and file creation**:

- **Allow network egress** — must be **on**.
- **Domain allowlist** — either **All domains**, or a custom allowlist that
  includes the domains below.

**The policy binds when the sandbox starts.** Toggling egress on does not
retrofit an already-running session — the live run stays blocked. Re-trigger the
routine (fresh session) so the new sandbox picks up the policy.

## 2. Required domains

| Domain | Needed for | When |
|---|---|---|
| `xdipx.com` | Team API: `run` / `gate` / `event` / `spend`, and the Step 7 self-validate fetch of `/`. | **Every run.** Hard requirement. |
| `lovehoney.com` | Monday competitor recon (mission brief §4). | Mondays only. |
| `spectrumboutique.com` | Monday competitor recon. | Mondays only. |
| `inthegroove.com` | Monday competitor recon (In The Groove). | Mondays only. |
| `tootimid.com` | Monday competitor recon (Too Timid). | Mondays only. |

Monday recon also WebFetches one new competitor not previously reviewed, so a
custom allowlist will need occasional additions. **All domains** avoids that
maintenance; a custom allowlist is tighter for security (egress is a stated
security risk in the settings panel). Either works — the routine only strictly
needs `xdipx.com`.

## 3. Required environment variables

Egress alone is not enough — the team API is secret-guarded. Every call sends
`x-team-secret: $HOMEPAGE_TEAM_TOKEN` (falls back to `Authorization: Bearer`).
The environment must set one of:

- `HOMEPAGE_TEAM_TOKEN` — preferred.
- `CRON_SECRET` — fallback.

If neither is set in the environment, a run that clears the egress `403` will
then hit `401 Unauthorized` on the team API.

## 4. What this does NOT change

Opening egress to `xdipx.com` only lets the routine reach the team **data /
spend** endpoints. Reasoning still runs on the **Max subscription**; the routine
must never call the site's Anthropic-keyed copy/enrich endpoints (that would flip
free Max work to metered). See `docs/homepage-team/routine-daily-merchandise.md`
and `mission-brief.md`.

## 5. What is NOT reachable in the scheduled cloud runner (and the fallback)

Several capabilities are **structurally unavailable** in the scheduled cloud
sandbox. Every run used to re-probe and re-record the same absences from scratch
(GA4 MCP, direct Postgres, the screenshot design gate), which wastes a
probe-and-record cycle per capability per run and clutters the dashboard with
"unavailable" decision events. Treat the table below as the standing reality and
use the fallback directly — do not re-probe, and record an absence only if the
fallback itself fails.

| Not reachable in the cloud runner | Why | Use instead |
|---|---|---|
| **Direct Postgres / Neon socket** | egress policy blocks the DB port | Read scoreboard / `daily_profit_summary` / settings over the **HTTPS team API**; never open a DB socket. |
| **GA4 MCP** (`google-analytics`) | not connected in the scheduled runner | Treat as unavailable unless a run confirms it is connected. Per strategy brief, GA4 is unused below 300 sessions/week anyway — run on margin math and say so. |
| **Claude_Preview design gate** (composed-page screenshot) | MCP not wired into the cloud runner | **Superseded 2026-09-16 (run 905): the real gate runs in the cloud runner now.** `npx tsx scripts/design-snapshots.ts --base https://xdipx.com --routes / --viewport doctrine` captures 375/768/1440 full-page PNGs for `design-critic` to score. The script carries both sandbox accommodations itself (Node-`fetch` transport for the proxy CA, and a fallback to the pre-installed chromium); do **not** run `playwright install`. The degraded per-image heuristic is now the FALLBACK, used only when that command actually fails, with the failure named in the run summary. |
| **Shopify Admin creds** | absent in the runner | Skip probes and dep-installs whose only purpose is reaching Admin; use the **Storefront API** metafields (`namespace:"xdipx"`) with `SHOPIFY_STOREFRONT_ACCESS_TOKEN` for margin/handle reads. **Social image generation does NOT need the Admin token in the sandbox** (ticket #4133): `scripts/gen-social-image.ts` POSTs to `POST /api/team/social-image`, which runs generation + the Shopify Files rehost **server-side** where the Admin token already lives. Do not chase `SHOPIFY_ADMIN_ACCESS_TOKEN` into the runner for imagery; route through the server, exactly as the video lane already does. |

**Honest counterweight, and its resolution.** The design gate not running on any
cloud publish was a quality-gate **gap**, and this section used to say the real
fix was *connecting* Claude_Preview (or a server-side render-to-image endpoint)
in the runner, as a separate owner/eng ask. That ask is no longer needed: run
905 (2026-09-16) made `scripts/design-snapshots.ts` work inside the sandbox, so
the gate scores real pixels from a cloud routine with no MCP and no owner
action. What the row above now removes is the wasted re-probe **and** the
standing excuse. A skipped design gate is a named failure again, not the
documented default.

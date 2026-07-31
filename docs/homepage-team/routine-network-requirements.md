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
| **Claude_Preview design gate** (composed-page screenshot) | MCP not wired into the cloud runner, and headless Chromium cannot reach the live site through the sandbox proxy | The **degraded per-image heuristic doctrine check is the STANDING path**, not a per-run surprise. Note it once and move on. |
| **Shopify Admin creds** | absent in the runner | Skip probes and dep-installs whose only purpose is reaching Admin; use the **Storefront API** metafields (`namespace:"xdipx"`) with `SHOPIFY_STOREFRONT_ACCESS_TOKEN` for margin/handle reads. |

**Honest counterweight (not a cost cut):** the design gate genuinely not running
on any cloud publish is a quality-gate **gap**. The real fix is *connecting*
Claude_Preview (or a server-side render-to-image endpoint) in the runner — a
separate owner/eng ask, not permanently skipping it. This section only removes
the wasted re-probe and documents today's reality.

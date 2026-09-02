# Credential inventory and rotation

**Status:** first version, 2026-09-02. Written as Stage G2b of the response to the
2026-09-01 automation audit, where token scoping was the only remaining RED item
that guards work already shipped.

Nobody had written down what one leaked token reaches. That is the gap this
closes, and it is a prerequisite for the code change rather than a substitute
for it.

---

## 1. The problem, stated exactly

`assertTeamAuth` (`app/lib/team.server.ts:82`) is the whole authorisation model:

```ts
const expected =
  process.env['TEAM_TOKEN'] ??
  process.env['HOMEPAGE_TEAM_TOKEN'] ??
  process.env['CRON_SECRET'] ??
  ''
```

Three consequences, each measured rather than assumed:

1. **`TEAM_TOKEN` is unset**, so every routine in the fleet presents the same
   `HOMEPAGE_TEAM_TOKEN`. There is one bearer for the whole estate.
2. It **falls through to `CRON_SECRET`**, so the token that authorises every
   `/cron/*` route and the token that authorises every team write are, in the
   worst case, the same string.
3. **Nothing binds `actor` to the presented credential.** Every write takes the
   actor from the request body. Any holder of the bearer can post as
   `agent:qa-reviewer` and mark a ticket `verified`, which is the one gate the
   release engine requires before it merges.

### What one leaked token reaches

| Surface | Count | What a holder can do |
|---|---|---|
| `/api/team/*` and `/api/homepage-team/*` | **30 routes** | File, transition, approve and retire tickets; write runs and events; publish-gate verdicts; file owner blockers; act on import candidates; enqueue video jobs; write social posts |
| `/cron/*` | **39 handlers** | Trigger any scheduled job on demand, including the pricing pass, the release engine, and the social publish tick |
| The `verified` transition | — | The release engine's only human-equivalent gate. Forging it merges arbitrary code |

That last row is the one that matters. The merge policy's remaining gates are CI,
the protected-path classifier, the QA verdict, the daily merge cap, and
post-deploy smoke. One of those five is a string in an environment variable.

### And a compromise would be largely invisible afterwards

`settings_audit_log` holds **47 rows against 2,182 settings keys**. Valve writes
have recorded an actor and a source since migration 072, but the years of writes
before that, and every non-valve write, are unattributed. There is no per-request
log that would let anyone reconstruct what a leaked token did.

---

## 2. Why the obvious fix must not ship first

The audit's proposal was to bind `actor` to the presented token's identity. Taken
literally today, **that stops all merging.**

There is no identity to bind to. Every routine presents the same bearer, so
binding collapses every actor to one value. The `in_review → verified` edge is
fenced to `agent:qa-reviewer`; it would start rejecting. The release engine
refuses to merge a PR without a `verified` ticket. The fleet would keep opening
PRs and nothing would ever land, which is a harder failure to diagnose than the
hole it closes.

**So the order is fixed: issue per-team tokens, then bind, and bind in
warn-then-enforce across one release.** Not the other way round.

---

## 3. The staged plan

### Stage 1 — issue the tokens (owner, ~10 minutes)

One secret per acting identity. Six, not thirty: the unit is the *actor* the bus
fences on, not the route.

| Env var | Presented by |
|---|---|
| `TEAM_TOKEN_QA` | R-QA. **The one that matters most** — it is the only holder of the `verified` transition |
| `TEAM_TOKEN_DEV` | R-DEV, R-SHEP, R-WATCH |
| `TEAM_TOKEN_CONTENT` | content writer, SEO curation, trend scout, podcast review |
| `TEAM_TOKEN_SOCIAL` | social drafts, business research, social trend scout, video lanes |
| `TEAM_TOKEN_PRODUCT` | product manager, enricher, import monitor |
| `TEAM_TOKEN_STRATEGY` | weekly strategy, cost review, apply pass, off-site, ads, email |

Generate with `openssl rand -hex 32` each. Set all six in Vercel, all
environments, and redeploy.

`CRON_SECRET` stays what it is and stops being an accepted team token.

### Stage 2 — accept them (agent-authored, protected-path owner merge)

`assertTeamAuth` returns the identity it matched instead of `void`, accepting any
of the six plus the legacy `HOMEPAGE_TEAM_TOKEN`. **The fallthrough to
`CRON_SECRET` is removed here** — that one is not a scoping change, it is a
straight defect, and it can go as soon as the six exist.

Nothing is enforced yet. Every route keeps working exactly as it does today.

### Stage 3 — warn (one release, agent-authored)

Every team write logs when the `actor` in the body does not match the identity of
the presented token. Nothing is rejected. Run it for a full week and read the
log: this is the step that finds the routine nobody remembered presents someone
else's credential, and finding those by rejection instead would be an outage.

### Stage 4 — enforce (protected-path owner merge)

A mismatch becomes a 403. `agent:qa-reviewer` becomes reachable only with
`TEAM_TOKEN_QA`, and the release engine's merge gate stops being forgeable by
anything that holds the shared bearer.

**Do not skip stage 3.** The routines are cloud triggers an agent cannot edit —
`update_trigger` refuses any routine it did not create, and all 27 existing xdipx
routines were created over the HTTP API — so every prompt change in stage 1 is
the owner's, by hand, and the probability that all six land correctly the first
time is not one.

---

## 4. Rotation checklist

There is no rotation policy today, so this is the first one. Run it per
credential, not as a big-bang.

1. **Issue the new value** in the provider's console. Do not revoke the old one
   yet.
2. **Set it in Vercel** (all environments) and redeploy. `env_present` reads this
   process's environment, so a value set but not deployed has correctly not
   landed.
3. **Confirm the app sees it.** `POST /cron/janitor-sweep` and read the
   `credentials` array from Stage G2: the integration should read `live`. That
   is the app answering, not the dashboard.
4. **Revoke the old value** in the provider's console.
5. **Re-run the sweep.** Still `live` means the new value is the one in use. If
   it flips to `dead`, the old value was still being used and step 2 did not
   take — put the old value back and start again.

Cadence: every 90 days for anything that can spend money or publish
(`SHOPIFY_ADMIN_ACCESS_TOKEN`, `IG_GRAPH_ACCESS_TOKEN`, the X set,
`KLAVIYO_API_KEY`, `RUNPOD_API_KEY`, `GITHUB_TOKEN`), and immediately on any
suspicion, on any contractor offboarding, and on any credential that has ever
been pasted into a chat, a ticket, or a log.

**This session's own access is in scope.** A Claude Code session working on this
repository holds the production database credential, the trigger API, and the
merge token, and can run DML by hand. That is appropriate for the work and it is
also a credential set with an expiry of "whenever someone remembers". It belongs
on the 90-day list like everything else.

---

## 5. What this document does not do

- **It does not scope anything yet.** Stage 1 is the owner's and everything after
  it waits on that. An owner blocker tracks it.
- **It adds no per-request audit log.** Reconstructing what a leaked token did is
  still not possible. That is worth doing and is not what unblocks the fleet
  today.
- **It does not touch `CRON_SECRET`'s own rotation.** The `/cron/*` surface has
  39 handlers behind one shared secret and the same argument applies to it, one
  layer down.

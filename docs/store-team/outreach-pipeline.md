# Outreach Pipeline (guest-post + brand-partnership email)

The send arm and reply ear for the offsite-scout's pitches. Today the chain stops at
approved pitch rows the owner sends by hand from hello@xdipx.com; this pipeline lets the
team send those pitches itself, valve-gated and capped, and loops the owner in at his
alert addresses (mike@xdipx.com and the OWNER_ALERT_EMAILS list) the moment a prospect
replies positively. Shipped 2026-08-05 with migration 077, entirely OFF by default.

## Architecture

```
docs/store-team/outreach-prospects.md      (owner-vetted target list)
        |  scripts/seed-outreach-prospects.ts (idempotent upsert, status 'new')
        v
outreach_prospects  <----  POST /api/team/outreach   (team-token auth)
        ^                  ops: upsert-prospect | list | queue | send
        |
        +----------------  /admin/outreach            (admin session)
                             the owner's read -> edit -> send surface
        |                    ops: upsert-prospect | list | queue | send
        |  'queue' marks a prospect sendable
        v
app/lib/outreach.server.ts  sendOutreachEmail()      (Zoho SMTP, plain text)
        |  guards, in order: valve on -> daily cap -> status 'queued' +
        |  contact_email present -> no outbound to this prospect in 7 days
        v
outreach_messages (direction 'out', records the SMTP Message-ID)
        ^
        |  /cron/outreach-inbox, every 30 min (vercel.json)
app/lib/outreach-inbox.server.ts  pollOutreachInbox()  (IMAP, read-only)
        |  matches In-Reply-To/References against stored Message-IDs;
        |  classifies matched replies (claude-sonnet-4-6, one word):
        |  positive | negative | neutral | auto_reply
        v
prospect status update + on 'positive' -> sendOwnerEmail() to the owner
```

Prospect lifecycle: `new -> researching -> queued -> sent -> replied_positive |
replied_negative | bounced`, plus hand-set `on_hold`, `landed`, `rejected`. Only a
`queued` prospect can be sent to; only `new`, `researching`, `on_hold` (and `queued`
itself) can be queued via the API, so a replied or rejected row is never re-entered
by an agent.

## The approval UI (/admin/outreach)

Added 2026-08-16. Before it, every part of this pipeline was reachable only by curl
against `/api/team/outreach` with a team token, so drafted pitches sat in suggestion
rows nobody could act on. The page is the owner's whole surface:

- **Sending card** — the `outreach_send_enabled` valve and `outreach_daily_send_cap`,
  with today's count. Both writes go through `setPipelineSettingAudited`, so a flip
  from this page is attributable in `settings_audit_log` like any other valve change.
- **Prospect table** — every row with status, contact, when the last pitch went out
  (the 7-day quiet period at a glance), and how many replies are on file.
- **Prospect detail** — the linked pitch draft, the full thread in both directions with
  the poller's classification, Queue, the hand-set statuses (`on_hold`, `landed`,
  `rejected`), and a contact-email field for rows the scout left incomplete.
- **Composer** — subject and plain-text body, seeded from the pitch draft, showing the
  identification footer that will be appended. Send calls the same
  `sendOutreachEmail()` the API calls, so the valve, cap, queued status, contact
  address, and dedupe window all still apply. When one of them would block, the page
  says which and disables the button instead of failing after the click.
- **Drafted pitches, not yet in the pipeline** — open `OFFSITE PITCH` suggestion rows
  with no prospect to send from. On 2026-08-16 that was nine of them: the prospects
  table had been seeded from the vetted doc while the scout filed its drafts as
  suggestions, and the two sets did not share a single domain. Adopt files the prospect
  (status `new`, linked back to the suggestion) with the domain, outlet name, and
  contact guessed from the draft and editable before saving.

What the page deliberately cannot do: set `sent`, `replied_positive`, or
`replied_negative` by hand (those are consequences of the wire, not opinions), send to
a prospect that is not queued, or bypass any guard. Seeding never invents copy — a
draft with no subject line yields an empty subject field rather than a generated one.

## Support-inbox safety (read this before touching the poller)

hello@xdipx.com is also the live support inbox. The poller is read-only towards the
mailbox by construction:

- the mailbox is opened with a read-only lock and every fetch uses BODY.PEEK, so no
  message is ever marked seen,
- it acts only on messages whose In-Reply-To/References match a stored outreach
  Message-ID; all other mail is ignored untouched,
- it never deletes, never moves, never flags anything.

Any change to `outreach-inbox.server.ts` must preserve all three properties.

## Env vars

| Var | Default | Notes |
|---|---|---|
| `OUTREACH_IMAP_HOST` | `imap.zoho.com` | |
| `OUTREACH_IMAP_PORT` | `993` | TLS |
| `OUTREACH_IMAP_USER` | falls back to `ZOHO_SMTP_USER` | |
| `OUTREACH_IMAP_PASS` | falls back to `ZOHO_SMTP_PASS` | Zoho needs IMAP access enabled for the mailbox (Zoho Mail settings, Mail Accounts, IMAP) and, with 2FA, an app-specific password |
| `OUTREACH_FROM` | `EMAIL_FROM`, then `hello@xdipx.com` | From address on outbound pitches |
| `OUTREACH_REPLY_TO` | same as From | |
| `OUTREACH_POSTAL_ADDRESS` | unset | Postal line in the identification footer; set it before enabling sends |

SMTP itself reuses the owner-alerts vars: `ZOHO_SMTP_HOST`/`PORT`/`USER`/`PASS`.

## Valve and cap

| Key (pipeline_settings) | Seeded | Meaning |
|---|---|---|
| `outreach_send_enabled` | `false` | Master valve. Missing row = OFF. Gates every send and arms the inbox cron (the cron no-ops while the valve is off and no outreach_messages rows exist) |
| `outreach_daily_send_cap` | `5` | Max outbound outreach emails per UTC day, all prospects combined |

## Policy constraints (binding)

- `docs/ads-policy.md` creative rules apply to every pitch; support-adjacent register.
- Earned coverage only. Never pay for links or placement; the prospects doc's REJECTED
  section lists paid schemes already ruled out.
- Emma is an AI guide. Never imply human product testing in a pitch or a follow-up.
- No em dashes. Billing descriptor is XDIPX. No prices or discount claims (MAP).
- One polite follow-up per prospect at most, and never inside the 7-day dedupe window
  the send guard enforces. A prospect who replied negatively is closed; do not re-pitch.
- The identification footer (xdipx.com + postal address) ships on every outbound email.

## Loop-in flow

A reply classified `positive` moves the prospect to `replied_positive` and emails the
owner (subject names the prospect domain) with the sender, subject, and body excerpt.
The owner takes over the thread from hello@xdipx.com by hand; agents never reply to a
prospect. `negative` closes the row as `replied_negative`. `neutral` and `auto_reply`
are stored without a status change.

## Owner enablement checklist

1. Apply migration 077: `DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 077`.
2. In Zoho Mail: enable IMAP for hello@xdipx.com and mint an app password if 2FA is on.
3. Set `OUTREACH_IMAP_USER`/`OUTREACH_IMAP_PASS` (or confirm the SMTP creds work for
   IMAP) and `OUTREACH_POSTAL_ADDRESS` in Vercel env, then redeploy.
4. Seed the vetted targets: `DATABASE_URL=<prod> npx tsx scripts/seed-outreach-prospects.ts`.
5. Watch one cron cycle of `/cron/outreach-inbox` (it should report `skipped:
   'outreach not armed'`).
6. Flip `outreach_send_enabled` to `true` from the Sending card on `/admin/outreach`
   (audited write). Keep the cap at 5 or lower.
7. On `/admin/outreach`: adopt one drafted pitch, queue it, read the seeded copy, and
   send it. Then verify the outreach_messages row, the Message-ID, and the received
   email before letting the routine drive it.

## Kill switch

Set `outreach_send_enabled` back to `false`. Sends stop immediately (the valve is read
uncached on every send). The inbox poll keeps running once messages exist, so replies
to already-sent pitches still reach the owner.

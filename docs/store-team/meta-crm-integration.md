# Meta CRM integration (Instant Form leads)

Owner decision 2026-10-23: build Meta's Conversions API for CRM on Instant Form leads, so the lead campaign can optimize for leads who buy instead of for form fills.

## How it works

A lead submitted on a Meta Instant Form has a lead id that Meta generated. Each time the lead reaches a new stage of our funnel, we send an event to dataset 1619122322498289 carrying that lead id. Meta asks for an event at every stage, the raw lead included.

| Stage (`event_name`) | Sent when | `event_time` |
|---|---|---|
| `Lead` | the lead is ingested | when Meta says the lead was created |
| `Converted` | Klaviyo shows a Placed Order on the lead's profile | when the order was placed |

Every stage event has `action_source: system_generated` and `custom_data: { event_source: "crm", lead_event_source: "xdipx" }`, plus hashed `em`, `ph` and `fn` when the form collected them.

Code:

- `app/routes/api.webhooks.meta-leadgen.tsx` receives the Page `leadgen` webhook and verifies `X-Hub-Signature-256`.
- `app/lib/meta-crm.server.ts` fetches the lead, subscribes the email to the paid-leads Klaviyo list (`lead_source: meta-instant-form`, plus `interest` and `meta_lead_id`), stores the match hashes in `meta_leads`, and sends the stage events through the `meta_lead_stage_events` ledger.
- `/cron/meta-crm-sync` runs hourly at :40. It reads each configured form for leads the webhook missed in the last 48 hours, checks Klaviyo for first orders on leads up to 30 days old, and resends unsent stages. Meta refuses events older than 7 days, so a stage still unsent after a week is marked and left alone.

The address itself is never stored in our database. `meta_leads` holds the SHA-256 match hashes and the Klaviyo profile id. Klaviyo is how a conversion is matched, because on our Shopify plan the order carries no email.

The code does nothing until the credentials below are set. Without a token the cron answers `skipped`, and without the secret the webhook refuses every post.

## Owner setup

1. **Instant Form.** Build it on the Page in Ads Manager. Ask for email (required), first name, and optionally phone. For the interest question, use a multiple-choice custom question whose name contains "interest" and whose option keys are the seven slugs: `curious`, `hands-free`, `wands`, `for-two`, `back-door`, `for-him`, `play`. The thank-you screen and the privacy disclaimer must say the lead is signing up for email from xdipx and must state the CURIOUS15 terms: 15% off, $30 minimum, Lovense and Playground excluded.
2. **Token.** Create a system-user token (or a long-lived Page token) with `leads_retrieval`, `pages_manage_metadata`, `pages_show_list` and `pages_read_engagement` on the Page, then set it as `META_LEADS_ACCESS_TOKEN` in Vercel production. If `META_ADS_ACCESS_TOKEN` already carries those permissions, the code falls back to it.
3. **Webhook.** In the Meta app's Webhooks settings, subscribe the Page object to the `leadgen` field with callback `https://xdipx.com/api/webhooks/meta-leadgen` and a verify token of your choosing. Set the same string as `META_WEBHOOK_VERIFY_TOKEN`, and set the app's secret as `META_APP_SECRET`. Then install the app on the Page: `POST /{page-id}/subscribed_apps?subscribed_fields=leadgen` with the Page token.
4. **Form ids.** Set `META_LEAD_FORM_IDS` to a comma-separated list of the form ids, so the backfill can read them.
5. **Test.** Submit a lead with Meta's Lead Ads Testing Tool. Within a minute there should be a `meta_leads` row, a profile on the paid-leads list, and a sent `Lead` row in `meta_lead_stage_events` with an `fbtrace_id`.
6. **Events Manager.** Once Lead and Converted events are arriving, open the dataset's CRM setup and map `Converted` as the stage to optimize for. Meta recommends roughly 200 leads a month, with 1 to 40 percent of them converting, before the "Conversion leads" goal can learn.

## Checking it

```sql
select count(*) filter (where subscribed_at is not null) as ingested,
       count(*) filter (where converted_at is not null) as converted,
       count(*) filter (where ingest_error is not null) as errored
from meta_leads;

select stage, count(*) filter (where sent_at is not null) as sent,
       count(*) filter (where sent_at is null) as unsent
from meta_lead_stage_events group by stage;
```

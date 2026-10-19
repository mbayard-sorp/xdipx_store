# Lead SMS: Twilio double opt-in for the paid-lead funnel

Built 2026-10-19. Code: `app/lib/lead-sms.server.ts`, the enrollment call in `app/routes/api.lead.tsx`,
the inbound hook in `app/routes/api.twilio.sms.tsx`, table `lead_sms_subscriptions` (migration 126).

## Where the texts come from

Lead SMS runs on Twilio, not Klaviyo. Klaviyo SMS is not used for leads: `KLAVIYO_SMS_LIST_ID` is
unset in production and the owner does not expect Klaviyo to approve SMS for a sex-toy store. Owner
blocker 731 (the Klaviyo SMS list) is superseded by this path.

| Piece | Value |
|---|---|
| Sending number | +16239001188 (`TWILIO_PHONE_NUMBER`) |
| Messaging service | `MG50cde7ba82c18e8491424c6d86674218`, "Low Volume Mixed A2P Messaging Service", set as `TWILIO_MESSAGING_SERVICE_SID` so `sendSms` posts through it |
| A2P brand | `BNf1fde0b30a8522a58c512a2e173caf35`, approved |
| A2P campaign | `QE2c6890da8086d771620e9b13fadeba0b`, Low Volume Mixed, verified, registered for marketing and transactional SMS for xdipx.com, adult wellness products, 18+ |
| Throughput | Low Volume Mixed is small (T-Mobile allows 2,000 segments a day per brand). Leads are tens a day at most |

Without `TWILIO_MESSAGING_SERVICE_SID`, `sendSms` falls back to `From=TWILIO_PHONE_NUMBER`, which is
the same number, but the message then does not ride the campaign's registered sender pool. Set the
service sid in Vercel production.

## Double opt-in is a registration requirement

The campaign's registered message flow is: the person submits a number with the consent box on
curious.xdipx.com/hello, receives a confirmation text, and must reply YES or START before joining the
list. Nothing marketing goes to a number that has not replied. The sequence in code:

1. `/api/lead` with a phone and `smsConsent` (and the `lead_sms_optin_enabled` switch on, or
   `LEAD_SMS_OPTIN_ENABLED=1`) calls `enrollLeadSms()`: one `lead_sms_subscriptions` row at
   `pending` and one confirmation text. A number already in `sms_optouts` gets a row at `opted_out`
   and no text, so the consent is on record without a send.
2. The person replies YES (or START). `handleLeadSmsInbound()` runs first on every inbound text in the
   Twilio webhook: it marks the row `confirmed`, stamps `welcome_sent_at` before sending (the latch
   that keeps a webhook retry from sending twice), and sends the welcome text once. A bare YES that
   confirmed a lead is answered by the welcome alone, so the webhook returns empty TwiML instead of
   running the age gate on it. START continues into the existing compliance path afterward, so the
   `sms_optouts` delete and the START reply happen exactly as before.
3. STOP flips the row to `opted_out` and then continues into the compliance path, so the
   `sms_optouts` insert and the STOP reply are unchanged. YES after STOP does nothing; only START
   resumes, without a second welcome.

There are no sends beyond these two. Follow-ups to confirmed numbers are not built.

## The two texts

Support register (2 to 3). Both are built in `lead-sms.server.ts` and pinned by
`lead-sms.server.test.ts`, which also checks every variant fits two GSM-7 segments (306 characters).

Confirmation, built from the campaign's registered opt-in message but accurate for this funnel:

> xdipx: Reply YES to confirm texts from Emma. You asked about wands on curious.xdipx.com. Msg freq
> varies. Reply HELP for help, STOP to cancel. Msg&data rates may apply.

The interest phrase comes from `INTEREST_SMS_PHRASE` (one per slug in `app/lib/lead-interests.ts`);
no interest reads "You signed up on curious.xdipx.com."

Welcome, once:

> xdipx: Hi Ann, your code CURIOUS15 takes 15% off $30+ orders, one use per customer, Lovense and
> Playground excluded. https://xdipx.com/discount/CURIOUS15?redirect=... Reply HELP for help, STOP to
> cancel.

The link goes through `/discount/CURIOUS15?redirect=` to the interest's collection with
`utm_source=sms`, `utm_medium=sms`, `utm_campaign=lead-sms` (reusing `buildShopUrl`), so the code is
on the cart. The link is most of the budget, which is why the terms read "$30+ orders" rather than
"orders of $30 or more". The first name is the first word only, plain letters, 12 characters at most;
anything else greets with "there".

Copy rules for any change: every text starts with `xdipx:`, carries "Reply HELP for help, STOP to
cancel" (the campaign's samples all do; the confirmation also carries "Msg&data rates may apply"),
no em-dashes, no countdowns, no urgency, Emma never claims to have used anything, and nothing goes
out before the YES. Run changed strings through `emma-empathy-reviewer`.

## Owner steps

1. Set `TWILIO_MESSAGING_SERVICE_SID=MG50cde7ba82c18e8491424c6d86674218` in Vercel production.
2. Clear blocker 731 as superseded by this path.
3. Turn the `lead_sms_optin_enabled` switch on (or set `LEAD_SMS_OPTIN_ENABLED=1`) when the
   /hello page should ask for a phone number again.

## Not built, on purpose

- No follow-up texts after the welcome.
- The SMS age gate (`sms_age_consent`) is untouched: a confirmed lead who later texts Emma a question
  still gets the 18+ prompt once. Folding the lead YES into that record is a separate decision.
- No retry of a failed confirmation send; the row stays `pending` with no `confirm_message_sid`.

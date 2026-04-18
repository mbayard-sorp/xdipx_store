// src/server.ts
import http from "node:http";
import crypto from "node:crypto";
import { WebSocketServer } from "ws";

// src/claude.ts
import Anthropic from "@anthropic-ai/sdk";

// src/prompts.ts
var IDENTITY_HEADER = `You are the voice of xdipx.com \u2014 a daily flash-sale site for sexual wellness products.`;
var CHANNEL_RULES = `PHONE CALL MODE:
- You're on a live phone call. Replies are spoken aloud by a TTS voice.
- Keep replies under 2 sentences unless the caller explicitly asks for more.
- Never read URLs, emails, or long strings of digits. Offer to text them instead.
- Pronounce the brand as "ex-dip" (two syllables). Never spell it out.
- If you don't know something, say so plainly and offer to take a voicemail.
- No markdown, no bullet lists, no headings \u2014 this is speech.
- Never use asterisks, underscores, backticks, or any symbol for emphasis. They are read aloud literally ("asterisk asterisk") and ruin the call.
- Do NOT write the word "dot" or "period" in your replies. Ever. Use real punctuation ("." at end of a sentence). The single exception: when spelling an email address back on request ("hello at x dip ex dot com"). Any other "dot" is a bug \u2014 the caller hears the literal word.
- PRICES: always spell numbers as words. Say "twenty-four ninety-nine" or "twenty-four dollars" \u2014 NEVER write "$24.99", "24.99", "43.00", or any decimal-number form. The TTS reads digits and decimals literally ("two four dot nine nine"), which sounds broken. This applies to every price you quote.
- Short sentences. Contractions. Natural rhythm.

ORDER LOOKUPS:
- When a caller asks about an order, collect two things: the order number and the last 4 digits of their billing ZIP. They may say digits as words ("one two three four") \u2014 treat as digits.
- Call the lookupOrder tool with both. Read back status plainly ("it shipped Tuesday with UPS, tracking ends in 7 2 0 3").
- If verification_failed happens twice in a row, stop retrying and offer to take a voicemail so the team can help.
- If rate_limited, apologise briefly and offer a voicemail.

TAKING AN ORDER (closing a sale on the phone):
- If the caller wants to buy something, your job is to assemble a Shopify draft order and EMAIL them a secure checkout link. SMS is not available right now \u2014 the checkout link is delivered by email only. You NEVER take card numbers.
- Flow:
  1. Use searchProducts to find what they want. Every result includes a variantId (Shopify GID). If the product has variantOptions, call getProductDetails or ask the caller which option they want before proceeding \u2014 that's where you get the right variantId.
  2. Call lookupReturningCustomer \u2014 uses caller ID automatically. If found, offer to ship to the address on file instead of re-collecting, and confirm the email on file is still the best one for the checkout link.
  3. If new caller, collect: email (READ IT BACK carefully \u2014 this is where the link goes), full name, street address, city, state (2-letter), ZIP.
  4. Read back a GENERIC summary before charging forward \u2014 e.g. "one item from our vibrators collection, shipping to Mike in Los Angeles, total around forty dollars, checkout link going to m-mike at gmail \u2014 sound right?" Never read full product names aloud; the caller may be on speakerphone.
  5. As soon as they say yes, CALL createDraftOrder with the items array (variantId + quantity), email, name, and address. Do not narrate "let me send that over" \u2014 just call the tool.
  6. When the tool returns ok with emailSent=true, tell them plainly: "Done \u2014 the secure checkout link just went to your email. Anything else?"
  7. If ok but emailSent=false, say: "Order is saved but the email didn't send. Let me send this to my team \u2014 they'll take amazing care of you." then recordVoicemail.
- Never tell the caller you're "texting" the link or that they'll "get a text" \u2014 it's email only.
- Caps: $500 subtotal, 5 items. If the tool returns a limit error, apologise and offer to send it to the team via recordVoicemail.
- CRITICAL: saying "I'll email you a link" without actually invoking createDraftOrder is a bug. If you've said yes you're sending, the very next action MUST be the tool call \u2014 not another question, not a confirmation.
- If createDraftOrder returns ok:false, READ the message field \u2014 it tells you exactly what to fix (invalid_state, invalid_zip, invalid_email, missing_fields, shopify_rejected). Ask the caller to clarify just that field and retry the tool. DO NOT fall back to voicemail on the first validation error \u2014 only after the same error twice in a row.
- State MUST be the 2-letter code (CA, NY, TX). If the caller says "California", convert to "CA" yourself before passing to the tool.

PRODUCT DISCOVERY:
- When the caller describes a mood, scenario, or experience level ("something for date night", "beginner-friendly", "waterproof and quiet"), use discoverProducts with structured filters rather than searchProducts.
- When the caller names a specific product or category keyword ("vibrators", "lube", "rabbit"), use searchProducts.
- NEVER reference "Vault", "For Him", "For Her", or "Couples" as sections of the site \u2014 those are deprecated. Instead, refer to "collections". Our current collections are: {collections}. Reference the most relevant collection based on what the caller is looking for.
- After describing a product the caller is interested in, ask ONE question and STOP: "Want me to add that to your bag?" Then be quiet \u2014 give the caller time to answer. Do NOT tack on a second question ("What else can I help you find?") in the same breath. You can ask about next steps AFTER they answer.
- After the caller commits to a product, use recommendSimilar once to suggest one add-on. Keep it to one sentence: "People who got that also grabbed a [generic description] for [price as words] \u2014 want me to add it?"
- Never push an upsell if the caller has declined once or seems in a hurry.

VOICEMAILS:
- If you can't answer something, if the caller wants a human, or if tools repeatedly fail, offer to take a message.
- Before saving: confirm a callback number (default their caller ID \u2014 just ask "is this a good number to reach you at?") and hold a one-to-two-sentence summary in your head.
- Then call recordVoicemail with { summary, callbackNumber, contextOrderNumber? }. The summary is written text for staff, not spoken.
- After the tool returns ok, tell the caller: "Got it \u2014 I'll send this to my team and they'll take amazing care of you. Anything else?" If not ok, apologise and offer to try once more.
- NEVER say "someone will call you back" or "we'll get back to you" \u2014 always frame it as "I'll send this to my team and they'll take amazing care of you."

ENDING THE CALL:
- When the caller says goodbye, thanks you, or says they don't need anything else, wrap up with: {goodbye}
- Keep it warm and brief. One goodbye \u2014 don't repeat yourself or drag it out.`;
function buildSystemPrompt(brandVoice, collections, goodbye) {
  let prompt = `${IDENTITY_HEADER}
${brandVoice.trim()}

${CHANNEL_RULES}`;
  if (collections?.length) {
    prompt = prompt.replace(
      "{collections}",
      collections.join(", ")
    );
  }
  const outroText = goodbye?.trim() || "Thanks for calling ex-dip \u2014 have a great one!";
  prompt = prompt.replace("{goodbye}", outroText);
  return prompt;
}

// src/settings.ts
import { neon } from "@neondatabase/serverless";
var url = process.env["DATABASE_URL"];
var sql = neon(url ?? "");
var DEFAULT_BRAND_VOICE = `Brand voice: playful, cheeky, warm, curious. Never clinical. Never sleazy. Write as a trusted, funny friend who isn't embarrassed about the topic. Your goal is to welcome first-time buyers and delight experienced ones. Keep all copy tasteful \u2014 suggestive is fine, explicit is not. Always signal discretion, value, and trust. Never use "sex" as an adjective \u2014 use "intimate", "pleasure", or "wellness". Never assume the reader's experience level.`;
var DEFAULT_GREETING = "Hey, you've reached ex-dip. I'm {feeling} you called. This call may be recorded. What's going on?";
var DEFAULT_FEELINGS = "so happy,thrilled,super excited,really glad,pumped,stoked,delighted";
var DEFAULT_ACTIVITIES = "browsing the vault,curating today's deal,testing out some new arrivals,organizing the stockroom";
var DEFAULT_FAREWELL_GOODBYE = "Thanks for calling ex-dip \u2014 have a great one!";
var DEFAULT_FAREWELL_MAX_PROMPTS = "I really like you \u2014 but it might be easier if you send an email to hello at exdipex dot com and we can help you directly. Once again that's hello at exdipex dot com.";
var DEFAULT_FAREWELL_MAX_DURATION = DEFAULT_FAREWELL_MAX_PROMPTS;
var DEFAULT_FAREWELL_SILENT = "";
var KEYS = [
  "brandVoice",
  "ivrGreeting",
  "ivrFeelings",
  "ivrActivities",
  "ivrFarewellGoodbye",
  "ivrFarewellMaxPrompts",
  "ivrFarewellMaxDuration",
  "ivrFarewellSilent"
];
function pickRandom(csv, fallback) {
  const items = csv.split(",").map((s) => s.trim()).filter(Boolean);
  if (!items.length) return fallback;
  return items[Math.floor(Math.random() * items.length)];
}
function resolveGreeting(template, feelings, activities) {
  const feeling = pickRandom(feelings, "happy");
  const activity = pickRandom(activities, "working");
  return template.replace("{feeling}", feeling).replace("{activity}", activity);
}
async function loadIvrSettings() {
  const fallback = {
    brandVoice: DEFAULT_BRAND_VOICE,
    greeting: resolveGreeting(DEFAULT_GREETING, DEFAULT_FEELINGS, DEFAULT_ACTIVITIES),
    farewellGoodbye: DEFAULT_FAREWELL_GOODBYE,
    farewellMaxPrompts: DEFAULT_FAREWELL_MAX_PROMPTS,
    farewellMaxDuration: DEFAULT_FAREWELL_MAX_DURATION,
    farewellSilent: DEFAULT_FAREWELL_SILENT
  };
  if (!url) return fallback;
  try {
    const rows = await sql(
      `SELECT key, value FROM pipeline_settings WHERE key = ANY($1)`,
      [KEYS]
    );
    const map = /* @__PURE__ */ new Map();
    for (const row of rows) map.set(row.key, row.value);
    return {
      brandVoice: map.get("brandVoice") || fallback.brandVoice,
      greeting: resolveGreeting(
        map.get("ivrGreeting") || DEFAULT_GREETING,
        map.get("ivrFeelings") || DEFAULT_FEELINGS,
        map.get("ivrActivities") || DEFAULT_ACTIVITIES
      ),
      farewellGoodbye: map.get("ivrFarewellGoodbye") || fallback.farewellGoodbye,
      farewellMaxPrompts: map.get("ivrFarewellMaxPrompts") || fallback.farewellMaxPrompts,
      farewellMaxDuration: map.get("ivrFarewellMaxDuration") || fallback.farewellMaxDuration,
      // Silent caller is allowed to be empty — only admins unset it on purpose.
      farewellSilent: map.get("ivrFarewellSilent") ?? fallback.farewellSilent
    };
  } catch (err) {
    console.warn("[ivr] loadIvrSettings failed, using fallbacks", err);
    return fallback;
  }
}

// src/tools/deal.ts
var APP_URL = process.env["XDIPX_APP_URL"] ?? "https://xdipx.com";
var SECRET = process.env["INTERNAL_API_SECRET"] ?? "";
var cache = null;
function nextMidnightPT() {
  const now = /* @__PURE__ */ new Date();
  const pt = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const midnight = new Date(pt);
  midnight.setHours(24, 0, 0, 0);
  return now.getTime() + (midnight.getTime() - pt.getTime());
}
async function readTodaysDeal() {
  if (cache && cache.expiresAt > Date.now()) return cache.deal;
  const res = await fetch(`${APP_URL}/api/internal/daily-deal`, {
    headers: { "x-internal-secret": SECRET }
  });
  if (!res.ok) {
    throw new Error(`daily-deal fetch failed: ${res.status}`);
  }
  const body = await res.json();
  cache = { deal: body.deal, expiresAt: nextMidnightPT() };
  return body.deal;
}

// src/tools/orders.ts
var DOMAIN = process.env["SHOPIFY_STORE_DOMAIN"] ?? "";
var TOKEN = process.env["SHOPIFY_ADMIN_ACCESS_TOKEN"] ?? "";
var ENDPOINT = `https://${DOMAIN}/admin/api/2024-10/graphql.json`;
async function adminQuery(query, variables) {
  if (!DOMAIN || !TOKEN) throw new Error("Shopify Admin credentials missing");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN
    },
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error(`Shopify Admin ${res.status}`);
  const body = await res.json();
  if (!body.data) throw new Error(`Shopify Admin error: ${JSON.stringify(body.errors)}`);
  return body.data;
}
function normaliseOrderNumber(raw) {
  return raw.replace(/\D+/g, "");
}
async function lookupOrder(input) {
  const number = normaliseOrderNumber(input.orderNumber);
  const zip = input.zipLast4.replace(/\D+/g, "").slice(-4);
  if (!number) return { ok: false, error: "not_found", message: "Empty order number." };
  if (zip.length !== 4) return { ok: false, error: "verification_failed", message: "Need 4 digits of zip." };
  try {
    const data = await adminQuery(
      `query LookupOrder($q: String!) {
        orders(first: 1, query: $q) {
          edges { node {
            id
            name
            displayFulfillmentStatus
            displayFinancialStatus
            billingAddress { zip }
            fulfillments(first: 5) {
              trackingInfo { number company }
              estimatedDeliveryAt
            }
          } }
        }
      }`,
      { q: `name:#${number}` }
    );
    const order = data.orders.edges[0]?.node;
    if (!order) return { ok: false, error: "not_found" };
    const billingZip = (order.billingAddress?.zip ?? "").replace(/\D+/g, "").slice(-4);
    if (!billingZip || billingZip !== zip) {
      return { ok: false, error: "verification_failed" };
    }
    const fulfill = order.fulfillments[0];
    const track = fulfill?.trackingInfo[0];
    return {
      ok: true,
      status: order.displayFulfillmentStatus,
      financialStatus: order.displayFinancialStatus,
      tracking: track?.number ?? null,
      carrier: track?.company ?? null,
      eta: fulfill?.estimatedDeliveryAt ?? null
    };
  } catch (err) {
    return {
      ok: false,
      error: "lookup_failed",
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

// src/tools/sms.ts
var ACCOUNT_SID = process.env["TWILIO_ACCOUNT_SID"] ?? "";
var AUTH_TOKEN = process.env["TWILIO_AUTH_TOKEN"] ?? "";
var FROM_NUMBER = process.env["TWILIO_PHONE_NUMBER"] ?? "";
async function sendSms(to, body) {
  if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM_NUMBER) {
    throw new Error("Twilio credentials missing");
  }
  const url3 = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64");
  const form = new URLSearchParams({ To: to, From: FROM_NUMBER, Body: body });
  const res = await fetch(url3, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio SMS failed ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.sid;
}
async function sendDealLinkSMS(toNumber, deal) {
  await sendSms(toNumber, `Today at xdipx: ${deal.title} \u2014 ${deal.url}`);
}

// src/db.ts
import { neon as neon2 } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
var url2 = process.env["DATABASE_URL"];
if (!url2) console.warn("[ivr] DATABASE_URL not set \u2014 DB writes will fail");
var sql2 = neon2(url2 ?? "");
var db = drizzle(sql2);
async function recordCall(row) {
  await sql2(
    `INSERT INTO call_log
       (call_sid, from_number, to_number, direction, end_reason, duration_sec, tokens_total)
     VALUES ($1, $2, $3, 'inbound', $4, $5, $6)
     ON CONFLICT (call_sid) DO UPDATE SET
       end_reason   = EXCLUDED.end_reason,
       duration_sec = EXCLUDED.duration_sec,
       tokens_total = EXCLUDED.tokens_total`,
    [row.callSid, row.fromNumber, row.toNumber, row.endReason, row.durationSec, row.tokensTotal]
  );
}
async function insertVoicemail(row) {
  await sql2(
    `INSERT INTO voicemails
       (call_sid, from_number, callback_number, summary, transcript, recording_url, context_order_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (call_sid) DO UPDATE SET
       summary = EXCLUDED.summary,
       transcript = EXCLUDED.transcript,
       callback_number = EXCLUDED.callback_number,
       context_order_number = EXCLUDED.context_order_number`,
    [
      row.callSid,
      row.fromNumber,
      row.callbackNumber,
      row.summary,
      row.transcript,
      row.recordingUrl,
      row.contextOrderNumber
    ]
  );
}

// src/session.ts
var MAX_TURNS = 40;
var Session = class {
  callSid = "";
  fromNumber = "";
  toNumber = "";
  summary = "";
  // running summary of truncated turns
  history = [];
  abort = null;
  /** Per-call rate-limiting counters keyed by tool name. */
  toolCallCount = {};
  /** Total prompt events observed this call (runaway guard). */
  promptCount = 0;
  /** How many re-engage nudges we've sent without a caller response. */
  reEngageCount = 0;
  /** Wall-clock start so we can compute remaining budget. */
  startedAt = Date.now();
  /** Total Claude tokens consumed this call (input + output, across all hops). */
  tokensUsed = 0;
  /** Once true, we inject a "wrap up" hint into the next turn's messages. */
  wrapUpMode = false;
  /** True once createDraftOrder has been invoked this call. Guards the
   *  send-intent trap in claude.ts from firing twice. */
  createdDraftOrderThisCall = false;
  /** Reason we'll log on WS close, if we end the call ourselves. */
  endReason = "user_hangup";
  /** Admin-configured prompts + farewells, resolved once at session start. */
  settings = null;
  /** Resolved system prompt for this call (built from settings.brandVoice). */
  systemPrompt = "";
  /** Active silence/duration timers owned by the session. */
  silenceTimer = null;
  durationTimer = null;
  /** Arm or reset the silence timer. onFire runs when the caller has been quiet. */
  armSilence(ms, onFire) {
    this.clearSilence();
    this.silenceTimer = setTimeout(onFire, ms);
  }
  clearSilence() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }
  /** Hard cap on call length — fires once, set at setup. */
  armDuration(ms, onFire) {
    this.clearDuration();
    this.durationTimer = setTimeout(onFire, ms);
  }
  clearDuration() {
    if (this.durationTimer) {
      clearTimeout(this.durationTimer);
      this.durationTimer = null;
    }
  }
  clearTimers() {
    this.clearSilence();
    this.clearDuration();
  }
  incrementToolCall(name) {
    const n = (this.toolCallCount[name] ?? 0) + 1;
    this.toolCallCount[name] = n;
    return n;
  }
  addTurn(role, content) {
    this.history.push({ role, content });
    this.truncate();
  }
  /** Drop oldest turns when over cap. The Anthropic API rejects a leading
   *  user tool_result that has no matching assistant tool_use, so when
   *  truncation would land on one we keep dropping until the new head is a
   *  plain caller utterance. */
  truncate() {
    if (this.history.length <= MAX_TURNS) return;
    let dropCount = this.history.length - MAX_TURNS;
    while (dropCount < this.history.length) {
      const head = this.history[dropCount];
      if (!head) break;
      const isToolResultHead = head.role === "user" && Array.isArray(head.content);
      if (!isToolResultHead) break;
      dropCount++;
    }
    if (dropCount === 0) return;
    const dropped = this.history.splice(0, dropCount);
    const droppedText = dropped.map(turnToText).join("\n");
    this.summary = this.summary ? `${this.summary}
${droppedText}` : droppedText;
  }
  /** Build the message list to send to Claude for the next turn. */
  buildMessages() {
    const msgs = [];
    if (this.summary) {
      msgs.push({
        role: "user",
        content: `[Earlier in this call, summarised]
${this.summary}`
      });
      msgs.push({ role: "assistant", content: "Understood." });
    }
    for (const t of this.history) {
      msgs.push({ role: t.role, content: t.content });
    }
    if (this.wrapUpMode) {
      msgs.push({
        role: "user",
        content: "[System note: this call is running long on tokens. Wrap up politely in your next reply \u2014 offer voicemail if the caller has more to discuss, then end.]"
      });
    }
    return msgs;
  }
  /** Abort any in-flight Claude stream (caller barge-in). */
  interrupt() {
    if (this.abort) {
      this.abort.abort();
      this.abort = null;
    }
  }
};
function turnToText(t) {
  const role = t.role === "user" ? "Caller" : "Agent";
  if (typeof t.content === "string") return `${role}: ${t.content}`;
  const parts = t.content.map((b) => {
    if (b.type === "text") return b.text;
    if (b.type === "tool_use") return `[called ${b.name}]`;
    if (b.type === "tool_result") return `[tool result]`;
    return "";
  }).filter(Boolean);
  return `${role}: ${parts.join(" ")}`;
}

// src/tools/voicemail.ts
var APP_URL2 = process.env["XDIPX_APP_URL"] ?? "https://xdipx.com";
var SECRET2 = process.env["INTERNAL_API_SECRET"] ?? "";
async function recordVoicemail(session, input) {
  if (!session.callSid) {
    return { ok: false, error: "no_call_sid", message: "Call context missing." };
  }
  if (!input.summary || input.summary.trim().length < 4) {
    return { ok: false, error: "summary_required", message: "Summary is required." };
  }
  const transcript = session.history.map(turnToText).join("\n");
  const callbackNumber = (input.callbackNumber ?? session.fromNumber ?? "").trim() || null;
  try {
    await insertVoicemail({
      callSid: session.callSid,
      fromNumber: session.fromNumber,
      callbackNumber,
      summary: input.summary.trim(),
      transcript,
      recordingUrl: null,
      // populated by Twilio webhook after call ends
      contextOrderNumber: input.contextOrderNumber?.trim() || null
    });
  } catch (err) {
    return {
      ok: false,
      error: "db_write_failed",
      message: err instanceof Error ? err.message : String(err)
    };
  }
  void fetch(`${APP_URL2}/api/internal/notify-voicemail`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": SECRET2
    },
    body: JSON.stringify({
      callSid: session.callSid,
      fromNumber: session.fromNumber,
      callbackNumber,
      summary: input.summary.trim(),
      contextOrderNumber: input.contextOrderNumber ?? null
    })
  }).catch((err) => {
    console.error("[ivr] notify-voicemail failed", err);
  });
  return { ok: true };
}

// src/tools/catalog.ts
var APP_URL3 = process.env["XDIPX_APP_URL"] ?? "https://xdipx.com";
var SECRET3 = process.env["INTERNAL_API_SECRET"] ?? "";
async function callQaTool(tool, input, ctx) {
  const res = await fetch(`${APP_URL3}/api/internal/qa-tool`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": SECRET3
    },
    body: JSON.stringify({ tool, input, phone: ctx?.phone, channel: ctx?.channel ?? "voice" })
  });
  if (!res.ok) {
    return { ok: false, error: `proxy_failed_${res.status}` };
  }
  return await res.json();
}

// src/tools/index.ts
var MAX_ORDER_LOOKUPS_PER_CALL = 15;
var TOOL_DEFINITIONS = [
  {
    name: "readTodaysDeal",
    description: "Look up today's featured flash-sale deal on xdipx (title, tagline, price, % off, stock). Call this when the caller asks what's on sale, what the deal is, what's featured, or any variation of 'what do you have today'. Always call this tool \u2014 never guess prices.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "lookupOrder",
    description: "Look up a customer's order by order number + last 4 digits of their billing ZIP. Collect both from the caller first \u2014 they may say the order number in words (e.g. 'number one two three four'); treat as digits. Returns fulfilment status, tracking number, carrier, and estimated delivery. If verification_failed twice, offer to take a voicemail instead of retrying further.",
    input_schema: {
      type: "object",
      properties: {
        orderNumber: {
          type: "string",
          description: "The order number the caller gave, digits only (e.g. '1234')."
        },
        zipLast4: {
          type: "string",
          description: "Last 4 digits of the billing ZIP code."
        }
      },
      required: ["orderNumber", "zipLast4"],
      additionalProperties: false
    }
  },
  {
    name: "recordVoicemail",
    description: "Save a voicemail from this caller. Call this AFTER you've confirmed: (1) the caller wants to leave a message, (2) you have a brief written summary of what they need, and (3) you have a callback number (default to their caller ID if they confirm). Optionally include an order number if the call was about one. Do not call this tool silently \u2014 tell the caller their message was saved.",
    input_schema: {
      type: "object",
      properties: {
        callbackNumber: {
          type: "string",
          description: "Phone number to call back (with country code if international). Defaults to caller ID if omitted."
        },
        summary: {
          type: "string",
          description: "One or two sentences describing what the caller needs and any context. Written, not spoken."
        },
        contextOrderNumber: {
          type: "string",
          description: "Related order number if the caller mentioned one."
        }
      },
      required: ["summary"],
      additionalProperties: false
    }
  },
  {
    name: "searchProducts",
    description: "Search the xdipx catalog for products matching a keyword or phrase. Returns up to 5 matches with titles, taglines, MAP-cleared prices, stock status, AND the Shopify variantId you'll need later to create a draft order. Always call this before quoting any price. Supports optional category and price filters. If the first search returns nothing useful, try again with a broader or different term (e.g. 'massager' instead of 'back massager'). Remove modifiers and retry before telling the caller we don't carry it.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Short search words. Prefer 1\u20132 words (e.g. 'wand', 'lube', 'couple kit'). Don't paste the caller's full sentence." },
        limit: { type: "number", description: "1\u20135, default 3. Keep low on phone \u2014 you can only say a few aloud." },
        collection: { type: "string", description: 'Collection handle to filter by if the caller mentioned one (e.g. "vibrators", "lubricants", "bondage"). Use the handle from listCollections.' },
        priceMax: { type: "number", description: "Max price in dollars if the caller gave a budget." }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "discoverProducts",
    description: "Find products by mood, use-case, experience level, or features \u2014 use when the caller describes a vibe or scenario rather than naming a specific product (e.g. 'something for date night', 'beginner-friendly', 'waterproof and quiet'). Uses structured tags for better matching than keyword search.",
    input_schema: {
      type: "object",
      properties: {
        mood: { type: "array", items: { type: "string", enum: ["playful", "romantic", "luxurious", "adventurous", "relaxing"] }, description: "Mood/vibe tags matching what the caller described." },
        experience: { type: "string", enum: ["beginner", "intermediate", "advanced"], description: "Experience level if the caller mentioned it." },
        useCase: { type: "array", items: { type: "string", enum: ["solo", "couples", "date-night", "gift", "travel"] }, description: "Use-case tags." },
        features: { type: "array", items: { type: "string", enum: ["waterproof", "quiet", "rechargeable", "app-controlled", "body-safe"] }, description: "Feature tags the caller asked about." },
        collection: { type: "string", description: "Collection handle to narrow results. Use the handle from listCollections." },
        priceMax: { type: "number", description: "Max price in dollars." },
        limit: { type: "number", description: "1\u20135, default 3. Keep low on phone." }
      },
      additionalProperties: false
    }
  },
  {
    name: "recommendSimilar",
    description: "After the caller picks a product, suggest 1\u20132 frequently bought-together items. Use as a natural add-on: 'people who got that also grabbed...' Keep it brief \u2014 one sentence. Never push if the caller has declined or seems in a hurry.",
    input_schema: {
      type: "object",
      properties: {
        handle: { type: "string", description: "Handle of the product the caller is buying." },
        limit: { type: "number", description: "1\u20133, default 2." }
      },
      required: ["handle"],
      additionalProperties: false
    }
  },
  {
    name: "getProductDetails",
    description: "Fetch extra details on a specific product by its handle. Only needed if the caller asks about specific variant options or details not covered by the search result tagline \u2014 searchProducts already returns title, tagline, pricing, and default variant.",
    input_schema: {
      type: "object",
      properties: {
        handle: { type: "string", description: "Product handle/slug returned by searchProducts." }
      },
      required: ["handle"],
      additionalProperties: false
    }
  },
  {
    name: "listCollections",
    description: "List the browsable collections on xdipx. Use when the caller asks what we sell, what categories we have, or when you want to suggest they browse a specific collection.",
    input_schema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "lookupReturningCustomer",
    description: "Check if this caller is an existing xdipx customer so you can skip asking for their shipping address. Uses caller ID automatically \u2014 don't ask them for their phone number.",
    input_schema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "createDraftOrder",
    description: "Create a Shopify draft order and EMAIL the caller a secure Shopify checkout link. SMS is not wired up \u2014 delivery is email only, so the caller's email must be correct. ONLY call after: (1) confirmed each product + variant + quantity via searchProducts/getProductDetails, (2) collected email (read back to confirm) + full name + full shipping address, (3) read back a GENERIC item description (e.g. 'one item from our vibrators collection, one accessory') and got a clear 'yes'. Never read full product names on a speakerphone. Never collect card numbers \u2014 Shopify handles payment. Hard caps: $500 subtotal, 5 line items. On limit error, apologize and offer a human callback via recordVoicemail.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              variantId: { type: "string", description: "Shopify variant GID, e.g. 'gid://shopify/ProductVariant/1234'." },
              quantity: { type: "number", description: "Integer 1\u20135." },
              title: { type: "string", description: "Short human label \u2014 your own reference." }
            },
            required: ["variantId", "quantity"],
            additionalProperties: false
          }
        },
        email: { type: "string", description: "Customer email for the invoice." },
        name: { type: "string", description: "Full name for shipping." },
        address1: { type: "string", description: "Street address line 1." },
        address2: { type: "string", description: "Apt/suite (optional)." },
        city: { type: "string", description: "City." },
        state: { type: "string", description: "Two-letter US state code, e.g. 'CA'." },
        zip: { type: "string", description: "ZIP code." }
      },
      required: ["items", "email", "name", "address1", "city", "state", "zip"],
      additionalProperties: false
    }
  },
  {
    name: "sendDealLinkSMS",
    description: "Text the caller a link to today's deal at their calling-number. Call this when the caller asks you to 'text me the link', 'send it to my phone', or similar. Confirms the number you're texting before sending is not required \u2014 we always use their caller ID.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  }
];
async function runTool(name, _input, ctx) {
  switch (name) {
    case "readTodaysDeal": {
      const deal = await readTodaysDeal();
      if (!deal) return { error: "no_live_deal", message: "No deal is live right now." };
      return deal;
    }
    case "lookupOrder": {
      const n = ctx.session.incrementToolCall("lookupOrder");
      if (n > MAX_ORDER_LOOKUPS_PER_CALL) {
        return {
          ok: false,
          error: "rate_limited",
          message: "Too many lookup attempts on this call. Offer voicemail."
        };
      }
      const parsed = _input;
      if (!parsed?.orderNumber || !parsed?.zipLast4) {
        return { ok: false, error: "verification_failed", message: "Missing orderNumber or zipLast4." };
      }
      return await lookupOrder({
        orderNumber: parsed.orderNumber,
        zipLast4: parsed.zipLast4
      });
    }
    case "recordVoicemail": {
      const parsed = _input;
      if (!parsed?.summary) {
        return { ok: false, error: "summary_required", message: "Summary is required." };
      }
      return await recordVoicemail(ctx.session, {
        callbackNumber: parsed.callbackNumber,
        summary: parsed.summary,
        contextOrderNumber: parsed.contextOrderNumber
      });
    }
    case "searchProducts":
    case "discoverProducts":
    case "recommendSimilar":
    case "getProductDetails":
    case "listCollections":
    case "lookupReturningCustomer":
    case "createDraftOrder": {
      const result = await callQaTool(name, _input ?? {}, {
        channel: "voice",
        ...ctx.session.fromNumber ? { phone: ctx.session.fromNumber } : {}
      });
      if (name === "createDraftOrder") {
        const r = result;
        if (!r.ok) {
          const inp = _input ?? {};
          console.error(
            `[ivr] createDraftOrder failed callSid=${ctx.session.callSid} error=${r.error} msg=${r.message} state=${inp["state"]} zip=${inp["zip"]} city=${inp["city"]} items=${Array.isArray(inp["items"]) ? inp["items"].length : 0}`
          );
        }
      }
      return result;
    }
    case "sendDealLinkSMS": {
      const deal = await readTodaysDeal();
      if (!deal) return { error: "no_live_deal", message: "No deal is live \u2014 can't send a link." };
      if (!ctx.session.fromNumber) {
        return { error: "no_caller_id", message: "Caller ID isn't available." };
      }
      try {
        await sendDealLinkSMS(ctx.session.fromNumber, { title: deal.title, url: deal.url });
        return { ok: true, sentTo: ctx.session.fromNumber };
      } catch (err) {
        return { error: "sms_failed", message: err instanceof Error ? err.message : String(err) };
      }
    }
    default:
      return { error: "unknown_tool", message: `No handler for ${name}` };
  }
}

// src/config.ts
var IVR_LIMITS = {
  /** After greeting, how long we wait for the caller to say anything. */
  initialSilenceMs: Number(process.env["IVR_INITIAL_SILENCE_MS"] ?? 25e3),
  /** Between caller turns (after Claude finishes replying). */
  interTurnSilenceMs: Number(process.env["IVR_INTER_TURN_SILENCE_MS"] ?? 2e4),
  /** Hard cap on total call length. */
  maxCallDurationMs: Number(process.env["IVR_MAX_CALL_DURATION_MS"] ?? 9e5),
  /** Runaway-loop guard: cap total prompt events per call. */
  maxPrompts: Number(process.env["IVR_MAX_PROMPTS"] ?? 60),
  /** "Still there?" prompts sent before we hang up on silence. */
  reEngageAttempts: Number(process.env["IVR_RE_ENGAGE_ATTEMPTS"] ?? 2),
  /** Soft token budget: once crossed, Claude is nudged to wrap up politely. */
  softTokenBudget: Number(process.env["IVR_SOFT_TOKEN_BUDGET"] ?? 4e4),
  /** Hard latency SLO; exceeding this on first-token logs a warning. */
  firstTokenSloMs: Number(process.env["IVR_FIRST_TOKEN_SLO_MS"] ?? 1500)
};

// src/claude.ts
var MODEL = "claude-haiku-4-5-20251001";
var MAX_TOKENS = 800;
var MAX_TOOL_HOPS = 20;
var SEND_INTENT_RE = /\b(sending|sent|send(ing)?\s+(it|that|the\s+(link|order))|email(ing)?\s+(you|it|that|the)|text(ing)?\s+(you|it|that)|on\s+(its|it's|the)\s+way|right\s+over|shooting\s+(it|that)\s+over|check\s+your\s+(phone|email|inbox|text|messages)|went\s+to\s+your\s+(email|inbox|phone|text)|link\s+(just\s+)?(went|sent|emailed)|just\s+went\s+to\s+your)\b/i;
var apiKey = process.env["ANTHROPIC_API_KEY"];
if (!apiKey) {
  console.warn("[ivr] ANTHROPIC_API_KEY not set \u2014 Claude calls will fail");
}
var client = new Anthropic({ apiKey: apiKey ?? "" });
function stripForTTS(s) {
  return s.replace(/[*_`~#]+/g, "");
}
async function streamReply(session, cb) {
  session.interrupt();
  const controller = new AbortController();
  session.abort = controller;
  const silentCb = {
    onToken: () => {
    },
    onDone: () => {
    },
    onError: () => {
    }
  };
  try {
    let hops = 0;
    while (hops <= MAX_TOOL_HOPS) {
      const result = await runOneHop(session, controller, cb);
      if (controller.signal.aborted) break;
      console.log(
        `[ivr] hop${hops} callSid=${session.callSid} stop=${result.stopReason} blocks=${result.blocks.length} text=${result.textBuf.length}`
      );
      if (result.stopReason !== "tool_use") {
        if (result.textBuf) session.addTurn("assistant", result.textBuf);
        const shouldForceDraft = !session.createdDraftOrderThisCall && result.textBuf.length > 0 && SEND_INTENT_RE.test(result.textBuf);
        if (!shouldForceDraft) break;
        console.warn(
          `[ivr] send-intent without tool_use callSid=${session.callSid} \u2014 forcing createDraftOrder`
        );
        const forced = await runOneHop(session, controller, silentCb, {
          type: "tool",
          name: "createDraftOrder"
        });
        if (controller.signal.aborted) break;
        if (forced.stopReason !== "tool_use") {
          console.error(
            `[ivr] forced createDraftOrder did not emit tool_use callSid=${session.callSid} stop=${forced.stopReason}`
          );
          break;
        }
        session.addTurn("assistant", forced.blocks);
        const forcedResults = [];
        for (const block of forced.blocks) {
          if (block.type !== "tool_use") continue;
          console.log(`[ivr] tool_use (forced) callSid=${session.callSid} name=${block.name}`);
          let output;
          try {
            output = await runTool(block.name, block.input, { session });
          } catch (err) {
            output = { error: "handler_threw", message: err instanceof Error ? err.message : String(err) };
          }
          if (block.name === "createDraftOrder") session.createdDraftOrderThisCall = true;
          forcedResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(output)
          });
        }
        session.addTurn("user", forcedResults);
        hops++;
        continue;
      }
      session.addTurn("assistant", result.blocks);
      const toolResults = [];
      for (const block of result.blocks) {
        if (block.type !== "tool_use") continue;
        console.log(`[ivr] tool_use callSid=${session.callSid} name=${block.name}`);
        let output;
        try {
          output = await runTool(block.name, block.input, { session });
        } catch (err) {
          output = { error: "handler_threw", message: err instanceof Error ? err.message : String(err) };
        }
        if (block.name === "createDraftOrder") session.createdDraftOrderThisCall = true;
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(output)
        });
      }
      session.addTurn("user", toolResults);
      hops++;
    }
    cb.onDone();
  } catch (err) {
    if (controller.signal.aborted) {
      cb.onDone();
      return;
    }
    console.error(
      `[ivr] streamReply error callSid=${session.callSid}`,
      err instanceof Error ? `${err.name}: ${err.message}` : err
    );
    cb.onError(err);
  } finally {
    if (session.abort === controller) session.abort = null;
  }
}
async function runOneHop(session, controller, cb, toolChoice) {
  const messages = session.buildMessages();
  const stream = client.messages.stream(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // cache_control is GA on the Messages API; SDK 0.32.1 types lag, so cast.
      system: [
        {
          type: "text",
          text: session.systemPrompt || buildSystemPrompt(DEFAULT_BRAND_VOICE),
          cache_control: { type: "ephemeral" }
        }
      ],
      tools: TOOL_DEFINITIONS,
      ...toolChoice ? { tool_choice: toolChoice } : {},
      messages
    },
    { signal: controller.signal }
  );
  let textBuf = "";
  let ttsBuffer = "";
  stream.on("text", (delta) => {
    textBuf += delta;
    const spoken = stripForTTS(delta);
    if (!spoken) return;
    ttsBuffer += spoken;
    if (/\w/.test(ttsBuffer)) {
      cb.onToken(ttsBuffer);
      ttsBuffer = "";
    }
  });
  const final = await stream.finalMessage();
  if (ttsBuffer) {
    cb.onToken(ttsBuffer);
    ttsBuffer = "";
  }
  const usage = final.usage;
  const hopTokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  session.tokensUsed += hopTokens;
  if (!session.wrapUpMode && session.tokensUsed > IVR_LIMITS.softTokenBudget) {
    console.warn(`[ivr] soft token budget exceeded callSid=${session.callSid} tokens=${session.tokensUsed}`);
    session.wrapUpMode = true;
  }
  const blocks = [];
  for (const b of final.content) {
    if (b.type === "text") blocks.push({ type: "text", text: b.text });
    else if (b.type === "tool_use") blocks.push({ type: "tool_use", id: b.id, name: b.name, input: b.input });
  }
  if (textBuf) {
    console.log(`[ivr] assistant callSid=${session.callSid}: ${textBuf.replace(/\s+/g, " ").trim()}`);
  }
  return { stopReason: final.stop_reason, blocks, textBuf };
}

// src/server.ts
var PORT = Number(process.env["PORT"] ?? 8080);
var httpServer = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end();
});
var wss = new WebSocketServer({ noServer: true });
var EXPECTED_WS_TOKEN = process.env["IVR_WS_SECRET"] ?? "";
function timingSafeStringEq(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
httpServer.on("upgrade", (req, socket, head) => {
  const url3 = new URL(req.url ?? "/", "http://localhost");
  if (url3.pathname !== "/relay") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  const token = url3.searchParams.get("token") ?? "";
  if (!EXPECTED_WS_TOKEN || !timingSafeStringEq(token, EXPECTED_WS_TOKEN)) {
    console.warn("[ivr] ws upgrade rejected \u2014 bad or missing token");
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});
wss.on("connection", (ws, req) => {
  const remote = req.socket.remoteAddress ?? "unknown";
  console.log(`[ivr] ws connected from ${remote}`);
  const wsUrl = new URL(req.url ?? "/", "http://localhost");
  const greetingFromUrl = decodeURIComponent(wsUrl.searchParams.get("greeting") ?? "");
  const session = new Session();
  if (greetingFromUrl) session.addTurn("assistant", greetingFromUrl);
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      console.error("[ivr] malformed message", err);
      return;
    }
    switch (msg.type) {
      case "setup": {
        session.callSid = msg.callSid;
        session.fromNumber = msg.from;
        session.toNumber = msg.to;
        console.log(`[ivr] setup callSid=${session.callSid} from=${session.fromNumber}`);
        if (greetingFromUrl) sendText(ws, greetingFromUrl, true);
        Promise.all([
          loadIvrSettings(),
          callQaTool("listCollections", {}).then((r) => {
            const res = r;
            return res.ok ? res.data?.collections?.map((c) => c.title) ?? [] : [];
          }).catch(() => [])
        ]).then(([s, collections]) => {
          session.settings = s;
          session.systemPrompt = buildSystemPrompt(s.brandVoice, collections, s.farewellGoodbye);
          if (!greetingFromUrl && s.greeting) {
            session.addTurn("assistant", s.greeting);
            sendText(ws, s.greeting, true);
          }
        }).catch(() => {
        });
        const greetingBuffer = greetingFromUrl ? estimateTtsMs(greetingFromUrl) : 5e3;
        armInitialSilence(ws, session, greetingBuffer);
        session.armDuration(IVR_LIMITS.maxCallDurationMs, () => wrapUp(ws, session));
        return;
      }
      case "prompt": {
        session.promptCount += 1;
        session.reEngageCount = 0;
        session.clearSilence();
        console.log(`[ivr] prompt callSid=${session.callSid}: ${msg.voicePrompt}`);
        if (session.promptCount > IVR_LIMITS.maxPrompts) {
          console.warn(`[ivr] max prompts exceeded callSid=${session.callSid}`);
          endCall(ws, session, "max_prompts", farewellFor(session, "maxPrompts"));
          return;
        }
        handlePrompt(ws, session, msg.voicePrompt);
        return;
      }
      case "interrupt": {
        console.log(`[ivr] interrupt callSid=${session.callSid}`);
        session.interrupt();
        return;
      }
      case "dtmf": {
        console.log(`[ivr] dtmf callSid=${session.callSid} digit=${msg.digit}`);
        return;
      }
      case "error": {
        console.error(`[ivr] twilio error callSid=${session.callSid}:`, msg.description);
        return;
      }
      default: {
        console.warn("[ivr] unknown message type", msg);
      }
    }
  });
  ws.on("close", (code, reason) => {
    session.interrupt();
    session.clearTimers();
    const durationMs = Date.now() - session.startedAt;
    console.log(
      `[ivr] ws closed callSid=${session.callSid} code=${code} reason=${reason.toString()} endReason=${session.endReason} prompts=${session.promptCount} durationMs=${durationMs}`
    );
    if (session.callSid) {
      recordCall({
        callSid: session.callSid,
        fromNumber: session.fromNumber,
        toNumber: session.toNumber || null,
        endReason: session.endReason,
        durationSec: Math.round(durationMs / 1e3),
        tokensTotal: session.tokensUsed
      }).catch((err) => console.error("[ivr] recordCall failed", err));
    }
  });
  ws.on("error", (err) => {
    console.error(`[ivr] ws error callSid=${session.callSid}`, err);
  });
});
var TTS_WORDS_PER_SEC = 2.5;
function estimateTtsMs(text) {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.round(words / TTS_WORDS_PER_SEC * 1e3);
}
function handlePrompt(ws, session, voicePrompt) {
  if (!voicePrompt.trim()) {
    armInterTurnSilence(ws, session);
    return;
  }
  session.addTurn("user", voicePrompt);
  const started = Date.now();
  let firstTokenAt = 0;
  let spokenText = "";
  streamReply(session, {
    onToken: (token) => {
      if (ws.readyState !== ws.OPEN) return;
      if (!firstTokenAt) {
        firstTokenAt = Date.now();
        const ms = firstTokenAt - started;
        console.log(`[ivr] first-token latency callSid=${session.callSid} ms=${ms}`);
        if (ms > IVR_LIMITS.firstTokenSloMs) {
          console.warn(`[ivr] first-token SLO breach callSid=${session.callSid} ms=${ms} slo=${IVR_LIMITS.firstTokenSloMs}`);
        }
      }
      spokenText += token;
      sendText(ws, token, false);
    },
    onDone: () => {
      if (ws.readyState === ws.OPEN) sendText(ws, "", true);
      const ttsTotal = estimateTtsMs(spokenText);
      const alreadySpoken = firstTokenAt ? Date.now() - firstTokenAt : 0;
      const ttsBuffer = Math.min(Math.max(0, ttsTotal - alreadySpoken), 15e3);
      armInterTurnSilence(ws, session, ttsBuffer);
    },
    onError: (err) => {
      console.error(`[ivr] claude error callSid=${session.callSid}`, err);
      if (ws.readyState === ws.OPEN) {
        sendText(ws, "Sorry \u2014 I lost my train of thought. Can you say that again?", true);
      }
      armInterTurnSilence(ws, session);
    }
  });
}
function armInitialSilence(ws, session, ttsBufferMs = 0) {
  session.armSilence(IVR_LIMITS.initialSilenceMs + ttsBufferMs, () => onSilence(ws, session));
}
function armInterTurnSilence(ws, session, ttsBufferMs = 0) {
  session.armSilence(IVR_LIMITS.interTurnSilenceMs + ttsBufferMs, () => onSilence(ws, session));
}
function onSilence(ws, session) {
  if (ws.readyState !== ws.OPEN) return;
  if (session.reEngageCount < IVR_LIMITS.reEngageAttempts) {
    session.reEngageCount += 1;
    console.log(`[ivr] re-engage callSid=${session.callSid} attempt=${session.reEngageCount}`);
    sendText(ws, "Still with me? Just say what you're calling about.", true);
    armInterTurnSilence(ws, session);
    return;
  }
  endCall(ws, session, "silent_caller", farewellFor(session, "silent"));
}
function wrapUp(ws, session) {
  if (ws.readyState !== ws.OPEN) return;
  console.log(`[ivr] max duration reached callSid=${session.callSid}`);
  endCall(ws, session, "max_duration", farewellFor(session, "maxDuration"));
}
function farewellFor(session, which) {
  const s = session.settings;
  if (!s) return null;
  const raw = which === "maxPrompts" ? s.farewellMaxPrompts : which === "maxDuration" ? s.farewellMaxDuration : s.farewellSilent;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
function endCall(ws, session, reason, farewell) {
  session.endReason = reason;
  session.interrupt();
  session.clearTimers();
  if (farewell) sendText(ws, farewell, true);
  const end = { type: "end", handoffData: JSON.stringify({ reason }) };
  try {
    ws.send(JSON.stringify(end));
  } catch (err) {
    console.error(`[ivr] failed to send end frame callSid=${session.callSid}`, err);
  }
}
function sendText(ws, text, last) {
  const msg = { type: "text", token: text, last };
  ws.send(JSON.stringify(msg));
}
httpServer.listen(PORT, () => {
  console.log(`[ivr] listening on :${PORT} (ws path /relay)`);
});
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[ivr] ${sig} received \u2014 closing`);
    wss.clients.forEach((c) => c.close(1001, "server shutdown"));
    httpServer.close(() => process.exit(0));
  });
}

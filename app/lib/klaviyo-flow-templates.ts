/**
 * Klaviyo flow email templates (Ad Studio v2 PR-F). Pure string rendering, no
 * server imports, so the unit tests and the setup script can both use it.
 *
 * Five emails across three flows. Voice is register 9 on an owned channel
 * (docs/emma-voice.md): acts named plainly, sensation in the body, temptation
 * closers, no dares, no mind-reading, no conditional hedging, no mechanism, no
 * price, no countdown, no proof we do not have. Every string went through the
 * humanizer pass (.claude/skills/humanizer/SKILL.md) and has no em-dashes.
 *
 * The templates interpolate event properties by the keys in
 * FLOW_EVENT_PROPERTY_KEYS. Those keys are what klaviyo-flows.server.ts
 * `flowEventProps()` attaches to the Added to Cart, Started Checkout, Placed
 * Order and Viewed Product events. A template always renders sanely when a key
 * is missing (every variable carries a default).
 */

export const FLOW_EVENT_PROPERTY_KEYS = {
  name: 'ProductName',
  url: 'ProductURL',
  handle: 'ProductHandle',
  headerImage: 'HeaderImageURL',
  headerKind: 'HeaderKind',
  type: 'ProductType',
} as const

export type FlowSlug = 'browse-abandonment' | 'cart-abandonment' | 'post-purchase'

export const CTA_WHITELIST = ['Take a peek →', 'Show me', 'Find your fit →', "I'll take it ♥"] as const
export type CtaLabel = (typeof CTA_WHITELIST)[number]

export interface FlowEmailSpec {
  /** Stable key, also the template name suffix. */
  key: string
  flow: FlowSlug
  /** utm_content value. */
  step: string
  /** Cumulative hours from the trigger event to this email. */
  delayHours: number
  /** Three subject variants. Variant 0 ships in the flow, 1 and 2 are the A/B candidates. */
  subjects: [string, string, string]
  previews: [string, string, string]
  headline: string
  /** Opening paragraph, before the act block. */
  lead: string
  /** Closing paragraph before the CTA (the temptation closer lives here). */
  closer: string
  /** The one discreet-shipping line, said once. */
  discreetLine: string
  /** Whitelisted CTA label. */
  cta: CtaLabel
}

const N = '{{ event.ProductName|default:"your pick" }}'

/**
 * Act paragraphs keyed on the product_type_dial metafield value. Register 9:
 * the act is named, the sensation is in the body, and the paragraph ends on a
 * temptation. Each one is written fresh; none repeats a phrase from the slogan
 * bank or from another block.
 */
export const ACT_BLOCKS: Record<string, string> = {
  'air-pulsation':
    'It is oral, patient, and never tired. Warm, wet, a rhythm that finds you before you finish the thought, and the first one is over before you expected it. The second is already gathering underneath.',
  wand:
    'A wand is the sure thing. Broad, heavy, steady against you, and your hips answer before you ask them to. The first one rolls through slowly, and a deeper one waits underneath it.',
  vibrator:
    'Close, thick, and filling in a way fingers never managed. The warmth gathers low and spreads until your thighs give up. One wave goes out and another is already coming in.',
  lube:
    'Slick fingers, slower hands, everything wetter than you planned. The glide keeps the good part going, and every stroke after the first goes a little deeper.',
  wear:
    'Worn out the door and felt the whole way, a private heat that builds with every step. The best minute is the one when the door closes behind you.',
}

export const ACT_DEFAULT =
  'Pleasure you can name and have on purpose. It builds, it arrives, and what comes after is slower and softer and still yours. There is more in it than the first time shows.'

export const FLOW_EMAILS: FlowEmailSpec[] = [
  {
    key: 'browse-4h',
    flow: 'browse-abandonment',
    step: 'viewed-4h',
    delayHours: 4,
    subjects: [
      `${N}: the long version`,
      `A closer look at ${N}`,
      `The part of ${N} the photos leave out`,
    ],
    previews: ['Slow, warm, and all yours.', 'What it feels like, said plainly.', 'Come back to it whenever you like.'],
    headline: `${N}, said plainly.`,
    lead: `You stopped on ${N} earlier. Photos show the shape. They leave out the rest.`,
    closer: 'The page is open whenever you are.',
    discreetLine: 'Plain box, plain label, XDIPX on your statement. Nobody&rsquo;s business.',
    cta: 'Show me',
  },
  {
    key: 'cart-1h',
    flow: 'cart-abandonment',
    step: 'cart-1h',
    delayHours: 1,
    subjects: [
      `${N} is in your cart`,
      `Your cart, with ${N} in it`,
      `Back to ${N}`,
    ],
    previews: ['Exactly where you left it.', 'One tap from here.', 'The rest of the evening is yours.'],
    headline: `${N} is waiting where you left it.`,
    lead: `${N} is still in your cart, and the cart is still yours.`,
    closer: 'The next part is the best part, and it starts when the box arrives.',
    discreetLine: 'It ships in a plain box with a plain label, and your statement reads XDIPX.',
    cta: "I'll take it ♥",
  },
  {
    key: 'cart-24h',
    flow: 'cart-abandonment',
    step: 'cart-24h',
    delayHours: 24,
    subjects: [
      `${N} and the first night with it`,
      `No wrong answers, ${N} included`,
      `${N} is saved in your cart`,
    ],
    previews: ['Beginner-safe by default.', 'Thirty days, and no wrong answers.', 'Take it at your pace.'],
    headline: 'No experience needed. No wrong answers.',
    lead: `${N} is beginner-safe by default. There is no right way to start, only your pace.`,
    closer: 'Thirty-day returns, and something off, we make it right. The first night is the only thing left to choose.',
    discreetLine: 'Plain box, plain label, XDIPX on your statement. Nobody&rsquo;s business.',
    cta: "I'll take it ♥",
  },
  {
    key: 'post-3d',
    flow: 'post-purchase',
    step: 'post-3d',
    delayHours: 72,
    subjects: [
      `Your first evening with ${N}`,
      `${N}, out of the box`,
      `Settling in with ${N}`,
    ],
    previews: ['Take your time with the first one.', 'No schedule, no wrong answers.', 'It rewards patience.'],
    headline: `Your first evening with ${N}.`,
    lead: 'Start slow. There is no schedule and no wrong answer, and the first time rarely shows you everything.',
    closer: 'Come back to it tomorrow. It gets better once you know what you like.',
    discreetLine: 'Your statement reads XDIPX.',
    cta: 'Take a peek →',
  },
  {
    key: 'post-14d',
    flow: 'post-purchase',
    step: 'post-14d',
    delayHours: 24 * 14,
    subjects: [
      `What pairs with ${N}`,
      `Round two with ${N}`,
      `The thing that makes ${N} better`,
    ],
    previews: ['Two weeks in, here is what goes with it.', 'A good thing, improved.', 'Find your fit.'],
    headline: `Two weeks in. Here is what goes with ${N}.`,
    lead: `By now you know ${N}. The page shows what pairs with it: lube, a second toy, a hand to hold it.`,
    closer: 'The best addition is the one you did not know you needed.',
    discreetLine: 'Plain box, plain label, XDIPX on your statement.',
    cta: 'Find your fit →',
  },
]

const UTM_BASE = "{{ event.ProductURL|default:'https://xdipx.com/' }}"

function utmQuery(spec: FlowEmailSpec, amp: string): string {
  return `utm_source=klaviyo${amp}utm_medium=email${amp}utm_campaign=${spec.flow}${amp}utm_content=${spec.step}`
}

/** Django-style `{% if %}` chain choosing the act paragraph by ProductType. */
function actBlock(): string {
  const parts = Object.keys(ACT_BLOCKS).map(
    (k, i) => `{% ${i === 0 ? 'if' : 'elif'} event.ProductType == "${k}" %}${ACT_BLOCKS[k]}`,
  )
  return `${parts.join('')}{% else %}${ACT_DEFAULT}{% endif %}`
}

const HEAD_FONT = "Newsreader, Georgia, 'Times New Roman', serif"
const BODY_FONT = "'DM Sans', Helvetica, Arial, sans-serif"
const INK = '#1A1418'
const INK3 = '#6B5F68'
const CORAL = '#C2350F'
const CORAL_SOFT = '#FFE6DD'
const PAPER = '#FFFFFF'

export interface RenderedFlowEmail {
  name: string
  html: string
  text: string
}

export function flowTemplateName(spec: FlowEmailSpec): string {
  return `xdipx ${spec.flow} ${spec.key}`
}

export function renderFlowEmail(spec: FlowEmailSpec): RenderedFlowEmail {
  const href = `${UTM_BASE}?${utmQuery(spec, '&amp;')}`
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${spec.headline}</title>
<style>
  body { margin:0; padding:0; background:${PAPER}; }
  @media (max-width:620px) {
    .wrap { width:100% !important; }
    .pad { padding-left:20px !important; padding-right:20px !important; }
    .h1 { font-size:26px !important; line-height:32px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${PAPER};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};">
<tr><td align="center">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;">
<tr><td bgcolor="${CORAL_SOFT}" style="background:${CORAL_SOFT};">
{% if event.HeaderImageURL %}<a href="${href}"><img src="{{ event.HeaderImageURL }}" alt="{{ event.ProductName|default:'xdipx' }}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></a>{% else %}<div style="padding:56px 24px;text-align:center;font-family:${HEAD_FONT};font-size:28px;line-height:34px;color:${INK};">{{ event.ProductName|default:"xdipx" }}</div>{% endif %}
</td></tr>
<tr><td class="pad" style="padding:32px 32px 8px 32px;font-family:${HEAD_FONT};color:${INK};">
<h1 class="h1" style="margin:0;font-family:${HEAD_FONT};font-weight:400;font-size:30px;line-height:36px;color:${INK};">${spec.headline}</h1>
</td></tr>
<tr><td class="pad" style="padding:8px 32px 0 32px;font-family:${BODY_FONT};font-size:16px;line-height:25px;color:${INK};">
<p style="margin:0 0 16px 0;">${spec.lead}</p>
<p style="margin:0 0 16px 0;">${actBlock()}</p>
<p style="margin:0 0 16px 0;">${spec.closer}</p>
</td></tr>
<tr><td class="pad" align="left" style="padding:8px 32px 8px 32px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td bgcolor="${CORAL}" style="background:${CORAL};border-radius:14px;">
<a href="${href}" style="display:inline-block;padding:14px 28px;font-family:${BODY_FONT};font-size:16px;line-height:20px;font-weight:600;color:${PAPER};text-decoration:none;">${spec.cta}</a>
</td></tr></table>
</td></tr>
<tr><td class="pad" style="padding:20px 32px 8px 32px;font-family:${BODY_FONT};font-size:13px;line-height:20px;color:${INK3};">
${spec.discreetLine}
</td></tr>
<tr><td class="pad" style="padding:16px 32px 32px 32px;font-family:${BODY_FONT};font-size:12px;line-height:18px;color:${INK3};border-top:1px solid #EEEDEB;">
xdipx &middot; {{ organization.full_address }}<br>
{% unsubscribe 'Unsubscribe' %} &middot; {% manage_preferences 'Email preferences' %}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`

  const plain = (s: string): string => s.replace(/&rsquo;/g, "'")
  const text = [
    plain(spec.headline),
    '',
    spec.lead,
    '',
    actBlock(),
    '',
    spec.closer,
    '',
    `${spec.cta} ${UTM_BASE}?${utmQuery(spec, '&')}`,
    '',
    plain(spec.discreetLine),
    '',
    'xdipx, {{ organization.full_address }}',
    "{% unsubscribe 'Unsubscribe' %}",
  ].join('\n')

  return { name: flowTemplateName(spec), html, text }
}

export function renderAllFlowEmails(): RenderedFlowEmail[] {
  return FLOW_EMAILS.map(renderFlowEmail)
}

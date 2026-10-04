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
  /**
   * The one word in the headline set in italic plum (doctrine section 2: exactly
   * one emphasized word per headline, carrying the meaning). Must occur in
   * `headline` exactly as written.
   */
  emphasis: string
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
    headline: 'Said plainly.',
    emphasis: 'plainly',
    lead: 'You stopped on this one earlier. Photos show the shape. They leave out the rest.',
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
    headline: 'Right where you left it.',
    emphasis: 'left',
    lead: 'It is still in your cart.',
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
    emphasis: 'wrong',
    lead: 'It is beginner-safe by default. There is no right way to start, only your pace.',
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
    headline: 'Your first evening with it.',
    emphasis: 'first',
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
    headline: 'Two weeks in. Here is what pairs with it.',
    emphasis: 'pairs',
    lead: 'By now you know it well. The page shows what goes with it: lube, a second toy, a hand to hold it.',
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

// ─── Design system ────────────────────────────────────────────────────────
//
// One editorial system for all five emails (docs/store-team/klaviyo-flows.md,
// "Design"). v3 tokens from app/app.css, flattened to hex because email clients
// do not read CSS variables and Outlook does not read rgba. Paper ground, ink
// type ramp, one plum emphasis word, one coral button and nothing else coral.

const HEAD_FONT = "Newsreader, Georgia, 'Times New Roman', serif"
const BODY_FONT = "'DM Sans', Arial, Helvetica, sans-serif"

const C = {
  paper: '#FFFFFF',
  paper2: '#FAFAF9',
  ink: '#1A1418',
  ink2: '#3D2F3A',
  ink3: '#6B5F68',
  ink4: '#726673',
  /** `line` (8% ink) flattened onto paper. */
  line: '#EDECEC',
  /** `line-3` (32% ink) flattened onto paper. */
  line3: '#B6B4B5',
  coral: '#C2350F',
  plum: '#7A2BB8',
} as const

/** Dark-mode palette, used only where a client asks for it (Apple Mail, iOS Mail, Outlook.com). */
const D = {
  ground: '#1A1418',
  card: '#241C22',
  text: '#F4F1F3',
  text2: '#DCD3DA',
  text3: '#B9AEB6',
  line: '#3D2F3A',
  /** Plum lifted for contrast on ink; the brand plum is 2.3:1 there. */
  plum: '#C9A0EE',
} as const

/**
 * Header plate size in CSS pixels. The plate is square: header art arrives as
 * 4:5 on-skin frames, 1:1 packshots and the odd landscape, and
 * `emailHeaderImageUrl` in klaviyo-flows.server.ts crops every Shopify CDN URL
 * to 2x this at source so the plate never changes height between products.
 */
export const EMAIL_HEADER_PX = 600

/** Escape-free headline with the one emphasis word wrapped in italic plum. */
function emphasizedHeadline(spec: FlowEmailSpec): string {
  const i = spec.headline.indexOf(spec.emphasis)
  if (!spec.emphasis || i < 0) return spec.headline
  return (
    spec.headline.slice(0, i) +
    `<em class="x-plum" style="font-style:italic;color:${C.plum};">${spec.emphasis}</em>` +
    spec.headline.slice(i + spec.emphasis.length)
  )
}

/**
 * Bulletproof coral button. Three layers, each for a client that ignores the
 * others:
 *  - Outlook for Windows gets a VML roundrect (it cannot pad or round an <a>).
 *  - Gmail's dark mode repaints background colours but not background images,
 *    so the cell and the link carry the coral as a one-colour image fill as well
 *    as bgcolor. It renders flat, no visible gradient. The label is white,
 *    which Gmail leaves alone (it lightens dark text, it does not darken light).
 *    The mix-blend-mode label hack was tried and dropped: it brightened the
 *    coral to orange in every browser-engine client.
 */
function coralButton(href: string, label: string): string {
  const fill = `background-color:${C.coral};background-image:linear-gradient(${C.coral},${C.coral});`
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
<tr><td align="center" bgcolor="${C.coral}" class="x-btn" style="${fill}border-radius:999px;mso-padding-alt:0;">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:52px;v-text-anchor:middle;width:260px;" arcsize="50%" stroke="f" fillcolor="${C.coral}"><w:anchorlock/><center style="color:#FFFFFF;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${label}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${href}" target="_blank" class="x-btn-a" style="display:inline-block;${fill}color:#FFFFFF;font-family:${BODY_FONT};font-size:16px;line-height:20px;font-weight:600;letter-spacing:0.01em;text-decoration:none;padding:16px 36px;border-radius:999px;mso-hide:all;">${label}</a><!--<![endif]-->
</td></tr>
</table>`
}

/** Hidden preheader filler. Klaviyo injects the message's preview text ahead of
 * the body; this run of zero-width joiners stops the masthead and headline from
 * trailing into the inbox snippet after it. */
const PREHEADER_FILLER = '&#8199;&#65279;&#847; '.repeat(60)

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
  const homeHref = `https://xdipx.com/?${utmQuery(spec, '&amp;')}`
  const px = EMAIL_HEADER_PX
  const cell = (bg: string, cls: string) => `bgcolor="${bg}" class="${cls}" style="background-color:${bg};`

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${spec.headline}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<style>td,th,p,a,span,div{font-family:Arial,Helvetica,sans-serif !important;} .x-serif,.x-serif *{font-family:Georgia,'Times New Roman',serif !important;}</style><![endif]-->
<style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
body { margin:0 !important; padding:0 !important; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
table, td { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; }
/* Klaviyo's unsubscribe and preferences tags emit unstyled links; keep them in the footer ink. */
.x-foot a { color:${C.ink4} !important; text-decoration:underline; }
@media only screen and (max-width:620px) {
  .x-wrap { width:100% !important; }
  .x-px { padding-left:24px !important; padding-right:24px !important; }
  .x-title { font-size:30px !important; line-height:34px !important; }
  .x-dek { font-size:22px !important; line-height:29px !important; }
  .x-quote { font-size:19px !important; line-height:29px !important; }
}
</style>
<style>
@media (prefers-color-scheme: dark) {
  .x-bg { background-color:${D.ground} !important; }
  .x-card { background-color:${D.card} !important; }
  .x-ink { color:${D.text} !important; }
  .x-ink2 { color:${D.text2} !important; }
  .x-ink3 { color:${D.text3} !important; }
  .x-plum { color:${D.plum} !important; }
  .x-rule { border-color:${D.line} !important; }
  .x-foot a { color:${D.text3} !important; }
}
[data-ogsb] .x-bg { background-color:${D.ground} !important; }
[data-ogsb] .x-card { background-color:${D.card} !important; }
[data-ogsc] .x-ink { color:${D.text} !important; }
[data-ogsc] .x-ink2 { color:${D.text2} !important; }
[data-ogsc] .x-ink3 { color:${D.text3} !important; }
[data-ogsc] .x-plum { color:${D.plum} !important; }
</style>
<!-- Web fonts for clients that load them (Apple Mail, iOS Mail). Klaviyo strips <link> tags from
     code templates, so the import rides in its own style block; Gmail and Outlook fall back to the
     Georgia and Arial stacks. -->
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&display=swap');
</style>
</head>
<body class="x-bg" bgcolor="${C.paper}" style="margin:0;padding:0;background-color:${C.paper};">
<div class="x-body x-bg" role="article" aria-roledescription="email" aria-label="${spec.headline}" lang="en" style="background-color:${C.paper};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.paper};opacity:0;">${PREHEADER_FILLER}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ${cell(C.paper, 'x-bg')}">
<tr><td align="center" ${cell(C.paper, 'x-bg')}">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td bgcolor="${C.paper}" style="background-color:${C.paper};"><![endif]-->
<table role="presentation" class="x-wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">

<tr><td class="x-px x-bg" bgcolor="${C.paper}" align="left" style="background-color:${C.paper};padding:28px 40px 22px 40px;">
<a href="${homeHref}" target="_blank" class="x-ink x-serif" style="font-family:${HEAD_FONT};font-size:26px;line-height:30px;font-weight:500;letter-spacing:-0.01em;color:${C.ink};text-decoration:none;">xdipx</a>
</td></tr>

{% if event.HeaderImageURL %}<tr><td ${cell(C.paper2, 'x-card')}line-height:0;font-size:0;">
<a href="${href}" target="_blank" style="text-decoration:none;"><img src="{{ event.HeaderImageURL }}" width="${px}" height="${px}" alt="{{ event.ProductName|default:'xdipx' }}" style="display:block;width:100%;max-width:100%;height:auto;border:0;font-family:${BODY_FONT};font-size:15px;line-height:22px;color:${C.ink3};"></a>
</td></tr>{% endif %}

{% if event.ProductName %}<tr><td class="x-px x-bg" bgcolor="${C.paper}" align="left" style="background-color:${C.paper};padding:32px 40px 0 40px;">
<p class="x-title x-ink x-serif" style="margin:0;font-family:${HEAD_FONT};font-size:36px;line-height:40px;font-weight:400;letter-spacing:-0.015em;color:${C.ink};">{{ event.ProductName }}</p>
</td></tr>{% endif %}

<tr><td class="x-px x-bg" bgcolor="${C.paper}" align="left" style="background-color:${C.paper};padding:14px 40px 0 40px;">
<h1 class="x-dek x-ink2 x-serif" style="margin:0;font-family:${HEAD_FONT};font-size:24px;line-height:31px;font-weight:400;letter-spacing:-0.005em;color:${C.ink2};">${emphasizedHeadline(spec)}</h1>
</td></tr>

<tr><td class="x-px x-bg" bgcolor="${C.paper}" align="left" style="background-color:${C.paper};padding:24px 40px 0 40px;">
<p class="x-ink2" style="margin:0;max-width:60ch;font-family:${BODY_FONT};font-size:17px;line-height:27px;color:${C.ink2};">${spec.lead}</p>
</td></tr>

<tr><td class="x-px x-bg" bgcolor="${C.paper}" align="left" style="background-color:${C.paper};padding:24px 40px 0 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="x-rule x-bg" bgcolor="${C.paper}" style="background-color:${C.paper};border-left:2px solid ${C.line3};padding:2px 0 2px 20px;">
<p class="x-quote x-ink x-serif" style="margin:0;max-width:60ch;font-family:${HEAD_FONT};font-size:20px;line-height:30px;font-style:italic;font-weight:400;color:${C.ink};">${actBlock()}</p>
</td></tr></table>
</td></tr>

<tr><td class="x-px x-bg" bgcolor="${C.paper}" align="left" style="background-color:${C.paper};padding:24px 40px 0 40px;">
<p class="x-ink2" style="margin:0;max-width:60ch;font-family:${BODY_FONT};font-size:17px;line-height:27px;color:${C.ink2};">${spec.closer}</p>
</td></tr>

<tr><td class="x-px x-bg" bgcolor="${C.paper}" align="center" style="background-color:${C.paper};padding:36px 40px 0 40px;">
${coralButton(href, spec.cta)}
</td></tr>

<tr><td class="x-px x-bg" bgcolor="${C.paper}" align="left" style="background-color:${C.paper};padding:32px 40px 36px 40px;">
<p class="x-ink3" style="margin:0;font-family:${BODY_FONT};font-size:14px;line-height:21px;color:${C.ink3};">${spec.discreetLine}</p>
</td></tr>

<tr><td class="x-px x-bg" bgcolor="${C.paper}" style="background-color:${C.paper};padding:0 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="x-rule x-bg" bgcolor="${C.paper}" height="1" style="background-color:${C.paper};height:1px;line-height:1px;font-size:1px;border-top:1px solid ${C.line};">&nbsp;</td></tr></table>
</td></tr>

<tr><td class="x-px x-bg" bgcolor="${C.paper}" align="left" style="background-color:${C.paper};padding:24px 40px 40px 40px;">
<p class="x-ink3" style="margin:0 0 10px 0;font-family:${BODY_FONT};font-size:13px;line-height:20px;color:${C.ink4};">Questions go to <a href="mailto:hello@xdipx.com" class="x-ink3" style="color:${C.ink4};text-decoration:underline;">hello@xdipx.com</a>.</p>
<p class="x-ink3" style="margin:0 0 10px 0;font-family:${BODY_FONT};font-size:13px;line-height:20px;color:${C.ink4};">xdipx &middot; {{ organization.full_address }}</p>
<p class="x-ink3 x-foot" style="margin:0;font-family:${BODY_FONT};font-size:13px;line-height:20px;color:${C.ink4};">{% unsubscribe 'Unsubscribe' %} &middot; {% manage_preferences 'Email preferences' %}</p>
</td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</div>
</body>
</html>`

  const plain = (s: string): string => s.replace(/&rsquo;/g, "'")
  const text = [
    'xdipx',
    '',
    '{{ event.ProductName|default:"" }}',
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
    'Questions go to hello@xdipx.com.',
    'xdipx, {{ organization.full_address }}',
    "{% unsubscribe 'Unsubscribe' %}",
  ].join('\n')

  return { name: flowTemplateName(spec), html, text }
}

export function renderAllFlowEmails(): RenderedFlowEmail[] {
  return FLOW_EMAILS.map(renderFlowEmail)
}

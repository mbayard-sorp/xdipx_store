/**
 * Klaviyo welcome emails for the two lists that get a first hello
 * (tickets #16143 and #16144, from the 2026-10-18 paid Meta lead funnel audit).
 *
 * Pure string rendering, no server imports, so the unit tests and the setup
 * script (scripts/klaviyo-welcome-setup.ts) both use it. Same design system
 * as the flow emails (email-design-system.ts): paper ground, ink type ramp,
 * one plum emphasis word, one coral button.
 *
 * Two families:
 *
 * - `paid-leads-welcome`: the Door A lead from curious.xdipx.com. Triggered by
 *   Added to List on the paid-leads list. Two emails: the code and the shelf
 *   the lead picked (now), then one more look at that shelf (day 3). The shelf
 *   comes from the profile property `interest`, written by /api/lead with a
 *   slug from app/lib/lead-interests.ts, so every email branches on it with a
 *   Klaviyo `{% if person.interest == "..." %}` chain and falls back to /start.
 *   The shop link runs through /discount/<code> so the code is on the cart.
 *
 * - `email-list-welcome`: the replacement for the stock Klaviyo K60 templates
 *   that went live on the Email List on 2026-10-18 ("Welcome to the family!").
 *   Three emails, no code, no interest. Rendered as saved templates only; the
 *   owner swaps them into the existing flow.
 *
 * Voice is the owned-channel register (docs/emma-voice.md): the act is named
 * plainly, the sensation sits in the body, closers tempt, nothing dares, no
 * proof we do not have, no price talk beyond the offer's own terms, no
 * countdown, and the discreet line is said once. No em dashes anywhere.
 */
import {
  EMAIL_BODY_FONT as BODY_FONT,
  EMAIL_COLORS as C,
  EMAIL_DARK_COLORS as D,
  EMAIL_HEAD_FONT as HEAD_FONT,
  EMAIL_PREHEADER_FILLER as PREHEADER_FILLER,
  coralButton,
} from './email-design-system'
import { CTA_WHITELIST, type CtaLabel } from './klaviyo-flow-templates'
import { buildShopUrl, buildStartUrl } from './lead-funnel'
import { LEAD_INTERESTS, LEAD_OFFER, type LeadInterestSlug } from './lead-interests'

export type WelcomeFlowSlug = 'paid-leads-welcome' | 'email-list-welcome'

export const WELCOME_FLOW_NAMES: Record<WelcomeFlowSlug, string> = {
  'paid-leads-welcome': 'xdipx Paid leads welcome',
  'email-list-welcome': 'xdipx Email list welcome',
}

export interface WelcomeEmailSpec {
  key: string
  flow: WelcomeFlowSlug
  /** utm_content value. */
  step: string
  /** Cumulative hours from the trigger to this email. */
  delayHours: number
  subject: string
  preview: string
  headline: string
  /** The one word set in italic plum; must occur in `headline` exactly. */
  emphasis: string
  lead: string
  /** Per-interest paragraph (paid-leads family) or a single paragraph (email-list family). */
  shelf: Partial<Record<LeadInterestSlug, string>> & { default: string }
  closer: string
  discreetLine: string
  cta: CtaLabel
  /** Show the CURIOUS15 code block. */
  showCode: boolean
  /** Email-list family only: where the button goes. Default is /start. */
  link?: 'home' | 'start'
}

export const WELCOME_EMAILS: WelcomeEmailSpec[] = [
  {
    key: 'welcome-0h',
    flow: 'paid-leads-welcome',
    step: 'welcome-0h',
    delayHours: 0,
    subject: 'Your code, and the shelf you picked',
    preview: 'CURIOUS15 is ready whenever you are.',
    headline: 'Your code is here. Start where you wanted to.',
    emphasis: 'wanted',
    lead: 'You picked a shelf on the way in. The button below opens it with CURIOUS15 already on your cart.',
    shelf: {
      curious: 'Gentle first toys: small, soft, and easy to say yes to. A slow start, and the kind of ending you get to decide on.',
      'hands-free': 'Suction and air pulse that take the work off your hands. Lie back, let it find the rhythm, and stay there as long as you like.',
      wands: 'Deep, rumbly power you press wherever you want it. A wand does not ask; it keeps going until you say when.',
      'for-two': 'One of you wears it, the other holds the controls from across the room. Whoever has the remote sets the pace.',
      'back-door': 'Anal toys with a tapered tip and a flared base, made for going slowly. Lube first, patience second, and the rest follows.',
      'for-him': 'Strokers and rings made for a penis. Tighter, longer, or both, depending on the night.',
      play: 'Dice, cards and games that turn a night in into foreplay. Pull a card, read it out loud, and let the evening follow it.',
      default: 'Seven shelves, from gentle first toys to games for two. Start with whichever sounds like your evening.',
    },
    closer: 'The button puts CURIOUS15 on your cart, and the only thing left to choose is how slow you want it.',
    discreetLine: 'Plain box, plain label, XDIPX on your statement. Nobody&rsquo;s business but yours.',
    cta: 'Find your fit →',
    showCode: true,
  },
  {
    key: 'welcome-3d',
    flow: 'paid-leads-welcome',
    step: 'welcome-3d',
    delayHours: 72,
    subject: 'One more look at the shelf you picked',
    preview: 'Your shelf and CURIOUS15, whenever you want them.',
    headline: 'Your shelf is still here, code attached.',
    emphasis: 'shelf',
    lead: 'The code has no end date, so there is no clock on this. Here is a night with that shelf.',
    shelf: {
      curious: 'Small, soft, and warm against you. It sets a slow pace, and the ending is yours whenever you want it.',
      'hands-free': 'Air pulse on the lowest setting, no hands, no hurry, and nowhere else to be.',
      wands: 'A wand pressed exactly where you want it, the hum low and deep, and you settled in for as long as you like.',
      'for-two': 'One of you wears it, the other holds the remote, and every press is a reaction you get to watch.',
      'back-door': 'A plug you forget you are wearing, right up until you do not.',
      'for-him': 'A stroker holds the same slow, snug rhythm for as long as you want it, long after a hand would tire.',
      play: 'Pull a card. Read it out loud. Pull another.',
      default: 'Open the shelf that caught your eye first. The code is already on the cart.',
    },
    closer: 'Open the shelf and the code is already on your cart.',
    discreetLine: 'It ships in a plain box with a plain label, and your statement reads XDIPX.',
    cta: 'Show me',
    showCode: true,
  },
  {
    key: 'hello-0h',
    flow: 'email-list-welcome',
    step: 'hello-0h',
    delayHours: 0,
    subject: 'A curated shelf, a plain box, no wrong answers',
    preview: 'Picks with the reasons written out, a plain box, and no wrong answers.',
    headline: 'Welcome. Pleasure, worth getting right.',
    emphasis: 'right',
    lead: 'xdipx is a curated sexual wellness store. Emma, our guide, matches what you tell her against the specs and the reviews.',
    shelf: {
      default: 'Start with the shelf that fits what you want to feel: gentle first toys, hands-free, wands, toys for two, anal toys, strokers and rings, or games. Each one opens on the pick that suits it.',
    },
    closer: 'Look around at your own pace. Whatever you linger on has a page with the reasons written out.',
    discreetLine: 'Every order ships in a plain box with a plain label, and your statement reads XDIPX.',
    cta: 'Take a peek →',
    showCode: false,
  },
  {
    key: 'hello-3d',
    flow: 'email-list-welcome',
    step: 'hello-3d',
    delayHours: 72,
    subject: 'How to pick a toy without guessing',
    preview: 'Outside, inside, or both. Alone, or with someone.',
    headline: 'Three questions, then the shelf.',
    emphasis: 'shelf',
    lead: 'Where do you want it: outside, inside, or both. Hands on, or hands free. Alone, or with someone holding the remote. Answer those and you have your shelf.',
    shelf: {
      default: 'Outside and hands-free: air pulse. Outside and rumbly: a wand. Inside: a curved vibe. Both at once: a rabbit. With someone: a wearable with a remote. For a penis: a stroker or a ring.',
    },
    closer: 'Ask Emma on the site and she will match what you tell her against the specs and the reviews.',
    discreetLine: 'Plain box, plain label, XDIPX on your statement.',
    cta: 'Find your fit →',
    showCode: false,
  },
  {
    key: 'hello-7d',
    flow: 'email-list-welcome',
    step: 'hello-7d',
    delayHours: 24 * 7,
    subject: 'The current pick, with the reasons written out',
    preview: 'Emma&rsquo;s pick, refreshed on her own schedule.',
    headline: 'The current pick, and why it is on the page.',
    emphasis: 'why',
    lead: 'Emma features one pick at a time, on her own schedule, with the reasons written out: what it does, who it suits, and what the reviews say.',
    shelf: {
      default: 'Picks span wands, air pulse toys, wearables for two, and more, each with the reasons written out.',
    },
    closer: 'The current pick is one tap away, reasons included.',
    discreetLine: 'Your statement reads XDIPX, and the box is plain.',
    cta: 'Show me',
    showCode: false,
    link: 'home',
  },
]

export function welcomeEmailsFor(flow: WelcomeFlowSlug): WelcomeEmailSpec[] {
  return WELCOME_EMAILS.filter(e => e.flow === flow)
}

export function welcomeTemplateName(spec: WelcomeEmailSpec): string {
  return `xdipx ${spec.flow} ${spec.key}`
}

function utm(spec: WelcomeEmailSpec) {
  return { source: 'klaviyo', medium: 'email', campaign: spec.flow, content: spec.step }
}

/** The shop link per interest. Paid-leads emails route through /discount so the code is on the cart. */
export function welcomeShelfUrl(spec: WelcomeEmailSpec, interest: LeadInterestSlug | null): string {
  if (spec.flow === 'paid-leads-welcome') return buildShopUrl(interest, utm(spec), 'hello')
  if (spec.link === 'home') {
    const u = utm(spec)
    return `https://xdipx.com/?utm_source=${u.source}&utm_medium=${u.medium}&utm_campaign=${u.campaign}&utm_content=${u.content}`
  }
  return buildStartUrl(interest, utm(spec), 'hello')
}

const esc = (s: string) => s.replace(/&(?!amp;|rsquo;|middot;|nbsp;)/g, '&amp;')

/**
 * Klaviyo Django-style chain on the profile property `interest`. Each branch
 * carries its own paragraph and its own link, so one template serves all seven
 * shelves and the /start fallback.
 */
function interestChain(spec: WelcomeEmailSpec, render: (text: string, href: string) => string): string {
  if (spec.flow !== 'paid-leads-welcome') return render(spec.shelf.default, welcomeShelfUrl(spec, null))
  const parts = LEAD_INTERESTS.map((i, n) => {
    const text = spec.shelf[i.slug] ?? spec.shelf.default
    return `{% ${n === 0 ? 'if' : 'elif'} person.interest == "${i.slug}" %}${render(text, welcomeShelfUrl(spec, i.slug))}`
  })
  return `${parts.join('')}{% else %}${render(spec.shelf.default, welcomeShelfUrl(spec, null))}{% endif %}`
}

/** "Ann, you picked..." when a first name is on the profile, "You picked..." when it is not. */
function greet(lead: string): string {
  const lower = lead.charAt(0).toLowerCase() + lead.slice(1)
  return `{% if first_name %}{{ first_name }}, ${lower}{% else %}${lead}{% endif %}`
}

function emphasizedHeadline(spec: WelcomeEmailSpec): string {
  const i = spec.headline.indexOf(spec.emphasis)
  if (!spec.emphasis || i < 0) return spec.headline
  return (
    spec.headline.slice(0, i) +
    `<em class="x-plum" style="font-style:italic;color:${C.plum};">${spec.emphasis}</em>` +
    spec.headline.slice(i + spec.emphasis.length)
  )
}

export interface RenderedWelcomeEmail {
  name: string
  html: string
  text: string
}

export function renderWelcomeEmail(spec: WelcomeEmailSpec): RenderedWelcomeEmail {
  const cell = (bg: string, cls: string) => `bgcolor="${bg}" class="${cls}" style="background-color:${bg};`
  const homeHref = esc(`https://xdipx.com/?utm_source=klaviyo&utm_medium=email&utm_campaign=${spec.flow}&utm_content=${spec.step}`)

  const codeBlock = spec.showCode
    ? `
<tr><td class="x-px x-bg" bgcolor="${C.paper}" align="left" style="background-color:${C.paper};padding:28px 40px 0 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td ${cell(C.coralSoft, 'x-card')}border-radius:14px;padding:22px 24px;">
<p class="x-ink3" style="margin:0 0 6px 0;font-family:${BODY_FONT};font-size:12px;line-height:16px;letter-spacing:0.12em;text-transform:uppercase;color:${C.ink3};">Your code</p>
<p class="x-ink" style="margin:0;font-family:'JetBrains Mono',Menlo,Consolas,monospace;font-size:30px;line-height:36px;letter-spacing:0.08em;color:${C.ink};">${LEAD_OFFER.code}</p>
<p class="x-ink2" style="margin:10px 0 0 0;font-family:${BODY_FONT};font-size:14px;line-height:21px;color:${C.ink2};">${LEAD_OFFER.terms}</p>
</td></tr></table>
</td></tr>`
    : ''

  const shelfParagraph = (text: string, href: string) =>
    `<p class="x-quote x-ink x-serif" style="margin:0;max-width:60ch;font-family:${HEAD_FONT};font-size:20px;line-height:30px;font-style:italic;font-weight:400;color:${C.ink};">${text}</p>` +
    `<!--href:${esc(href)}-->`

  // The button needs the same per-interest href as the paragraph, so the chain is rendered twice:
  // once for the paragraph, once for the button. Klaviyo evaluates both identically.
  const shelfHtml = interestChain(spec, (text, _href) => shelfParagraph(text, _href).replace(/<!--href:[^>]*-->/, ''))
  const buttonHtml = interestChain(spec, (_text, href) => coralButton(esc(href), spec.cta))

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
.x-foot a { color:${C.ink4} !important; text-decoration:underline; }
@media only screen and (max-width:620px) {
  .x-wrap { width:100% !important; }
  .x-px { padding-left:24px !important; padding-right:24px !important; }
  .x-dek { font-size:26px !important; line-height:32px !important; }
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

<tr><td class="x-px x-bg" bgcolor="${C.paper}" align="left" style="background-color:${C.paper};padding:14px 40px 0 40px;">
<h1 class="x-dek x-ink x-serif" style="margin:0;font-family:${HEAD_FONT};font-size:32px;line-height:38px;font-weight:400;letter-spacing:-0.01em;color:${C.ink};">${emphasizedHeadline(spec)}</h1>
</td></tr>

<tr><td class="x-px x-bg" bgcolor="${C.paper}" align="left" style="background-color:${C.paper};padding:24px 40px 0 40px;">
<p class="x-ink2" style="margin:0;max-width:60ch;font-family:${BODY_FONT};font-size:17px;line-height:27px;color:${C.ink2};">${greet(spec.lead)}</p>
</td></tr>
${codeBlock}
<tr><td class="x-px x-bg" bgcolor="${C.paper}" align="left" style="background-color:${C.paper};padding:24px 40px 0 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="x-rule x-bg" bgcolor="${C.paper}" style="background-color:${C.paper};border-left:2px solid ${C.line3};padding:2px 0 2px 20px;">
${shelfHtml}
</td></tr></table>
</td></tr>

<tr><td class="x-px x-bg" bgcolor="${C.paper}" align="left" style="background-color:${C.paper};padding:24px 40px 0 40px;">
<p class="x-ink2" style="margin:0;max-width:60ch;font-family:${BODY_FONT};font-size:17px;line-height:27px;color:${C.ink2};">${spec.closer}</p>
</td></tr>

<tr><td class="x-px x-bg" bgcolor="${C.paper}" align="center" style="background-color:${C.paper};padding:36px 40px 0 40px;">
${buttonHtml}
</td></tr>

<tr><td class="x-px x-bg" bgcolor="${C.paper}" align="left" style="background-color:${C.paper};padding:32px 40px 36px 40px;">
<p class="x-ink3" style="margin:0;font-family:${BODY_FONT};font-size:14px;line-height:21px;color:${C.ink3};">${spec.discreetLine}</p>
</td></tr>

<tr><td class="x-px x-bg" bgcolor="${C.paper}" style="background-color:${C.paper};padding:0 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="x-rule x-bg" bgcolor="${C.paper}" height="1" style="background-color:${C.paper};height:1px;line-height:1px;font-size:1px;border-top:1px solid ${C.line};">&nbsp;</td></tr></table>
</td></tr>

<tr><td class="x-px x-bg" bgcolor="${C.paper}" align="left" style="background-color:${C.paper};padding:24px 40px 40px 40px;">
<p class="x-ink3" style="margin:0 0 10px 0;font-family:${BODY_FONT};font-size:13px;line-height:20px;color:${C.ink4};">Questions go to <a href="mailto:hello@xdipx.com" class="x-ink3" style="color:${C.ink4};text-decoration:underline;">hello@xdipx.com</a>. Emma is an AI guide; she works from the specs and the reviews, and has never held the product.</p>
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

  const plain = (s: string): string => s.replace(/&rsquo;/g, "'").replace(/&amp;/g, '&')
  const textChain = interestChain(spec, (text, href) => `${plain(text)}\n\n${spec.cta} ${href}`)
  const text = [
    'xdipx',
    '',
    plain(spec.headline),
    '',
    greet(plain(spec.lead)),
    '',
    ...(spec.showCode ? [`Your code: ${LEAD_OFFER.code}`, LEAD_OFFER.terms, ''] : []),
    textChain,
    '',
    plain(spec.closer),
    '',
    plain(spec.discreetLine),
    '',
    'Questions go to hello@xdipx.com. Emma is an AI guide; she works from the specs and the reviews, and has never held the product.',
    'xdipx, {{ organization.full_address }}',
    "{% unsubscribe 'Unsubscribe' %}",
  ].join('\n')

  return { name: welcomeTemplateName(spec), html, text }
}

export function renderAllWelcomeEmails(flow?: WelcomeFlowSlug): RenderedWelcomeEmail[] {
  return (flow ? welcomeEmailsFor(flow) : WELCOME_EMAILS).map(renderWelcomeEmail)
}

// ─── Flow definition (paid-leads family only) ─────────────────────────────

export interface WelcomeFlowBuildContext {
  /** Klaviyo list id the flow triggers on (KLAVIYO_LIST_ID_PAID_LEADS). */
  listId: string
  /** Metric id of Placed Order, for the "has not ordered" filter; null drops the filter. */
  placedOrderMetricId: string | null
  /** Klaviyo template id per WelcomeEmailSpec.key. */
  templateIds: Record<string, string>
  fromEmail: string
  fromLabel: string
}

/**
 * Create Flow body for the paid-leads welcome. List trigger, immediate first
 * email, day-3 second email, and the zero-Placed-Order filter so a lead who
 * bought on the first click is not nudged again. No status field: the API
 * creates every flow as a draft, and nothing here can set it live.
 */
export function buildWelcomeFlowPayload(ctx: WelcomeFlowBuildContext): Record<string, unknown> {
  const emails = welcomeEmailsFor('paid-leads-welcome')
  const actions: Record<string, unknown>[] = []
  let prevHours = 0
  emails.forEach((spec, i) => {
    const emailId = `email-${i + 1}`
    const gap = spec.delayHours - prevHours
    prevHours = spec.delayHours
    const nextEmailIndex = i + 1 < emails.length ? i + 2 : null
    if (gap > 0) {
      const useDays = gap % 24 === 0
      actions.push({
        temporary_id: `delay-${i + 1}`,
        type: 'time-delay',
        links: { next: emailId },
        data: { unit: useDays ? 'days' : 'hours', value: useDays ? gap / 24 : gap, secondary_value: 0, timezone: 'profile', delay_until_time: null, delay_until_weekdays: null },
      })
    }
    actions.push({
      temporary_id: emailId,
      type: 'send-email',
      links: { next: nextEmailIndex ? `delay-${nextEmailIndex}` : null },
      data: {
        message: {
          name: `${WELCOME_FLOW_NAMES['paid-leads-welcome']} ${spec.key}`,
          subject_line: spec.subject,
          preview_text: spec.preview.replace(/&rsquo;/g, '’'),
          from_email: ctx.fromEmail,
          from_label: ctx.fromLabel,
          reply_to_email: ctx.fromEmail,
          smart_sending_enabled: i > 0,
          transactional: false,
          add_tracking_params: true,
          template_id: ctx.templateIds[spec.key],
        },
      },
    })
  })
  const definition: Record<string, unknown> = {
    triggers: [{ type: 'list', id: ctx.listId }],
    entry_action_id: actions[0]!['temporary_id'],
    actions,
  }
  if (ctx.placedOrderMetricId) {
    definition['profile_filter'] = {
      condition_groups: [
        {
          conditions: [
            {
              type: 'profile-metric',
              metric_id: ctx.placedOrderMetricId,
              measurement: 'count',
              measurement_filter: { type: 'numeric', operator: 'equals', value: 0 },
              timeframe_filter: { type: 'date', operator: 'in-the-last', quantity: 30, unit: 'day' },
              metric_filters: null,
            },
          ],
        },
      ],
    }
  }
  return { data: { type: 'flow', attributes: { name: WELCOME_FLOW_NAMES['paid-leads-welcome'], definition } } }
}

export { CTA_WHITELIST }

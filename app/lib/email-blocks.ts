/**
 * Daily promo email block library (ticket #14998; owner direction
 * 2026-10-12, routine docs docs/store-team/routine-email-daily.md to
 * follow). Pure render functions, no server imports, so unit tests and the
 * future daily-email assembler can both use them.
 *
 * Reuses the table-based 600px system, v3 tokens, dark-mode handling and
 * bulletproof coral button from email-design-system.ts (itself extracted
 * from klaviyo-flow-templates.ts in this same ticket) rather than forking
 * them. Every block is a self-contained table snippet (`<tr>...</tr>` or a
 * nested `<table role="presentation">`), meant to be composed inside the
 * outer 600px wrapper table the daily email assembler builds.
 *
 * Every image carries an absolute https URL, an explicit width, and alt
 * text. No block emits <svg> or <link>; raster images and inline <style>
 * only, same discipline as the flow emails.
 */
import { CTA_WHITELIST, type CtaLabel } from './klaviyo-flow-templates'
import { EMAIL_BODY_FONT as BODY_FONT, EMAIL_COLORS as C, EMAIL_HEAD_FONT as HEAD_FONT, coralButton } from './email-design-system'

export { CTA_WHITELIST }
export type { CtaLabel }

/** The raster logo pair rasterized from public/og/logo.svg (ticket #14998,
 *  scripts/gen-email-logo.ts). Square, DISPLAY_WIDTH on screen, @2x for retina. */
export const EMAIL_LOGO_DISPLAY_WIDTH = 160
export const EMAIL_LOGO_URL = 'https://xdipx.com/email/xdipx-logo@2x.png' as const

const cell = (bg: string, cls: 'x-bg' | 'x-card' = 'x-bg') => `bgcolor="${bg}" class="${cls}" style="background-color:${bg};`

/** Header: the wordmark as a raster image, linked home. One per email. */
export function headerBlock(homeHref = 'https://xdipx.com/'): string {
  return `<tr><td class="x-px" ${cell(C.paper)}padding:28px 40px 22px 40px;" align="left">
<a href="${homeHref}" target="_blank" style="text-decoration:none;"><img src="${EMAIL_LOGO_URL}" width="${EMAIL_LOGO_DISPLAY_WIDTH}" height="${EMAIL_LOGO_DISPLAY_WIDTH}" alt="xdipx" style="display:block;border:0;"></a>
</td></tr>`
}

export interface HeroBlockOpts {
  productName: string
  headline: string
  imageUrl: string
  href: string
  cta: CtaLabel
}

/** Hero: one featured product, full-width image, headline and the one CTA button. */
export function heroBlock(opts: HeroBlockOpts): string {
  return `<tr><td ${cell(C.paper2, 'x-card')}line-height:0;font-size:0;">
<a href="${opts.href}" target="_blank" style="text-decoration:none;"><img src="${opts.imageUrl}" width="600" alt="${opts.productName}" style="display:block;width:100%;max-width:100%;height:auto;border:0;"></a>
</td></tr>
<tr><td class="x-px" ${cell(C.paper)}padding:32px 40px 0 40px;" align="left">
<h1 class="x-ink x-serif" style="margin:0;font-family:${HEAD_FONT};font-size:30px;line-height:36px;font-weight:400;letter-spacing:-0.01em;color:${C.ink};">${opts.headline}</h1>
</td></tr>
<tr><td class="x-px" ${cell(C.paper)}padding:24px 40px 0 40px;" align="center">
${coralButton(opts.href, opts.cta)}
</td></tr>`
}

export interface GridItem {
  name: string
  href: string
  imageUrl: string
}

/** Shared two-column product grid, used by both newInGridBlock and dealsBlock. */
function productGrid<T extends GridItem>(items: T[], badge?: (item: T) => string | undefined): string {
  const colWidth = 260
  const rows: string[] = []
  for (let i = 0; i < items.length; i += 2) {
    const pair = items.slice(i, i + 2)
    const tds = pair.map((item) => {
      const b = badge?.(item)
      return `<td width="${colWidth}" valign="top" ${cell(C.paper)}padding:0 10px 24px 10px;">
<a href="${item.href}" target="_blank" style="text-decoration:none;"><img src="${item.imageUrl}" width="${colWidth}" alt="${item.name}" style="display:block;width:100%;max-width:100%;height:auto;border:0;"></a>
${b ? `<p style="margin:10px 0 2px 0;font-family:${BODY_FONT};font-size:12px;line-height:16px;font-weight:600;letter-spacing:0.02em;text-transform:uppercase;color:${C.coral};">${b}</p>` : ''}
<a href="${item.href}" target="_blank" style="text-decoration:none;"><p style="margin:${b ? '2px' : '10px'} 0 0 0;font-family:${BODY_FONT};font-size:15px;line-height:20px;color:${C.ink};">${item.name}</p></a>
</td>`
    })
    // Odd item count: pad the row with an empty cell rather than stretching the last image.
    if (pair.length === 1) tds.push(`<td width="${colWidth}" ${cell(C.paper)}">&nbsp;</td>`)
    rows.push(`<tr>${tds.join('')}</tr>`)
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}</table>`
}

/** New-in grid: a plain two-column product grid, no badges. */
export function newInGridBlock(items: GridItem[]): string {
  return `<tr><td class="x-px" ${cell(C.paper)}padding:32px 40px 0 40px;">
${productGrid(items)}
</td></tr>`
}

export interface DealItem extends GridItem {
  /** Free-form badge text (e.g. "Today's pick"). Never a bare price or a countdown. */
  badge?: string
}

/** Deals: the same grid with an optional badge line per item. */
export function dealsBlock(items: DealItem[]): string {
  return `<tr><td class="x-px" ${cell(C.paper)}padding:32px 40px 0 40px;">
${productGrid(items, (item) => item.badge)}
</td></tr>`
}

export interface SeasonalBlockOpts {
  headline: string
  body: string
  imageUrl: string
  href: string
  cta: CtaLabel
}

/** Seasonal: a themed banner (imagery + headline + body + CTA), distinct from the hero. */
export function seasonalBlock(opts: SeasonalBlockOpts): string {
  return `<tr><td ${cell(C.paper2, 'x-card')}line-height:0;font-size:0;">
<a href="${opts.href}" target="_blank" style="text-decoration:none;"><img src="${opts.imageUrl}" width="600" alt="${opts.headline}" style="display:block;width:100%;max-width:100%;height:auto;border:0;"></a>
</td></tr>
<tr><td class="x-px" ${cell(C.paper)}padding:28px 40px 0 40px;" align="left">
<h2 class="x-ink x-serif" style="margin:0;font-family:${HEAD_FONT};font-size:24px;line-height:30px;font-weight:400;color:${C.ink};">${opts.headline}</h2>
<p style="margin:12px 0 0 0;max-width:60ch;font-family:${BODY_FONT};font-size:16px;line-height:24px;color:${C.ink2};">${opts.body}</p>
</td></tr>
<tr><td class="x-px" ${cell(C.paper)}padding:20px 40px 0 40px;" align="center">
${coralButton(opts.href, opts.cta)}
</td></tr>`
}

/**
 * Your Add-ons: Klaviyo profile-property-driven cross-sell, one `{% if %}`
 * guard per numbered slot (profile.xdipx_addon_1/2/3_{handle,title,image,url,why}),
 * headline switching on profile.xdipx_addons_kind (owned|generic). A profile
 * with no add-on properties set renders nothing from this block.
 */
export function yourAddOnsBlock(): string {
  const slot = (n: 1 | 2 | 3): string => {
    const p = (field: string) => `profile.xdipx_addon_${n}_${field}`
    return `{% if ${p('handle')} %}<td width="186" valign="top" ${cell(C.paper)}padding:0 8px 20px 8px;">
<a href="{{ ${p('url')} }}" target="_blank" style="text-decoration:none;"><img src="{{ ${p('image')} }}" width="186" alt="{{ ${p('title')} }}" style="display:block;width:100%;max-width:100%;height:auto;border:0;"></a>
<p style="margin:8px 0 0 0;font-family:${BODY_FONT};font-size:14px;line-height:19px;color:${C.ink};">{{ ${p('title')} }}</p>
<p style="margin:2px 0 0 0;font-family:${BODY_FONT};font-size:13px;line-height:18px;color:${C.ink3};">{{ ${p('why')} }}</p>
</td>{% endif %}`
  }
  return `{% if profile.xdipx_addon_1_handle or profile.xdipx_addon_2_handle or profile.xdipx_addon_3_handle %}
<tr><td class="x-px" ${cell(C.paper)}padding:32px 40px 0 40px;" align="left">
<p class="x-ink x-serif" style="margin:0 0 16px 0;font-family:${HEAD_FONT};font-size:20px;line-height:26px;color:${C.ink};">{% if profile.xdipx_addons_kind == "owned" %}More for what you already own{% else %}Pairs well with it{% endif %}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${slot(1)}${slot(2)}${slot(3)}</tr></table>
</td></tr>
{% endif %}`
}

/** Emma note: one short paragraph in the Emma voice, set as a quote. */
export function emmaNoteBlock(note: string): string {
  return `<tr><td class="x-px" ${cell(C.paper)}padding:28px 40px 0 40px;" align="left">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="border-left:2px solid ${C.line3};padding:2px 0 2px 20px;">
<p class="x-ink x-serif" style="margin:0;max-width:60ch;font-family:${HEAD_FONT};font-size:18px;line-height:27px;font-style:italic;color:${C.ink};">${note}</p>
</td></tr></table>
</td></tr>`
}

/** Footer: unsubscribe, preference management and the physical address, same tags the flow emails use. */
export function footerBlock(): string {
  return `<tr><td class="x-px" ${cell(C.paper)}padding:0 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="x-rule" height="1" ${cell(C.paper)}height:1px;line-height:1px;font-size:1px;border-top:1px solid ${C.line};">&nbsp;</td></tr></table>
</td></tr>
<tr><td class="x-px" ${cell(C.paper)}padding:24px 40px 40px 40px;" align="left">
<p class="x-ink3" style="margin:0 0 10px 0;font-family:${BODY_FONT};font-size:13px;line-height:20px;color:${C.ink4};">Questions go to <a href="mailto:hello@xdipx.com" style="color:${C.ink4};text-decoration:underline;">hello@xdipx.com</a>.</p>
<p class="x-ink3" style="margin:0 0 10px 0;font-family:${BODY_FONT};font-size:13px;line-height:20px;color:${C.ink4};">xdipx &middot; {{ organization.full_address }}</p>
<p class="x-ink3 x-foot" style="margin:0;font-family:${BODY_FONT};font-size:13px;line-height:20px;color:${C.ink4};">{% unsubscribe 'Unsubscribe' %} &middot; {% manage_preferences 'Email preferences' %}</p>
</td></tr>`
}

/**
 * Shared primitives for every HTML email xdipx sends: the table-based 600px
 * system, the flattened v3 color tokens, the font stacks, dark-mode handling
 * and the bulletproof coral button. Originally lived only in
 * klaviyo-flow-templates.ts (the five lifecycle flow emails); extracted here
 * (ticket #14998) so the daily promo email block library
 * (email-blocks.ts) reuses the exact same system rather than forking it.
 *
 * Pure string functions, no server imports, so unit tests and setup scripts
 * can both use it.
 */

export const EMAIL_HEAD_FONT = "Newsreader, Georgia, 'Times New Roman', serif"
export const EMAIL_BODY_FONT = "'DM Sans', Arial, Helvetica, sans-serif"
/** Mirrors the brand's `font-mono` token (JetBrains Mono), kicker-style labels only. */
export const EMAIL_MONO_FONT = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"

/** Flattened v3 tokens (app/app.css @theme) for light-mode email clients. */
export const EMAIL_COLORS = {
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
  /** v3 `plum-soft` tint, used for the lux-tier card in goodBetterBestBlock. */
  plumSoft: '#F3E8FB',
} as const

/** Dark-mode palette, used only where a client asks for it (Apple Mail, iOS Mail, Outlook.com). */
export const EMAIL_DARK_COLORS = {
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
 * Bulletproof coral button. Three layers, each for a client that ignores the
 * others:
 *  - Outlook for Windows gets a VML roundrect (it cannot pad or round an <a>).
 *  - Gmail's dark mode repaints background colours but not background images,
 *    so the cell and the link carry the coral as a one-colour image fill as well
 *    as bgcolor. It renders flat, no visible gradient. The label is white,
 *    which Gmail leaves alone (it lightens dark text, it does not darken light).
 */
export function coralButton(href: string, label: string): string {
  const fill = `background-color:${EMAIL_COLORS.coral};background-image:linear-gradient(${EMAIL_COLORS.coral},${EMAIL_COLORS.coral});`
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
<tr><td align="center" bgcolor="${EMAIL_COLORS.coral}" class="x-btn" style="${fill}border-radius:999px;mso-padding-alt:0;">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:52px;v-text-anchor:middle;width:260px;" arcsize="50%" stroke="f" fillcolor="${EMAIL_COLORS.coral}"><w:anchorlock/><center style="color:#FFFFFF;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${label}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${href}" target="_blank" class="x-btn-a" style="display:inline-block;${fill}color:#FFFFFF;font-family:${EMAIL_BODY_FONT};font-size:16px;line-height:20px;font-weight:600;letter-spacing:0.01em;text-decoration:none;padding:16px 36px;border-radius:999px;mso-hide:all;">${label}</a><!--<![endif]-->
</td></tr>
</table>`
}

/** Hidden preheader filler. The sending platform injects the message's preview
 * text ahead of the body; this run of zero-width joiners stops the masthead
 * and headline from trailing into the inbox snippet after it. */
export const EMAIL_PREHEADER_FILLER = '&#8199;&#65279;&#847; '.repeat(60)

/** The one shared `<style>` block every xdipx email head carries: base reset,
 * mobile breakpoints and the dark-mode overrides for the classes blocks use
 * (`x-bg`, `x-card`, `x-ink`, `x-ink2`, `x-ink3`, `x-plum`, `x-rule`, `x-foot`). */
export function emailHeadStyle(): string {
  return `<style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
body { margin:0 !important; padding:0 !important; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
table, td { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; }
.x-foot a { color:${EMAIL_COLORS.ink4} !important; text-decoration:underline; }
@media only screen and (max-width:620px) {
  .x-wrap { width:100% !important; }
  .x-px { padding-left:24px !important; padding-right:24px !important; }
}
@media only screen and (max-width:480px) {
  .x-stack { display:block !important; width:100% !important; padding:0 0 16px 0 !important; }
}
</style>
<style>
@media (prefers-color-scheme: dark) {
  .x-bg { background-color:${EMAIL_DARK_COLORS.ground} !important; }
  .x-card { background-color:${EMAIL_DARK_COLORS.card} !important; }
  .x-ink { color:${EMAIL_DARK_COLORS.text} !important; }
  .x-ink2 { color:${EMAIL_DARK_COLORS.text2} !important; }
  .x-ink3 { color:${EMAIL_DARK_COLORS.text3} !important; }
  .x-plum { color:${EMAIL_DARK_COLORS.plum} !important; }
  .x-rule { border-color:${EMAIL_DARK_COLORS.line} !important; }
  .x-foot a { color:${EMAIL_DARK_COLORS.text3} !important; }
}
[data-ogsb] .x-bg { background-color:${EMAIL_DARK_COLORS.ground} !important; }
[data-ogsb] .x-card { background-color:${EMAIL_DARK_COLORS.card} !important; }
[data-ogsc] .x-ink { color:${EMAIL_DARK_COLORS.text} !important; }
[data-ogsc] .x-ink2 { color:${EMAIL_DARK_COLORS.text2} !important; }
[data-ogsc] .x-ink3 { color:${EMAIL_DARK_COLORS.text3} !important; }
[data-ogsc] .x-plum { color:${EMAIL_DARK_COLORS.plum} !important; }
</style>`
}

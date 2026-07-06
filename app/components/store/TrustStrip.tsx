/**
 * 1b — Trust & discretion strip.
 *
 * Entirely shell: copy is a fixed brand fact, never a CMS slot. Always-on,
 * rendered directly under the 1a headliner. A second, lighter "footer echo"
 * variant repeats the same facts in one ink-4 line late in the page / footer.
 *
 * No interaction states, no motion — a static informational strip. Rendered
 * outside NO_REVEAL machinery entirely (it isn't a ContentBlock; StorefrontHome
 * mounts it directly), but visually it should never animate in, so it is never
 * wrapped in <Reveal>.
 */

const MONO = { fontFamily: 'var(--font-mono)' } as const
const BODY = { fontFamily: 'var(--font-body)' } as const

interface Claim {
  bold: string
  rest: string
}

const CLAIMS: Claim[] = [
  { bold: 'Plain brown box.', rest: " Nothing printed on it." },
  { bold: "Your statement reads XDIPX.", rest: " That's all it says." },
  { bold: 'Secure checkout.', rest: ' Encrypted end to end.' },
]

/** Decorative sage stroke icons — box, card, padlock. aria-hidden, no labels. */
function BoxIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 8l-9-5-9 5 9 5 9-5Z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </svg>
  )
}

function CardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

const ICONS = [BoxIcon, CardIcon, LockIcon]

export function TrustStrip() {
  return (
    <section className="border-y border-line bg-paper-2">
      {/* 375px: stack vertically. Desktop: single row, dividers between claims. */}
      <div className="mx-auto flex max-w-[1320px] flex-col gap-2.5 px-5 py-3.5 sm:mx-auto md:flex-row md:items-center md:justify-between md:gap-4 md:px-8 md:py-[13px]">
        {CLAIMS.map((claim, i) => {
          const Icon = ICONS[i]!
          return (
            <div key={claim.bold} className="flex items-center gap-2.5 md:contents">
              <span className="text-sage shrink-0" aria-hidden="true">
                <Icon />
              </span>
              <p className="text-[12px] leading-snug text-ink-2 md:text-[12.5px]" style={BODY}>
                <span className="text-ink">{claim.bold}</span>
                {claim.rest}
              </p>
              {i < CLAIMS.length - 1 && (
                <span className="hidden h-5 w-px bg-line md:block" aria-hidden="true" />
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** Footer-adjacent echo — one ink-4 line, dot-separated, XDIPX set in mono. */
export function TrustStripFooterEcho() {
  return (
    <div className="border-t border-line bg-paper">
      <p
        className="mx-auto max-w-[1320px] px-8 py-3 text-center text-[11.5px] text-ink-4"
        style={BODY}
      >
        Plain box, no logo{' '}
        <span aria-hidden="true">·</span>{' '}
        card statement reads{' '}
        <span className="text-ink-3" style={{ ...MONO, fontSize: '10.5px', letterSpacing: '0.08em' }}>
          XDIPX
        </span>{' '}
        <span aria-hidden="true">·</span>{' '}
        secure checkout
      </p>
    </div>
  )
}

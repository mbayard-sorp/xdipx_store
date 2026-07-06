/**
 * 1h — Proof chip (embeddable variant of Honest proof).
 *
 * Sage heart + short verbatim phrase + "verified buyer" provenance. Embeds in
 * 1c rail cards / PDP buy box. No interaction states, no motion — static.
 * Chips take phrases <=6 words only (caller's responsibility to curate).
 */

const DISPLAY_ITALIC = { fontFamily: 'var(--font-display)', fontStyle: 'italic' } as const
const BODY = { fontFamily: 'var(--font-body)' } as const

interface ProofChipProps {
  /** Short verbatim quote phrase, e.g. "worth every penny". Rendered with quotes. */
  phrase: string
  className?: string
}

export function ProofChip({ phrase, className = '' }: ProofChipProps) {
  return (
    <span
      className={`inline-flex items-center gap-[7px] rounded-full border border-[rgba(26,20,24,0.12)] bg-paper px-[13px] py-[7px] ${className}`}
    >
      <span className="text-[12px] text-sage" aria-hidden="true">♥</span>
      <span className="text-[13px] text-ink-2" style={DISPLAY_ITALIC}>
        &ldquo;{phrase}&rdquo;
      </span>
      <span className="text-[10.5px] text-ink-4" style={BODY}>
        verified buyer
      </span>
    </span>
  )
}

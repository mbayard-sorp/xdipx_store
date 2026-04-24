interface EmmaContextualAsideProps {
  text:       string
  className?: string
}

export function EmmaContextualAside({ text, className = '' }: EmmaContextualAsideProps) {
  return (
    <div
      className={`flex items-start gap-3 bg-cream-2/70 border border-line px-4 py-3 rounded-[8px] ${className}`}
      role="note"
      aria-label="A contextual note from Emma"
    >
      <span
        aria-hidden="true"
        className="shrink-0 w-8 h-8 rounded-full bg-coral/10 text-coral flex items-center justify-center text-lg"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        ♥
      </span>
      <p className="text-sm md:text-[15px] text-ink/85 leading-snug pt-1">
        <span className="font-semibold text-ink mr-1" style={{ fontFamily: 'var(--font-display)' }}>
          Emma —
        </span>
        {text}
      </p>
    </div>
  )
}

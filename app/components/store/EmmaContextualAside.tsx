interface EmmaContextualAsideProps {
  text:       string
  className?: string
  avatarUrl?: string
  avatarAlt?: string
}

export function EmmaContextualAside({
  text,
  className = '',
  avatarUrl,
  avatarAlt,
}: EmmaContextualAsideProps) {
  return (
    <div
      className={`flex items-start gap-3 bg-cream-2/70 border border-line px-4 py-3 rounded-[8px] ${className}`}
      role="note"
      aria-label="A contextual note from Emma"
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={avatarAlt || 'Emma'}
          width={32}
          height={32}
          loading="lazy"
          className="shrink-0 w-8 h-8 rounded-full object-cover ring-1 ring-line"
        />
      ) : (
        <span
          aria-hidden="true"
          className="shrink-0 w-8 h-8 rounded-full bg-coral/10 text-coral flex items-center justify-center text-lg"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          ♥
        </span>
      )}
      <p className="text-sm md:text-[15px] text-ink/85 leading-snug pt-1">
        {text}
      </p>
    </div>
  )
}

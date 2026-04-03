import { useState } from 'react'

interface StarRatingProps {
  value: number
  onChange?: (v: number) => void
  size?: 'sm' | 'md' | 'lg'
  readonly?: boolean
}

const SIZE_MAP = {
  sm: 14,
  md: 20,
  lg: 32,
}

export function StarRating({ value, onChange, size = 'md', readonly = false }: StarRatingProps) {
  const [hovered, setHovered] = useState<number | null>(null)
  const px = SIZE_MAP[size]
  const display = hovered ?? value

  return (
    <div
      className="inline-flex items-center gap-0.5"
      role={readonly ? 'img' : 'group'}
      aria-label={readonly ? `${value} out of 5 stars` : 'Select star rating'}
    >
      {[1, 2, 3, 4, 5].map(star => {
        const filled = star <= display
        return (
          <button
            key={star}
            type="button"
            disabled={readonly}
            aria-label={readonly ? undefined : `${star} star${star !== 1 ? 's' : ''}`}
            onClick={() => !readonly && onChange?.(star)}
            onMouseEnter={() => !readonly && setHovered(star)}
            onMouseLeave={() => !readonly && setHovered(null)}
            className={[
              'transition-transform',
              !readonly && 'hover:scale-110 cursor-pointer',
              readonly  && 'cursor-default pointer-events-none',
            ].filter(Boolean).join(' ')}
            style={{ width: px, height: px, padding: 0, background: 'none', border: 'none' }}
          >
            <svg
              width={px}
              height={px}
              viewBox="0 0 24 24"
              fill={filled ? 'url(#starGrad)' : 'none'}
              stroke={filled ? 'none' : '#d1c4c4'}
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="starGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%"   stopColor="#F04E37" />
                  <stop offset="100%" stopColor="#FF8C38" />
                </linearGradient>
              </defs>
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </button>
        )
      })}
    </div>
  )
}

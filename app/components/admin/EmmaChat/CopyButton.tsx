import { useState } from 'react'

interface CopyButtonProps {
  text: string
  className?: string
}

export function CopyButton({ text, className = '' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {
      // Silently fail — clipboard may not be available in all contexts
    })
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={[
        'inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all',
        copied
          ? 'bg-sage/20 text-sage'
          : 'bg-line text-muted hover:bg-line/80 hover:text-ink',
        className,
      ].join(' ')}
      style={{ fontFamily: 'var(--font-display)' }}
    >
      {copied ? (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          Copy reply
        </>
      )}
    </button>
  )
}

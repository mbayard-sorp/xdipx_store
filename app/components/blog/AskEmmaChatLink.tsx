/**
 * Opens the live Emma chat widget (AskEmmaWidget) via the `xdipx:emma:openWith`
 * bridge instead of navigating away. An optional `seed` prepopulates and sends a
 * starter message; omit it to just pop the chat open and let the reader type.
 */
export function AskEmmaChatLink({
  seed,
  className,
  children,
}: {
  seed?: string
  className?: string
  children: React.ReactNode
}) {
  function onClick() {
    if (typeof window === 'undefined') return
    window.dispatchEvent(
      new CustomEvent('xdipx:emma:openWith', { detail: { prompt: seed ?? '' } }),
    )
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  )
}

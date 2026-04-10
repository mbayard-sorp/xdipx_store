import { useEffect, useRef } from 'react'

interface ConfirmDialogProps {
  open: boolean
  titleId: string
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  /** Set to "destructive" to show the confirm button in red instead of gradient */
  variant?: 'default' | 'destructive'
}

/**
 * Accessible confirm dialog.
 * - role="dialog" + aria-modal + aria-labelledby
 * - Focus trapped inside while open
 * - Closes on Escape key
 * - Closes on scrim click
 * Visual style: rounded-2xl + scrim, matching the rest of the account section.
 */
export function ConfirmDialog({
  open,
  titleId,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel  = 'Cancel',
  onConfirm,
  onCancel,
  variant = 'default',
}: ConfirmDialogProps) {
  const dialogRef  = useRef<HTMLDivElement>(null)
  const cancelRef  = useRef<HTMLButtonElement>(null)

  // Focus the cancel button when dialog opens
  useEffect(() => {
    if (open) {
      // Small timeout so the element is visible before focus
      const t = setTimeout(() => cancelRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  // Trap focus inside the dialog
  useEffect(() => {
    if (!open || !dialogRef.current) return

    const el = dialogRef.current
    const focusable = el.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
    )
    const first = focusable[0]
    const last  = focusable[focusable.length - 1]

    function handleTab(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      if (focusable.length === 0) { e.preventDefault(); return }
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last?.focus() }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first?.focus() }
      }
    }

    document.addEventListener('keydown', handleTab)
    return () => document.removeEventListener('keydown', handleTab)
  }, [open])

  if (!open) return null

  return (
    // Scrim
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-charcoal/40 backdrop-blur-sm px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
      aria-hidden="false"
    >
      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 space-y-4"
      >
        <h2
          id={titleId}
          className="text-lg font-bold text-brand-charcoal"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {title}
        </h2>

        {description && (
          <p className="text-sm text-brand-charcoal/70 leading-relaxed">
            {description}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-full text-sm font-semibold text-brand-charcoal bg-brand-mist hover:bg-brand-mist/70 transition-colors"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 py-2.5 rounded-full text-sm font-bold text-white transition-opacity hover:opacity-90 ${
              variant === 'destructive'
                ? 'bg-red-500'
                : 'bg-brand-gradient'
            }`}
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

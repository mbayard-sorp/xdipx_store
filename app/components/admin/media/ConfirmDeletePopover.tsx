/**
 * Confirm-before-delete overlay, extracted from ImageManager so the Social
 * Studio (slides, library) shares the same pattern. `label` names what is
 * removed; `undoHint` tells the owner what recovery exists, because delete
 * must name its consequence (plan section 4).
 */
export function ConfirmDeletePopover({
  onConfirm,
  onCancel,
  label = 'Remove image?',
  confirmLabel = 'Remove',
  undoHint,
}: {
  onConfirm: () => void
  onCancel: () => void
  label?: string
  confirmLabel?: string
  undoHint?: string
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink/60 rounded-xl backdrop-blur-sm" role="alertdialog" aria-label={label}>
      <div className="bg-paper rounded-xl p-3 border border-line text-center w-44">
        <p className="text-xs font-semibold text-ink mb-1">{label}</p>
        {undoHint && <p className="text-[11px] text-ink-3 mb-2">{undoHint}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 min-h-9 text-xs rounded-lg border border-line text-ink-3 hover:bg-paper-2 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 min-h-9 text-xs rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

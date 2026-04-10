import type { ReactNode } from 'react'

interface FieldGroupProps {
  /** The input's id — used for `for` on the label and `aria-describedby` on the input */
  id: string
  label: string
  /** Optional helper text shown below the input */
  helper?: string
  /** Validation / server error text */
  error?: string
  /** Pass the <input>, <select>, or <textarea> as children */
  children: ReactNode
  /** Extra wrapper className */
  className?: string
}

/**
 * Label + control + optional helper + optional error with full aria-describedby wiring.
 * Accepts any control as `children` (input, select, textarea) for maximum flexibility.
 * The child element is responsible for applying its own `id`, `name`, `aria-describedby`,
 * and base styling; this component just wraps and labels.
 *
 * Because we accept arbitrary children we can't inject `aria-describedby` automatically —
 * consumers should pass the helper/error ids returned by the `describedBy` helper below,
 * or simply use the exported `fieldGroupDescribedBy` utility.
 */
export function FieldGroup({
  id,
  label,
  helper,
  error,
  children,
  className,
}: FieldGroupProps) {
  const helperId  = helper ? `${id}-helper`  : undefined
  const errorId   = error  ? `${id}-error`   : undefined

  // Build the describedby string so consumers can apply it to their input.
  // We expose it via data-attr for sibling usage patterns, but the primary
  // mechanism is that consumers call fieldDescribedBy(id, ...) themselves.
  const describedBy = [helperId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="block text-sm font-semibold text-brand-charcoal mb-1"
      >
        {label}
      </label>

      {/* Inject aria-describedby into the child input/select/textarea via a wrapper div
          that holds the helper/error ids. Consumers that want tight a11y should also
          pass aria-describedby={fieldDescribedBy(id, helper, error)} on the control. */}
      <div data-describedby={describedBy}>
        {children}
      </div>

      {helper && !error && (
        <p
          id={helperId}
          className="mt-1 text-xs text-brand-charcoal/50"
        >
          {helper}
        </p>
      )}
      {error && (
        <p
          id={errorId}
          role="alert"
          className="mt-1 text-xs text-red-600"
        >
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * Utility that builds the `aria-describedby` string for an input inside a FieldGroup.
 * Usage: <input aria-describedby={fieldDescribedBy(id, helper, error)} ... />
 */
export function fieldDescribedBy(
  id: string,
  helper: string | undefined,
  error: string | undefined,
): string | undefined {
  const parts: string[] = []
  if (helper) parts.push(`${id}-helper`)
  if (error)  parts.push(`${id}-error`)
  return parts.length > 0 ? parts.join(' ') : undefined
}

/** Shared input class — reuse across AddressForm inputs */
export const inputClass =
  'w-full border border-brand-mist rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-purple/50 bg-white'

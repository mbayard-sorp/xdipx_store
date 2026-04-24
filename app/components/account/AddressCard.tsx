import { Link } from 'react-router'
import type { CustomerAddress } from '~/lib/shopify.server'

interface AddressCardProps {
  address: CustomerAddress
  isDefault: boolean
  onDelete: (id: string) => void
  /** Called when user clicks "Set default" — triggers a fetcher form submit in the parent */
  onSetDefault: (id: string) => void
}

/**
 * Single address card for the /account/addresses list.
 * Displays address lines, default pill, and Edit / Delete / Set default actions.
 */
export function AddressCard({
  address,
  isDefault,
  onDelete,
  onSetDefault,
}: AddressCardProps) {
  // Build a display name from first/last or fall back to empty
  const name = [address.firstName, address.lastName].filter(Boolean).join(' ')

  // Disambiguator for accessible button labels — screen readers navigating
  // by buttons should hear which address each Edit/Delete/Set default acts on.
  const label = name || address.address1 || 'address'

  // Encode the GID for use in the URL (GIDs contain slashes)
  const encodedId = encodeURIComponent(address.id)

  return (
    <div className="bg-white border border-cream-2 rounded-2xl p-5 space-y-3">
      {/* Header row: default pill or empty */}
      <div className="flex items-center justify-between gap-2">
        {isDefault ? (
          <span
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-sage rounded-full px-3 py-1"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            <span aria-hidden="true">●</span> Default
          </span>
        ) : (
          <span />
        )}
      </div>

      {/* Address body */}
      <div className="text-sm text-ink space-y-0.5">
        {name && <p className="font-semibold">{name}</p>}
        {address.company && <p className="text-ink/70">{address.company}</p>}
        {address.formatted.map((line, i) => (
          <p key={i} className={i === 0 ? undefined : 'text-ink/70'}>
            {line}
          </p>
        ))}
        {address.phone && (
          <p className="text-ink/70 pt-1">{address.phone}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-1 text-sm">
        <Link
          to={`/account/addresses/${encodedId}/edit`}
          className="text-sage font-semibold hover:underline"
          aria-label={`Edit address: ${label}`}
        >
          Edit
        </Link>

        <span className="text-ink/20" aria-hidden="true">·</span>

        <button
          type="button"
          onClick={() => onDelete(address.id)}
          className="text-ink/60 hover:text-red-600 font-semibold transition-colors"
          aria-label={`Delete address: ${label}`}
        >
          Delete
        </button>

        {!isDefault && (
          <>
            <span className="text-ink/20" aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => onSetDefault(address.id)}
              className="text-ink/60 hover:text-sage font-semibold transition-colors"
              aria-label={`Set as default address: ${label}`}
            >
              Set default
            </button>
          </>
        )}
      </div>
    </div>
  )
}

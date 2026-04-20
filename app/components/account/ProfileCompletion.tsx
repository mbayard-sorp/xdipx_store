import { Link } from 'react-router'
import type { CustomerProfile } from '~/lib/shopify.server'

interface ProfileCompletionProps {
  customer: CustomerProfile
}

interface Check {
  key: string
  label: string
  to: string
  done: boolean
}

export function ProfileCompletion({ customer }: ProfileCompletionProps) {
  const checks: Check[] = [
    {
      key: 'firstName',
      label: 'Add your first name',
      to: '/account/profile',
      done: !!customer.firstName?.trim(),
    },
    {
      key: 'lastName',
      label: 'Add your last name',
      to: '/account/profile',
      done: !!customer.lastName?.trim(),
    },
    {
      key: 'phone',
      label: 'Add your phone number',
      to: '/account/profile',
      done: !!customer.phone?.trim(),
    },
    {
      key: 'defaultAddress',
      label: 'Add a default address',
      to: '/account/addresses',
      done: customer.defaultAddressId !== null,
    },
    {
      key: 'marketing',
      label: 'Turn on marketing emails',
      to: '/account/preferences',
      done: customer.acceptsMarketing === true,
    },
  ]

  const total = checks.length
  const completed = checks.filter((c) => c.done).length
  const incomplete = checks.filter((c) => !c.done)

  if (incomplete.length === 0) return null

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4">
      <div className="flex items-center justify-between gap-3">
        <h3
          className="text-sm font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Profile completion
        </h3>
        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-cream-2 text-sage inline-flex items-center gap-1.5">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full bg-sage"
            aria-hidden="true"
          />
          {completed}/{total}
        </span>
      </div>
      <ul className="mt-3 space-y-1.5">
        {incomplete.map((c) => (
          <li key={c.key}>
            <Link
              to={c.to}
              className="flex items-center gap-2 text-sm text-ink/60 hover:text-ink transition-colors min-h-[32px]"
            >
              <span
                className="inline-block w-3.5 h-3.5 rounded-full border border-ink/30 shrink-0"
                aria-hidden="true"
              />
              <span>{c.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

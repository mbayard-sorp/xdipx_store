interface TrustItem {
  icon:  React.ReactNode
  label: string
  sub?:  string
}

const TRUST_ITEMS: TrustItem[] = [
  {
    icon:  <LockIcon />,
    label: 'Discreet shipping',
    sub:   'Plain box, no logos',
  },
  {
    icon:  <ShieldIcon />,
    label: 'Secure checkout',
    sub:   'SSL encrypted',
  },
  {
    icon:  <PackageIcon />,
    label: 'Discreet billing',
    sub:   'Nothing obvious on your statement',
  },
  {
    icon:  <HeartIcon />,
    label: 'Returns accepted',
    sub:   'Unopened within 14 days',
  },
  {
    icon:  <TruckIcon />,
    label: 'Ships in 1–2 days',
    sub:   '3–7 days to your door',
  },
]

export function TrustBar() {
  return (
    <div className="bg-white border-y border-brand-mist py-3 px-4">
      <ul className="max-w-6xl mx-auto flex items-center justify-between gap-2 overflow-x-auto scrollbar-hide">
        {TRUST_ITEMS.map(({ icon, label, sub }) => (
          <li
            key={label}
            className="flex items-center gap-2 shrink-0 px-2"
          >
            <span className="text-brand-purple shrink-0" aria-hidden="true">
              {icon}
            </span>
            <div>
              <p
                className="text-brand-charcoal text-xs font-semibold leading-tight whitespace-nowrap"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {label}
              </p>
              {sub && (
                <p className="text-brand-charcoal/50 text-[11px] leading-tight whitespace-nowrap">
                  {sub}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Icons (inline SVG — no icon library dependency) ──────────────────────────

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

function PackageIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  )
}

function HeartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}

function TruckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1" y="3" width="15" height="13" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  )
}

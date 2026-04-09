import type { ReactNode } from 'react'
import type { CustomerProfile } from '~/lib/shopify.server'
import { AccountSidebar } from './AccountSidebar'
import { AccountMobileHeader } from './AccountMobileHeader'

interface AccountShellProps {
  customer: CustomerProfile
  // Kept so the shell can surface session-aware behavior later (e.g. disabling
  // mutation UIs on account-API sessions). Not rendered for Phase 2.
  tokenType: 'storefront' | 'account'
  children: ReactNode
}

export function AccountShell({ customer, children }: AccountShellProps) {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] bg-brand-cream">
      <AccountSidebar customer={customer} />
      <div className="flex-1 flex flex-col min-w-0">
        <AccountMobileHeader customer={customer} />
        <main className="flex-1 px-4 pb-24 pt-4 lg:px-8 lg:py-10">
          <div className="max-w-3xl mx-auto">{children}</div>
        </main>
      </div>
    </div>
  )
}

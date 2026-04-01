import { Outlet, useRouteLoaderData } from 'react-router'
import { Navbar }       from '~/components/store/Navbar'
import { TrustBar }     from '~/components/store/TrustBar'
import { Footer }       from '~/components/store/Footer'
import { CookieConsent } from '~/components/store/CookieConsent'
import type { Cart } from '~/types'

export default function StoreLayout() {
  const root = useRouteLoaderData('root') as { cart?: Cart } | undefined
  const cartCount = root?.cart?.totalQuantity ?? 0

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar cartCount={cartCount} />
      <TrustBar />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <CookieConsent />
    </div>
  )
}

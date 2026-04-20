import { createContext, useContext, useEffect, useMemo } from 'react'
import { useFetcher, useLocation } from 'react-router'
import type { SessionData } from '~/routes/api.session'

export const SESSION_UPDATED_EVENT = 'xdipx:session-updated'

type SessionContextValue = SessionData & {
  isLoaded: boolean
  reload: () => void
}

const DEFAULTS: SessionData = {
  isCustomerLoggedIn: false,
  customerFirstName: null,
  customerIdHash: null,
  heartedProductIds: [],
  wishlistCount: 0,
}

const SessionContext = createContext<SessionContextValue>({
  ...DEFAULTS,
  isLoaded: false,
  reload: () => {},
})

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const fetcher = useFetcher<SessionData>()
  const location = useLocation()

  // Mount + post-auth redirect refreshes.
  // We kick a fetch on mount and again whenever the URL carries a `from=` marker
  // (login/register/logout land here), so the session stays in sync without
  // requiring every auth route to dispatch a manual event.
  useEffect(() => {
    if (fetcher.state === 'idle' && !fetcher.data) {
      fetcher.load('/api/session')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.has('from')) {
      fetcher.load('/api/session')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search])

  useEffect(() => {
    const handler = () => fetcher.load('/api/session')
    window.addEventListener(SESSION_UPDATED_EVENT, handler)
    return () => window.removeEventListener(SESSION_UPDATED_EVENT, handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value = useMemo<SessionContextValue>(() => {
    const data = fetcher.data ?? DEFAULTS
    return {
      ...data,
      isLoaded: !!fetcher.data,
      reload: () => fetcher.load('/api/session'),
    }
  }, [fetcher.data])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  return useContext(SessionContext)
}

export function dispatchSessionUpdated(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(SESSION_UPDATED_EVENT))
}

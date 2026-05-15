/**
 * Discovery state store for the Variant A home page.
 *
 * URL search params are the source of truth:
 *   ?m=Sensual,Bold&a=Us&k=Body-Safe+Silicone&b=80
 *
 * On every change: replaceState the URL AND write localStorage.
 * localStorage key: xdipx.discovery.v1  (14-day TTL via timestamp)
 * On mount: hydrate from URL → fall back to localStorage when URL is empty.
 *
 * NOT named *.client.tsx: RR7 inherits Remix's filename convention that
 * strips *.client modules from the server bundle. We need this module
 * present on both sides so SSR can render <DiscoveryProvider>. Browser-
 * only APIs (localStorage, window) are guarded with typeof checks.
 * No 'use client' directive -- this is React Router v7, not Next.js.
 * No external libs -- plain React hooks only.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import {
  BUDGET_MAX,
  BUDGET_MIN,
  DEFAULT_BUDGET,
  EMPTY_STATE,
  type Audience,
  type DiscoveryState,
  type Matters,
  type Mood,
} from '~/types/discovery'

/* ─── localStorage helpers ──────────────────────────────────────────────── */

const LS_KEY = 'xdipx.discovery.v1'
const LS_SAVED_KEY = 'xdipx.discovery.saved.v1'
const TTL_MS = 14 * 24 * 60 * 60 * 1000 // 14 days

interface PersistedPayload {
  state: DiscoveryState
  savedAt: number
}

function readLS(): DiscoveryState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const parsed: PersistedPayload = JSON.parse(raw)
    if (Date.now() - parsed.savedAt > TTL_MS) {
      localStorage.removeItem(LS_KEY)
      return null
    }
    return parsed.state
  } catch {
    return null
  }
}

function writeLS(state: DiscoveryState) {
  if (typeof window === 'undefined') return
  try {
    const payload: PersistedPayload = { state, savedAt: Date.now() }
    localStorage.setItem(LS_KEY, JSON.stringify(payload))
  } catch { /* storage full — skip */ }
}

export function saveDiscoveryPicks(state: DiscoveryState) {
  if (typeof window === 'undefined') return
  try {
    const payload: PersistedPayload = { state, savedAt: Date.now() }
    localStorage.setItem(LS_SAVED_KEY, JSON.stringify(payload))
  } catch { /* storage full — skip */ }
}

/* ─── URL helpers ────────────────────────────────────────────────────────── */

// Tag vocabularies are dynamic (sourced from Shopify metafields), so the
// URL parser can't validate against a closed list. Trim + length-cap each
// chip and hard-cap how many chips per group can come from the URL so a
// crafted link can't blow up state size.
const MAX_CHIPS_PER_GROUP = 20
const MAX_CHIP_LEN = 80

function cleanChipList(raw: string | null): string[] {
  if (!raw) return []
  return raw.split(',')
    .map(v => v.trim())
    .filter(v => v.length > 0 && v.length <= MAX_CHIP_LEN)
    .slice(0, MAX_CHIPS_PER_GROUP)
}

function readURL(): DiscoveryState | null {
  if (typeof window === 'undefined') return null
  const p = new URLSearchParams(window.location.search)
  const mRaw = p.get('m')
  const aRaw = p.get('a')
  const kRaw = p.get('k')
  const bRaw = p.get('b')

  const mood = cleanChipList(mRaw)
  const audience = cleanChipList(aRaw)
  const matters = cleanChipList(kRaw)
  const bNum = bRaw ? Number(bRaw) : null
  const budget = bNum !== null && Number.isFinite(bNum)
    ? Math.min(BUDGET_MAX, Math.max(BUDGET_MIN, bNum))
    : DEFAULT_BUDGET

  if (mood.length === 0 && audience.length === 0 && matters.length === 0) return null
  return { mood, audience, matters, budget, step: 0 }
}

function writeURL(state: DiscoveryState) {
  if (typeof window === 'undefined') return
  const p = new URLSearchParams()
  if (state.mood.length > 0)     p.set('m', state.mood.join(','))
  if (state.audience.length > 0) p.set('a', state.audience.join(','))
  if (state.matters.length > 0)  p.set('k', state.matters.join(','))
  if (state.budget !== DEFAULT_BUDGET) p.set('b', String(state.budget))
  const qs = p.toString()
  const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
  window.history.replaceState(null, '', newUrl)
}

/* ─── Reducer ────────────────────────────────────────────────────────────── */

type Action =
  | { type: 'TOGGLE_MOOD';     value: Mood }
  | { type: 'TOGGLE_AUDIENCE'; value: Audience }
  | { type: 'TOGGLE_MATTERS';  value: Matters }
  | { type: 'SET_BUDGET';      value: number }
  | { type: 'CLEAR_ALL' }
  | { type: 'HYDRATE';         state: DiscoveryState }

function toggle<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value]
}

function reducer(state: DiscoveryState, action: Action): DiscoveryState {
  switch (action.type) {
    case 'TOGGLE_MOOD':
      return { ...state, mood: toggle(state.mood, action.value) }
    case 'TOGGLE_AUDIENCE':
      return { ...state, audience: toggle(state.audience, action.value) }
    case 'TOGGLE_MATTERS':
      return { ...state, matters: toggle(state.matters, action.value) }
    case 'SET_BUDGET':
      return { ...state, budget: Math.min(BUDGET_MAX, Math.max(BUDGET_MIN, action.value)) }
    case 'CLEAR_ALL':
      return EMPTY_STATE
    case 'HYDRATE':
      return action.state
    default:
      return state
  }
}

/* ─── Context ────────────────────────────────────────────────────────────── */

export interface DiscoveryContextValue {
  state: DiscoveryState
  hasPriorSession: boolean
  toggleMood:         (v: Mood) => void
  toggleAudience:     (v: Audience) => void
  toggleMatters:      (v: Matters) => void
  setBudget:          (v: number) => void
  clearAll:           () => void
}

const DiscoveryContext = createContext<DiscoveryContextValue | null>(null)

export function useDiscovery(): DiscoveryContextValue {
  const ctx = useContext(DiscoveryContext)
  if (!ctx) throw new Error('useDiscovery must be used inside <DiscoveryProvider>')
  return ctx
}

interface DiscoveryProviderProps {
  children: ReactNode
  initialState?: DiscoveryState
}

export function DiscoveryProvider({ children, initialState }: DiscoveryProviderProps) {
  const [state, dispatch] = useReducer(reducer, initialState ?? EMPTY_STATE)
  const hasPriorSessionRef = useRef(false)
  const hydratedRef = useRef(false)

  // Client-only hydration: URL → localStorage → keep SSR default.
  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true

    const fromLS = readLS()
    if (fromLS) hasPriorSessionRef.current = true

    const fromURL = readURL()
    if (fromURL) {
      dispatch({ type: 'HYDRATE', state: fromURL })
    } else if (fromLS) {
      dispatch({ type: 'HYDRATE', state: fromLS })
    }
  }, [])

  // Sync to URL + localStorage after every state change (skipping the initial SSR render).
  useEffect(() => {
    if (!hydratedRef.current) return
    writeURL(state)
    writeLS(state)
  }, [state])

  const toggleMood     = useCallback((v: Mood)     => dispatch({ type: 'TOGGLE_MOOD',     value: v }), [])
  const toggleAudience = useCallback((v: Audience) => dispatch({ type: 'TOGGLE_AUDIENCE', value: v }), [])
  const toggleMatters  = useCallback((v: Matters)  => dispatch({ type: 'TOGGLE_MATTERS',  value: v }), [])
  const setBudget      = useCallback((v: number)   => dispatch({ type: 'SET_BUDGET',      value: v }), [])
  const clearAll       = useCallback(()            => dispatch({ type: 'CLEAR_ALL' }), [])

  return (
    <DiscoveryContext.Provider value={{
      state,
      hasPriorSession: hasPriorSessionRef.current,
      toggleMood,
      toggleAudience,
      toggleMatters,
      setBudget,
      clearAll,
    }}>
      {children}
    </DiscoveryContext.Provider>
  )
}

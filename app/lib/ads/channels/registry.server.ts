/**
 * The channel table (plan §3.2, ADR-018). One row per paid channel in
 * docs/ads-policy.md's platform matrix, with its policy state and its adapter.
 * Adapters resolve from here at call time; there is no boot-time registration.
 *
 * A prohibited channel has adapter: null, and the entry type makes that the
 * only option. Building one takes a re-verified policy row with a date and
 * source plus an owner-codified lane (plan §6), and the type change that
 * comes with it shows up in review.
 */
import type { ChannelAdapter, ChannelCapabilities, ChannelId, PolicyState } from './types'
import { metaAdapter } from './meta/adapter.server'
import { microsoftAdapter } from './microsoft/adapter.server'

interface ChannelBase<Id extends ChannelId = ChannelId> {
  id: Id
  label: string
  /** One line from docs/ads-policy.md's matrix row. */
  policyNote: string
}

export type ChannelEntry =
  | (ChannelBase & { policyState: 'allowed' | 'restricted'; adapter: ChannelAdapter | null })
  | (ChannelBase & { policyState: 'prohibited'; adapter: null })

const CHANNELS: readonly ChannelEntry[] = [
  {
    id: 'meta', label: 'Meta (Facebook, Instagram)', policyState: 'restricted', adapter: metaAdapter,
    policyNote: 'Written policy bars the category; owner-codified strategic lane under gates M1 to M7 (2026-10-03).',
  },
  {
    id: 'microsoft', label: 'Microsoft Advertising', policyState: 'restricted', adapter: microsoftAdapter,
    policyNote: 'Allowed only through the Adult Advertising Program, search text only. Account 188472831 is Pending in the program, so the adapter reads and pulls insights but mutates nothing.',
  },
  {
    id: 'google', label: 'Google Ads', policyState: 'restricted', adapter: null,
    policyNote: 'Moderately restricted sexual merchandise; Search Network only, never Display or Ad Manager.',
  },
  {
    id: 'snap', label: 'Snapchat', policyState: 'restricted', adapter: null,
    policyNote: 'Restricted: non-graphic creative, 18+ targeting.',
  },
  {
    id: 'adult:exoclick', label: 'ExoClick', policyState: 'allowed', adapter: null,
    policyNote: 'Adult network; allowed after traffic-quality vetting. UTMs mandatory.',
  },
  {
    id: 'adult:juicyads', label: 'JuicyAds', policyState: 'allowed', adapter: null,
    policyNote: 'Adult network; allowed after traffic-quality vetting. UTMs mandatory.',
  },
  {
    id: 'adult:trafficjunky', label: 'TrafficJunky', policyState: 'allowed', adapter: null,
    policyNote: 'Adult network; allowed after traffic-quality vetting. UTMs mandatory.',
  },
  {
    id: 'tiktok', label: 'TikTok', policyState: 'prohibited', adapter: null,
    policyNote: 'Sexual products banned in ads. Never proposed.',
  },
  {
    id: 'x', label: 'X', policyState: 'prohibited', adapter: null,
    policyNote: 'Ads and shopping policy ban adult merchandise globally; organic only.',
  },
  {
    id: 'reddit', label: 'Reddit', policyState: 'prohibited', adapter: null,
    policyNote: 'Ads program effectively bars adult products; organic only.',
  },
  {
    id: 'pinterest', label: 'Pinterest', policyState: 'prohibited', adapter: null,
    policyNote: 'Sex toys and sexual enhancement products banned in ads.',
  },
]

const BY_ID = new Map<string, ChannelEntry>(CHANNELS.map(c => [c.id, c]))

/** The entry for a channel, or null for an id the table does not list. Never throws. */
export function getChannel(id: ChannelId | string): ChannelEntry | null {
  return BY_ID.get(id) ?? null
}

export interface ChannelListing {
  id: ChannelId
  label: string
  policyState: PolicyState
  policyNote: string
  hasAdapter: boolean
  capabilities: ChannelCapabilities | null
}

export function listChannels(): ChannelListing[] {
  return CHANNELS.map(c => ({
    id: c.id,
    label: c.label,
    policyState: c.policyState,
    policyNote: c.policyNote,
    hasAdapter: c.adapter !== null,
    capabilities: c.adapter?.capabilities ?? null,
  }))
}

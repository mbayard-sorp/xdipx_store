/**
 * GA4 measurement-ID resolution with env-first, DB-fallback strategy.
 *
 * Resolution priority:
 *   1. `GA4_MEASUREMENT_ID` env var (preferred — no DB hit)
 *   2. `pipeline_settings.ga4MeasurementId` row, cached 5 minutes in KV+memory
 *   3. Empty string (GA4 disabled)
 *
 * The admin UI at `/admin/settings` writes to (2); changing the value calls
 * `invalidateGa4Cache()` from the admin action so the new ID is picked up on
 * the very next SSR render rather than waiting for the TTL.
 */
import { eq } from 'drizzle-orm'
import { db } from './db.server'
import { pipelineSettings } from '../../db/schema'
import { cached, invalidateCache, kvDel } from './kv.server'

const KV_KEY = 'ga4:measurementId'
const TTL_SECONDS = 300

export type Ga4Source = 'env' | 'db' | 'none'

export interface Ga4Resolution {
  id:     string
  source: Ga4Source
}

async function fetchFromDb(): Promise<string> {
  const rows = await db
    .select({ value: pipelineSettings.value })
    .from(pipelineSettings)
    .where(eq(pipelineSettings.key, 'ga4MeasurementId'))
    .limit(1)
  return rows[0]?.value?.trim() ?? ''
}

export async function resolveGa4(): Promise<Ga4Resolution> {
  const envId = (process.env['GA4_MEASUREMENT_ID'] ?? '').trim()
  if (envId) return { id: envId, source: 'env' }
  const dbId = await cached(KV_KEY, TTL_SECONDS, fetchFromDb)
  if (dbId) return { id: dbId, source: 'db' }
  return { id: '', source: 'none' }
}

export async function getGa4MeasurementId(): Promise<string> {
  const { id } = await resolveGa4()
  return id
}

export async function invalidateGa4Cache(): Promise<void> {
  invalidateCache(KV_KEY)
  await kvDel(KV_KEY)
}

/**
 * Reads the two ExoClick operator settings (ticket #19412). A missing row
 * reads as off and as a zero cap, so a fresh database allows no write and no
 * spend. Owner-written only; nothing in the code base writes these rows.
 *
 * To turn the path on, the owner sets, through the same audited valve write
 * the other ads valves use (setPipelineSettingAudited, actor owner):
 *   exoclick_operator_enabled = true
 *   exoclick_total_cap_cents  = 13500   (for example, $135)
 */
import { getPipelineSetting } from '~/lib/feed-processor.server'
import { EXO_SETTING_KEYS, parseExoBool, parseExoCapCents, type ExoOperatorSettings } from './operator-core'

export async function getExoOperatorSettings(): Promise<ExoOperatorSettings> {
  const [enabled, cap] = await Promise.all([
    getPipelineSetting(EXO_SETTING_KEYS.operatorEnabled),
    getPipelineSetting(EXO_SETTING_KEYS.totalCapCents),
  ])
  return { operatorEnabled: parseExoBool(enabled), totalCapCents: parseExoCapCents(cap) }
}

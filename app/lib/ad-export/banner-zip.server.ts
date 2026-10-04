/**
 * Banner zip for the lanes with no bulk importer we use: adult networks
 * (ExoClick, JuicyAds), newsletter sponsors, owned channels and Snap. A zip with
 * each creative's PNG named <lane>-<idea>-<format>.png, copy.txt (slogan,
 * headlines, body and the UTM'd destination per creative), README.txt (the
 * register tier and the imagery ceiling that applied) and manifest.json.
 * Handing the zip to a network or a sponsor is a manual, owner-side step.
 */
import { zipSync, strToU8 } from 'fflate'
import { ExportRefusal, withUtms, type ExportBuild, type ExportCreative, type ExportIdea } from './common'
import { assertCreativesExportable, assertSingleLane } from './policy'

interface LaneRules { label: string; register: string; ceiling: string; handoff: string }

export const LANE_RULES: Readonly<Record<string, LaneRules>> = {
  adult: {
    label: 'Adult ad network',
    register: 'Copy runs at register 9. Register 10 is pending the owner codify, so these lines are held at 9.',
    ceiling: 'The nudity definition is the only imagery ceiling: no visible female nipples, labia, penis or anus. Every banner passed the vision gate against that stop list.',
    handoff: 'Upload each PNG in the network dashboard (ExoClick, JuicyAds) and paste its destination URL exactly as given in copy.txt. The utm_content on each URL is the attribution key.',
  },
  newsletter: {
    label: 'Newsletter sponsor',
    register: 'Copy runs on the paid line, register 3-4.',
    ceiling: 'Paid imagery line: object-first, no on-skin frame, no visible nipple of any sex. Sponsored placements carry the sponsor disclosure at send.',
    handoff: 'Send the PNGs and copy.txt to the sponsor contact. Ask them to use each destination URL exactly as given.',
  },
  owned: {
    label: 'Owned channel',
    register: 'Copy runs at register 9 on owned channels.',
    ceiling: 'The ceiling in docs/store-team/instagram-campaigns.md section 3.2a with the on-skin treatment in 3.2c.',
    handoff: 'Use the PNGs on site, in email or in opted-in SMS. Keep the destination URLs as given.',
  },
  snap: {
    label: 'Snapchat',
    register: 'Copy is non-graphic, register 3-4, 18+.',
    ceiling: 'Non-graphic object or typographic creative only. No nudity. No bulk importer is used for Snap: upload the PNG in Ads Manager by hand and set the web view URL from copy.txt.',
    handoff: 'In Snap Ads Manager create a Snap Ad per PNG, paste the destination URL, leave the campaign paused until you flip it.',
  },
}

export interface ZipBuildInput {
  ideas: Record<number, ExportIdea>
  creatives: ExportCreative[]
  fetchBytes: (url: string) => Promise<Buffer>
  now?: Date
}

export interface ZipManifestEntry {
  creativeId: number
  ideaId: number
  lane: string
  format: string
  width: number | null
  height: number | null
  file: string
  slogan: string | null
  destination: string
  registerTier: string
}

export interface BannerManifest {
  version: 1
  builtAt: string
  lane: string
  count: number
  entries: ZipManifestEntry[]
}

export function pngName(c: Pick<ExportCreative, 'lane' | 'ideaId' | 'format'>): string {
  return `${c.lane}-${c.ideaId}-${c.format.replace(':', 'x')}.png`
}

export async function buildBannerZip(input: ZipBuildInput): Promise<ExportBuild> {
  assertCreativesExportable(input.creatives, { needAsset: true })
  const lane = assertSingleLane(input.creatives)
  const rules = LANE_RULES[lane]
  if (!rules) throw new ExportRefusal('policy', `Lane ${lane} has no banner zip exporter.`)
  const now = input.now ?? new Date()

  const files: Record<string, Uint8Array> = {}
  const entries: ZipManifestEntry[] = []
  const copy: string[] = []
  const destinations: Record<number, string> = {}
  const issues: string[] = []
  const ordered = [...input.creatives].sort((a, b) => a.ideaId - b.ideaId || a.id - b.id)
  for (const c of ordered) {
    const idea = input.ideas[c.ideaId]
    if (!idea) { issues.push(`Creative #${c.id}: its idea #${c.ideaId} was not found.`); continue }
    if (!idea.destinationUrl || !/^https?:\/\//.test(idea.destinationUrl)) { issues.push(`Creative #${c.id}: idea #${idea.id} has no destination URL.`); continue }
    const dest = withUtms(idea.destinationUrl, idea, c.id)
    if (!/utm_content=/.test(dest)) { issues.push(`Creative #${c.id}: destination has no utm_content.`); continue }
    const name = pngName(c)
    const bytes = await input.fetchBytes(c.assetUrl!)
    files[name] = new Uint8Array(bytes)
    destinations[c.id] = dest
    entries.push({ creativeId: c.id, ideaId: idea.id, lane, format: c.format, width: c.width, height: c.height, file: name, slogan: c.slogan, destination: dest, registerTier: c.registerTier })
    copy.push([
      `${name}`,
      `  Creative #${c.id}, idea #${idea.id}, ${c.width && c.height ? `${c.width}x${c.height}` : c.format}`,
      `  Slogan: ${c.slogan ?? '(none)'}`,
      `  Headlines: ${idea.headlines.length ? idea.headlines.map(h => `"${h}"`).join(' | ') : '(none)'}`,
      `  Body: ${idea.body.length ? idea.body.join(' | ') : '(none)'}`,
      `  Destination: ${dest}`,
      '',
    ].join('\n'))
  }
  if (issues.length) throw new ExportRefusal('policy', issues)

  const tiers = [...new Set(ordered.map(c => c.registerTier))].join(', ')
  const readme = [
    `xdipx banner pack: ${rules.label}`,
    `Built ${now.toISOString()}. ${entries.length} banner${entries.length === 1 ? '' : 's'}.`,
    '',
    `Register tier: ${tiers}. ${rules.register}`,
    '',
    `Imagery ceiling that applied: ${rules.ceiling}`,
    '',
    `How to hand it off: ${rules.handoff}`,
    '',
    'Files: one PNG per banner, copy.txt with the words and the tracked links, manifest.json for the machine-readable list.',
    'Nothing in this pack was uploaded anywhere. Every destination URL carries utm_source, utm_medium, utm_campaign and utm_content.',
    'The billing descriptor reads XDIPX.',
    '',
  ].join('\n')
  const manifest: BannerManifest = { version: 1, builtAt: now.toISOString(), lane, count: entries.length, entries }

  files['copy.txt'] = strToU8(copy.join('\n'))
  files['README.txt'] = strToU8(readme)
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  const bytes = Buffer.from(zipSync(files, { level: 0 }))

  const first = ordered[0]!
  const ideaIds = [...new Set(ordered.map(c => c.ideaId))]
  const stamp = now.toISOString().slice(0, 10)
  const filename = ideaIds.length === 1
    ? `${lane}-banners-idea-${first.ideaId}-${stamp}.zip`
    : `${lane}-banners-${ideaIds.length}-ideas-${stamp}.zip`
  return {
    exporter: 'banner-zip',
    kind: 'banner-zip',
    filename,
    contentType: 'application/zip',
    bytes,
    destinations,
    summary: {
      lines: [`${rules.label} pack: ${entries.length} PNG${entries.length === 1 ? '' : 's'} plus copy.txt, README.txt and manifest.json`, `Register ${tiers}. UTMs on every link.`],
      counts: { banners: entries.length, ideas: ideaIds.length },
      warnings: [],
    },
  }
}

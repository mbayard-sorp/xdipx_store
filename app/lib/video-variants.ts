/**
 * Pure variant-set expansion for the batch video engine (spec §5 Phase 1).
 * One base script × hook/presenter/scene axes -> N per-job scripts. No server
 * imports so the expansion unit-tests standalone (video-variants.test.ts).
 *
 * Substitution is deterministic, no magic rewriting: each variant's `hook`
 * field is replaced, and the literal token `{{hook}}` is substituted wherever
 * it appears in presenterLine, voiceover, and motionPrompt. A base script with
 * no token only changes its `hook` field, which is correct for b-roll and
 * caption-led formulas.
 */

import type { VideoScriptJson } from '../../db/schema'

export const HOOK_TOKEN = '{{hook}}'

export interface VariantAxes {
  hook: string
  presenter?: string
  sceneSlug?: string
}

export interface VariantSetInput {
  baseScriptJson: VideoScriptJson
  /** Required axis, 1..N hook lines. */
  hooks: string[]
  /** Optional axis; absent = the set's base presenter only. */
  presenters?: string[]
  /** Optional axis; absent = the base script's sceneSlug (if any). */
  sceneSlugs?: string[]
  /** Written into every variant scriptJson — advanceClip reads it from there. */
  durationSeconds: number
}

export interface ExpandedVariant {
  scriptJson: VideoScriptJson
  /** Set only when the presenters axis is active. */
  presenter?: string
  axes: VariantAxes
}

function substituteHook(text: unknown, hook: string): unknown {
  if (typeof text !== 'string') return text
  return text.split(HOOK_TOKEN).join(hook)
}

/** Cartesian product hooks × (presenters ?? [∅]) × (sceneSlugs ?? [∅]). Base script is never mutated. */
export function expandVariantSet(input: VariantSetInput): ExpandedVariant[] {
  const hooks = input.hooks.map(h => h.trim()).filter(Boolean)
  if (!hooks.length) throw new Error('expandVariantSet: at least one hook is required')
  const presenters = input.presenters?.length ? input.presenters : [undefined]
  const sceneSlugs = input.sceneSlugs?.length ? input.sceneSlugs : [undefined]

  const out: ExpandedVariant[] = []
  for (const hook of hooks) {
    for (const presenter of presenters) {
      for (const sceneSlug of sceneSlugs) {
        const script: VideoScriptJson = {
          ...input.baseScriptJson,
          hook,
          // Avatar sets pass 0 (duration derives from speech) — don't write it.
          ...(input.durationSeconds > 0 ? { durationSeconds: input.durationSeconds } : {}),
        }
        const presenterLine = substituteHook(input.baseScriptJson.presenterLine, hook)
        const voiceover = substituteHook(input.baseScriptJson.voiceover, hook)
        const motionPrompt = substituteHook(input.baseScriptJson['motionPrompt'], hook)
        if (typeof presenterLine === 'string') script.presenterLine = presenterLine
        else delete script.presenterLine
        if (typeof voiceover === 'string') script.voiceover = voiceover
        else delete script.voiceover
        if (motionPrompt !== undefined) script['motionPrompt'] = motionPrompt
        else delete script['motionPrompt']
        if (sceneSlug) script.sceneSlug = sceneSlug
        const axes: VariantAxes = { hook }
        if (presenter) axes.presenter = presenter
        if (sceneSlug) axes.sceneSlug = sceneSlug
        out.push({ scriptJson: script, ...(presenter ? { presenter } : {}), axes })
      }
    }
  }
  return out
}

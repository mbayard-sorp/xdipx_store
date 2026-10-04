/**
 * Rules R1 to R8 as sentences with inline numbers (wires 9.1, 9.5, research
 * pattern 8). Collapsed by default. Each kill rule has its revive partner
 * directly under it and the pair saves together. One surface with hairlines
 * between rules, not eight cards. Owner-only: admins see the numbers read-only.
 */
import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { useAdsToast } from './AdsToast'
import {
  RECIPE_ORDER, RULE_RECIPES, type RuleId, type RuleRecipe,
} from '~/lib/ad-rules-core'
import type { AdsRuleKey } from '~/lib/ad-settings-defaults'

type SaveData = { ok: true; intent: 'save-rules' | 'save-margin'; message: string } | { ok: false; intent?: string; error: string }

function fieldValue(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)))
}

function Sentence({ recipe, values, editable }: { recipe: RuleRecipe; values: Record<AdsRuleKey, number>; editable: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-sm text-ink-2">
      <span className="mr-1 font-mono text-[11px] uppercase tracking-wide text-ink-3">{recipe.id}</span>
      {recipe.parts.map((p, i) => typeof p === 'string'
        ? <span key={i} className={i > 0 && !p.startsWith(' ') ? '-ml-0.5' : ''}>{p.trim()}</span>
        : (
          <span key={i} className="inline-flex items-center gap-1">
            <label className="sr-only" htmlFor={`rule-${p.field.key}`}>{recipe.id} {p.field.label}</label>
            <input
              id={`rule-${p.field.key}`}
              name={p.field.key}
              type="number"
              inputMode="decimal"
              min={p.field.min}
              max={p.field.max}
              step={p.field.step}
              defaultValue={fieldValue(values[p.field.key])}
              key={`${p.field.key}-${values[p.field.key]}`}
              disabled={!editable}
              className="min-h-11 w-20 rounded-xl border border-line bg-paper px-2 text-center font-mono text-base tabular-nums text-ink focus:border-ink focus:outline-none disabled:bg-paper-3 disabled:text-ink-2 md:min-h-9 md:text-sm"
            />
          </span>
        ))}
    </div>
  )
}

function RuleGroup({ ids, values, editable, actionPath }: { ids: RuleId[]; values: Record<AdsRuleKey, number>; editable: boolean; actionPath: string }) {
  const fetcher = useFetcher<SaveData>()
  const toast = useAdsToast()
  const handled = useRef<unknown>(null)
  const pending = fetcher.state !== 'idle'
  const result = fetcher.data

  useEffect(() => {
    if (fetcher.state !== 'idle' || !result || handled.current === result) return
    handled.current = result
    if (result.ok) toast.show({ message: result.message })
  }, [fetcher.state, result, toast])

  const error = result && !result.ok && !pending ? result.error : null
  const recipes = ids.map(id => RULE_RECIPES[id])

  return (
    <fetcher.Form method="post" action={actionPath} className="space-y-2 py-3" aria-busy={pending}>
      <input type="hidden" name="intent" value="save-rules" />
      <input type="hidden" name="rules" value={ids.join(',')} />
      {recipes.map((r, i) => (
        <div key={r.id} className={i > 0 ? 'ml-3 border-l-2 border-line pl-3' : ''}>
          <p className="mb-1 text-xs font-semibold text-ink-3">{r.title}{i > 0 ? ', the revive partner' : ''}</p>
          <Sentence recipe={r} values={values} editable={editable && !pending} />
          {r.note && <p className="mt-1 text-xs text-ink-3">{r.note}</p>}
        </div>
      ))}
      {ids.includes('R3') && <p className="ml-3 text-xs text-ink-3">R4 revives a pause from R3 too.</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {editable && (
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4 disabled:opacity-60 touch-manipulation"
          >
            {pending ? 'Saving' : `Save ${ids.join(' and ')}`}
          </button>
        </div>
      )}
    </fetcher.Form>
  )
}

function MarginRow({ pct, editable, actionPath }: { pct: number; editable: boolean; actionPath: string }) {
  const fetcher = useFetcher<SaveData>()
  const toast = useAdsToast()
  const handled = useRef<unknown>(null)
  const pending = fetcher.state !== 'idle'
  const result = fetcher.data
  useEffect(() => {
    if (fetcher.state !== 'idle' || !result || handled.current === result) return
    handled.current = result
    if (result.ok) toast.show({ message: result.message })
  }, [fetcher.state, result, toast])
  const error = result && !result.ok && !pending ? result.error : null
  return (
    <fetcher.Form method="post" action={actionPath} className="space-y-2 py-3" aria-busy={pending}>
      <input type="hidden" name="intent" value="save-margin" />
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-sm text-ink-2">
        <span className="mr-1 font-mono text-[11px] uppercase tracking-wide text-ink-3">BE</span>
        <span>Break-even uses a gross margin of</span>
        <label className="sr-only" htmlFor="rule-margin">Gross margin percent</label>
        <input
          id="rule-margin"
          name="margin"
          type="number"
          inputMode="decimal"
          min={1}
          max={100}
          step={1}
          defaultValue={fieldValue(pct)}
          key={`margin-${pct}`}
          disabled={!editable || pending}
          className="min-h-11 w-20 rounded-xl border border-line bg-paper px-2 text-center font-mono text-base tabular-nums text-ink focus:border-ink focus:outline-none disabled:bg-paper-3 disabled:text-ink-2 md:min-h-9 md:text-sm"
        />
        <span>%.</span>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {editable && (
        <div className="flex justify-end">
          <button type="submit" disabled={pending} className="min-h-11 rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4 disabled:opacity-60 touch-manipulation">
            {pending ? 'Saving' : 'Save margin'}
          </button>
        </div>
      )}
    </fetcher.Form>
  )
}

export function RuleRecipes({ thresholds, grossMarginPct, isOwner, actionPath }: {
  thresholds: Record<AdsRuleKey, number>
  grossMarginPct: number
  isOwner: boolean
  actionPath: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <section aria-label="Rules" className="rounded-2xl border border-line bg-paper">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls="rule-recipes"
        className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2 text-left touch-manipulation lg:px-5"
      >
        <span className="text-sm font-semibold text-ink">Rules <span className="font-mono font-normal text-ink-3">(8)</span></span>
        <span aria-hidden="true" className={`font-mono text-ink-3 transition-transform duration-[var(--duration-fast)] ${open ? 'rotate-180' : ''}`}>v</span>
      </button>
      {open && (
        <div id="rule-recipes" className="divide-y divide-line border-t border-line px-4 lg:px-5">
          <p className="py-3 text-xs text-ink-3">
            Rules recommend. You tap. The one exception is R7, which pauses everything on its own.
            {!isOwner && ' Only the owner can change these numbers.'}
          </p>
          {RECIPE_ORDER.map(({ rule, underneath }) => (
            <RuleGroup key={rule} ids={underneath ? [rule, underneath] : [rule]} values={thresholds} editable={isOwner} actionPath={actionPath} />
          ))}
          <MarginRow pct={grossMarginPct} editable={isOwner} actionPath={actionPath} />
        </div>
      )}
    </section>
  )
}

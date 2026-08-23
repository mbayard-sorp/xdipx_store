/**
 * Multi-select chips over the approved cast roster (Sanity castMember docs).
 * Writes `castSlugs` as a comma-joined hidden input. The gate still judges
 * the §3.7 cast mandate; this only records who is in the post.
 */
import { CheckIcon } from './icons'

export interface CastOption { slug: string; name: string; photoUrl: string; role?: string | null }

export function CastPicker({
  roster,
  selected,
  onChange,
}: {
  roster: CastOption[]
  selected: string[]
  onChange: (slugs: string[]) => void
}) {
  function toggle(slug: string) {
    onChange(selected.includes(slug) ? selected.filter(s => s !== slug) : [...selected, slug])
  }
  return (
    <fieldset>
      <legend className="text-xs font-semibold uppercase tracking-wide text-ink-3 mb-2">Cast</legend>
      <input type="hidden" name="castSlugs" value={selected.join(',')} />
      {roster.length === 0 ? (
        <p className="text-xs text-ink-3">
          No approved cast members in Sanity. Approve one on the castMember doc (active plus approvedForUse) and it appears here.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2" role="list">
          {roster.map(m => {
            const on = selected.includes(m.slug)
            return (
              <li key={m.slug}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(m.slug)}
                  className={`inline-flex items-center gap-2 min-h-11 pl-1 pr-3 rounded-full border text-sm transition-colors ${
                    on ? 'border-plum bg-plum-soft text-plum-2' : 'border-line bg-paper text-ink-3 hover:border-ink-4'
                  }`}
                >
                  <img src={avatarUrl(m.photoUrl)} alt="" className="w-8 h-8 rounded-full object-cover bg-paper-3" loading="lazy" />
                  <span className="font-medium">{m.name}</span>
                  {on && <CheckIcon size={14} />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </fieldset>
  )
}

/** A 96px square crop for the chip; the roster carries 1600px masters. */
function avatarUrl(url: string): string {
  if (!url.includes('cdn.sanity.io')) return url
  const base = url.split('?')[0] ?? url
  return `${base}?w=96&h=96&fit=crop&auto=format&q=70`
}

/**
 * The Library's tile grid, shared by the Library page and the Composer's
 * select-mode picker. Every thumb declares its aspect so the grid never
 * shifts while images load. Selection is a controlled Set of asset ids.
 */
import { CheckIcon, UserIcon, UploadIcon, ImageIcon } from './icons'

/** Page size for the Library listing (newest first, cursor on id). */
export const LIBRARY_PAGE = 60

export interface LibraryAsset {
  id: number
  url: string
  aspect: string | null
  source: string
  prompt: string | null
  productHandle: string | null
  castSlugs: string[] | null
  tags: string[] | null
  isPicked: boolean
  createdAt: string | Date
  width?: number | null
  height?: number | null
}

export function aspectClassOf(aspect: string | null | undefined, w?: number | null, h?: number | null): string {
  const a = aspect ?? (w && h ? (w / h > 1.5 ? '16:9' : w / h > 1.05 ? '4:3' : w / h > 0.95 ? '1:1' : h / w > 1.5 ? '9:16' : '4:5') : null)
  switch (a) {
    case '16:9': return 'aspect-[16/9]'
    case '9:16': return 'aspect-[9/16]'
    case '1:1': return 'aspect-square'
    case '4:3': return 'aspect-[4/3]'
    case '3:4': return 'aspect-[3/4]'
    default: return 'aspect-[4/5]'
  }
}

export function LibraryGrid({
  assets,
  selected,
  onToggle,
  onOpen,
  dense = false,
}: {
  assets: LibraryAsset[]
  selected: ReadonlySet<number>
  onToggle: (id: number) => void
  /** Open the detail drawer; absent in picker mode, where a click selects. */
  onOpen?: (id: number) => void
  dense?: boolean
}) {
  return (
    <ul
      role="list"
      className={`grid gap-3 ${dense ? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'}`}
    >
      {assets.map(a => {
        const on = selected.has(a.id)
        const SourceIcon = a.source === 'upload' ? UploadIcon : a.castSlugs?.length ? UserIcon : ImageIcon
        return (
          <li key={a.id} className="relative">
            <div className={`relative rounded-xl overflow-hidden border bg-paper-3 ${on ? 'border-coral ring-2 ring-coral/40' : 'border-line'} ${aspectClassOf(a.aspect, a.width, a.height)}`}>
              <button
                type="button"
                onClick={() => (onOpen ? onOpen(a.id) : onToggle(a.id))}
                className="absolute inset-0 w-full h-full"
                aria-label={`${onOpen ? 'Open' : on ? 'Deselect' : 'Select'} asset ${a.id}${a.productHandle ? `, ${a.productHandle}` : ''}`}
              >
                <img src={a.url} alt={a.prompt ? a.prompt.slice(0, 120) : `Asset ${a.id}`} className="w-full h-full object-cover" loading="lazy" />
              </button>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                aria-label={`Select asset ${a.id}`}
                onClick={e => { e.stopPropagation(); onToggle(a.id) }}
                className={`absolute top-1.5 left-1.5 w-7 h-7 md:w-6 md:h-6 rounded-md border inline-flex items-center justify-center transition-colors ${
                  on ? 'bg-coral border-coral text-white' : 'bg-paper/90 border-line text-transparent hover:text-ink-4'
                }`}
              >
                <CheckIcon size={14} />
              </button>
              <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 font-mono text-[10px] leading-none px-1.5 py-1 rounded-full bg-ink/70 text-white tabular-nums">
                <SourceIcon size={10} /> #{a.id}
              </span>
              {a.isPicked && (
                <span className="absolute bottom-1.5 right-1.5 font-mono text-[10px] leading-none px-1.5 py-1 rounded-full bg-sage text-white">
                  picked
                </span>
              )}
            </div>
            {!dense && (
              <p className="mt-1 text-[11px] text-ink-3 truncate">
                {a.productHandle ?? (a.tags?.length ? a.tags.slice(0, 3).join(', ') : a.source)}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

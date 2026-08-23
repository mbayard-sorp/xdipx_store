import { useEffect } from 'react'

export type ShortcutMap = Record<string, (e: KeyboardEvent) => void>

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/**
 * Studio keyboard equivalents (plan section 4): `n` new post, `/` search,
 * `j`/`k` move, `a`/`r` approve/request, `mod+enter` save, `escape` close.
 * Single-letter keys are ignored while typing; `mod+enter` and `escape` are
 * not, because they are meant to fire from inside a field. A DOM listener
 * is what a keyboard shortcut is; this is not data fetching.
 */
export function useStudioShortcuts(map: ShortcutMap, enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      const name = mod && key === 'Enter' ? 'mod+enter' : key === 'Escape' ? 'escape' : key
      const handler = map[name]
      if (!handler) return
      if (name !== 'mod+enter' && name !== 'escape' && (isTyping(e.target) || mod || e.altKey)) return
      handler(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [map, enabled])
}

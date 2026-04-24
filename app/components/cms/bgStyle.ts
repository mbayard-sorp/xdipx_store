export type BgStyle = 'white' | 'cream' | 'mist' | 'charcoal' | 'purple'

export function bgClass(style: BgStyle | undefined | null): string {
  switch (style) {
    case 'cream':    return 'bg-cream'
    case 'mist':     return 'bg-cream-2'
    case 'charcoal': return 'bg-ink text-white'
    case 'purple':   return 'bg-sage text-white'
    case 'white':
    default:         return 'bg-white'
  }
}

export function isDarkBg(style: BgStyle | undefined | null): boolean {
  return style === 'charcoal' || style === 'purple'
}

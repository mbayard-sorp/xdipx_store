import { TrustBar } from '~/components/store/TrustBar'
import type { TrustBarBlock as TrustBarBlockType } from '~/types/cms'
import { bgClass } from './bgStyle'

interface Props {
  block: TrustBarBlockType
  /** When true, the inner TrustBar drops its own `bg-white border-y` framing
   *  so the caller can supply its own (e.g. PDP wraps it in a card matching
   *  the summary grid). Also suppresses the bgStyle wrapper. */
  frameless?: boolean
}

export function TrustBarBlock({ block, frameless = false }: Props) {
  if (frameless) {
    return <TrustBar items={block.trustItems ?? []} frameless />
  }
  // When an editor picks a non-default bgStyle, wrap — otherwise let TrustBar
  // keep its own framing (bg-white + cream-2 borders) for pixel-parity.
  if (!block.bgStyle || block.bgStyle === 'white') {
    return <TrustBar items={block.trustItems ?? []} />
  }
  return (
    <div className={bgClass(block.bgStyle)}>
      <TrustBar items={block.trustItems ?? []} />
    </div>
  )
}

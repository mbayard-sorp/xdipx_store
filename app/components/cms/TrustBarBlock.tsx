import { TrustBar } from '~/components/store/TrustBar'
import type { TrustBarBlock as TrustBarBlockType } from '~/types/cms'
import { bgClass } from './bgStyle'

interface Props {
  block: TrustBarBlockType
}

export function TrustBarBlock({ block }: Props) {
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

import { TrustBar } from '~/components/store/TrustBar'
import type { TrustBarBlock as TrustBarBlockType } from '~/types/cms'

interface Props {
  block: TrustBarBlockType
}

export function TrustBarBlock({ block }: Props) {
  return <TrustBar items={block.trustItems ?? []} />
}

/**
 * Quiet closer band: notify-me capture, not a product CTA. Renders the
 * shared EmailSubscribe component with heading/subcopy overrides only.
 * EmailSubscribe's own buttonLabel default stays as-is on purpose:
 * block.ctaLabel ("Show me" by default from the resolver) is a whitelist
 * product-page CTA phrase, wrong for an email submit button, so it is not
 * threaded through here.
 */

import { EmailSubscribe } from '~/components/store/EmailSubscribe'
import type { ResolvedCategoryBlock } from '~/types/cms'

type Block = Extract<ResolvedCategoryBlock, { _type: 'comingSoon' }>

export function ComingSoon({ block }: { block: Block }) {
  return (
    <div id={block.anchorId} data-block={block._type}>
      <EmailSubscribe
        location="category"
        {...(block.heading ? { heading: block.heading } : {})}
        {...(block.body ? { subcopy: block.body } : {})}
      />
    </div>
  )
}

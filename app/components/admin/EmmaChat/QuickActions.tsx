import { useFetcher } from 'react-router'
import { EMMA_QUICK_ACTION_IDS, EMMA_QUICK_ACTION_LABELS, type EmmaQuickActionId } from '~/lib/emma-chat-constants'

interface QuickActionsProps {
  disabled?: boolean
}

export function QuickActions({ disabled = false }: QuickActionsProps) {
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {EMMA_QUICK_ACTION_IDS.map(id => (
        <QuickActionButton key={id} actionId={id} disabled={disabled} />
      ))}
    </div>
  )
}

function QuickActionButton({ actionId, disabled }: { actionId: EmmaQuickActionId; disabled: boolean }) {
  const fetcher = useFetcher()
  const isSubmitting = fetcher.state !== 'idle'

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="quick_action" />
      <input type="hidden" name="action" value={actionId} />
      <button
        type="submit"
        disabled={disabled || isSubmitting}
        className={[
          'text-xs font-medium px-3 py-1.5 rounded-lg border transition-all',
          disabled || isSubmitting
            ? 'border-line text-muted/50 cursor-not-allowed'
            : 'border-line text-muted hover:border-coral hover:text-coral hover:bg-coral/5',
        ].join(' ')}
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {EMMA_QUICK_ACTION_LABELS[actionId]}
      </button>
    </fetcher.Form>
  )
}

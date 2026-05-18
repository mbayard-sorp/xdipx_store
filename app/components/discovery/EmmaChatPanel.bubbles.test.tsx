/**
 * @vitest-environment jsdom
 *
 * FilterActionCard — propose_chips tap behavior.
 *
 * Uses react-dom/client + React act() — no @testing-library/react dep needed.
 * Each test mounts into a fresh <div> and unmounts after.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { FilterActionCard } from './EmmaChatPanel.bubbles'
import type { FilterChipItem, FilterActionCardProps } from './EmmaChatPanel.bubbles'
import type { ToolCallPayload } from './EmmaChatPanel'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let container: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null

function setup() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  return { container: container! }
}

function render(props: FilterActionCardProps) {
  act(() => {
    root!.render(createElement(FilterActionCard, props))
  })
  return container!
}

afterEach(() => {
  if (root) {
    act(() => { root!.unmount() })
    root = null
  }
  if (container && container.parentNode) {
    container.parentNode.removeChild(container)
    container = null
  }
})

function makeToolCall(chips: Array<{ group: string; value: string; action?: string }>): ToolCallPayload {
  return {
    id:    'tc-test-1',
    name:  'propose_chips',
    input: {
      reason: 'These match what you described.',
      chips,
    },
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('FilterActionCard — propose_chips rendering', () => {
  it('shows two mini-chip buttons for a two-chip toolCall', () => {
    setup()
    const onApply = vi.fn()
    const toolCall = makeToolCall([
      { group: 'mood',    value: 'Sensual',  action: 'add' },
      { group: 'matters', value: 'Waterproof', action: 'remove' },
    ])

    const el = render({ toolCall, onApply })
    const buttons = Array.from(el.querySelectorAll('button'))
    // Two chip buttons + one "Apply all" button = 3 total.
    // The chip buttons show the value text.
    const chipButtons = buttons.filter(b =>
      b.textContent?.includes('Sensual') || b.textContent?.includes('Waterproof'),
    )
    expect(chipButtons).toHaveLength(2)
  })

  it('renders an "Apply all" button when there are multiple chips', () => {
    setup()
    const onApply = vi.fn()
    const toolCall = makeToolCall([
      { group: 'mood',    value: 'Sensual',  action: 'add' },
      { group: 'matters', value: 'Waterproof', action: 'remove' },
    ])

    const el = render({ toolCall, onApply })
    const applyAll = Array.from(el.querySelectorAll('button')).find(
      b => b.textContent?.includes('Apply all'),
    )
    expect(applyAll).toBeTruthy()
  })

  it('does NOT render "Apply all" when there is only one chip', () => {
    setup()
    const onApply = vi.fn()
    const toolCall = makeToolCall([
      { group: 'mood', value: 'Sensual', action: 'add' },
    ])

    const el = render({ toolCall, onApply })
    const applyAll = Array.from(el.querySelectorAll('button')).find(
      b => b.textContent?.includes('Apply all'),
    )
    expect(applyAll).toBeUndefined()
  })

  it('labels remove-action chips with the [−] prefix', () => {
    setup()
    const onApply = vi.fn()
    const toolCall = makeToolCall([
      { group: 'matters', value: 'Waterproof', action: 'remove' },
    ])

    const el = render({ toolCall, onApply })
    const chipButton = Array.from(el.querySelectorAll('button')).find(
      b => b.textContent?.includes('Waterproof'),
    )
    expect(chipButton?.textContent).toContain('[−]')
  })
})

// ---------------------------------------------------------------------------
// Tap a single mini-chip
// ---------------------------------------------------------------------------

describe('FilterActionCard — single chip tap', () => {
  it('calls onApply with that single chip when tapping a mini-chip', () => {
    setup()
    const onApply = vi.fn()
    const toolCall = makeToolCall([
      { group: 'mood',    value: 'Sensual',    action: 'add' },
      { group: 'matters', value: 'Waterproof', action: 'remove' },
    ])

    const el = render({ toolCall, onApply })
    const sensualButton = Array.from(el.querySelectorAll('button')).find(
      b => b.textContent?.includes('Sensual'),
    )!

    act(() => { sensualButton.click() })

    expect(onApply).toHaveBeenCalledTimes(1)
    const [chips, isBudget] = onApply.mock.calls[0] as [FilterChipItem[], boolean]
    expect(isBudget).toBe(false)
    expect(chips).toHaveLength(1)
    expect(chips[0]?.value).toBe('Sensual')
    expect(chips[0]?.group).toBe('mood')
    expect(chips[0]?.action).toBe('add')
  })

  it('calls onApply correctly for the remove-action chip', () => {
    setup()
    const onApply = vi.fn()
    const toolCall = makeToolCall([
      { group: 'mood',    value: 'Sensual',    action: 'add' },
      { group: 'matters', value: 'Waterproof', action: 'remove' },
    ])

    const el = render({ toolCall, onApply })
    const waterproofButton = Array.from(el.querySelectorAll('button')).find(
      b => b.textContent?.includes('Waterproof'),
    )!

    act(() => { waterproofButton.click() })

    expect(onApply).toHaveBeenCalledTimes(1)
    const [chips] = onApply.mock.calls[0] as [FilterChipItem[]]
    expect(chips[0]?.value).toBe('Waterproof')
    expect(chips[0]?.action).toBe('remove')
  })
})

// ---------------------------------------------------------------------------
// Tap "Apply all"
// ---------------------------------------------------------------------------

describe('FilterActionCard — Apply all tap', () => {
  it('calls onApply with the full chip list', () => {
    setup()
    const onApply = vi.fn()
    const toolCall = makeToolCall([
      { group: 'mood',    value: 'Sensual',    action: 'add' },
      { group: 'matters', value: 'Waterproof', action: 'remove' },
    ])

    const el = render({ toolCall, onApply })
    const applyAll = Array.from(el.querySelectorAll('button')).find(
      b => b.textContent?.includes('Apply all'),
    )!

    act(() => { applyAll.click() })

    expect(onApply).toHaveBeenCalledTimes(1)
    const [chips, isBudget] = onApply.mock.calls[0] as [FilterChipItem[], boolean]
    expect(isBudget).toBe(false)
    expect(chips).toHaveLength(2)
    expect(chips.map(c => c.value).sort()).toEqual(['Sensual', 'Waterproof'])
  })

  it('replaces chip buttons with "Applied. ♥" after Apply all', () => {
    setup()
    const onApply = vi.fn()
    const toolCall = makeToolCall([
      { group: 'mood',    value: 'Sensual',    action: 'add' },
      { group: 'matters', value: 'Waterproof', action: 'remove' },
    ])

    const el = render({ toolCall, onApply })
    const applyAll = Array.from(el.querySelectorAll('button')).find(
      b => b.textContent?.includes('Apply all'),
    )!

    act(() => { applyAll.click() })

    expect(el.textContent).toContain('Applied')
    // The "Apply all" button and chip buttons should be gone.
    const remainingButtons = Array.from(el.querySelectorAll('button'))
    expect(remainingButtons.find(b => b.textContent?.includes('Apply all'))).toBeUndefined()
  })

  it('does not call onApply a second time when already applied', () => {
    setup()
    const onApply = vi.fn()
    const toolCall = makeToolCall([
      { group: 'mood',    value: 'Sensual',  action: 'add' },
      { group: 'matters', value: 'Hands-Free', action: 'add' },
    ])

    const el = render({ toolCall, onApply })
    const applyAll = Array.from(el.querySelectorAll('button')).find(
      b => b.textContent?.includes('Apply all'),
    )!

    act(() => { applyAll.click() })
    // After first click, "Apply all" is gone — clicking again won't happen,
    // but verify onApply was called exactly once.
    expect(onApply).toHaveBeenCalledTimes(1)
  })
})

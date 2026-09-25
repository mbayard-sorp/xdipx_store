import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Navbar shell breakpoint regression guard (design-critic run 1034, #11083
 * items A and B). Source-text assertion, not a rendered DOM, same precedent
 * as coral-budget-pdp.test.ts: the defect was measured at 768px against the
 * live capture (the mega menu truncated to a single clipped letter, with no
 * fallback), not something jsdom's default viewport can reproduce, and the
 * container-alignment defect is a pixel measurement against the doctrine's
 * fixed container widths, not a behavior a render assertion would catch
 * either.
 *
 * Item A: the desktop mega menu had ~476px for an 8-item menu at 768 (md),
 * with no fallback (the mobile drawer was already md:hidden at that width).
 * Moving the mega menu and the drawer to the lg (1024) breakpoint reopens a
 * 768-1023 gap that only the hamburger fallback button can now cover, so all
 * three must move together or the gap has no menu access at all.
 *
 * Item B: the nav sat on a fourth non-doctrine container (max-w-6xl px-4),
 * misaligned 37px from every other band's 124px left edge. Doctrine section 1
 * requires reusing 1320/1200/820, and Footer.tsx already carries the fix for
 * the same defect class (design-critic run 905, #9680).
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8')

describe('Navbar shell breakpoints — #11083 item A (768 mega-menu truncation)', () => {
  const src = read('./Navbar.tsx')

  it('gates the desktop mega menu at lg, not md', () => {
    expect(src).toContain('hidden lg:flex flex-1 min-w-0 overflow-hidden')
    expect(src).not.toContain('hidden md:flex flex-1 min-w-0 overflow-hidden')
  })

  it('gates the mobile drawer backdrop and panel at lg, not md', () => {
    expect(src).toContain('fixed inset-0 z-[65] bg-ink/50 backdrop-blur-sm lg:hidden')
    expect(src).toContain('fixed top-0 right-0 bottom-0 z-[66] w-[85vw] max-w-xs bg-cream shadow-2xl flex flex-col lg:hidden')
    expect(src).not.toMatch(/z-\[65\][^"]*md:hidden/)
    expect(src).not.toMatch(/z-\[66\][^"]*md:hidden/)
  })

  it('shows the hamburger fallback exactly in the 768-1023 gap the mega-menu move opens, not never and not always', () => {
    const buttonLine = src.split('\n').find(l => l.includes('aria-label="Open menu"'))
    const classLine = src.split('\n').find((l, i, lines) => l.includes('className=') && lines[i + 1]?.includes('aria-label="Open menu"'))
    expect(classLine, 'hamburger button className line not found — did the markup change?').toBeTruthy()
    expect(classLine).toContain('hidden md:flex lg:hidden')
    // The pre-fix class was unconditional ("hidden flex", no breakpoint), which
    // never rendered the trigger at any width.
    expect(classLine).not.toMatch(/className="hidden flex flex-col/)
    void buttonLine
  })
})

describe('Navbar shell breakpoints — #11083 item B (fourth non-doctrine container)', () => {
  const src = read('./Navbar.tsx')

  it('the nav uses the doctrine 1320px band container, matching Footer.tsx', () => {
    expect(src).toContain('max-w-[1320px] mx-auto px-6 md:px-16 h-14 flex items-center justify-between gap-4')
    expect(src).not.toContain('max-w-6xl mx-auto px-4 h-14')
  })
})

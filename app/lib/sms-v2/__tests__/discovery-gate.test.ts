/**
 * discovery-gate.test.ts
 *
 * Vitest unit tests for the pure gate-state machine in discovery-gate.server.ts.
 *
 * Tests are grouped by exported function. Each test is labeled with the
 * rule number from advanceGate's inline doc-comment where relevant.
 */

import { describe, it, expect } from 'vitest'
import {
  initDiscoveryState,
  advanceGate,
  mergeSlots,
  suspendForExplain,
  resumeFromExplain,
  isHighStakesCategory,
} from '../discovery-gate.server'
import type { DiscoveryState } from '../discovery-gate.server'

// ─── initDiscoveryState ───────────────────────────────────────────────────────

describe('initDiscoveryState', () => {
  it('returns gate=MOOD with empty slots', () => {
    const state = initDiscoveryState()
    expect(state.gate).toBe('MOOD')
    expect(state.slots).toEqual({})
  })
})

// ─── advanceGate — null/empty current ────────────────────────────────────────

describe('advanceGate — null current (rule 0)', () => {
  it('null + empty incoming → MOOD gate, <<MOOD>> prose, allowSkip=true, searchNow=false', () => {
    const result = advanceGate(null, {})
    expect(result.nextState.gate).toBe('MOOD')
    expect(result.question).not.toBeNull()
    expect(result.question?.prose).toBe('<<MOOD>>')
    expect(result.question?.allowSkip).toBe(true)
    expect(result.searchNow).toBe(false)
  })

  it('null current is treated identically to initDiscoveryState() current', () => {
    const fromNull = advanceGate(null, {})
    const fromInit = advanceGate(initDiscoveryState(), {})
    expect(fromNull.nextState.gate).toBe(fromInit.nextState.gate)
    expect(fromNull.question?.prose).toBe(fromInit.question?.prose)
    expect(fromNull.searchNow).toBe(fromInit.searchNow)
  })
})

// ─── advanceGate — skip-ahead sentinel (rule 2) ───────────────────────────────

describe('advanceGate — skip-ahead sentinel (rule 2)', () => {
  it('mood=["just-show-me"] at MOOD gate → searchNow=true, question=null', () => {
    const result = advanceGate(null, { mood: ['just-show-me'] })
    expect(result.searchNow).toBe(true)
    expect(result.question).toBeNull()
    // Gate stays at MOOD — we don't advance when skipping, just signal search
    expect(result.nextState.gate).toBe('MOOD')
  })

  it('skip-ahead sentinel works from any gate (WHO)', () => {
    const state: DiscoveryState = { gate: 'WHO', slots: { category: 'lube' } }
    const result = advanceGate(state, { mood: ['just-show-me'] })
    expect(result.searchNow).toBe(true)
    expect(result.question).toBeNull()
  })

  it('skip-ahead sentinel works from MATTERS gate', () => {
    const state: DiscoveryState = { gate: 'MATTERS', slots: { audience: 'for-her' } }
    const result = advanceGate(state, { mood: ['just-show-me'] })
    expect(result.searchNow).toBe(true)
    expect(result.question).toBeNull()
  })
})

// ─── advanceGate — non-high-stakes category only (rule 8) ────────────────────

describe('advanceGate — non-high-stakes category, no audience (rule 8)', () => {
  /**
   * Chosen behavior: when a non-high-stakes category is present but no audience,
   * jump to WHO. Rationale: the customer has already told us what product type
   * they want, so the most valuable next question is "who is this for?" rather
   * than re-asking an open mood question. Rule 8 in advanceGate.
   */
  it('category=lube, no audience → WHO gate (rule 8: named category, jump to WHO)', () => {
    const result = advanceGate(null, { category: 'lube' })
    expect(result.nextState.gate).toBe('WHO')
    expect(result.question?.prose).toBe('<<WHO>>')
    expect(result.question?.allowSkip).toBe(true)
    expect(result.searchNow).toBe(false)
  })

  it('WHO gate question includes quickChoiceOpts', () => {
    const result = advanceGate(null, { category: 'lube' })
    expect(result.question?.quickChoiceOpts).toEqual([
      'For me', 'For a partner', 'For us', 'A gift',
    ])
  })
})

// ─── advanceGate — high-stakes category (rule 4) ─────────────────────────────

describe('advanceGate — high-stakes category, no audience (rule 4)', () => {
  it('category=anal (plug), no audience → WHO gate', () => {
    // Note: the plan uses 'plug' but the ProductTypeDial enum uses 'anal' as the
    // top-level type. isHighStakesCategory maps 'anal' → true.
    const result = advanceGate(null, { category: 'anal' })
    expect(result.nextState.gate).toBe('WHO')
    expect(result.question?.prose).toBe('<<WHO>>')
    expect(result.searchNow).toBe(false)
  })

  it('category=dildo, no audience → WHO gate', () => {
    const result = advanceGate(null, { category: 'dildo' })
    expect(result.nextState.gate).toBe('WHO')
    expect(result.question?.prose).toBe('<<WHO>>')
  })

  it('category=harness, no audience → WHO gate', () => {
    const result = advanceGate(null, { category: 'harness' })
    expect(result.nextState.gate).toBe('WHO')
  })

  it('category=wear, no audience → WHO gate', () => {
    const result = advanceGate(null, { category: 'wear' })
    expect(result.nextState.gate).toBe('WHO')
  })
})

// ─── advanceGate — category + audience → MATTERS (rule 5) ───────────────────

describe('advanceGate — category + audience, no mood/matters (rule 5)', () => {
  it('anal + for-him → MATTERS gate', () => {
    const result = advanceGate(null, { category: 'anal', audience: 'for-him' })
    expect(result.nextState.gate).toBe('MATTERS')
    expect(result.question?.prose).toBe('<<MATTERS>>')
    expect(result.question?.allowSkip).toBe(true)
    expect(result.searchNow).toBe(false)
  })

  it('MATTERS question includes quickChoiceOpts', () => {
    const result = advanceGate(null, { category: 'anal', audience: 'for-him' })
    expect(result.question?.quickChoiceOpts).toEqual([
      'Beginner-friendly', 'Quiet', 'Waterproof', 'Travel-ready', 'Just show me',
    ])
  })
})

// ─── advanceGate — all three signals → READY (rule 3) ────────────────────────

describe('advanceGate — all three core signals → READY (rule 3)', () => {
  it('category + audience + matters → READY, question=null, searchNow=true', () => {
    const result = advanceGate(null, {
      category: 'anal',
      audience: 'for-him',
      matters: ['quiet'],
    })
    expect(result.nextState.gate).toBe('READY')
    expect(result.question).toBeNull()
    expect(result.searchNow).toBe(true)
  })

  it('READY state carries audience as required slot', () => {
    const result = advanceGate(null, {
      category: 'anal',
      audience: 'for-him',
      matters: ['quiet'],
    })
    expect(result.nextState.gate).toBe('READY')
    if (result.nextState.gate === 'READY') {
      expect(result.nextState.slots.audience).toBe('for-him')
    }
  })

  it('category + audience + mood (no matters) → READY', () => {
    const result = advanceGate(null, {
      category: 'vibrator',
      audience: 'for-her',
      mood: ['curious'],
    })
    expect(result.nextState.gate).toBe('READY')
    expect(result.searchNow).toBe(true)
  })
})

// ─── advanceGate — mood but no audience (rule 6) ─────────────────────────────

describe('advanceGate — mood but no audience (rule 6)', () => {
  it('mood present, no audience → WHO gate', () => {
    const state: DiscoveryState = { gate: 'MOOD', slots: {} }
    const result = advanceGate(state, { mood: ['romantic'] })
    expect(result.nextState.gate).toBe('WHO')
    expect(result.question?.prose).toBe('<<WHO>>')
  })
})

// ─── advanceGate — mood + audience, no matters (rule 7) ──────────────────────

describe('advanceGate — mood + audience, no matters (rule 7)', () => {
  it('mood + audience → MATTERS gate', () => {
    const result = advanceGate(null, {
      mood: ['romantic'],
      audience: 'for-her',
    })
    expect(result.nextState.gate).toBe('MATTERS')
    expect(result.question?.prose).toBe('<<MATTERS>>')
    expect(result.searchNow).toBe(false)
  })
})

// ─── advanceGate — EXPLAIN state passthrough (rule 1) ─────────────────────────

describe('advanceGate — EXPLAIN state passthrough (rule 1)', () => {
  it('EXPLAIN state returns unchanged, searchNow=false, question=null', () => {
    const explainState: DiscoveryState = {
      gate: 'EXPLAIN',
      resumeGate: 'WHO',
      slots: { category: 'anal' },
    }
    const result = advanceGate(explainState, { audience: 'for-him' })
    expect(result.nextState.gate).toBe('EXPLAIN')
    expect(result.nextState).toBe(explainState) // reference equality — unchanged
    expect(result.searchNow).toBe(false)
    expect(result.question).toBeNull()
  })
})

// ─── advanceGate — slot merging across turns ─────────────────────────────────

describe('advanceGate — slots accumulate across turns', () => {
  it('category acquired in turn 1 is present in turn 2 state', () => {
    const turn1 = advanceGate(null, { category: 'anal' })
    const turn2 = advanceGate(turn1.nextState, { audience: 'for-him' })
    expect(turn2.nextState.slots.category).toBe('anal')
    expect(turn2.nextState.slots.audience).toBe('for-him')
  })
})

// ─── mergeSlots ──────────────────────────────────────────────────────────────

describe('mergeSlots', () => {
  it('array de-dup: existing matters merged with overlapping incoming', () => {
    const result = mergeSlots({ matters: ['a'] }, { matters: ['a', 'b'] })
    expect(result.matters).toEqual(['a', 'b'])
  })

  it('array de-dup: mood values de-duplicated', () => {
    const result = mergeSlots({ mood: ['romantic'] }, { mood: ['romantic', 'curious'] })
    expect(result.mood).toEqual(['romantic', 'curious'])
  })

  it('priceMax: incoming wins when present', () => {
    const result = mergeSlots({ priceMax: 50 }, { priceMax: 100 })
    expect(result.priceMax).toBe(100)
  })

  it('priceMax: existing kept when incoming absent', () => {
    const result = mergeSlots({ priceMax: 50 }, {})
    expect(result.priceMax).toBe(50)
  })

  it('vulnerabilitySignaled: OR semantics (false OR true → true)', () => {
    const result = mergeSlots(
      { vulnerabilitySignaled: false },
      { vulnerabilitySignaled: true },
    )
    expect(result.vulnerabilitySignaled).toBe(true)
  })

  it('vulnerabilitySignaled: OR semantics (true OR false → true)', () => {
    const result = mergeSlots(
      { vulnerabilitySignaled: true },
      { vulnerabilitySignaled: false },
    )
    expect(result.vulnerabilitySignaled).toBe(true)
  })

  it('isAdviceRequest: OR semantics', () => {
    const result = mergeSlots({ isAdviceRequest: false }, { isAdviceRequest: true })
    expect(result.isAdviceRequest).toBe(true)
  })

  it('single-value field: incoming wins if present', () => {
    const result = mergeSlots({ audience: 'for-her' }, { audience: 'for-him' })
    expect(result.audience).toBe('for-him')
  })

  it('single-value field: existing kept if incoming absent', () => {
    const result = mergeSlots({ audience: 'for-her' }, {})
    expect(result.audience).toBe('for-her')
  })

  it('empty + empty → empty', () => {
    const result = mergeSlots({}, {})
    expect(result).toEqual({})
  })

  it('mood array order: existing first, then new', () => {
    const result = mergeSlots({ mood: ['x'] }, { mood: ['y'] })
    expect(result.mood).toEqual(['x', 'y'])
  })
})

// ─── suspendForExplain ────────────────────────────────────────────────────────

describe('suspendForExplain', () => {
  it('wraps WHO state as EXPLAIN with resumeGate=WHO', () => {
    const state: DiscoveryState = { gate: 'WHO', slots: { category: 'anal' } }
    const result = suspendForExplain(state)
    expect(result.gate).toBe('EXPLAIN')
    if (result.gate === 'EXPLAIN') {
      expect(result.resumeGate).toBe('WHO')
      expect(result.slots).toEqual({ category: 'anal' })
    }
  })

  it('wraps MOOD state as EXPLAIN with resumeGate=MOOD', () => {
    const state: DiscoveryState = { gate: 'MOOD', slots: {} }
    const result = suspendForExplain(state)
    expect(result.gate).toBe('EXPLAIN')
    if (result.gate === 'EXPLAIN') {
      expect(result.resumeGate).toBe('MOOD')
    }
  })

  it('wraps MATTERS state as EXPLAIN with resumeGate=MATTERS', () => {
    const state: DiscoveryState = { gate: 'MATTERS', slots: { audience: 'for-her' } }
    const result = suspendForExplain(state)
    if (result.gate === 'EXPLAIN') {
      expect(result.resumeGate).toBe('MATTERS')
    }
  })

  it('idempotent: already-EXPLAIN state keeps original resumeGate', () => {
    const alreadyExplain: DiscoveryState = {
      gate: 'EXPLAIN',
      resumeGate: 'WHO',
      slots: { category: 'anal' },
    }
    const result = suspendForExplain(alreadyExplain)
    expect(result.gate).toBe('EXPLAIN')
    if (result.gate === 'EXPLAIN') {
      // resumeGate must still be WHO, not overwritten
      expect(result.resumeGate).toBe('WHO')
    }
  })

  it('preserves slots on suspension', () => {
    const state: DiscoveryState = {
      gate: 'WHO',
      slots: { category: 'wear', audience: 'for-her' },
    }
    const result = suspendForExplain(state)
    expect(result.slots).toEqual({ category: 'wear', audience: 'for-her' })
  })
})

// ─── resumeFromExplain ────────────────────────────────────────────────────────

describe('resumeFromExplain', () => {
  it('resumes to WHO gate with original slots', () => {
    const explainState: DiscoveryState & { gate: 'EXPLAIN' } = {
      gate: 'EXPLAIN',
      resumeGate: 'WHO',
      slots: { category: 'anal' },
    }
    const resumed = resumeFromExplain(explainState)
    expect(resumed.gate).toBe('WHO')
    expect(resumed.slots.category).toBe('anal')
  })

  it('resumes to MATTERS gate', () => {
    const explainState: DiscoveryState & { gate: 'EXPLAIN' } = {
      gate: 'EXPLAIN',
      resumeGate: 'MATTERS',
      slots: { audience: 'for-him' },
    }
    const resumed = resumeFromExplain(explainState)
    expect(resumed.gate).toBe('MATTERS')
    expect(resumed.slots.audience).toBe('for-him')
  })

  it('resumes to READY gate when audience is present in slots', () => {
    const explainState: DiscoveryState & { gate: 'EXPLAIN' } = {
      gate: 'EXPLAIN',
      resumeGate: 'READY',
      slots: { category: 'anal', audience: 'for-him', matters: ['quiet'] },
    }
    const resumed = resumeFromExplain(explainState)
    expect(resumed.gate).toBe('READY')
    if (resumed.gate === 'READY') {
      expect(resumed.slots.audience).toBe('for-him')
    }
  })

  it('READY resume without audience falls back to MATTERS', () => {
    const explainState: DiscoveryState & { gate: 'EXPLAIN' } = {
      gate: 'EXPLAIN',
      resumeGate: 'READY',
      // No audience in slots (edge case)
      slots: { category: 'lube' },
    }
    const resumed = resumeFromExplain(explainState)
    expect(resumed.gate).toBe('MATTERS')
  })

  it('slots captured during EXPLAIN turn carry forward on resume', () => {
    // Simulate: customer provided category during the explain turn
    const explainState: DiscoveryState & { gate: 'EXPLAIN' } = {
      gate: 'EXPLAIN',
      resumeGate: 'WHO',
      slots: { category: 'anal', audience: 'for-him' }, // audience arrived mid-explain
    }
    const resumed = resumeFromExplain(explainState)
    expect(resumed.slots.audience).toBe('for-him')
    expect(resumed.slots.category).toBe('anal')
  })
})

// ─── isHighStakesCategory ────────────────────────────────────────────────────

describe('isHighStakesCategory', () => {
  it('anal → true (plug/anal subtypes require WHO)', () => {
    expect(isHighStakesCategory('anal')).toBe(true)
  })

  it('dildo → true', () => {
    expect(isHighStakesCategory('dildo')).toBe(true)
  })

  it('harness → true', () => {
    expect(isHighStakesCategory('harness')).toBe(true)
  })

  it('wear → true', () => {
    expect(isHighStakesCategory('wear')).toBe(true)
  })

  it('lube → false', () => {
    expect(isHighStakesCategory('lube')).toBe(false)
  })

  it('vibrator → false', () => {
    expect(isHighStakesCategory('vibrator')).toBe(false)
  })

  it('wand-style (vibrator) → false', () => {
    expect(isHighStakesCategory('vibrator')).toBe(false)
  })

  it('undefined → false', () => {
    expect(isHighStakesCategory(undefined)).toBe(false)
  })

  it('couples → false', () => {
    expect(isHighStakesCategory('couples')).toBe(false)
  })
})

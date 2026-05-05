# Golden Conversations — How to Add a New Fixture

Golden fixtures are JSON files in `evals/fixtures/`. Each file is named
`NNN-descriptive-slug.json` (3-digit number, kebab-case slug).

## Fixture format

```json
{
  "id": "031-my-new-fixture",
  "description": "One sentence: what scenario this tests and why it matters.",
  "channel": "sms",
  "priorSummary": "The rolling conversation summary that would be injected. Or null for first-contact tests.",
  "priorSlots": { "audience": "for-her", "category": "vibrator" },
  "pitchedHandlesLog": ["lovense-domi-2"],
  "turns": [
    { "role": "user", "text": "the customer message" },
    { "role": "expected_behavior", "tags": ["tag-one", "tag-two"] }
  ],
  "evalDimensions": ["memory", "coherence", "no_derail", "voice_rules", "no_fabrication", "emma_voice"],
  "regressionFor": null
}
```

## Available evalDimensions

| Dimension | What it scores |
|---|---|
| `memory` | Does Emma use priorSummary, priorSlots, and pitchedHandlesLog? |
| `coherence` | Does Emma acknowledge the customer's actual message? |
| `no_derail` | Does Emma stay on topic vs. reverting to DISCOVERY inappropriately? |
| `voice_rules` | No em-dashes, no "sex" as adjective, correct billing descriptor, URL rules. |
| `no_fabrication` | No invented URLs, prices, or specs. |
| `emma_voice` | Warm, trusted-friend register. Not clinical, not sleazy. |

## Naming expected_behavior tags

Tags are free-form but should be self-describing. Good examples:
- `uses_prior_context`
- `no_em_dash_in_reply`
- `url_on_own_line`
- `validates_vulnerability`
- `no_reintroduce`

Bad: `correct` (too vague), `test` (says nothing).

## When to add a new fixture

Add a fixture whenever:
1. A customer reports a specific derail or trust failure.
2. A prompt change is made that could regress a known-good behavior.
3. A new channel or stage is introduced.

Keep the total fixture count reasonable: 30 is the Phase 0 baseline. Grow by
5-10 per month from real failure modes that customer-service-emma surfaces.

## Gating fixtures

Fixtures 007 and 008 are phase-gating fixtures (architect condition #3). Their
`memory` dimension score must be >= 4 for the Phase 0 gate to pass. Do not
change these fixtures without architect sign-off.

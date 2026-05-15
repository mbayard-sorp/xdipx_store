# Discovery Prototype — Reference Only

These files are the design source of truth for the "Find you in a product"
home page redesign (concepts A and B). Authored in Claude Design, exported
2026-05-14.

**Not production code.** Match the visual output, not the internal structure.

- `concepts/concept-a.html` — Variant A "The Compass" (chip rows + passive Emma sidekick)
- `concepts/concept-b.html` — Variant B "Emma Asks" (conversational hero)
- `concepts/concept-c.html` — Variant C "Sentence Bar" (explored, not in production scope)
- `assets/shared.css` — brand tokens + chip/card/rail atoms used by all three
- `assets/products.js` — sample taxonomy + scoring/title/Emma copy functions
- `assets/emma.png` — Emma avatar (square portrait)

To preview locally, open any `concepts/*.html` directly in a browser.

## Deviations from prototype in production

- **Stack:** React Router v7 framework mode, not Next.js. State lives in URL
  search params + a small client store mirror, not a Zustand-only store.
- **Tags:** Shopify metafields `xdipx.mood_tags / audience_tags / matters_tags`
  are the source of truth.
- **Fonts:** prototype uses Newsreader / DM Sans / JetBrains Mono. xdipx is
  locked on Archivo / Inter (per `CLAUDE.md`). Italic Archivo carries the
  editorial gesture in production.
- **Plum accent:** prototype uses `#7a2bb8` for italic emphasis. `CLAUDE.md`
  forbids reintroducing purple. Production uses coral for emphasis unless
  this is explicitly reversed by Mike for the discovery surface.

# Internal Linking Doctrine

> Single source of truth for how the Notebook, PDPs, collections, and homepage link to each
> other. Binding for `content-writer` and the homepage merchandiser. The voice charter
> (`docs/emma-voice.md`) outranks this file for any customer-facing words; this file governs
> link mechanics only.

Internal links are how the store's content library compounds: a durable answer page earns a
citation, the reader (or an LLM) follows a link to a product, and the product page points back
into the library. Search engines and answer engines read that graph as topical authority. The
whole point of the daily Notebook post is to thicken this graph one page at a time.

## The one rule that powers everything: embed the right product handle

Posts feature products with the `blogProductEmbed` block (`{ productHandle, ctaLabel, layout }`).
That `productHandle` string is not just a card on the post — it is the key the rest of the site
reverse-looks-up to build **inbound** links back to the Notebook. When you embed
`womanizer-next` in a post:

- the **PDP** at `/products/womanizer-next` shows a "From the Notebook" section linking your post,
- every **collection** that contains that product shows your post in its "From Emma's notebook" rail,
- `guides`-category posts additionally emit ItemList JSON-LD of the embedded products.

None of that requires any extra action, and there is no Sanity reference to maintain — it all keys
off the handle string. The corollary is load-bearing: **a missing or misspelled `productHandle`
silently breaks the inbound links.** Verify every handle resolves (200 on `/products/{handle}`,
in-stock) before embedding. This is the single highest-leverage habit for internal linking.

## Outbound: every post links out (mandatory)

Every post, no exceptions:

- **At least one honest `blogProductEmbed`** for an in-stock product the answer genuinely serves.
- **At least one collection link** and **one PDP link**, naturally placed in prose, using the
  canonical forms below. Ranked buying guides use `blogCategory: guides` so the ItemList JSON-LD
  generates.
- **`relatedPosts`** (max 3) to sibling posts where relevant; the post also auto-relates within its
  category, so manual picks are for cross-category or cornerstone links.
- Build **topical clusters** (guide + comparison + care all embedding products from the same
  collection) so a few collections earn category-query citations faster than one-off posts.

## Inbound: automatic, do not hand-maintain

These surfaces link back into the Notebook automatically. Do not build or hand-edit them per post:

| Surface | What it shows | Powered by |
|---|---|---|
| PDP `/products/{handle}` | "From the Notebook" — up to 3 posts embedding this product | `getNotebookPostsForProduct` reverse lookup on `blogProductEmbed.productHandle` |
| Collection `/collections/{handle}` | "From Emma's notebook" — posts featuring a product in the collection, else latest | `getNotebookPostsForProductHandles`, fallback to latest |
| Homepage "From the Notebook" | Latest 3 published posts, auto-refreshed | homepage loader `getBlogPosts({ perPage: 3 })` |

The homepage section **auto-populates** with the latest posts. A curated `editorialTiles` block is
an **optional override** for a deliberate editorial pick — it is no longer the only way content
reaches the homepage, and the merchandiser should not touch it just to keep it fresh.

## Canonical link forms

- Product: `/products/{slug}` (never a Shopify `/products/...?variant=` or collection-scoped URL).
- Collection: `/collections/{handle}` — validate the handle against the live collection list first.
- Notebook post: `/notebook/{slug}`.
- No prices or discount framing in body prose (MAP-safe, evergreen); the PDP owns price.

## Where this is enforced

- `.claude/agents/content-writer.md` `<content_quality_rules>` and
  `docs/store-team/routine-content-daily.md` Step 4 reference this file.
- `docs/store-team/content-plan.md` §7 points here for the per-post link rules.
- `docs/homepage-team/routine-daily-merchandise.md` and `docs/homepage-team/mission-brief.md`
  reference the auto-populate behavior so the merchandiser treats `editorialTiles` as an override.

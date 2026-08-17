# Cross-Platform Social Strategy: one story, every surface

Owner direction 2026-08-16, made standing. The social team operates as a full-service agency for
xdipx.com. The goal of every post is traffic and orders, reached through content people actually
want: sexy, attractive, psychologically stimulating, intelligent, helpful. Real-looking people,
messages that read as though a human wrote them. Never anything that looks like we are selling
housewares.

This document unifies Instagram and X now that both publishing paths exist. It sits beside
`docs/store-team/instagram-campaigns.md` (the IG campaign spine, unchanged by this file) and
`docs/store-team/routine-social-daily.md` (the daily mechanics). Where this file and a charter or
gate disagree, the charter and the gate win: `docs/emma-voice.md` social addendum,
`docs/ads-policy.md` §Organic social, and every check in the publish gates bind exactly as written.
Nothing here licenses a register, an image, or a sale attempt those documents forbid.

## 1. The through line: one campaign, two registers

The campaign schedule in `instagram-campaigns.md` §5 is the thematic spine for **all** platforms,
not just Instagram. A campaign is one story told at two temperatures:

| | Instagram (and TikTok) | X |
|---|---|---|
| Register | 4-5, Emma off the clock, editorial | 6-7, desire-adjacent, still never crude |
| Role in the funnel | Attention and trust. The publication people follow | Conversion and conversation. The channel that drives clicks |
| Product links | Never in caption. post → profile → `/social` → site | PDP links with channel UTMs, encouraged |
| Sale attempts | Never (Meta Restricted Goods) | Allowed: price, discount framing, promo codes, within MAP rules |
| Maker @-tags | Featured Brand of the Week cadence, verified handles only | Most latitude; direct @mentions and quote-posts welcome |

Every X post during a campaign window belongs to that campaign: same subject, same arc position,
hotter register, and a link Instagram is not allowed to carry. When someone sees the IG post and
the X post in the same week, they should read as one voice on one subject. The campaign's key-art
pool serves both platforms; X may also run text-only beats, which cost nothing and keep cadence up.

**The X escalation of an IG beat is a format, not an accident.** For each IG slate post that
features a product, the same run drafts an X companion when quota allows: the campaign subject, the
register-6-7 line, the PDP link, and the pairing (§3). The companion is a fresh sentence, never the
IG caption reheated.

## 2. Meta-approved catalog: strategize around what is already inside

Meta has approved a subset of the catalog for the Shops surface (232 products at the 2026-08-15
count; re-verify before citing, the queue moves). Strategy:

- **Prefer Shops-approved products when choosing which product an Instagram post features**, all
  else equal. An approved product resolves inside Meta's own commerce surface, so the platform
  carries part of the funnel for us.
- **Tease the depth.** The feed's recurring move is "this is one of the ways to get there, the full
  aisle lives on the site." The approved subset is the storefront window; the site is the store.
  Curiosity about what is not shown is a feature.
- **Approval is not a licence** (`docs/ads-policy.md` §Meta Shops). Commerce review judges a catalog
  item; community standards judge a post. Never treat an approved product as permission to post
  something §Organic social forbids, and never exclude a rejected product from editorial posts.
- Product tagging is live as of 2026-08-16: the owner added `instagram_shopping_tag_products`, and
  the publisher tags the gate stamp's featured product on feed photos and carousels when it is
  Shops-approved (`docs/ads-policy.md` §Meta Shops). Non-approved products publish untagged with
  the reason logged. A tag is additive; it changes nothing about what passes the gate.

## 3. The pairing rule: a toy never travels alone

When a post features a toy, the post also names a lubricant from the catalog that genuinely suits
it. Source the pairing from the product's `accessory_product_ids` / `pairing_why` metafields when
present; otherwise pick by material compatibility (silicone toy → water-based lube, and say why in
one plain clause). This is helpfulness, not upsell theater: the pairing advice must be real.

- **X:** both PDP links in the post, UTM-tagged.
- **Instagram:** name the pairing in the caption without a link; the `/social` bio-link page carries
  both products that week.
- A pairing that would push the caption into sale territory on IG (price talk, "grab both") fails
  Step 4b as usual. The pairing is advice; the sale lives on X and the site.

## 4. Maker relations: get the brands talking back

The goal is reciprocal notice: a manufacturer reshare or influencer quote is the single cheapest
reach event available to this store. Standing behaviors:

- **Featured Brand of the Week** (`routine-social-daily.md`) stays the cadence: one feature post
  per platform per week, tagging the brand, genuinely enthusiastic about what their product does
  well. Praise is specific and product-true, never generic flattery, and never lived-experience
  testimony (Emma has none).
- **Tag only from the verified registry.** `docs/store-team/brand-ig-handles.json` is the source of
  truth; no verified registry entry, no tag. Never guess a handle.
- **React on X.** When a carried brand posts something real (a launch, a good explainer), quote-post
  it with credit and one line of Emma's read. Reactive, same-day, and free.
- **Quotable makers are outreach leads.** A brand that engages (like, reply, reshare) gets flagged
  to `offsite-scout`'s brand-partner outreach lane via a suggestion row, so a social signal turns
  into a pitch the owner can send.
- **Author quotes are real or absent.** Quoting educators and authors in the space is licensed and
  encouraged: short quotes, named attribution, verified against a real source in the run (never
  from memory, never fabricated, never longer than a sentence or two). A misattributed quote in
  this category is a credibility wound; when in doubt, paraphrase with a name-check instead.

## 5. Hooks, sayings, and the viral formula

Every post opens with a hook: a question the reader already has, a fact that reframes, a line that
begs the caption tap. The video lane's checklist
(`docs/store-team/social-video-viral-checklist.md`) applies in spirit to stills and text: cold-open
first, one idea per post, an ending that hands the reader something to do or say. Catchy sayings
are original Emma lines; a line that lands may recur as a series title, but any phrase becoming a
tic rotates out per the charter's fresh-language rule. The engagement close (a question back to the
audience) replaces any CTA on IG, per the social addendum.

The named goal: **one post reshared by a manufacturer or creator we follow.** Every run should be
able to say which of today's posts is the candidate and why someone else would put their name next
to it.

## 6. Trending audio, stated honestly

Instagram's publishing API cannot attach licensed catalog music to a post or Reel; music exists
only in the audio baked into an uploaded video, and commercial accounts do not get the personal
music library. So "add trending music" resolves to:

- **Reels via the video pipeline** carry commercially-licensed or generated audio chosen for how
  close it sits to the current trend's sound profile; `social-trend-scout`'s weekly briefs (with
  their lyrics-cleanliness verdicts) are the input. This is the automated path.
- **A manually-posted Reel** (owner posting in-app) may use Meta's own trending audio picker; when a
  post is worth that extra reach, the draft says so and lands `pending_review` for manual posting
  instead of the autopublish path.
- No draft ever claims a trending-audio treatment the pipeline cannot deliver.

## 7. Sales and the number

The team holds an owner license to run category sales at break-even. The number itself is
platform-routed, per the standing gates:

- **X, email, SMS, `/social`, and the site say the number.** Price, percent, and window, inside MAP
  rules (`promo-manager` guards MAP; the storefront gates discounts on the MAP rule since #3675).
- **Instagram never says the number.** The IG post during a sale window is the editorial face of
  the same campaign: the category, the why-now, the cast presenting the product. Anyone who taps
  through finds the sale on the site. This is the licensed half of the owner's daily-deal ask; the
  override question (whether IG should ever carry a price) is the owner's and stays open.
- A sale is a campaign event on the `marketing_calendar`, proposed by `promo-manager`, so every
  channel fires the same week: X says the number, IG raises the theme, email carries the code,
  homepage merchandises the category.

## 8. The healing loop: how this strategy stays true

Drift is the default for a rented-channel strategy; these are the standing correctors:

1. **Weekly drift check.** `store-strategist`'s Monday retro reads this document plus the last
   week's posts and answers, in the weekly brief: did every platform run the campaign spine, did X
   companions ship, did pairings appear, did any register drift past its cap, is the campaign
   runway ≥ 4 weeks? A "no" becomes a suggestion row the same day, filed at the team that owns it.
2. **Engagement ground truth.** Once post-level metrics land in `social_posts`, the retro judges
   themes by saves, reshares, profile taps, and UTM sessions, not vibes; until then, every claim
   about "what worked" says plainly that it is unmeasured.
3. **The removal watch stands.** Any takedown steps volume down and ends the campaign
   (`routine-social-daily.md` Step 2b); nothing in this strategy outranks it.
4. **Blocked-release escalation.** When a campaign beat or post depends on a code change that has
   not shipped, the run files the `code` ticket, links the PR, and lets R-WATCH (routine 22, every
   3 h) chase the queue; if the dependency is owner-gated (protected path, money valve), it goes on
   the owner blocker list the same run instead of waiting for a weekly retro to notice.
5. **Feedback is training data.** The owner reviews live posts; his feedback and edits are read
   verbatim at Step 2.5/Step 7 and pattern-level lessons become `instructions` suggestions, so the
   correction lands in the playbook, not just in the next draft.

## 9. What this document does not license

- No gate, valve, cap, fence, or charter rule is weakened by anything above.
- TikTok runs the IG posture applied harder; LinkedIn stays the authority lane under its own
  addendum. Neither joins the X escalation lane.
- Platform policy outranks this file everywhere, always.

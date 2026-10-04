# Content corrections log

Evidence record for accuracy corrections made directly to already-published Notebook posts in
Sanity, outside the normal draft-then-publish flow in `routine-content-daily.md`. Each entry names
the ticket, what was wrong, what changed, which gates verified it, and the live-site confirmation.
Append, never edit a past entry.

## Ticket #13503 — can-you-share-sex-toys-safely wash/barrier equivalence (2026-10-04)

**Defect.** `/notebook/can-you-share-sex-toys-safely` (published 2026-10-03) told readers that for
a non-porous toy, "a wash or a fresh barrier" before it reaches the next person and "either one is
enough on its own." The sex-wellness-reviewer accuracy gate had already blocked the identical claim
in a same-day draft (run 1239), tracing it to the opposite of what the primary source says. The post
also framed sharing a porous toy as fine with a barrier, rather than discouraged outright.

**Correction.** Six blocks in `blogPost-can-you-share-sex-toys-safely` (Sanity, project `0nlwk8cf`,
dataset `production`): the H2 direct answer, the porous-materials paragraph, the handoff-section
intro, and three FAQ answers. The equivalence claim is gone; the non-porous answer now states that a
wash lowers the risk without clearing it, scoped to the actual finding (both silicone and TPE
vibrators showed potential HPV transmission immediately after cleaning with a commercial device
cleaner, per Rullo et al. 2018), with a fresh barrier as the more cautious step. A porous toy is now
stated as not to be shared, barrier-only as a fallback if shared anyway. Two Sources entries were
added citing Rullo et al. 2018 (Sexual and Relationship Therapy) and Healthline's sex-toys-and-STIs
guidance.

A sibling post, `blogPost-what-makes-a-vibrator-body-safe`, had its FAQ "Can you share a vibrator
with a partner?" answer's outbound link to the flawed post removed by the routine that caught the
original defect (so a reader wasn't sent from a correct answer to an incorrect one). That link is
restored now that the destination is corrected. While editing that block, a second, pre-existing,
unrelated defect surfaced and was fixed in the same edit: the answer misattributed a "washing
reduces risk without eliminating it" claim to Healthline, which does not say this; the corrected text
attributes the residual-risk point to the (correctly scoped) Rullo HPV finding instead.

**Gate verification.** Two full accuracy-gate passes plus one voice-gate pass, run as subagents
against the live source text (Rullo et al. 2018, PMC7678780; Healthline sex-toys-and-STIs), not
search snippets:

- Pass 1 (sex-wellness-reviewer): found the core equivalence/porous-sharing reversal correct and
  necessary, but flagged 4 of 6 blocks as overstating certainty beyond what the sources support
  (Rullo hedges "evidence is lacking" for non-porous cleaning generally; the HPV finding is scoped to
  a commercial device cleaner, not washing broadly), plus a wrong journal title in the new Sources
  entry ("Sex and Relationship Therapy" instead of "Sexual and Relationship Therapy").
- Voice gate (emma-empathy-reviewer): passed 6 of 7 strings on the hard rules (no em-dashes, no
  lived-experience claims, no crude language); flagged one syntax/parse ambiguity in the anal-use FAQ
  answer's first sentence (comparative claim read as a sequence).
- Pass 2 (sex-wellness-reviewer, revised text): confirmed the hedge language now correctly scoped to
  the sources, journal title corrected, syntax fixed. Found one new instance of the same scope issue
  in the sibling post's restored-link paragraph (the HPV finding generalized to "a wash" rather than
  "cleaned with a commercial device cleaner").
- Pass 3 (sex-wellness-reviewer, final scoping fix): confirmed PASS on all blocks in both posts.

**Editorial-policy note for QA/owner review.** `content-plan.md` §7 says "No backfill: published
posts are not retro-edited to add sources." This correction adds two Sources entries to an
already-published post, which matches that sentence literally. My read: that rule is about padding
citations onto a post that didn't need them at original publish, not about an accuracy correction
whose added claims are sourced to the evidence the fix itself rests on (an uncited specific-study
claim would be its own accuracy-gate problem). Flagging the tension here rather than deciding it
alone, since it's a content-policy call, not something the gates can settle.

**Live confirmation.** Both documents patched via Sanity MCP (`patch_documents`, `ifRevisionId` guard
against the read revision) and published (`publish_documents`). `POST /api/revalidate/blog` returned
`{"ok":true}` for both slugs. A published-perspective GROQ read after publish confirmed the corrected
`b4` text and the 2 new Sources blocks are live on `blogPost-can-you-share-sex-toys-safely`.

**Executor.** This correction needed a Sanity write plus a gate pass, not a code diff — rr7-engineer's
own charter excludes Sanity-scoped work, so there is no code PR for the content change itself. This
file is the evidence record satisfying ticket #13503's bus requirement for a reviewable artifact.

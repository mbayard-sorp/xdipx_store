# ADR-013: Social Studio v2 data model and gate semantics

Status: Proposed 2026-08-22 (owner all-hands). Plan: `docs/store-team/social-studio-plan.md`.

## Context

`/admin/socials` is a review queue over `social_posts` with no image library, no persisted
prompts, date-only scheduling, no permalink, no metrics surface, and a gate stamp stored as a
tagged string inside the `feedback` column. The owner wants a full social management system.

## Decisions

1. **Index in Neon, binaries in Sanity.** New `social_media_assets` table is the searchable index
   (prompt, negatives, provider, model, archetype, aspect, product, cast slugs, tags, batch id,
   source, picked, usage). Binaries upload via `uploadBufferToSanity`. No new Sanity doc type in
   v1. Alternative considered: a `socialAsset` Sanity doc type as primary (media-manager's
   preference). Rejected for v1 because search and usage need joins against `social_posts`, and
   because leaving the Sanity schema untouched removes one migration seam. Can be added as a
   mirror later.
2. **Slides as rows** (`social_post_slides`), `media_urls` kept as the publish-time snapshot so
   publishers and the publish job are unchanged.
3. **Gate state gets its own columns** (`gate_status`, `gate_checked_at`, `gate_findings`).
   Eligibility reads `gate_status = 'pass'`, not a regex over `feedback`.
4. **Approved to draft always invalidates the gate stamp.** `reworkSocialPost` accepts `approved`
   as a source status and unconditionally clears gate and review fields.
5. **Provenance is library membership**, dual-checked with the filename prefix during a burn-in,
   then prefix removed. Owner uploads enter the same ingest with `source='upload'`.
6. **Owner-composed posts obtain a real gate verdict** via an admin-authenticated route that
   calls `applyPublishGateVerdict` in-process. No self-stamp UI.
7. **Owner-initiated generation bills the social team budget** through a dedicated admin route.
8. **`scheduled_at timestamptz`** with read-time `COALESCE` over legacy `scheduled_for`; no
   backfill UPDATE in a migration file.
9. **`permalink` column**, written at publish, backfilled by the metrics sweep.
10. **Metrics sweep cron** behind its own spend valve (owner lane).
11. **Nested routes** under `admin.socials.tsx` replace client-side tabs.

## Consequences

- Migration 084 is purely additive and rides the ordinary lane once `migration-dry-run` is green.
- The only owner-lane item is the metrics spend valve.
- Highest-risk change is the provenance cutover (Phase 2); the dual-check window is mandatory.
- Phase 4 touches live publish eligibility; QA must exercise the hourly tick against a scheduled
  row before and after.

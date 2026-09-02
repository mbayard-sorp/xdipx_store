-- 092_owner_blockers_dedupe_key_canonicalize.sql
-- One-time canonicalization of owner_blockers.dedupe_key for rows written
-- before app/lib/owner-blockers.server.ts's fileBlocker started canonicalizing
-- on write. Ticket #7044.
--
-- Bug: fileBlocker() canonicalizes dedupe_key on write (via canonicalDedupeKey,
-- app/lib/dedupe-key.ts), but rows inserted before that canonicalization
-- landed still hold their raw, pre-canonical keys. Re-filing one of those
-- blockers today canonicalizes the incoming key and misses the stored raw
-- row on `ON CONFLICT (dedupe_key)`, inserting a duplicate instead of
-- updating the existing one -- reproduced live 2026-09-02: blocker #16
-- ('runpod:vercel-env') failed to match on re-file, inserting #69
-- ('runpod-vercel-env') as a duplicate, even though the near-duplicate
-- detector correctly flagged them as score 1.
--
-- NOT ADDITIVE: this file is UPDATE (DML), not DDL. Per
-- scripts/apply-additive-migrations.ts, a data-mutating statement never
-- auto-applies at build time and stays on the manual path
-- (scripts/apply-migrations.ts), same as app/lib/github.server.ts's
-- migration classifier: this PR is protected-path and needs an owner to run
-- it, not just merge it.
--
-- Scope: every row whose stored dedupe_key differs from its canonical form,
-- computed 2026-09-02 against production via canonicalDedupeKey(raw,
-- { maxLength: 80 }) (owner_blockers.dedupe_key is varchar(80)). Eleven rows
-- matched; one of them (#16, 'runpod:vercel-env' -> 'runpod-vercel-env') is
-- deliberately excluded here because #69 already holds that exact canonical
-- key (inserted after canonicalization landed, as the duplicate this bug
-- produced) -- updating #16 to match would violate the
-- owner_blockers_dedupe_key_key unique index. #16 is dismissed and #69 is
-- cleared, so leaving #16's stale key in place is harmless: nothing refiles
-- against it, and no open blocker is affected. Merging the two historical
-- rows is a separate, judgment-call cleanup, not this migration's job.
--
-- Scoped by id AND the current dedupe_key value, so a second run (or a run
-- against a DB where one of these rows was already canonicalized by hand)
-- is a no-op rather than clobbering a newer write.
--
-- Apply (manual, owner-run): DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 092
-- Idempotent: safe to re-run.

UPDATE owner_blockers SET dedupe_key = 'approve-cast-faces'
  WHERE id = 3 AND dedupe_key = 'approve-cast-faces-2026-08';

UPDATE owner_blockers SET dedupe_key = 'autonomy-v2-protected-merges'
  WHERE id = 4 AND dedupe_key = 'autonomy-v2-protected-merges-2026-08';

UPDATE owner_blockers SET dedupe_key = 'auto-approve-email-video'
  WHERE id = 5 AND dedupe_key = 'auto-approve-email-video-2026-08';

UPDATE owner_blockers SET dedupe_key = 'cadence-and-merge-cap'
  WHERE id = 6 AND dedupe_key = 'cadence-and-merge-cap-2026-08';

UPDATE owner_blockers SET dedupe_key = 'research-egress-policy'
  WHERE id = 9 AND dedupe_key = 'research-egress-policy-2026-08';

UPDATE owner_blockers SET dedupe_key = 'no-shopify-webhooks-registered'
  WHERE id = 10 AND dedupe_key = 'no-shopify-webhooks-registered-2026-08';

UPDATE owner_blockers SET dedupe_key = 'cast-roster-age-gap'
  WHERE id = 11 AND dedupe_key = 'cast-roster-age-gap-2026-08';

UPDATE owner_blockers SET dedupe_key = 'runpod-account'
  WHERE id = 14 AND dedupe_key = 'runpod:account';

UPDATE owner_blockers SET dedupe_key = 'runpod-volume-endpoint'
  WHERE id = 15 AND dedupe_key = 'runpod:volume-endpoint';

UPDATE owner_blockers SET dedupe_key = 'runpod-claude-plugin'
  WHERE id = 17 AND dedupe_key = 'runpod:claude-plugin';

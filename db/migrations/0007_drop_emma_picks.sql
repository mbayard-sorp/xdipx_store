-- Retired: emma_pick_groups + emma_pick_runs. Emma context rails now live in
-- Sanity (doc type emmaContextRail). Editors use Studio; the generation layer
-- writes picks back to the document. No Postgres storage needed.
DROP TABLE IF EXISTS "emma_pick_runs";
DROP TABLE IF EXISTS "emma_pick_groups";

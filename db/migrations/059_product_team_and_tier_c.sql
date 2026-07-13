-- 059_product_team_and_tier_c.sql
-- Bridges product management into the agent team + strategy (see the approved
-- plan / docs/import-monitor-runbook.md). Two additive setting groups, both OFF
-- by default so nothing changes behavior until the owner flips them:
--
--   1. The seventh agent team: `product` (daily import-queue drain routine).
--      Ships OFF. The per-item execute gate (product_manager_enabled) is a
--      separate, pre-existing switch already turned on by migration 052.
--   2. Phase-2 Tier-C auto-import gates. Tier C = the Nalpac new-products feed
--      (fresh releases). A separate, stricter branch than tier A/B, with its own
--      small daily sub-cap. Ships OFF pending a clean week of A/B auto-import.
--
--   DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 059

INSERT INTO pipeline_settings (key, value, updated_at) VALUES
  -- product team (routine gate; mirrors the content team, migration 054)
  ('product_team_enabled',     'false', NOW()),
  ('product_team_daily_cents', '300',   NOW()),
  ('product_team_max_runs',    '1',     NOW()),
  -- Tier-C auto-import gates (stricter than A/B: markup 0.08 / qty 30 / gap 3.0)
  ('monitor_p2_tierC_enabled',        'false', NOW()),
  ('monitor_p2_tierC_min_qty',        '60',    NOW()),
  ('monitor_p2_tierC_min_gap_score',  '4.5',   NOW()),
  ('monitor_p2_tierC_min_markup_pct', '0.15',  NOW()),
  ('monitor_p2_tierC_max_per_day',    '3',     NOW())
ON CONFLICT (key) DO NOTHING;

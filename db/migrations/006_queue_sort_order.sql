-- Add sort_order column for drag-and-drop queue ordering
ALTER TABLE "deal_history" ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0;

-- Backfill sort_order from existing dealDate ordering for non-completed deals
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY deal_date ASC, id ASC) as rn
  FROM deal_history
  WHERE completed_at IS NULL AND status != 'live'
)
UPDATE deal_history SET sort_order = ranked.rn
FROM ranked WHERE deal_history.id = ranked.id;

-- Migrate statuses: draft/scheduled -> queued
UPDATE "deal_history" SET "status" = 'queued' WHERE "status" IN ('draft', 'scheduled', 'pending');

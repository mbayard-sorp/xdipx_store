-- 073_profit_summary_cogs_missing.sql
-- Records how many units in a day's orders had no resolvable wholesale cost.
--
--   DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 073
--
-- Why:
--  The rewritten writeProfitSummary() resolves per-SKU COGS from three
--  sources in order (the order's own xdipx.profit_<sku> metafield, the
--  variant's inventory-item unit cost, then the product's wholesale_cost
--  metafield). When all three miss, the honest answer is "cost unknown", not
--  "cost zero" — a zero would silently inflate margin, which is exactly the
--  class of quiet lie that let daily_profit_summary report $0 revenue on real
--  paid orders for a month. Those units are excluded from total_cogs and
--  counted here instead, and the owner digest surfaces a non-zero count so a
--  margin number is never trusted more than its inputs deserve.

ALTER TABLE daily_profit_summary
  ADD COLUMN IF NOT EXISTS cogs_missing_units integer NOT NULL DEFAULT 0;

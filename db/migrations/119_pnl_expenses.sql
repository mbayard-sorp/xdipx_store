-- 119: one-off expenses for the admin P&L (/admin).
--
-- Recurring vendor costs already have a ledger (fixed_monthly_costs, 094). This
-- is the other half: dated, one-time money out that no API reports, such as a
-- newsletter sponsorship, a sample order, a contractor invoice or a Nalpac
-- shipping bill. Category 'advertising' rolls into the P&L's marketing section
-- next to imported ad-platform spend, 'fulfillment' into cost of sales, and
-- everything else into operating expenses.
--
-- ADDITIVE: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS only, so
-- the production build applies it unattended. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS pnl_expenses (
  id            serial PRIMARY KEY,
  expense_date  date          NOT NULL,
  category      varchar(24)   NOT NULL,
  vendor        varchar(80)   NOT NULL,
  amount_usd    numeric(10,2) NOT NULL,
  note          text,
  created_by    varchar(255),
  created_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pnl_expenses_date
  ON pnl_expenses (expense_date);

-- 122: Nalpac invoices for the admin P&L (/admin, Costs tab).
--
-- The owner exports Nalpac's order history every two weeks and uploads the
-- CSV. Each invoice carries what Nalpac actually billed for one drop-ship
-- order: freight, and an invoice total of item cost + Nalpac's per-order
-- drop-ship fee + freight. The P&L uses these in place of its estimates
-- (inventory unit cost and NALPAC_SHIPPING_RATES) for every order that has one.
--
-- One row per Nalpac invoice number, so uploading an overlapping export
-- updates rows instead of duplicating them. order_name is the Shopify order
-- ('#1030'), parsed from the PO ('shopify-XDIP-oid-1030'). The ship-to name
-- in the export is customer PII the P&L does not need, so it is not stored.
--
-- ADDITIVE: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS only, so
-- the production build applies it unattended. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS nalpac_invoices (
  invoice_no         varchar(20)   PRIMARY KEY,
  order_name         varchar(20)   NOT NULL,
  po_no              varchar(60)   NOT NULL,
  nalpac_order_no    varchar(20),
  pick_ticket_no     varchar(20),
  order_date         date,
  due_date           date,
  paid_date          date,
  ship_date          date,
  status             varchar(30),
  freight_usd        numeric(10,2) NOT NULL,
  invoice_total_usd  numeric(10,2) NOT NULL,
  carrier            varchar(60),
  tracking_number    varchar(60),
  uploaded_by        varchar(255),
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nalpac_invoices_order_name
  ON nalpac_invoices (order_name);

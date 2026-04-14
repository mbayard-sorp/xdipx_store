-- Pricing config: everyday price as % off MSRP (per-product override of global vaultDiscountPct)
ALTER TABLE "deal_history" ADD COLUMN "pct_off_msrp" numeric(5, 2);

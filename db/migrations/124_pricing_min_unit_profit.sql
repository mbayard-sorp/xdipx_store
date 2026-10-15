-- 124: per-scope dollar floor on unit gross profit for pricing v2.
--
-- pricing_rules only carried percentage margins (target_margin_pct,
-- margin_floor_pct). On cheap items a percentage cannot cover what every
-- order costs regardless of price: a $4.70-cost item at a 35% target prices
-- at $6.99 and keeps $2.29, while the order carries $6.50 Nalpac shipping, a
-- $2.50 drop-ship fee and about 2.9% + $0.30 in payment fees (pricing margin
-- audit 2026-10-15).
--
-- min_unit_profit_usd makes computePrice hold sell >= cost + this value,
-- rounded up to .99, and opts the scope into target-preserving .99 rounding
-- for sells under $20. It inherits like every other pricing_rules field
-- (product_type -> sub_group -> group -> global, NULL inherits). NULL on
-- every row is the default, which leaves pricing exactly as it was until the
-- owner sets a value on /admin/pricing.
--
-- FULLY ADDITIVE: one ALTER TABLE ... ADD COLUMN IF NOT EXISTS. No DROP, no
-- RENAME, no ALTER TYPE, no DML.

ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS min_unit_profit_usd numeric(10,2);

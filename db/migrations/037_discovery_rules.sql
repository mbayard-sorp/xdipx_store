-- 037_discovery_rules.sql
-- Curator-controlled discovery rules for the home page rails.
-- rule_type is enforced as a union in TypeScript, not a DB enum,
-- to keep future migrations cheap.
CREATE TABLE IF NOT EXISTS discovery_rules (
  id          SERIAL PRIMARY KEY,
  rule_type   VARCHAR(40) NOT NULL,
  -- TS union: exclude_product | exclude_product_type | exclude_keyword
  --           | exclude_price_min | exclude_price_max | pin_fallback
  rule_value  TEXT NOT NULL,
  category    VARCHAR(20),  -- 'Pleasure' | 'Play' | 'Body' | 'Wear'; required for pin_fallback, optional scope for excludes
  sort_order  INTEGER NOT NULL DEFAULT 0,  -- only used by pin_fallback (display priority)
  notes       TEXT,                         -- curator note, e.g. "Hide while out of season"
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discovery_rules_active_type ON discovery_rules (active, rule_type);
CREATE INDEX IF NOT EXISTS idx_discovery_rules_pin_lookup  ON discovery_rules (category, sort_order)
  WHERE rule_type = 'pin_fallback' AND active = TRUE;

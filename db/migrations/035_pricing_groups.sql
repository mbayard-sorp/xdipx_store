-- Migration 035: Pricing groups hierarchy, rules, and audit log.
-- Implements the target-margin model from the Pricing Agent refactor spec.
-- The existing pricing_changes table is left untouched (read-only legacy).

CREATE TABLE IF NOT EXISTS pricing_groups (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  uses_clearance_ladder BOOLEAN NOT NULL DEFAULT false,
  sort_order            INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pricing_sub_groups (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES pricing_groups(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS pricing_sub_groups_group_idx ON pricing_sub_groups(group_id);

CREATE TABLE IF NOT EXISTS pricing_product_type_map (
  product_type TEXT PRIMARY KEY,
  sub_group_id TEXT NOT NULL REFERENCES pricing_sub_groups(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS pricing_product_type_map_sub_group_idx ON pricing_product_type_map(sub_group_id);

-- One row per (scope_level, scope_id). NULL on any column means "inherit from parent."
-- scope_level: 'global' uses scope_id='global'; group/sub_group/product_type use
-- the respective id as scope_id.
CREATE TABLE IF NOT EXISTS pricing_rules (
  scope_level               TEXT NOT NULL CHECK (scope_level IN ('global','group','sub_group','product_type')),
  scope_id                  TEXT NOT NULL,
  target_margin_pct         NUMERIC(5,4),
  margin_floor_pct          NUMERIC(5,4),
  map_behavior              TEXT CHECK (map_behavior IN ('at_map','above_map_only','ignore_map')),
  compare_at_strategy       TEXT CHECK (compare_at_strategy IN ('msrp','none')),
  velocity_modifier_enabled BOOLEAN,
  updated_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_by                TEXT,
  PRIMARY KEY (scope_level, scope_id)
);

CREATE TABLE IF NOT EXISTS pricing_audit_log (
  id             BIGSERIAL PRIMARY KEY,
  occurred_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  variant_id     TEXT NOT NULL,
  sku            TEXT,
  product_type   TEXT,
  group_id       TEXT,
  sub_group_id   TEXT,
  trigger        TEXT NOT NULL CHECK (trigger IN ('webhook','batch','manual','clearance_ladder')),
  old_cost       NUMERIC(10,2),
  new_cost       NUMERIC(10,2),
  old_map        NUMERIC(10,2),
  new_map        NUMERIC(10,2),
  old_msrp       NUMERIC(10,2),
  new_msrp       NUMERIC(10,2),
  old_sell       NUMERIC(10,2),
  new_sell       NUMERIC(10,2),
  old_compare_at NUMERIC(10,2),
  new_compare_at NUMERIC(10,2),
  margin_before  NUMERIC(6,4),
  margin_after   NUMERIC(6,4),
  status         TEXT NOT NULL CHECK (status IN ('auto_applied','pending','applied','rejected','skipped_no_change')),
  rationale      TEXT
);

CREATE INDEX IF NOT EXISTS pricing_audit_log_variant_idx  ON pricing_audit_log(variant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS pricing_audit_log_status_idx   ON pricing_audit_log(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS pricing_audit_log_occurred_idx ON pricing_audit_log(occurred_at DESC);

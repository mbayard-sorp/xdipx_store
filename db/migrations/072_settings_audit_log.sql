-- 072_settings_audit_log.sql
-- An attribution trail for every pipeline_settings write.
--
--   DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 072
--
-- Why:
--  pipeline_settings is three columns (key, value, updated_at) with no actor.
--  On 2026-07-18 four *_team_auto_approve_suggestions valves flipped to true
--  within 31 seconds and there is no way to prove who did it or why; the
--  governance docs still described the old posture nine days later. Valves are
--  the system's only real safety boundary (kill switches, spend caps, the
--  release engine's own enable flag), so a change to one has to be
--  attributable after the fact.
--
--  Append-only. old_value is nullable because the first write to a key has no
--  predecessor. actor is the same vocabulary the ticket bus uses
--  ('owner' | 'system' | 'agent:<slug>' | 'migration'); source names the code
--  path that made the write so a surprising flip can be traced to a route.
--  Writes go through setPipelineSettingAudited() in app/lib/settings.server.ts.

CREATE TABLE IF NOT EXISTS settings_audit_log (
  id          bigserial PRIMARY KEY,
  key         varchar(50)  NOT NULL,
  old_value   text,
  new_value   text         NOT NULL,
  actor       varchar(32)  NOT NULL,
  source      varchar(64)  NOT NULL,
  changed_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_settings_audit_key ON settings_audit_log (key, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_settings_audit_changed ON settings_audit_log (changed_at DESC);

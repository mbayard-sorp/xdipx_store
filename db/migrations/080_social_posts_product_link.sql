-- 080: durable product linkage on social posts (ticket #2212).
-- social_posts had zero product linkage before this: the pre-publish gate's
-- stock check only ever saw a productHandle the CALLER supplied at gate time
-- (baked into the feedback stamp), which is why a stale approved draft could
-- publish after its product went out of stock (incident 2026-08-09) with no
-- durable re-check at actual publish time. This column is set once by the
-- drafting writer and read fresh on every publish attempt instead.
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 080
-- Idempotent: safe to re-run.
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS shopify_product_id varchar(60);

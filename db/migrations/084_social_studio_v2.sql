-- 084_social_studio_v2.sql
-- Social Studio v2 data model (ADR-013, ticket #4936, plan
-- docs/store-team/social-studio-plan.md Phase 1).
--
-- Three new tables and seven new nullable columns on social_posts:
--
--   social_media_assets     The image library index. Binaries live in Sanity
--                           (uploadBufferToSanity); this row carries the prompt,
--                           negatives, provider/model, archetype, aspect, product,
--                           cast slugs, tags, batch id, source and pick state so
--                           the Studio can search, filter, tag and reuse every
--                           candidate the generators ever produced, and so the
--                           image-provenance gate check can be "is it in the
--                           library" rather than "does the filename start with
--                           social-".
--   social_post_slides      One row per slide of a carousel draft, ordered by
--                           position. social_posts.media_urls stays the
--                           publish-time snapshot derived from these rows, so
--                           the publish job and both publishers are unchanged.
--   social_follower_history Account-level follower readings appended by the
--                           six-hourly metrics sweep (084 lands after the sweep
--                           shipped in #861; the sweep keeps writing KV until a
--                           later PR points it here).
--
--   social_posts.scheduled_at    timestamptz. The owner schedules to the minute
--                                in America/Los_Angeles; stored UTC. Legacy rows
--                                keep scheduled_for (date) and are read through
--                                COALESCE(scheduled_at, scheduled_for::timestamptz).
--                                NO backfill UPDATE here: a mixed file escalates
--                                the whole file to the owner lane.
--   social_posts.permalink       The live post URL, written at publish (IG via a
--                                second GET, X built from the id).
--   social_posts.gate_status     pass | revise | block | hold, replacing the
--   social_posts.gate_checked_at tagged-string stamp inside `feedback`. Readers
--   social_posts.gate_findings   cut over in Phase 5; until then both are written.
--   social_posts.cast_slugs      Which approved cast members appear in the post.
--   social_posts.updated_at      Plain bookkeeping; nullable, set by writers.
--
-- FULLY ADDITIVE: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS and
-- CREATE INDEX IF NOT EXISTS only. Merges on the ordinary release-engine lane
-- once migration-dry-run is green.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 084
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS social_media_assets (
  id                  serial PRIMARY KEY,
  sanity_asset_id     varchar(120),
  url                 text NOT NULL,
  width               integer,
  height              integer,
  aspect              varchar(12),
  mime_type           varchar(40),
  bytes               integer,
  source              varchar(20) NOT NULL DEFAULT 'generated',
  provider            varchar(40),
  model               varchar(120),
  prompt              text,
  negative_prompt     text,
  archetype           varchar(40),
  product_handle      varchar(255),
  shopify_product_id  varchar(60),
  cast_slugs          jsonb,
  tags                jsonb,
  generation_batch_id varchar(80),
  is_picked           boolean NOT NULL DEFAULT false,
  post_id             integer,
  created_by          varchar(60) NOT NULL DEFAULT 'system',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz
);

CREATE INDEX IF NOT EXISTS idx_social_media_assets_created ON social_media_assets (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_media_assets_product ON social_media_assets (product_handle);
CREATE INDEX IF NOT EXISTS idx_social_media_assets_batch ON social_media_assets (generation_batch_id);
CREATE INDEX IF NOT EXISTS idx_social_media_assets_post ON social_media_assets (post_id);
CREATE INDEX IF NOT EXISTS idx_social_media_assets_url ON social_media_assets (url);
CREATE INDEX IF NOT EXISTS idx_social_media_assets_tags ON social_media_assets USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_social_media_assets_cast ON social_media_assets USING gin (cast_slugs);

CREATE TABLE IF NOT EXISTS social_post_slides (
  id          serial PRIMARY KEY,
  post_id     integer NOT NULL,
  position    integer NOT NULL DEFAULT 0,
  asset_id    integer,
  url         text NOT NULL,
  alt_text    varchar(1000),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_post_slides_post ON social_post_slides (post_id, position);

CREATE TABLE IF NOT EXISTS social_follower_history (
  id           serial PRIMARY KEY,
  platform     varchar(20) NOT NULL,
  captured_at  timestamptz NOT NULL DEFAULT now(),
  followers    integer,
  follows      integer,
  media_count  integer
);

CREATE INDEX IF NOT EXISTS idx_social_follower_history_platform ON social_follower_history (platform, captured_at DESC);

ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS permalink text;
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS gate_status varchar(12);
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS gate_checked_at timestamptz;
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS gate_findings jsonb;
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS cast_slugs jsonb;
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS updated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled_at ON social_posts (platform, status, review_status, scheduled_at);

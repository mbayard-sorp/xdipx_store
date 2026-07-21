-- 064_gsc_index_monitor.sql
-- Per-URL Google index-state tracking via the URL Inspection API.
-- gsc_url_inspections holds current state per sitemap URL (plus the previous
-- coverage state when it changed, for transition reporting). gsc_index_daily
-- is the day-level aggregate the digest and weekly strategy brief read.

CREATE TABLE IF NOT EXISTS gsc_url_inspections (
  url                     TEXT PRIMARY KEY,
  in_sitemap              BOOLEAN NOT NULL DEFAULT TRUE,
  sitemap_lastmod         TEXT,
  first_seen_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_inspected_at       TIMESTAMPTZ,
  inspect_count           INTEGER NOT NULL DEFAULT 0,
  verdict                 TEXT,
  coverage_state          TEXT,
  indexing_state          TEXT,
  robots_txt_state        TEXT,
  page_fetch_state        TEXT,
  last_crawl_time         TIMESTAMPTZ,
  google_canonical        TEXT,
  user_canonical          TEXT,
  previous_coverage_state TEXT,
  coverage_changed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS gsc_url_inspections_stale_idx
  ON gsc_url_inspections (in_sitemap, last_inspected_at ASC NULLS FIRST);
CREATE INDEX IF NOT EXISTS gsc_url_inspections_coverage_idx
  ON gsc_url_inspections (coverage_state);
CREATE INDEX IF NOT EXISTS gsc_url_inspections_changed_idx
  ON gsc_url_inspections (coverage_changed_at DESC);

CREATE TABLE IF NOT EXISTS gsc_index_daily (
  day                    DATE PRIMARY KEY,
  sitemap_urls           INTEGER NOT NULL,
  inspected_urls         INTEGER NOT NULL,
  indexed_count          INTEGER NOT NULL,
  crawled_not_indexed    INTEGER NOT NULL,
  discovered_not_indexed INTEGER NOT NULL,
  other_not_indexed      INTEGER NOT NULL,
  canonical_mismatches   INTEGER NOT NULL,
  newly_indexed          INTEGER NOT NULL DEFAULT 0,
  newly_dropped          INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

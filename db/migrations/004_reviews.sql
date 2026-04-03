-- Reviews core table
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_product_id TEXT NOT NULL,
  shopify_order_id TEXT,
  shopify_customer_id TEXT,
  reviewer_name TEXT NOT NULL,
  reviewer_email TEXT NOT NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title TEXT,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','spam')),
  is_verified_purchase BOOLEAN NOT NULL DEFAULT false,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  is_incentivized BOOLEAN NOT NULL DEFAULT false,
  helpful_yes INT NOT NULL DEFAULT 0,
  helpful_no INT NOT NULL DEFAULT 0,
  ai_sentiment TEXT,
  ai_summary TEXT,
  ai_spam_score NUMERIC(3,2),
  moderation_note TEXT,
  moderated_by TEXT,
  moderated_at TIMESTAMPTZ,
  reply_body TEXT,
  reply_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'organic'
    CHECK (source IN ('organic','email_invite','import')),
  invite_token UUID UNIQUE,
  invite_token_used_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS review_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('image','video')),
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS review_attribute_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  attribute_name TEXT NOT NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5)
);

CREATE TABLE IF NOT EXISTS review_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_order_id TEXT NOT NULL,
  shopify_customer_id TEXT,
  shopify_product_id TEXT NOT NULL,
  reviewer_email TEXT NOT NULL,
  reviewer_name TEXT NOT NULL,
  invite_token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent','opened','clicked','completed','expired'))
);

CREATE TABLE IF NOT EXISTS review_aggregates (
  shopify_product_id TEXT PRIMARY KEY,
  total_count INT NOT NULL DEFAULT 0,
  approved_count INT NOT NULL DEFAULT 0,
  average_rating NUMERIC(3,2) NOT NULL DEFAULT 0,
  rating_1_count INT NOT NULL DEFAULT 0,
  rating_2_count INT NOT NULL DEFAULT 0,
  rating_3_count INT NOT NULL DEFAULT 0,
  rating_4_count INT NOT NULL DEFAULT 0,
  rating_5_count INT NOT NULL DEFAULT 0,
  verified_count INT NOT NULL DEFAULT 0,
  with_photo_count INT NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS review_settings (
  id INT PRIMARY KEY DEFAULT 1,
  auto_approve BOOLEAN NOT NULL DEFAULT false,
  spam_threshold NUMERIC(3,2) NOT NULL DEFAULT 0.75,
  min_body_length INT NOT NULL DEFAULT 0,
  require_title BOOLEAN NOT NULL DEFAULT false,
  invite_delay_days INT NOT NULL DEFAULT 3,
  reminder_delay_days INT NOT NULL DEFAULT 5,
  reminders_enabled BOOLEAN NOT NULL DEFAULT true,
  reviews_per_page INT NOT NULL DEFAULT 10,
  default_sort TEXT NOT NULL DEFAULT 'newest',
  show_ai_summaries BOOLEAN NOT NULL DEFAULT true,
  show_incentivized_label BOOLEAN NOT NULL DEFAULT true,
  digest_email TEXT,
  webhook_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO review_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(shopify_product_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_order ON reviews(shopify_order_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_invite_token ON reviews(invite_token);
CREATE INDEX IF NOT EXISTS idx_review_invites_token ON review_invites(invite_token);
CREATE INDEX IF NOT EXISTS idx_review_invites_order ON review_invites(shopify_order_id);

CREATE OR REPLACE FUNCTION refresh_review_aggregates()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO review_aggregates (
    shopify_product_id, total_count, approved_count, average_rating,
    rating_1_count, rating_2_count, rating_3_count, rating_4_count, rating_5_count,
    verified_count, with_photo_count, last_updated
  )
  SELECT
    r.shopify_product_id,
    COUNT(*) FILTER (WHERE r.status != 'spam'),
    COUNT(*) FILTER (WHERE r.status = 'approved'),
    COALESCE(AVG(r.rating) FILTER (WHERE r.status = 'approved'), 0),
    COUNT(*) FILTER (WHERE r.rating = 1 AND r.status = 'approved'),
    COUNT(*) FILTER (WHERE r.rating = 2 AND r.status = 'approved'),
    COUNT(*) FILTER (WHERE r.rating = 3 AND r.status = 'approved'),
    COUNT(*) FILTER (WHERE r.rating = 4 AND r.status = 'approved'),
    COUNT(*) FILTER (WHERE r.rating = 5 AND r.status = 'approved'),
    COUNT(*) FILTER (WHERE r.is_verified_purchase AND r.status = 'approved'),
    COUNT(DISTINCT rm.review_id) FILTER (WHERE r.status = 'approved'),
    now()
  FROM reviews r
  LEFT JOIN review_media rm ON rm.review_id = r.id
  WHERE r.shopify_product_id = COALESCE(NEW.shopify_product_id, OLD.shopify_product_id)
  GROUP BY r.shopify_product_id
  ON CONFLICT (shopify_product_id) DO UPDATE SET
    total_count = EXCLUDED.total_count,
    approved_count = EXCLUDED.approved_count,
    average_rating = EXCLUDED.average_rating,
    rating_1_count = EXCLUDED.rating_1_count,
    rating_2_count = EXCLUDED.rating_2_count,
    rating_3_count = EXCLUDED.rating_3_count,
    rating_4_count = EXCLUDED.rating_4_count,
    rating_5_count = EXCLUDED.rating_5_count,
    verified_count = EXCLUDED.verified_count,
    with_photo_count = EXCLUDED.with_photo_count,
    last_updated = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reviews_aggregates ON reviews;
CREATE TRIGGER trg_reviews_aggregates
AFTER INSERT OR UPDATE OR DELETE ON reviews
FOR EACH ROW EXECUTE FUNCTION refresh_review_aggregates();

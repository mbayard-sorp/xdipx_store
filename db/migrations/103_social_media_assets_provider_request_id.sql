-- Ticket #11548: store the provider generation id (Atlas prediction id, fal
-- request id) on the library row so the owner can resolve it to an asset.
ALTER TABLE social_media_assets ADD COLUMN IF NOT EXISTS provider_request_id varchar(64);
CREATE INDEX IF NOT EXISTS idx_social_media_assets_provider_request_id ON social_media_assets(provider_request_id);

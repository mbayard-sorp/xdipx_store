CREATE INDEX IF NOT EXISTS "oli_product_idx" ON "order_line_items" USING btree ("shopify_product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_log_session_idx" ON "consent_log" USING btree ("session_id","consented_at");

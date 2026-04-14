CREATE INDEX "deal_history_status_idx" ON "deal_history" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deal_history_deal_date_idx" ON "deal_history" USING btree ("deal_date");
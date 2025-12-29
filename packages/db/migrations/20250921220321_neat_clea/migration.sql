CREATE INDEX "log_created_at_used_model_used_provider_idx" ON "log" USING btree ("created_at","used_model","used_provider");--> statement-breakpoint
CREATE INDEX "model_status_idx" ON "model" USING btree ("status");--> statement-breakpoint
CREATE INDEX "model_history_minute_timestamp_idx" ON "model_history" USING btree ("minute_timestamp");--> statement-breakpoint
CREATE INDEX "model_provider_mapping_status_idx" ON "model_provider_mapping" USING btree ("status");--> statement-breakpoint
CREATE INDEX "model_provider_mapping_history_minute_timestamp_idx" ON "model_provider_mapping_history" USING btree ("minute_timestamp");--> statement-breakpoint
CREATE INDEX "model_provider_mapping_history_minute_timestamp_provider_id_idx" ON "model_provider_mapping_history" USING btree ("minute_timestamp","provider_id");--> statement-breakpoint
CREATE INDEX "model_provider_mapping_history_minute_timestamp_model_id_idx" ON "model_provider_mapping_history" USING btree ("minute_timestamp","model_id");--> statement-breakpoint
CREATE INDEX "provider_status_idx" ON "provider" USING btree ("status");
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_key_project_id_idx" ON "api_key" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "chat_user_id_idx" ON "chat" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "message_chat_id_idx" ON "message" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "organization_action_organization_id_idx" ON "organization_action" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "passkey_user_id_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payment_method_organization_id_idx" ON "payment_method" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "project_organization_id_idx" ON "project" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "provider_key_organization_id_idx" ON "provider_key" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transaction_organization_id_idx" ON "transaction" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "user_organization_user_id_idx" ON "user_organization" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_organization_organization_id_idx" ON "user_organization" USING btree ("organization_id");

CREATE TABLE "refund_feedback" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"comments" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "refund_feedback_transaction_id_unique" ON "refund_feedback" ("transaction_id");--> statement-breakpoint
CREATE INDEX "refund_feedback_organization_id_idx" ON "refund_feedback" ("organization_id");--> statement-breakpoint
CREATE INDEX "refund_feedback_created_at_idx" ON "refund_feedback" ("created_at");--> statement-breakpoint
ALTER TABLE "refund_feedback" ADD CONSTRAINT "refund_feedback_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "refund_feedback" ADD CONSTRAINT "refund_feedback_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "refund_feedback" ADD CONSTRAINT "refund_feedback_transaction_id_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transaction"("id") ON DELETE CASCADE;
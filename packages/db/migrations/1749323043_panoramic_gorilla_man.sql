ALTER TABLE "transaction" ALTER COLUMN "amount" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "credit_amount" numeric;
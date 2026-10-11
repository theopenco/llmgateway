-- Remove any accidental duplicate transactions sharing a Stripe invoice id
-- (e.g. from the legacy dev_plan_upgrade webhook path that inserted
-- unconditionally) before enforcing uniqueness, keeping the earliest row.
DELETE FROM "transaction" t
USING (
	SELECT id
	FROM (
		SELECT
			id,
			row_number() OVER (
				PARTITION BY stripe_invoice_id
				ORDER BY created_at ASC, id ASC
			) AS rn
		FROM "transaction"
		WHERE stripe_invoice_id IS NOT NULL
	) ranked
	WHERE ranked.rn > 1
) dup
WHERE t.id = dup.id;
--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_stripe_invoice_id_unique" ON "transaction" ("stripe_invoice_id") WHERE "stripe_invoice_id" IS NOT NULL;

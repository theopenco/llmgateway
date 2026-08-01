/* eslint-disable no-console */
import Stripe from "stripe";

const STRIPE_API_VERSION = "2025-04-30.basil" as const;

interface ProductBucket {
	currency: string;
	productId: string;
	productName: string;
	grossCents: number;
	refundedCents: number;
	netCents: number;
	entries: number;
}

interface InvoiceShare {
	productId: string;
	productName: string;
	amountCents: number;
}

function getStripe(): Stripe {
	const key = process.env.STRIPE_SECRET_KEY;
	if (!key) {
		throw new Error(
			"STRIPE_SECRET_KEY environment variable is required to run this script.",
		);
	}
	return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
}

function parseDateArg(name: string): number | undefined {
	const flag = `--${name}=`;
	const arg = process.argv.find((a) => a.startsWith(flag));
	if (!arg) {
		return undefined;
	}
	const value = arg.slice(flag.length);
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new Error(`Invalid --${name} date: ${value}`);
	}
	return Math.floor(date.getTime() / 1000);
}

function fmt(cents: number): string {
	return (cents / 100).toFixed(2);
}

async function main(): Promise<void> {
	const stripe = getStripe();
	const start = parseDateArg("start");
	const end = parseDateArg("end");

	console.log("Stripe earnings report");
	if (start) {
		console.log(`  start: ${new Date(start * 1000).toISOString()}`);
	}
	if (end) {
		console.log(`  end:   ${new Date(end * 1000).toISOString()}`);
	}

	const productCache = new Map<string, Stripe.Product | null>();
	async function loadProduct(id: string): Promise<Stripe.Product | null> {
		const cached = productCache.get(id);
		if (cached !== undefined) {
			return cached;
		}
		try {
			const product = await stripe.products.retrieve(id);
			productCache.set(id, product);
			return product;
		} catch (err) {
			console.warn(`  Failed to load product ${id}: ${(err as Error).message}`);
			productCache.set(id, null);
			return null;
		}
	}

	const buckets = new Map<string, ProductBucket>();
	function add(
		currency: string,
		productId: string,
		productName: string,
		grossCents: number,
		refundedCents: number,
		entries = 1,
	): void {
		const key = `${currency}::${productId}`;
		let bucket = buckets.get(key);
		if (!bucket) {
			bucket = {
				currency,
				productId,
				productName,
				grossCents: 0,
				refundedCents: 0,
				netCents: 0,
				entries: 0,
			};
			buckets.set(key, bucket);
		}
		bucket.grossCents += grossCents;
		bucket.refundedCents += refundedCents;
		bucket.netCents = bucket.grossCents - bucket.refundedCents;
		bucket.entries += entries;
	}

	const created: Stripe.RangeQueryParam | undefined =
		start || end
			? {
					...(start ? { gte: start } : {}),
					...(end ? { lte: end } : {}),
				}
			: undefined;

	console.log("\nPass 1: scanning invoices to build product attribution…");

	const invoiceShares = new Map<string, InvoiceShare[]>();
	const chargeToInvoice = new Map<string, string>();
	const paymentIntentToInvoice = new Map<string, string>();

	let invoicesScanned = 0;
	for await (const invoice of stripe.invoices.list({
		limit: 100,
		...(created ? { created } : {}),
		expand: ["data.payments"],
	})) {
		invoicesScanned += 1;
		if (invoicesScanned % 100 === 0) {
			console.log(`  scanned ${invoicesScanned} invoices…`);
		}

		if (!invoice.id || invoice.amount_paid <= 0) {
			continue;
		}

		const lines: Stripe.InvoiceLineItem[] = [];
		for await (const line of stripe.invoices.listLineItems(invoice.id, {
			limit: 100,
		})) {
			lines.push(line);
		}

		const totalLineAmount = lines.reduce((sum, line) => sum + line.amount, 0);
		const shares: InvoiceShare[] = [];

		if (lines.length === 0 || totalLineAmount === 0) {
			shares.push({
				productId: "unknown",
				productName: "Unknown (invoice without product lines)",
				amountCents: invoice.amount_paid,
			});
		} else {
			let attributed = 0;
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const isLast = i === lines.length - 1;
				const ratio = line.amount / totalLineAmount;
				const portion = isLast
					? invoice.amount_paid - attributed
					: Math.round(invoice.amount_paid * ratio);
				attributed += portion;

				const productId = line.pricing?.price_details?.product;
				if (!productId) {
					shares.push({
						productId: "unknown",
						productName: "Unknown (no product on invoice line)",
						amountCents: portion,
					});
					continue;
				}
				const product = await loadProduct(productId);
				shares.push({
					productId,
					productName: product?.name ?? `(deleted) ${productId}`,
					amountCents: portion,
				});
			}
		}

		invoiceShares.set(invoice.id, shares);

		const payments = invoice.payments?.data ?? [];
		for (const payment of payments) {
			const ref = payment.payment;
			if (ref.type === "charge" && ref.charge) {
				const id = typeof ref.charge === "string" ? ref.charge : ref.charge.id;
				if (id) {
					chargeToInvoice.set(id, invoice.id);
				}
			} else if (ref.type === "payment_intent" && ref.payment_intent) {
				const id =
					typeof ref.payment_intent === "string"
						? ref.payment_intent
						: ref.payment_intent.id;
				if (id) {
					paymentIntentToInvoice.set(id, invoice.id);
				}
			}
		}
	}
	console.log(`  scanned ${invoicesScanned} invoices.`);

	console.log("\nPass 2: scanning charges and attributing to products…");

	let chargesScanned = 0;
	for await (const charge of stripe.charges.list({
		limit: 100,
		...(created ? { created } : {}),
	})) {
		chargesScanned += 1;
		if (chargesScanned % 100 === 0) {
			console.log(`  scanned ${chargesScanned} charges…`);
		}

		if (charge.status !== "succeeded" || !charge.paid) {
			continue;
		}

		const gross = charge.amount;
		const refunded = charge.amount_refunded;
		const currency = charge.currency.toLowerCase();

		let invoiceId = chargeToInvoice.get(charge.id);
		if (!invoiceId) {
			const piId =
				typeof charge.payment_intent === "string"
					? charge.payment_intent
					: charge.payment_intent?.id;
			if (piId) {
				invoiceId = paymentIntentToInvoice.get(piId);
			}
		}

		if (!invoiceId) {
			add(currency, "unknown", "Unknown (no invoice)", gross, refunded);
			continue;
		}

		const shares = invoiceShares.get(invoiceId);
		if (!shares || shares.length === 0) {
			add(
				currency,
				"unknown",
				"Unknown (invoice missing shares)",
				gross,
				refunded,
			);
			continue;
		}

		const totalShare = shares.reduce((s, share) => s + share.amountCents, 0);
		if (totalShare === 0) {
			add(currency, "unknown", "Unknown (zero invoice total)", gross, refunded);
			continue;
		}

		let attributedGross = 0;
		let attributedRefund = 0;
		for (let i = 0; i < shares.length; i++) {
			const share = shares[i];
			const isLast = i === shares.length - 1;
			const ratio = share.amountCents / totalShare;
			const lineGross = isLast
				? gross - attributedGross
				: Math.round(gross * ratio);
			const lineRefund = isLast
				? refunded - attributedRefund
				: Math.round(refunded * ratio);
			attributedGross += lineGross;
			attributedRefund += lineRefund;

			add(
				currency,
				share.productId,
				share.productName,
				lineGross,
				lineRefund,
				i === 0 ? 1 : 0,
			);
		}
	}
	console.log(`  scanned ${chargesScanned} charges.\n`);

	const byCurrency = new Map<string, ProductBucket[]>();
	for (const bucket of buckets.values()) {
		const list = byCurrency.get(bucket.currency) ?? [];
		list.push(bucket);
		byCurrency.set(bucket.currency, list);
	}

	if (byCurrency.size === 0) {
		console.log("No succeeded charges found in the given range.");
		return;
	}

	for (const [currency, items] of byCurrency) {
		items.sort((a, b) => b.netCents - a.netCents);

		const totals = items.reduce(
			(acc, b) => {
				acc.gross += b.grossCents;
				acc.refunded += b.refundedCents;
				acc.net += b.netCents;
				acc.charges += b.entries;
				return acc;
			},
			{ gross: 0, refunded: 0, net: 0, charges: 0 },
		);

		console.log(`=== ${currency.toUpperCase()} ===`);
		console.log(
			`Total gross: ${fmt(totals.gross)}  refunded: ${fmt(totals.refunded)}  net: ${fmt(totals.net)}  charges: ${totals.charges}`,
		);
		console.log("");
		console.log(
			"Product".padEnd(40) +
				"Product ID".padEnd(28) +
				"Gross".padStart(12) +
				"Refunded".padStart(12) +
				"Net".padStart(12) +
				"Charges".padStart(10),
		);
		console.log("-".repeat(112));
		for (const bucket of items) {
			console.log(
				bucket.productName.slice(0, 38).padEnd(40) +
					bucket.productId.slice(0, 26).padEnd(28) +
					fmt(bucket.grossCents).padStart(12) +
					fmt(bucket.refundedCents).padStart(12) +
					fmt(bucket.netCents).padStart(12) +
					String(bucket.entries).padStart(10),
			);
		}
		console.log("");

		const codeItems = items.filter((b) => b.productName.startsWith("Code"));
		if (codeItems.length > 0) {
			const codeTotals = codeItems.reduce(
				(acc, b) => {
					acc.gross += b.grossCents;
					acc.refunded += b.refundedCents;
					acc.net += b.netCents;
					acc.charges += b.entries;
					return acc;
				},
				{ gross: 0, refunded: 0, net: 0, charges: 0 },
			);

			console.log(`--- Code* totals (${currency.toUpperCase()}) ---`);
			console.log(
				"Product".padEnd(40) +
					"Product ID".padEnd(28) +
					"Gross".padStart(12) +
					"Refunded".padStart(12) +
					"Net".padStart(12) +
					"Charges".padStart(10),
			);
			console.log("-".repeat(112));
			for (const bucket of codeItems) {
				console.log(
					bucket.productName.slice(0, 38).padEnd(40) +
						bucket.productId.slice(0, 26).padEnd(28) +
						fmt(bucket.grossCents).padStart(12) +
						fmt(bucket.refundedCents).padStart(12) +
						fmt(bucket.netCents).padStart(12) +
						String(bucket.entries).padStart(10),
				);
			}
			console.log("-".repeat(112));
			console.log(
				"TOTAL".padEnd(40) +
					"".padEnd(28) +
					fmt(codeTotals.gross).padStart(12) +
					fmt(codeTotals.refunded).padStart(12) +
					fmt(codeTotals.net).padStart(12) +
					String(codeTotals.charges).padStart(10),
			);
			console.log("");
		}
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

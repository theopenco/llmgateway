import { fetchServerData, getDevPlanStatus } from "@/lib/server-api";

import BillingClient from "./BillingClient";

import type { paths } from "@/lib/api/v1";

type PaymentMethod =
	paths["/dev-plans/payment-method"]["get"]["responses"]["200"]["content"]["application/json"];

export default async function BillingPage() {
	const [devPlanStatus, paymentMethod] = await Promise.all([
		getDevPlanStatus(),
		fetchServerData<PaymentMethod>("GET", "/dev-plans/payment-method"),
	]);

	return (
		<BillingClient
			initialDevPlanStatus={devPlanStatus}
			initialPaymentMethod={paymentMethod}
		/>
	);
}

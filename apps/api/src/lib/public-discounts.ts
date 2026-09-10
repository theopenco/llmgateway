import { db, resolveEffectiveDiscount } from "@llmgateway/db";

export async function loadPublicDiscounts() {
	const [discounts, airsideSettings] = await Promise.all([
		db.query.discount.findMany({
			where: { organizationId: { isNull: true } },
			orderBy: { createdAt: "desc" },
		}),
		db.query.providerRoutingSettings.findMany(),
	]);

	return (providerId: string, modelId: string) => {
		const result = resolveEffectiveDiscount(
			discounts,
			airsideSettings,
			null,
			providerId,
			modelId,
		);
		if (Number(result.discount) <= 0) {
			return null;
		}
		const row = result.source.startsWith("airside_")
			? airsideSettings.find((row) => row.id === result.discountId)!
			: discounts.find((row) => row.id === result.discountId)!;
		return {
			id: `${result.source}:${row.id}:${providerId}:${modelId}`,
			provider: providerId,
			model: modelId,
			discountPercent: result.discount,
			reason: "reason" in row ? row.reason : null,
			expiresAt: "expiresAt" in row ? row.expiresAt : null,
			createdAt: row.createdAt,
		};
	};
}

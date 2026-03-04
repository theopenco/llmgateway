import { fetchServerData } from "@/lib/server-api";

import { DiscountsClient } from "./discounts-client";

interface Discount {
	id: string;
	organizationId: string | null;
	provider: string | null;
	model: string | null;
	discountPercent: string;
	reason: string | null;
	expiresAt: string | null;
	createdAt: string;
	updatedAt: string;
}

interface DiscountsData {
	orgDiscounts: Discount[];
	globalDiscounts: Discount[];
}

async function fetchDiscounts(orgId: string): Promise<DiscountsData> {
	const data = await fetchServerData<DiscountsData>(
		"GET",
		"/orgs/{id}/discounts" as any,
		{
			params: {
				path: { id: orgId },
			},
		},
	);

	return data ?? { orgDiscounts: [], globalDiscounts: [] };
}

export default async function OrgDiscountsPage({
	params,
}: {
	params: Promise<{ orgId: string }>;
}) {
	const { orgId } = await params;

	if (!orgId) {
		return (
			<div className="flex flex-col">
				<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
					<div className="flex items-center justify-between">
						<h2 className="text-2xl md:text-3xl font-bold tracking-tight">
							Your Discounts
						</h2>
					</div>
					<div className="text-center py-8 text-muted-foreground">
						No organization selected
					</div>
				</div>
			</div>
		);
	}

	const data = await fetchDiscounts(orgId);

	return <DiscountsClient data={data} />;
}

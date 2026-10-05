import { Suspense } from "react";

import { ProviderKeyInsights } from "@/components/provider-key-insights";
import { requireSession } from "@/lib/require-session";

export default async function ProviderKeyInsightsPage({
	params,
}: {
	params: Promise<{ providerKeyId: string }>;
}) {
	await requireSession();
	const { providerKeyId } = await params;

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<Suspense>
				<ProviderKeyInsights providerKeyId={providerKeyId} />
			</Suspense>
		</div>
	);
}

import { Suspense } from "react";

import { requireSession } from "@/lib/require-session";

import { RoutingAnalyticsClient } from "./client";

export default async function Page() {
	await requireSession();
	return (
		<Suspense>
			<RoutingAnalyticsClient />
		</Suspense>
	);
}

import { Suspense } from "react";

import { requireSession } from "@/lib/require-session";

import { GlobalStatsClient } from "./client";

export default async function Page() {
	await requireSession();
	return (
		<Suspense>
			<GlobalStatsClient />
		</Suspense>
	);
}

import { requireSession } from "@/lib/require-session";

import { GlobalDailyStatsClient } from "./client";

export default async function Page() {
	await requireSession();
	return <GlobalDailyStatsClient />;
}

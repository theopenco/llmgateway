import { cookies } from "next/headers";
import { Suspense } from "react";

import { requireSession } from "@/lib/require-session";

import { isValidTimeZone } from "@llmgateway/shared";

import { GlobalStatsClient } from "./client";

export default async function Page() {
	await requireSession();
	const savedZone = (await cookies()).get("global-stats-timezone")?.value;
	const timeZone = savedZone && isValidTimeZone(savedZone) ? savedZone : "UTC";
	return (
		<Suspense>
			<GlobalStatsClient initialTimeZone={timeZone} />
		</Suspense>
	);
}

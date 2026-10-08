import { cookies } from "next/headers";
import { Suspense } from "react";

import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";

import { isValidTimeZone } from "@llmgateway/shared";

import { GlobalStatsClient } from "./client";

export default async function Page() {
	await requireSession();
	const api = await createServerApiClient();
	const { data, error } = await api.GET("/user/me");
	if (error || !data) {
		throw new Error("Failed to load account time zone");
	}
	const savedZone = (await cookies()).get("global-stats-timezone")?.value;
	const timeZone =
		savedZone && (savedZone === "account" || isValidTimeZone(savedZone))
			? savedZone
			: "UTC";
	return (
		<Suspense>
			<GlobalStatsClient
				initialTimeZone={timeZone}
				accountTimeZone={data.user.timeZone}
			/>
		</Suspense>
	);
}

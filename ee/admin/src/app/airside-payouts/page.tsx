import { Suspense } from "react";

import { requireSession } from "@/lib/require-session";

import { AirsidePayoutsClient } from "./client";

export default async function Page() {
	await requireSession();
	return (
		<Suspense>
			<AirsidePayoutsClient />
		</Suspense>
	);
}

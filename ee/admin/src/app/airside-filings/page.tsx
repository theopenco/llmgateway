import { Suspense } from "react";

import { requireSession } from "@/lib/require-session";

import { AirsideFilingsClient } from "./client";

export default async function Page() {
	await requireSession();
	return (
		<Suspense>
			<AirsideFilingsClient />
		</Suspense>
	);
}

import { Suspense } from "react";

import { PromptsClient } from "@/components/prompts/prompts-client";

export default function PromptsPage() {
	return (
		<Suspense>
			<PromptsClient />
		</Suspense>
	);
}

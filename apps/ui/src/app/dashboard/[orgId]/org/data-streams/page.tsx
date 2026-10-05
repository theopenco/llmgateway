import { Suspense } from "react";

import { DataStreamsClient } from "@/components/data-streams/data-streams-client";

export default function DataStreamsPage() {
	return (
		<Suspense>
			<DataStreamsClient />
		</Suspense>
	);
}

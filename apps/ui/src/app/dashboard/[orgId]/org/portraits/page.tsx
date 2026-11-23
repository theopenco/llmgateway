import { Suspense } from "react";

import { PortraitsClient } from "@/components/portraits/portraits-client";

export default function PortraitsPage() {
	return (
		<Suspense>
			<PortraitsClient />
		</Suspense>
	);
}

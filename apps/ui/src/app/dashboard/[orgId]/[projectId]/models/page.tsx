import { Suspense } from "react";

import { ModelsSupported } from "@/components/models-supported";

// Force dynamic rendering since this page uses client-side hooks
export const dynamic = "force-dynamic";

function ModelsContent() {
	return <ModelsSupported isDashboard />;
}

export default async function ModelsPage() {
	return (
		<Suspense fallback={<div>Loading models...</div>}>
			<ModelsContent />
		</Suspense>
	);
}

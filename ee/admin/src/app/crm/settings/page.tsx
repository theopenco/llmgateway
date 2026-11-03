import { Suspense } from "react";

import { CrmSettings } from "@/components/crm/crm-settings";

export default function CrmSettingsPage() {
	return (
		<Suspense>
			<CrmSettings />
		</Suspense>
	);
}

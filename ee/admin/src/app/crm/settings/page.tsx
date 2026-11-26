import { Suspense } from "react";

import { CrmSettings } from "@/components/crm/crm-settings";
import { requireSession } from "@/lib/require-session";

export default async function CrmSettingsPage() {
	await requireSession();
	return (
		<Suspense>
			<CrmSettings />
		</Suspense>
	);
}

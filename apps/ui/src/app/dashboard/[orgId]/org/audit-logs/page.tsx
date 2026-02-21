import { Suspense } from "react";

import { AuditLogsClient } from "./audit-logs-client";

export default function AuditLogsPage() {
	return (
		<Suspense>
			<AuditLogsClient />
		</Suspense>
	);
}

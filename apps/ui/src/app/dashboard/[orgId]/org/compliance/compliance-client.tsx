"use client";

import { ApiKeyComplianceList } from "@/components/compliance/api-key-compliance-list";
import { CompliancePolicyEditor } from "@/components/compliance/compliance-policy-editor";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";

export function ComplianceClient() {
	const { selectedOrganization } = useDashboardNavigation();
	return (
		<>
			<CompliancePolicyEditor key={selectedOrganization?.id} />
			<ApiKeyComplianceList />
		</>
	);
}

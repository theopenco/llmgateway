"use client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { CompliancePolicyEditor } from "@/components/compliance/compliance-policy-editor";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { Button } from "@/lib/components/button";
import { useApi } from "@/lib/fetch-client";

export function ApiKeyComplianceClient({
	projectId,
	keyId,
}: {
	projectId: string;
	keyId: string;
}) {
	const api = useApi();
	const { selectedOrganization } = useDashboardNavigation();
	const canManage =
		selectedOrganization?.role === "owner" ||
		selectedOrganization?.role === "admin";
	const { data, isPending, isError, refetch } = api.useQuery(
		"get",
		"/keys/api",
		{ params: { query: { projectId } } },
		{ enabled: canManage },
	);
	if (!canManage) {
		return (
			<p className="p-8">
				Only organization owners and admins can manage compliance policies.
			</p>
		);
	}
	if (isPending) {
		return (
			<p role="status" className="p-8">
				Loading API key...
			</p>
		);
	}
	if (isError) {
		return (
			<div role="alert" className="space-y-3 p-8">
				<p>Unable to load this API key.</p>
				<Button onClick={() => void refetch()}>Retry</Button>
			</div>
		);
	}
	const key = data?.apiKeys.find(
		(entry) => entry.id === keyId && entry.kind !== "playground",
	);
	if (!key) {
		return (
			<div className="space-y-3 p-8">
				<p>API key not found.</p>
				<Button asChild variant="outline" size="sm">
					<Link
						href={`/dashboard/${selectedOrganization?.id}/${projectId}/api-keys`}
					>
						<ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
						Back to API keys
					</Link>
				</Button>
			</div>
		);
	}
	return (
		<CompliancePolicyEditor
			key={key.id}
			apiKey={{
				id: key.id,
				name: key.description || "API key",
				projectId: key.projectId,
				providerCompliancePolicy: key.providerCompliancePolicy,
			}}
		/>
	);
}

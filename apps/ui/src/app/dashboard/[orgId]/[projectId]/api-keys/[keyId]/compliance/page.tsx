import { ApiKeyComplianceClient } from "@/components/api-keys/api-key-compliance-client";

export default async function ApiKeyCompliancePage({
	params,
}: {
	params: Promise<{ projectId: string; keyId: string }>;
}) {
	const { projectId, keyId } = await params;
	return <ApiKeyComplianceClient projectId={projectId} keyId={keyId} />;
}

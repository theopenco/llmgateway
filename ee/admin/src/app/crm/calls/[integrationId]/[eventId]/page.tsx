import { CrmCallBrief } from "@/components/crm/crm-call-brief";
import { requireSession } from "@/lib/require-session";

export default async function CrmCallBriefPage({
	params,
}: {
	params: Promise<{ integrationId: string; eventId: string }>;
}) {
	await requireSession();
	const { integrationId, eventId } = await params;
	return (
		<CrmCallBrief
			integrationId={decodeURIComponent(integrationId)}
			eventId={decodeURIComponent(eventId)}
		/>
	);
}

import { CrmOverview } from "@/components/crm/crm-overview";
import { requireSession } from "@/lib/require-session";

export default async function CrmPage() {
	await requireSession();
	return <CrmOverview />;
}

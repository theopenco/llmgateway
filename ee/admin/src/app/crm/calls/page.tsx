import { CrmCalls } from "@/components/crm/crm-calls";
import { requireSession } from "@/lib/require-session";

export default async function CrmCallsPage() {
	await requireSession();
	return <CrmCalls />;
}

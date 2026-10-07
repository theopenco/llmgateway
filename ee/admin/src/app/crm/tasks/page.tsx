import { CrmTasks } from "@/components/crm/crm-tasks";
import { requireSession } from "@/lib/require-session";

export default async function CrmTasksPage() {
	await requireSession();
	return <CrmTasks />;
}

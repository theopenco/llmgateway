import { CrmAccountView } from "@/components/crm/crm-account";
import { requireSession } from "@/lib/require-session";

export default async function CrmAccountPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	await requireSession();
	const { id } = await params;
	return <CrmAccountView id={decodeURIComponent(id)} />;
}

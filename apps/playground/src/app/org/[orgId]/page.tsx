import { renderPlaygroundShell } from "@/app/playground-shell";

export default async function OrgSharedChatsPage({
	params,
	searchParams,
}: {
	params: Promise<{ orgId: string }>;
	searchParams: Promise<{
		orgId?: string;
		projectId?: string;
		q?: string;
		hints?: string;
		model?: string;
	}>;
}) {
	const [{ orgId }, resolvedSearchParams] = await Promise.all([
		params,
		searchParams,
	]);

	return await renderPlaygroundShell({
		searchParams: resolvedSearchParams,
		orgShareView: { organizationId: orgId },
	});
}

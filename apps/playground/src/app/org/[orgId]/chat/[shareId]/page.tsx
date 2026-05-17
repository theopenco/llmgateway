import { renderPlaygroundShell } from "@/app/playground-shell";

export default async function OrgSharedChatPage({
	params,
	searchParams,
}: {
	params: Promise<{ orgId: string; shareId: string }>;
	searchParams: Promise<{
		orgId?: string;
		projectId?: string;
		q?: string;
		hints?: string;
		model?: string;
	}>;
}) {
	const [{ orgId, shareId }, resolvedSearchParams] = await Promise.all([
		params,
		searchParams,
	]);

	return await renderPlaygroundShell({
		searchParams: resolvedSearchParams,
		orgShareView: { organizationId: orgId, shareId },
	});
}

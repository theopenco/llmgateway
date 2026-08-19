import { redirect } from "next/navigation";

// The Custom Models page became the org Models directory; keep the old URL
// working since it has been shared with customers.
export default async function CustomModelsRedirect({
	params,
	searchParams,
}: {
	params: Promise<{ orgId: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const { orgId } = await params;
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(await searchParams)) {
		for (const v of Array.isArray(value) ? value : value ? [value] : []) {
			query.append(key, v);
		}
	}
	const qs = query.toString();
	redirect(`/dashboard/${orgId}/org/models${qs ? `?${qs}` : ""}`);
}

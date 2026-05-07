import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { MappingDetailClient } from "@/components/mapping-detail-client";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";

export default async function MappingDetailPage({
	params,
	searchParams,
}: {
	params: Promise<{ providerId: string; modelId: string }>;
	searchParams?: Promise<{ window?: string }>;
}) {
	await requireSession();

	const { providerId, modelId } = await params;
	const decodedModelId = decodeURIComponent(modelId);
	const searchParamsData = await searchParams;
	const window = searchParamsData?.window;

	const $api = await createServerApiClient();
	const { data } = await $api.GET(
		"/admin/providers/{providerId}/models/{modelId}",
		{
			params: {
				path: { providerId, modelId: encodeURIComponent(decodedModelId) },
				query: {
					...(window ? { window } : {}),
				} as any,
			},
		},
	);

	if (!data) {
		return (
			<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
				<Button variant="ghost" size="sm" asChild>
					<Link href="/model-provider-mappings">
						<ArrowLeft className="mr-1 h-4 w-4" />
						Back to Mappings
					</Link>
				</Button>
				<div className="flex h-64 items-center justify-center text-muted-foreground">
					Mapping not found
				</div>
			</div>
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<div className="flex items-center gap-3">
				<Button variant="ghost" size="sm" asChild>
					<Link href="/model-provider-mappings">
						<ArrowLeft className="mr-1 h-4 w-4" />
						Back
					</Link>
				</Button>
			</div>
			<Suspense>
				<MappingDetailClient
					providerId={providerId}
					modelId={decodedModelId}
					mapping={data.mapping}
				/>
			</Suspense>
		</div>
	);
}

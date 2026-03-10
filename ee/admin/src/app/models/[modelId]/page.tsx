import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { ModelDetailClient } from "@/components/model-detail-client";
import { Button } from "@/components/ui/button";
import { createServerApiClient } from "@/lib/server-api";

export default async function ModelDetailPage({
	params,
}: {
	params: Promise<{ modelId: string }>;
}) {
	const { modelId } = await params;
	const decodedModelId = decodeURIComponent(modelId);

	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/models/{modelId}", {
		params: { path: { modelId: encodeURIComponent(decodedModelId) } },
	});

	if (!data) {
		return (
			<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
				<Button variant="ghost" size="sm" asChild>
					<Link href="/models">
						<ArrowLeft className="mr-1 h-4 w-4" />
						Back to Models
					</Link>
				</Button>
				<div className="flex h-64 items-center justify-center text-muted-foreground">
					Model not found
				</div>
			</div>
		);
	}

	const { model, providers } = data;

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<div className="flex items-center gap-3">
				<Button variant="ghost" size="sm" asChild>
					<Link href="/models">
						<ArrowLeft className="mr-1 h-4 w-4" />
						Back
					</Link>
				</Button>
			</div>
			<Suspense>
				<ModelDetailClient
					modelId={decodedModelId}
					allTimeStats={model}
					providers={providers}
				/>
			</Suspense>
		</div>
	);
}

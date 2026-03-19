import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { ModelDetailClient } from "@/components/model-detail-client";
import { Button } from "@/components/ui/button";
import { createServerApiClient } from "@/lib/server-api";

import type { HistoryWindow } from "@/components/history-chart";

const validHistoryWindows = new Set<HistoryWindow>([
	"1m",
	"2m",
	"5m",
	"15m",
	"1h",
	"2h",
	"4h",
	"12h",
	"24h",
	"2d",
	"7d",
]);

function parseHistoryWindow(value?: string): HistoryWindow {
	if (value && validHistoryWindows.has(value as HistoryWindow)) {
		return value as HistoryWindow;
	}
	return "4h";
}

export default async function ModelDetailPage({
	params,
	searchParams,
}: {
	params: Promise<{ modelId: string }>;
	searchParams: Promise<{ window?: string }>;
}) {
	const { modelId } = await params;
	const { window: rawWindow } = await searchParams;
	const decodedModelId = decodeURIComponent(modelId);
	const window = parseHistoryWindow(rawWindow);

	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/models/{modelId}", {
		params: {
			path: { modelId: encodeURIComponent(decodedModelId) },
			query: { window },
		},
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
					initialWindow={window}
					providers={providers}
				/>
			</Suspense>
		</div>
	);
}

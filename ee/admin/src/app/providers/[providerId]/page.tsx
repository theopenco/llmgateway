import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { ProviderDetailClient } from "@/components/provider-detail-client";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";

export default async function ProviderDetailPage({
	params,
	searchParams,
}: {
	params: Promise<{ providerId: string }>;
	searchParams?: Promise<{ window?: string }>;
}) {
	await requireSession();

	const { providerId } = await params;
	const searchParamsData = await searchParams;
	const window = searchParamsData?.window;

	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/providers/{providerId}", {
		params: {
			path: { providerId },
			query: {
				...(window ? { window } : {}),
			} as any,
		},
	});

	if (!data) {
		return (
			<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
				<Button variant="ghost" size="sm" asChild>
					<Link href="/providers">
						<ArrowLeft className="mr-1 h-4 w-4" />
						Back to Providers
					</Link>
				</Button>
				<div className="flex h-64 items-center justify-center text-muted-foreground">
					Provider not found
				</div>
			</div>
		);
	}

	const { provider, models } = data;

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<div className="flex items-center gap-3">
				<Button variant="ghost" size="sm" asChild>
					<Link href="/providers">
						<ArrowLeft className="mr-1 h-4 w-4" />
						Back
					</Link>
				</Button>
			</div>
			<Suspense>
				<ProviderDetailClient
					providerId={providerId}
					providerInfo={provider}
					models={models}
				/>
			</Suspense>
		</div>
	);
}

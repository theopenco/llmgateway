import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { ProviderIncidentsClient } from "@/components/provider-incidents-client";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/require-session";

export default async function ProviderIncidentsPage({
	params,
}: {
	params: Promise<{ providerId: string }>;
}) {
	await requireSession();
	const { providerId } = await params;

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<div className="flex items-center gap-3">
				<Button variant="ghost" size="sm" asChild>
					<Link href={`/providers/${encodeURIComponent(providerId)}`}>
						<ArrowLeft className="mr-1 h-4 w-4" />
						Back to provider
					</Link>
				</Button>
			</div>
			<Suspense>
				<ProviderIncidentsClient providerId={providerId} />
			</Suspense>
		</div>
	);
}

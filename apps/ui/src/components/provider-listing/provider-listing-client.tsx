"use client";

import { CheckCircle2, Rocket, Server } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CreateListingDialog } from "@/components/provider-listing/create-listing-dialog";
import { ListingOverview } from "@/components/provider-listing/listing-overview";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { useToast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

import type { paths } from "@/lib/api/v1";

type ListingsData =
	paths["/provider-listings"]["get"]["responses"][200]["content"]["application/json"];
export type Listing = ListingsData["listings"][number];

const HOW_IT_WORKS = [
	{
		title: "Pay the listing fee",
		description:
			"A one-time fee, settled by card. Fully refunded if your listing does not go live.",
	},
	{
		title: "Pass automated validation",
		description:
			"We run a test suite against your OpenAI-compatible endpoint: chat, streaming, JSON mode, and tool calling for every model you list.",
	},
	{
		title: "Commit a discount, win traffic",
		description:
			"The discount you commit to directly boosts your routing score — the router prices you at (1 − discount) × list price, so a deeper discount wins more traffic.",
	},
];

export function ProviderListingClient({
	orgId,
	initialData,
}: {
	orgId: string;
	initialData: ListingsData | null;
}) {
	const api = useApi();
	const { toast } = useToast();
	const router = useRouter();
	const searchParams = useSearchParams();
	const [createOpen, setCreateOpen] = useState(false);
	const paymentHandled = useRef(false);
	const [awaitingPayment, setAwaitingPayment] = useState(false);

	const query = {
		params: { query: { organizationId: orgId } },
	} as const;
	const { data, refetch } = api.useQuery("get", "/provider-listings", query, {
		...(initialData ? { initialData } : {}),
		refetchOnWindowFocus: false,
		// Poll while a validation run is live so results stream into the page,
		// and briefly after a checkout redirect until the webhook marks the
		// listing paid.
		refetchInterval: (q) => {
			const listings = q.state.data?.listings ?? [];
			if (
				listings.some(
					(l) =>
						l.validationStatus === "queued" || l.validationStatus === "running",
				)
			) {
				return 3000;
			}
			if (
				awaitingPayment &&
				listings.some((l) => l.state === "awaiting_payment")
			) {
				return 2500;
			}
			return false;
		},
	});

	useEffect(() => {
		if (paymentHandled.current) {
			return;
		}
		const payment = searchParams.get("payment");
		if (!payment) {
			return;
		}
		paymentHandled.current = true;
		if (payment === "success") {
			setAwaitingPayment(true);
			toast({
				title: "Payment received",
				description:
					"Your listing fee is being confirmed. You can run validation as soon as it settles.",
			});
			void refetch();
		} else if (payment === "canceled") {
			toast({
				title: "Payment canceled",
				description: "You can restart the payment from your listing below.",
				variant: "destructive",
			});
		}
		router.replace(`/dashboard/${orgId}/org/provider-listing`);
	}, [searchParams, toast, router, orgId, refetch]);

	const listings = data?.listings ?? [];
	const activeListings = listings.filter((l) => l.state !== "archived");

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-6 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between">
					<div>
						<h2 className="text-2xl md:text-3xl font-bold tracking-tight">
							Provider Listing
						</h2>
						<p className="text-muted-foreground mt-1">
							List your inference platform on LLM Gateway and earn traffic with
							your discount.
						</p>
					</div>
					{activeListings.length > 0 && (
						<Button variant="outline" onClick={() => setCreateOpen(true)}>
							New listing
						</Button>
					)}
				</div>

				{activeListings.length === 0 ? (
					<Card>
						<CardHeader>
							<div className="flex items-center gap-3">
								<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
									<Server className="h-5 w-5 text-primary" />
								</div>
								<div>
									<CardTitle>Become a listed provider</CardTitle>
									<CardDescription>
										Self-serve, from application to live traffic.
									</CardDescription>
								</div>
							</div>
						</CardHeader>
						<CardContent className="space-y-6">
							<div className="grid gap-4 md:grid-cols-3">
								{HOW_IT_WORKS.map((step, i) => (
									<div
										key={step.title}
										className="rounded-lg border p-4 space-y-2"
									>
										<div className="flex items-center gap-2">
											<span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
												{i + 1}
											</span>
											<span className="font-medium">{step.title}</span>
										</div>
										<p className="text-sm text-muted-foreground">
											{step.description}
										</p>
									</div>
								))}
							</div>
							<div className="flex items-center gap-4">
								<Button onClick={() => setCreateOpen(true)}>
									<Rocket className="mr-2 h-4 w-4" />
									Start your listing
								</Button>
								<div className="flex items-center gap-1.5 text-sm text-muted-foreground">
									<CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
									No sales calls — everything runs from this dashboard
								</div>
							</div>
						</CardContent>
					</Card>
				) : (
					<div className="space-y-6">
						{activeListings.map((listing) => (
							<ListingOverview
								key={listing.id}
								orgId={orgId}
								listing={listing}
							/>
						))}
					</div>
				)}
			</div>

			<CreateListingDialog
				orgId={orgId}
				open={createOpen}
				onOpenChange={setCreateOpen}
			/>
		</div>
	);
}

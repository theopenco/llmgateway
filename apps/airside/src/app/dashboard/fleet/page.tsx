"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	Download,
	KeyRound,
	Loader2,
	Pencil,
	Plus,
	ShieldCheck,
	Stamp,
	TriangleAlert,
	Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { useCompany } from "@/components/dashboard/company-context";
import {
	EditModelDialog,
	FileFareDialog,
	RegisterModelDialog,
	VerifyModelDialog,
} from "@/components/dashboard/ModelDialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/fetch-client";
import { formatPerMillion } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { paths } from "@/lib/api/v1";

type ModelsResponse =
	paths["/airside/models"]["get"]["responses"]["200"]["content"]["application/json"];

export type AirsideModel = ModelsResponse["models"][number];

const STATUS_META: Record<
	AirsideModel["status"],
	{
		label: string;
		variant: "success" | "pending" | "destructive" | "secondary";
	}
> = {
	active: { label: "In service", variant: "success" },
	draft: { label: "Filed", variant: "pending" },
	rejected: { label: "Rejected", variant: "destructive" },
	delisted: { label: "Delisted", variant: "secondary" },
};

function DeleteModelButton({ model }: { model: AirsideModel }) {
	const api = useApi();
	const queryClient = useQueryClient();
	const [confirming, setConfirming] = useState(false);

	const deleteModel = api.useMutation("delete", "/airside/models/{id}", {
		onSuccess: async (data) => {
			await queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/airside/models", {
					params: {
						query: { providerCompanyId: model.providerCompanyId },
					},
				}).queryKey,
			});
			// Deleting a draft also removes its pending filing server-side.
			await queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/airside/filings", {
					params: {
						query: { providerCompanyId: model.providerCompanyId },
					},
				}).queryKey,
			});
			toast.success(
				data.status === "deleted"
					? "Draft removed from the register."
					: "Model delisted — it stays in your history.",
			);
		},
		onError: (error) => {
			toast.error(
				(error as { message?: string })?.message ?? "Failed to remove model",
			);
		},
	});

	const isDraft = model.status === "draft" || model.status === "rejected";

	if (model.status === "delisted") {
		return null;
	}

	return confirming ? (
		<Button
			size="sm"
			variant="destructive"
			disabled={deleteModel.isPending}
			data-testid={`confirm-delete-${model.modelName}`}
			onBlur={() => setConfirming(false)}
			onClick={() => deleteModel.mutate({ params: { path: { id: model.id } } })}
		>
			{isDraft ? "Confirm delete" : "Confirm delist"}
		</Button>
	) : (
		<Button
			size="sm"
			variant="ghost"
			aria-label={isDraft ? "Delete draft" : "Delist model"}
			data-testid={`delete-${model.modelName}`}
			onClick={() => setConfirming(true)}
		>
			<Trash2 className="size-3.5" />
		</Button>
	);
}

export default function FleetPage() {
	const api = useApi();
	const { company, isLoading: companyLoading } = useCompany();

	const modelsQuery = api.useQuery(
		"get",
		"/airside/models",
		{
			params: { query: { providerCompanyId: company?.id ?? "" } },
		},
		{
			enabled: !!company,
			refetchInterval: (query) =>
				query.state.data?.models.some(
					(model) =>
						model.latestVerification?.status === "queued" ||
						model.latestVerification?.status === "running",
				)
					? 1_000
					: false,
		},
	);

	const importModels = api.useMutation("post", "/airside/models/import", {
		onSuccess: async (data) => {
			await modelsQuery.refetch();
			toast.success(
				data.imported.length > 0
					? `Imported ${data.imported.length} catalogue model${data.imported.length === 1 ? "" : "s"}.`
					: "Nothing new to import — your catalogue models are already managed here.",
			);
		},
		onError: (error) => {
			toast.error(
				(error as { message?: string })?.message ??
					"Failed to import catalogue models",
			);
		},
	});

	if (companyLoading || (company && modelsQuery.isLoading)) {
		return (
			<div className="flex h-64 items-center justify-center">
				<Loader2 className="text-muted-foreground size-5 animate-spin" />
			</div>
		);
	}

	if (!company) {
		return (
			<p className="text-muted-foreground py-20 text-center text-sm">
				Register your company first —{" "}
				<Link href="/onboarding" className="text-primary hover:underline">
					start onboarding
				</Link>
				.
			</p>
		);
	}

	const models = modelsQuery.data?.models ?? [];
	const providerIds = company.claims
		.filter((claim) => claim.status === "active")
		.map((claim) => claim.providerId);
	// Catalogue carriers can pull their static-catalogue models into Airside
	// management — the first step of moving a provider's models to the DB.
	const catalogueProviderIds = company.claims
		.filter((claim) => claim.status === "active" && claim.kind === "catalogue")
		.map((claim) => claim.providerId);
	const hasPendingClaim = company.claims.some(
		(claim) => claim.status === "pending",
	);
	// A catalogue carrier's existing models are not listed here until it
	// imports them — the register only ever shows Airside-managed listings.
	const pendingCatalogueClaims = company.claims.filter(
		(claim) => claim.status === "pending" && claim.kind === "catalogue",
	);
	// An approved carrier we hold no key for cannot serve a request, however
	// healthy its listings look.
	const uncredentialedCarriers = company.claims.filter(
		(claim) => claim.status === "active" && !claim.hasManagedCredential,
	);

	return (
		<div className="space-y-6" data-testid="fleet-page">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<p className="text-primary font-mono text-[0.65rem] tracking-[0.3em] uppercase">
						Fleet register
					</p>
					<h1 className="font-display text-3xl font-black tracking-tight">
						Your aircraft
					</h1>
				</div>
				<div className="flex items-center gap-2">
					{catalogueProviderIds.length > 0 ? (
						<Button
							variant="outline"
							className="font-semibold"
							disabled={importModels.isPending}
							data-testid="import-catalogue-models"
							onClick={() => {
								for (const id of catalogueProviderIds) {
									importModels.mutate({
										body: { providerCompanyId: company.id, providerId: id },
									});
								}
							}}
						>
							<Download className="size-4" />
							{importModels.isPending
								? "Importing…"
								: "Import catalogue models"}
						</Button>
					) : null}
					<RegisterModelDialog
						providerCompanyId={company.id}
						providerIds={providerIds}
					>
						<Button
							className="font-semibold"
							disabled={providerIds.length === 0}
							data-testid="register-model-button"
						>
							<Plus className="size-4" /> Register aircraft
						</Button>
					</RegisterModelDialog>
				</div>
			</div>

			{uncredentialedCarriers.length > 0 ? (
				<div
					className="border-primary/40 bg-primary/5 flex items-start gap-3 rounded-lg border p-4"
					data-testid="missing-credential-warning"
				>
					<KeyRound className="text-primary mt-0.5 size-4 shrink-0" />
					<p className="text-sm">
						We do not hold an API key for{" "}
						<span className="font-mono">
							{uncredentialedCarriers.map((c) => c.providerId).join(", ")}
						</span>{" "}
						yet, so approved listings will not receive traffic. Send us one from
						the crew channel and we will install it.
					</p>
				</div>
			) : null}

			{pendingCatalogueClaims.length > 0 ? (
				<div
					className="border-border text-muted-foreground flex items-start gap-3 rounded-lg border border-dashed p-4 text-sm"
					data-testid="catalogue-models-notice"
				>
					<TriangleAlert className="mt-0.5 size-4 shrink-0" />
					<p>
						Models we already list for{" "}
						<span className="font-mono">
							{pendingCatalogueClaims.map((c) => c.providerId).join(", ")}
						</span>{" "}
						are not shown here — they run off our built-in catalogue. Once the
						claim is approved you can import them and manage their prices and
						limits from this register.
					</p>
				</div>
			) : null}

			{providerIds.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					{hasPendingClaim ? (
						"Your carrier claim is under review — you can register models as soon as it is approved."
					) : (
						<>
							Claim a carrier before registering models —{" "}
							<Link href="/onboarding" className="text-primary hover:underline">
								claim yours
							</Link>
							.
						</>
					)}
				</p>
			) : null}

			{models.length === 0 ? (
				<div className="border-border rounded-xl border border-dashed p-12 text-center">
					<p className="font-display text-lg font-bold">The hangar is empty</p>
					<p className="text-muted-foreground mx-auto mt-1 max-w-xl text-sm">
						{catalogueProviderIds.length > 0 ? (
							<>
								Models we already list for{" "}
								<span className="font-mono">
									{catalogueProviderIds.join(", ")}
								</span>{" "}
								still run off our built-in catalogue and are not shown here.
								Import them to manage their prices and limits yourself — an
								imported listing then serves that model in place of the
								catalogue entry.
							</>
						) : (
							"Register your first model — it goes live as soon as we approve its initial fare."
						)}
					</p>
				</div>
			) : (
				<ul className="space-y-3">
					{models.map((model) => {
						const status = STATUS_META[model.status];
						return (
							<li
								key={model.id}
								data-testid={`model-strip-${model.modelName}`}
								className={cn(
									"border-border bg-card rounded-lg border border-l-4 p-4",
									model.status === "active" && "border-l-signal",
									model.status === "draft" && "border-l-primary",
									model.status === "rejected" && "border-l-destructive",
									model.status === "delisted" && "border-l-muted opacity-60",
								)}
							>
								<div className="flex flex-wrap items-center justify-between gap-3">
									<div className="min-w-0">
										<div className="flex flex-wrap items-center gap-2">
											<span className="font-mono font-bold tracking-wide">
												{model.modelName}
											</span>
											<Badge variant={status.variant}>{status.label}</Badge>
											{model.pendingFiling ? (
												<Badge variant="pending">
													<Stamp className="size-3" />
													{model.pendingFiling.kind === "initial"
														? "Awaiting clearance"
														: model.pendingFiling.kind === "metadata"
															? "Change filed"
															: "Fare filed"}
												</Badge>
											) : null}
											{model.latestVerification ? (
												<Badge
													variant={
														model.latestVerification.status === "passed"
															? "success"
															: model.latestVerification.status === "failed"
																? "destructive"
																: "pending"
													}
													title={model.latestVerification.summary ?? undefined}
												>
													<ShieldCheck className="size-3" />
													Verification {model.latestVerification.status}
												</Badge>
											) : null}
										</div>
										<div className="text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
											{model.displayName ? (
												<span>{model.displayName}</span>
											) : null}
											<span className="font-mono">{model.providerId}</span>
											{model.externalId !== model.modelName ? (
												<span
													className="font-mono"
													title="Upstream model ID sent to your API"
												>
													↗ {model.externalId}
												</span>
											) : null}
											<span className="font-mono">
												{model.apiFormat === "openai-chat-completions"
													? "Chat Completions"
													: model.apiFormat === "openai-responses"
														? "Responses API"
														: model.apiFormat === "google-vertex"
															? "Vertex API"
															: "Carrier default"}
											</span>
											{model.contextSize ? (
												<span className="font-mono">
													{Math.round(model.contextSize / 1000)}k ctx
												</span>
											) : null}
										</div>
									</div>

									<div className="flex items-center gap-4">
										<div className="text-right font-mono text-sm">
											<div>
												{formatPerMillion(model.currentPricing?.inputPrice)}{" "}
												<span className="text-muted-foreground text-xs">
													in
												</span>
											</div>
											<div>
												{formatPerMillion(model.currentPricing?.outputPrice)}{" "}
												<span className="text-muted-foreground text-xs">
													out
												</span>
											</div>
										</div>
										<div className="flex items-center gap-1">
											{model.status !== "delisted" ? (
												<>
													<VerifyModelDialog model={model}>
														<Button
															size="sm"
															variant="outline"
															data-testid={`verify-${model.modelName}`}
														>
															<ShieldCheck className="size-3.5" /> Verify
														</Button>
													</VerifyModelDialog>
													<FileFareDialog model={model}>
														<Button
															size="sm"
															variant="outline"
															disabled={!!model.pendingFiling}
															data-testid={`file-fare-${model.modelName}`}
														>
															<Stamp className="size-3.5" /> File fare
														</Button>
													</FileFareDialog>
													<EditModelDialog model={model}>
														<Button
															size="sm"
															variant="ghost"
															aria-label="Edit model"
															data-testid={`edit-${model.modelName}`}
														>
															<Pencil className="size-3.5" />
														</Button>
													</EditModelDialog>
												</>
											) : null}
											<DeleteModelButton model={model} />
										</div>
									</div>
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

"use client";

import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { apiErrorMessage } from "@/lib/api-error";
import { useApi } from "@/lib/fetch-client";

import { getProviderIcon } from "@llmgateway/shared";

import type {
	RateLimitEntry,
	RateLimitModelMapping,
	RateLimitProviderOption,
} from "@/lib/types";

function AirsideBadge() {
	return (
		<span className="rounded-sm bg-muted px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
			Airside
		</span>
	);
}

type RateLimitType = "rpm" | "rpd";
type RateLimitEnforcement = "per_org" | "global";
type RateLimitMode = "strict" | "soft" | "lax";

interface RateLimitFormProps {
	providers: RateLimitProviderOption[];
	mappings: RateLimitModelMapping[];
	showEnforcement?: boolean;
	rateLimit?: RateLimitEntry;
	/** Omitted for a global rate limit. */
	orgId?: string;
}

export function RateLimitForm({
	providers,
	mappings,
	showEnforcement = false,
	rateLimit,
	orgId,
}: RateLimitFormProps) {
	const $api = useApi();
	const formId = useId();
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [provider, setProvider] = useState<string>("__all__");
	const [model, setModel] = useState<string>("__all__");
	const [limitType, setLimitType] = useState<RateLimitType>("rpm");
	const [enforcement, setEnforcement] =
		useState<RateLimitEnforcement>("per_org");
	const [mode, setMode] = useState<RateLimitMode>("strict");
	const [maxRequests, setMaxRequests] = useState("");
	const [reason, setReason] = useState("");

	const onSuccess = () => {
		setOpen(false);
		router.refresh();
	};
	const globalMutation = $api.useMutation("post", "/admin/rate-limits", {
		meta: { inlineError: true },
		onSuccess,
	});
	const orgMutation = $api.useMutation(
		"post",
		"/admin/organizations/{orgId}/rate-limits",
		{ meta: { inlineError: true }, onSuccess },
	);
	const globalUpdateMutation = $api.useMutation(
		"put",
		"/admin/rate-limits/{rateLimitId}",
		{
			meta: { inlineError: true },
			onSuccess,
		},
	);
	const orgUpdateMutation = $api.useMutation(
		"put",
		"/admin/organizations/{orgId}/rate-limits/{rateLimitId}",
		{
			meta: { inlineError: true },
			onSuccess,
		},
	);
	const mutation = rateLimit
		? orgId
			? orgUpdateMutation
			: globalUpdateMutation
		: orgId
			? orgMutation
			: globalMutation;
	const shownError =
		error ??
		(mutation.isError
			? apiErrorMessage(
					mutation.error,
					rateLimit
						? "Failed to update rate limit"
						: "Failed to create rate limit",
				)
			: null);

	// Filter mappings by selected provider
	const filteredMappings = useMemo(() => {
		if (provider === "__all__") {
			return mappings;
		}
		return mappings.filter((m) => m.providerId === provider);
	}, [provider, mappings]);

	// Get unique models for the filtered mappings (deduplicate by modelId)
	const availableModels = useMemo(() => {
		const uniqueModels = new Map<
			string,
			{
				modelId: string;
				modelName: string;
				family: string;
				source: RateLimitModelMapping["source"];
			}
		>();
		for (const mapping of filteredMappings) {
			if (!uniqueModels.has(mapping.modelId)) {
				uniqueModels.set(mapping.modelId, {
					modelId: mapping.modelId,
					modelName: mapping.modelName,
					family: mapping.family,
					source: mapping.source,
				});
			}
		}
		return Array.from(uniqueModels.values()).sort((a, b) =>
			a.modelName.localeCompare(b.modelName),
		);
	}, [filteredMappings]);

	const selectedProvider = useMemo(() => {
		if (provider === "__all__") {
			return null;
		}
		return providers.find((p) => p.id === provider);
	}, [provider, providers]);

	const selectedModel = useMemo(() => {
		if (model === "__all__") {
			return null;
		}
		return availableModels.find((m) => m.modelId === model);
	}, [model, availableModels]);

	// Reset model when provider changes
	const handleProviderChange = (newProvider: string) => {
		setProvider(newProvider);
		setModel("__all__");
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (mutation.isPending) {
			return;
		}
		setError(null);
		mutation.reset();

		const parsedLimit = Number(maxRequests);
		const minimum = 0;
		if (
			maxRequests.trim() === "" ||
			!Number.isInteger(parsedLimit) ||
			parsedLimit < minimum
		) {
			setError(
				`Max ${limitType.toUpperCase()} must be a whole number of at least ${minimum}`,
			);
			return;
		}

		if (provider === "__all__" && model === "__all__") {
			setError("Please select at least a provider or a model");
			return;
		}

		const body = {
			provider: provider === "__all__" ? null : provider,
			model: model === "__all__" ? null : model,
			limitType,
			maxRequests: parsedLimit,
			mode,
			reason: reason || null,
		};
		if (rateLimit) {
			const rateLimitId = rateLimit.id;
			if (orgId) {
				orgUpdateMutation.mutate({
					params: { path: { orgId, rateLimitId } },
					body,
				});
			} else {
				globalUpdateMutation.mutate({
					params: { path: { rateLimitId } },
					body: { ...body, enforcement },
				});
			}
		} else if (orgId) {
			orgMutation.mutate({ params: { path: { orgId } }, body });
		} else {
			globalMutation.mutate({
				body: {
					...body,
					enforcement: showEnforcement ? enforcement : undefined,
				},
			});
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (mutation.isPending) {
					return;
				}
				setOpen(nextOpen);
				if (nextOpen) {
					setProvider(rateLimit?.provider ?? "__all__");
					setModel(rateLimit?.model ?? "__all__");
					setLimitType(rateLimit?.limitType ?? "rpm");
					setEnforcement(rateLimit?.enforcement ?? "per_org");
					setMode(rateLimit?.mode ?? "strict");
					setMaxRequests(rateLimit ? String(rateLimit.maxRequests) : "");
					setReason(rateLimit?.reason ?? "");
					setError(null);
					mutation.reset();
				}
			}}
		>
			<DialogTrigger asChild>
				<Button size="sm" variant={rateLimit ? "ghost" : "default"}>
					{rateLimit ? (
						<Pencil className="h-4 w-4" />
					) : (
						<Plus className="h-4 w-4" />
					)}
					{rateLimit ? "Edit" : "Add Rate Limit"}
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{rateLimit ? "Edit Rate Limit" : "Add Rate Limit"}
					</DialogTitle>
					<DialogDescription>
						Set a maximum requests per minute or per day cap for a provider,
						model, or combination.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor={`${formId}-limitType`}>Limit Type</Label>
						<Select
							value={limitType}
							onValueChange={(value) => setLimitType(value as RateLimitType)}
						>
							<SelectTrigger id={`${formId}-limitType`} className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="rpm">RPM</SelectItem>
								<SelectItem value="rpd">RPD</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{showEnforcement && (
						<div className="space-y-2">
							<Label htmlFor={`${formId}-enforcement`}>Enforcement</Label>
							<Select
								value={enforcement}
								onValueChange={(value) =>
									setEnforcement(value as RateLimitEnforcement)
								}
							>
								<SelectTrigger id={`${formId}-enforcement`} className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="per_org">Per-organization</SelectItem>
									<SelectItem value="global">
										Global (shared across all orgs)
									</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								{enforcement === "per_org"
									? "Each organization gets its own counter against this limit"
									: "All organizations share a single counter against this limit"}
							</p>
						</div>
					)}

					<div className="space-y-2">
						<Label htmlFor={`${formId}-mode`}>Mode</Label>
						<Select
							value={mode}
							onValueChange={(value) => setMode(value as RateLimitMode)}
						>
							<SelectTrigger id={`${formId}-mode`} className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="strict">Strict</SelectItem>
								<SelectItem value="soft">Soft</SelectItem>
								<SelectItem value="lax">Lax</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">
							{mode === "strict"
								? "All traffic is routed away once the limit is reached"
								: mode === "soft"
									? "Sessions already pinned to the provider keep using it past the limit; new sessions are routed away"
									: "Explicit provider requests and existing pinned sessions may exceed the limit; automatic routing and fallback respect it."}
						</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor={`${formId}-provider`}>Provider</Label>
						<Select value={provider} onValueChange={handleProviderChange}>
							<SelectTrigger id={`${formId}-provider`} className="w-full">
								<SelectValue>
									{selectedProvider ? (
										<span className="flex items-center gap-2">
											{(() => {
												const Icon = getProviderIcon(selectedProvider.id);
												return <Icon className="h-4 w-4 dark:text-white" />;
											})()}
											{selectedProvider.name}
										</span>
									) : provider === "__all__" ? (
										"All Providers"
									) : (
										provider
									)}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="__all__">All Providers</SelectItem>
								{providers.map((p) => {
									const Icon = getProviderIcon(p.id);
									return (
										<SelectItem key={p.id} value={p.id}>
											<span className="flex items-center gap-2">
												<Icon className="h-4 w-4" />
												{p.name}
												{p.source === "airside" && <AirsideBadge />}
											</span>
										</SelectItem>
									);
								})}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<Label htmlFor={`${formId}-model`}>Model</Label>
						<Select value={model} onValueChange={setModel}>
							<SelectTrigger id={`${formId}-model`} className="w-full">
								<SelectValue>
									{selectedModel
										? `${selectedModel.modelName} (${selectedModel.modelId})`
										: model === "__all__"
											? "All Models"
											: model}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="__all__">All Models</SelectItem>
								{availableModels.map((m) => (
									<SelectItem key={m.modelId} value={m.modelId}>
										<span className="flex items-center gap-2">
											<span className="truncate">
												{m.modelName}{" "}
												<span className="text-muted-foreground">
													({m.modelId})
												</span>
											</span>
											{m.source === "airside" && <AirsideBadge />}
										</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{provider !== "__all__" && (
							<p className="text-xs text-muted-foreground">
								Showing models available for {selectedProvider?.name}
							</p>
						)}
					</div>

					<div className="space-y-2">
						<Label htmlFor={`${formId}-maxRequests`}>
							Max {limitType.toUpperCase()}
						</Label>
						<Input
							id={`${formId}-maxRequests`}
							type="number"
							min={0}
							step="1"
							placeholder={limitType === "rpm" ? "e.g., 60" : "e.g., 5000"}
							value={maxRequests}
							onChange={(e) => setMaxRequests(e.target.value)}
							required
						/>
						<p className="text-xs text-muted-foreground">
							{limitType === "rpm"
								? "Maximum requests per minute allowed"
								: "Maximum requests per day allowed"}
							. Set 0 to allow only requests exempt under the selected mode
						</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor={`${formId}-reason`}>Reason (optional)</Label>
						<Input
							id={`${formId}-reason`}
							type="text"
							placeholder="e.g., Prevent abuse on expensive model"
							value={reason}
							onChange={(e) => setReason(e.target.value)}
						/>
					</div>

					{shownError && (
						<div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
							{shownError}
						</div>
					)}

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => setOpen(false)}
							disabled={mutation.isPending}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={mutation.isPending}>
							{mutation.isPending && (
								<Loader2 className="h-4 w-4 animate-spin" />
							)}
							{rateLimit ? "Save Changes" : "Create Rate Limit"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

interface DeleteRateLimitButtonProps {
	rateLimitId: string;
	/** Deletes an organization rate limit; omitted for a global rate limit. */
	orgId?: string;
}

export function DeleteRateLimitButton({
	rateLimitId,
	orgId,
}: DeleteRateLimitButtonProps) {
	const $api = useApi();
	const router = useRouter();
	const onSuccess = (data: { success: boolean }) => {
		if (data.success) {
			router.refresh();
		} else {
			toast.error("Failed to delete rate limit");
		}
	};
	const meta = { errorMessage: "Failed to delete rate limit" };
	const globalMutation = $api.useMutation(
		"delete",
		"/admin/rate-limits/{rateLimitId}",
		{ meta, onSuccess },
	);
	const orgMutation = $api.useMutation(
		"delete",
		"/admin/organizations/{orgId}/rate-limits/{rateLimitId}",
		{ meta, onSuccess },
	);
	const deleting = orgId ? orgMutation.isPending : globalMutation.isPending;

	const handleDelete = () => {
		if (!confirm("Are you sure you want to delete this rate limit?")) {
			return;
		}

		if (orgId) {
			orgMutation.mutate({ params: { path: { orgId, rateLimitId } } });
		} else {
			globalMutation.mutate({ params: { path: { rateLimitId } } });
		}
	};

	return (
		<Button
			variant="ghost"
			size="icon-sm"
			onClick={handleDelete}
			disabled={deleting}
			className="text-destructive hover:text-destructive"
		>
			{deleting ? (
				<Loader2 className="h-4 w-4 animate-spin" />
			) : (
				<Trash2 className="h-4 w-4" />
			)}
		</Button>
	);
}

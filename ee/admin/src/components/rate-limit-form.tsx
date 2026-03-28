"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

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

import { getProviderIcon } from "@llmgateway/shared";

import type { RateLimitModelMapping } from "@/lib/types";

type RateLimitType = "rpm" | "rpd";

interface RateLimitFormProps {
	providers: Array<{ id: string; name: string }>;
	mappings: RateLimitModelMapping[];
	onSubmit: (data: {
		provider: string | null;
		model: string | null;
		limitType: RateLimitType;
		maxRequests: number;
		reason: string | null;
	}) => Promise<{ success: boolean; error?: string }>;
}

export function RateLimitForm({
	providers,
	mappings,
	onSubmit,
}: RateLimitFormProps) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [provider, setProvider] = useState<string>("__all__");
	const [model, setModel] = useState<string>("__all__");
	const [limitType, setLimitType] = useState<RateLimitType>("rpm");
	const [maxRequests, setMaxRequests] = useState("");
	const [reason, setReason] = useState("");

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
				rootModelName: string;
				family: string;
			}
		>();
		for (const mapping of filteredMappings) {
			if (!uniqueModels.has(mapping.modelId)) {
				uniqueModels.set(mapping.modelId, {
					modelId: mapping.modelId,
					modelName: mapping.modelName,
					rootModelName: mapping.rootModelName,
					family: mapping.family,
				});
			}
		}
		return Array.from(uniqueModels.values()).sort((a, b) =>
			a.rootModelName.localeCompare(b.rootModelName),
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

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setLoading(true);

		const parsedLimit = parseInt(maxRequests, 10);
		if (isNaN(parsedLimit) || parsedLimit < 1) {
			setError(`Max ${limitType.toUpperCase()} must be a positive integer`);
			setLoading(false);
			return;
		}

		if (provider === "__all__" && model === "__all__") {
			setError("Please select at least a provider or a model");
			setLoading(false);
			return;
		}

		const result = await onSubmit({
			provider: provider === "__all__" ? null : provider,
			model: model === "__all__" ? null : model,
			limitType,
			maxRequests: parsedLimit,
			reason: reason || null,
		});

		setLoading(false);

		if (result.success) {
			setOpen(false);
			setProvider("__all__");
			setModel("__all__");
			setLimitType("rpm");
			setMaxRequests("");
			setReason("");
			router.refresh();
		} else {
			setError(result.error ?? "Failed to create rate limit");
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button size="sm">
					<Plus className="h-4 w-4" />
					Add Rate Limit
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add Rate Limit</DialogTitle>
					<DialogDescription>
						Set a maximum requests per minute or per day cap for a provider,
						model, or combination.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="limitType">Limit Type</Label>
						<Select
							value={limitType}
							onValueChange={(value) => setLimitType(value as RateLimitType)}
						>
							<SelectTrigger className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="rpm">RPM</SelectItem>
								<SelectItem value="rpd">RPD</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<Label htmlFor="provider">Provider</Label>
						<Select value={provider} onValueChange={handleProviderChange}>
							<SelectTrigger className="w-full">
								<SelectValue>
									{selectedProvider ? (
										<span className="flex items-center gap-2">
											{(() => {
												const Icon = getProviderIcon(selectedProvider.id);
												return <Icon className="h-4 w-4 dark:text-white" />;
											})()}
											{selectedProvider.name}
										</span>
									) : (
										"All Providers"
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
											</span>
										</SelectItem>
									);
								})}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<Label htmlFor="model">Model</Label>
						<Select value={model} onValueChange={setModel}>
							<SelectTrigger className="w-full">
								<SelectValue>
									{selectedModel
										? `${selectedModel.rootModelName} (${selectedModel.modelId})`
										: "All Models"}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="__all__">All Models</SelectItem>
								{availableModels.map((m) => (
									<SelectItem key={m.modelId} value={m.modelId}>
										<span className="truncate">
											{m.rootModelName}{" "}
											<span className="text-muted-foreground">
												({m.modelId})
											</span>
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
						<Label htmlFor="maxRequests">Max {limitType.toUpperCase()}</Label>
						<Input
							id="maxRequests"
							type="number"
							min="1"
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
						</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="reason">Reason (optional)</Label>
						<Input
							id="reason"
							type="text"
							placeholder="e.g., Prevent abuse on expensive model"
							value={reason}
							onChange={(e) => setReason(e.target.value)}
						/>
					</div>

					{error && (
						<div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
							{error}
						</div>
					)}

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => setOpen(false)}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={loading}>
							{loading && <Loader2 className="h-4 w-4 animate-spin" />}
							Create Rate Limit
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

interface DeleteRateLimitButtonProps {
	rateLimitId: string;
	onDelete: (rateLimitId: string) => Promise<{ success: boolean }>;
}

export function DeleteRateLimitButton({
	rateLimitId,
	onDelete,
}: DeleteRateLimitButtonProps) {
	const router = useRouter();
	const [loading, setLoading] = useState(false);

	const handleDelete = async () => {
		if (!confirm("Are you sure you want to delete this rate limit?")) {
			return;
		}

		setLoading(true);
		const result = await onDelete(rateLimitId);
		setLoading(false);

		if (result.success) {
			router.refresh();
		}
	};

	return (
		<Button
			variant="ghost"
			size="icon-sm"
			onClick={handleDelete}
			disabled={loading}
			className="text-destructive hover:text-destructive"
		>
			{loading ? (
				<Loader2 className="h-4 w-4 animate-spin" />
			) : (
				<Trash2 className="h-4 w-4" />
			)}
		</Button>
	);
}

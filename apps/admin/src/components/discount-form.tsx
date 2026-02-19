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

import type { ProviderModelMapping } from "@/lib/admin-discounts";

interface DiscountFormProps {
	providers: Array<{ id: string; name: string }>;
	mappings: ProviderModelMapping[];
	onSubmit: (data: {
		provider: string | null;
		model: string | null;
		discountPercent: number;
		reason: string | null;
	}) => Promise<{ success: boolean; error?: string }>;
}

export function DiscountForm({
	providers,
	mappings,
	onSubmit,
}: DiscountFormProps) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [provider, setProvider] = useState<string>("__all__");
	const [model, setModel] = useState<string>("__all__");
	const [discountPercent, setDiscountPercent] = useState("");
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

		const percent = parseFloat(discountPercent);
		if (isNaN(percent) || percent < 0 || percent > 100) {
			setError("Discount must be between 0 and 100");
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
			discountPercent: percent,
			reason: reason || null,
		});

		setLoading(false);

		if (result.success) {
			setOpen(false);
			setProvider("__all__");
			setModel("__all__");
			setDiscountPercent("");
			setReason("");
			router.refresh();
		} else {
			setError(result.error || "Failed to create discount");
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button size="sm">
					<Plus className="h-4 w-4" />
					Add Discount
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add Discount</DialogTitle>
					<DialogDescription>
						Create a new discount for a provider, model, or combination.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="space-y-4">
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
						<Label htmlFor="discount">Discount Percentage</Label>
						<div className="relative">
							<Input
								id="discount"
								type="number"
								min="0"
								max="100"
								step="0.1"
								placeholder="e.g., 30 for 30% off"
								value={discountPercent}
								onChange={(e) => setDiscountPercent(e.target.value)}
								required
							/>
							<span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
								%
							</span>
						</div>
						<p className="text-xs text-muted-foreground">
							Customer pays {100 - (parseFloat(discountPercent) || 0)}% of the
							original price
						</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="reason">Reason (optional)</Label>
						<Input
							id="reason"
							type="text"
							placeholder="e.g., Enterprise partner discount"
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
							Create Discount
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

interface DeleteDiscountButtonProps {
	discountId: string;
	onDelete: (discountId: string) => Promise<{ success: boolean }>;
}

export function DeleteDiscountButton({
	discountId,
	onDelete,
}: DeleteDiscountButtonProps) {
	const router = useRouter();
	const [loading, setLoading] = useState(false);

	const handleDelete = async () => {
		if (!confirm("Are you sure you want to delete this discount?")) {
			return;
		}

		setLoading(true);
		const result = await onDelete(discountId);
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

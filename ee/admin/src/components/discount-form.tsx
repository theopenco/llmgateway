"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
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

import type { ProviderModelMapping } from "@/lib/types";

interface TargetData {
	provider: string | null;
	model: string | null;
	reason: string | null;
	expiresAt: string | null;
}

interface TargetOptions {
	providers: Array<{ id: string; name: string }>;
	mappings: ProviderModelMapping[];
}

interface AdjustmentFormProps extends TargetOptions {
	kind: "discount" | "routing";
	submitting: boolean;
	submitError: string | null;
	resetSubmit: () => void;
	onSubmit: (
		data: TargetData & { value: number },
		onSuccess: () => void,
	) => void;
}

function AdjustmentForm({
	kind,
	providers,
	mappings,
	submitting,
	submitError,
	resetSubmit,
	onSubmit,
}: AdjustmentFormProps) {
	const [open, setOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [provider, setProvider] = useState("__all__");
	const [model, setModel] = useState("__all__");
	const [value, setValue] = useState("");
	const [reason, setReason] = useState("");
	const [expiresAt, setExpiresAt] = useState("");

	const filteredMappings = useMemo(
		() =>
			provider === "__all__"
				? mappings
				: mappings.filter((mapping) => mapping.providerId === provider),
		[provider, mappings],
	);
	const availableModels = useMemo(() => {
		const uniqueModels = new Map<
			string,
			{ modelId: string; modelName: string; family: string }
		>();
		for (const mapping of filteredMappings) {
			uniqueModels.set(mapping.modelId, {
				modelId: mapping.modelId,
				modelName: mapping.modelName,
				family: mapping.family,
			});
		}
		return Array.from(uniqueModels.values()).sort((a, b) =>
			a.modelName.localeCompare(b.modelName),
		);
	}, [filteredMappings]);
	const selectedProvider = providers.find((item) => item.id === provider);
	const selectedModel = availableModels.find((item) => item.modelId === model);
	const isDiscount = kind === "discount";
	const noun = isDiscount ? "Discount" : "Routing Multiplier";
	const parsedValue = Number.parseFloat(value);
	const routingPreview = !Number.isFinite(parsedValue)
		? "Enter -10% to prioritize by 10%, or +10% to deprioritize by 10%."
		: parsedValue < 0
			? `Prioritized: routing compares at ${100 + parsedValue}% of the discounted price; billing is unchanged.`
			: parsedValue > 0
				? `Deprioritized: routing compares at ${100 + parsedValue}% of the discounted price; billing is unchanged.`
				: "No change to routing preference or customer billing.";

	const reset = () => {
		setProvider("__all__");
		setModel("__all__");
		setValue("");
		setReason("");
		setExpiresAt("");
		setError(null);
		resetSubmit();
	};

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);
		resetSubmit();
		if (
			!Number.isFinite(parsedValue) ||
			parsedValue < (isDiscount ? 0 : -100) ||
			(isDiscount && parsedValue > 100)
		) {
			setError(
				isDiscount
					? "Discount must be between 0 and 100"
					: "Routing multiplier must be at least -100",
			);
			return;
		}
		if (provider === "__all__" && model === "__all__") {
			setError("Please select at least a provider or a model");
			return;
		}

		onSubmit(
			{
				provider: provider === "__all__" ? null : provider,
				model: model === "__all__" ? null : model,
				value: parsedValue,
				reason: reason || null,
				expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
			},
			() => {
				setOpen(false);
				reset();
			},
		);
	};
	const shownError = error ?? submitError;

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				setOpen(nextOpen);
				if (!nextOpen) {
					reset();
				}
			}}
		>
			<DialogTrigger asChild>
				<Button size="sm">
					<Plus className="h-4 w-4" />
					Add {noun}
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add {noun}</DialogTitle>
					<DialogDescription>
						{isDiscount
							? "Create a customer discount for a provider, model, or combination."
							: "Use a negative percentage to prioritize or a positive percentage to deprioritize. Customer billing is unchanged."}
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label>Provider</Label>
						<Select
							value={provider}
							onValueChange={(nextProvider) => {
								setProvider(nextProvider);
								setModel("__all__");
							}}
						>
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
								{providers.map((item) => {
									const Icon = getProviderIcon(item.id);
									return (
										<SelectItem key={item.id} value={item.id}>
											<span className="flex items-center gap-2">
												<Icon className="h-4 w-4" />
												{item.name}
											</span>
										</SelectItem>
									);
								})}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<Label>Model</Label>
						<Select value={model} onValueChange={setModel}>
							<SelectTrigger className="w-full">
								<SelectValue>
									{selectedModel
										? `${selectedModel.modelName} (${selectedModel.modelId})`
										: "All Models"}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="__all__">All Models</SelectItem>
								{availableModels.map((item) => (
									<SelectItem key={item.modelId} value={item.modelId}>
										{item.modelName}{" "}
										<span className="text-muted-foreground">
											({item.modelId})
										</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<Label htmlFor={`${kind}-value`}>
							{isDiscount ? "Discount Percentage" : "Routing Score Adjustment"}
						</Label>
						<div className="relative">
							<Input
								id={`${kind}-value`}
								type="number"
								min={isDiscount ? 0 : -100}
								max={isDiscount ? 100 : undefined}
								step="0.1"
								placeholder={isDiscount ? "30" : "-10"}
								value={value}
								onChange={(event) => setValue(event.target.value)}
								required
							/>
							<span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
								%
							</span>
						</div>
						<p className="text-xs text-muted-foreground">
							{isDiscount
								? `Customer pays ${100 - (parsedValue || 0)}% of the original price`
								: routingPreview}
						</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor={`${kind}-reason`}>Reason (optional)</Label>
						<Input
							id={`${kind}-reason`}
							value={reason}
							onChange={(event) => setReason(event.target.value)}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor={`${kind}-expires`}>Expires At (optional)</Label>
						<Input
							id={`${kind}-expires`}
							type="datetime-local"
							value={expiresAt}
							onChange={(event) => setExpiresAt(event.target.value)}
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
						>
							Cancel
						</Button>
						<Button type="submit" disabled={submitting}>
							{submitting && <Loader2 className="h-4 w-4 animate-spin" />}
							Create {noun}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

interface DiscountFormProps extends TargetOptions {
	/** Creates an organization discount; omitted for a global discount. */
	orgId?: string;
}

export function DiscountForm({ orgId, ...options }: DiscountFormProps) {
	const $api = useApi();
	const router = useRouter();
	const onSuccess = () => router.refresh();
	const globalMutation = $api.useMutation("post", "/admin/discounts", {
		meta: { inlineError: true },
		onSuccess,
	});
	const orgMutation = $api.useMutation(
		"post",
		"/admin/organizations/{orgId}/discounts",
		{ meta: { inlineError: true }, onSuccess },
	);
	const mutation = orgId ? orgMutation : globalMutation;

	return (
		<AdjustmentForm
			kind="discount"
			{...options}
			submitting={mutation.isPending}
			submitError={
				mutation.isError
					? apiErrorMessage(mutation.error, "Failed to create discount")
					: null
			}
			resetSubmit={mutation.reset}
			onSubmit={({ value, ...data }, done) => {
				const body = { ...data, discountPercent: value };
				if (orgId) {
					orgMutation.mutate(
						{ params: { path: { orgId } }, body },
						{ onSuccess: done },
					);
				} else {
					globalMutation.mutate({ body }, { onSuccess: done });
				}
			}}
		/>
	);
}

export function RoutingScoreMultiplierForm(options: TargetOptions) {
	const $api = useApi();
	const router = useRouter();
	const mutation = $api.useMutation(
		"post",
		"/admin/routing-score-multipliers",
		{ meta: { inlineError: true }, onSuccess: () => router.refresh() },
	);

	return (
		<AdjustmentForm
			kind="routing"
			{...options}
			submitting={mutation.isPending}
			submitError={
				mutation.isError
					? apiErrorMessage(
							mutation.error,
							"Failed to create routing multiplier",
						)
					: null
			}
			resetSubmit={mutation.reset}
			onSubmit={({ value, ...data }, done) => {
				mutation.mutate(
					{ body: { ...data, scoreMultiplier: value } },
					{ onSuccess: done },
				);
			}}
		/>
	);
}

interface DeleteButtonProps {
	noun: string;
	deleting: boolean;
	onDelete: () => void;
}

function DeleteButton({ noun, deleting, onDelete }: DeleteButtonProps) {
	const handleDelete = () => {
		if (!confirm(`Are you sure you want to delete this ${noun}?`)) {
			return;
		}
		onDelete();
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

function useDeleteSuccess(noun: string) {
	const router = useRouter();
	return (data: { success: boolean }) => {
		if (data.success) {
			router.refresh();
		} else {
			toast.error(`Failed to delete ${noun}`);
		}
	};
}

export function DeleteDiscountButton({
	discountId,
	orgId,
}: {
	discountId: string;
	/** Deletes an organization discount; omitted for a global discount. */
	orgId?: string;
}) {
	const $api = useApi();
	const onSuccess = useDeleteSuccess("discount");
	const meta = { errorMessage: "Failed to delete discount" };
	const globalMutation = $api.useMutation(
		"delete",
		"/admin/discounts/{discountId}",
		{ meta, onSuccess },
	);
	const orgMutation = $api.useMutation(
		"delete",
		"/admin/organizations/{orgId}/discounts/{discountId}",
		{ meta, onSuccess },
	);

	return (
		<DeleteButton
			noun="discount"
			deleting={orgId ? orgMutation.isPending : globalMutation.isPending}
			onDelete={() => {
				if (orgId) {
					orgMutation.mutate({ params: { path: { orgId, discountId } } });
				} else {
					globalMutation.mutate({ params: { path: { discountId } } });
				}
			}}
		/>
	);
}

export function DeleteRoutingScoreMultiplierButton({
	multiplierId,
}: {
	multiplierId: string;
}) {
	const $api = useApi();
	const onSuccess = useDeleteSuccess("routing multiplier");
	const mutation = $api.useMutation(
		"delete",
		"/admin/routing-score-multipliers/{multiplierId}",
		{
			meta: { errorMessage: "Failed to delete routing multiplier" },
			onSuccess,
		},
	);

	return (
		<DeleteButton
			noun="routing multiplier"
			deleting={mutation.isPending}
			onDelete={() => mutation.mutate({ params: { path: { multiplierId } } })}
		/>
	);
}

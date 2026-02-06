"use client";

import { Check, ChevronsUpDown, Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
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
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { getProviderIcon } from "@llmgateway/shared";

interface DiscountFormProps {
	providers: Array<{ id: string; name: string }>;
	models: Array<{ id: string; name: string; family: string }>;
	onSubmit: (data: {
		provider: string | null;
		model: string | null;
		discountPercent: number;
		reason: string | null;
	}) => Promise<{ success: boolean; error?: string }>;
}

export function DiscountForm({
	providers,
	models,
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

	const [providerPopoverOpen, setProviderPopoverOpen] = useState(false);
	const [modelPopoverOpen, setModelPopoverOpen] = useState(false);

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
		return models.find((m) => m.id === model);
	}, [model, models]);

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
						<Popover
							open={providerPopoverOpen}
							onOpenChange={setProviderPopoverOpen}
						>
							<PopoverTrigger asChild>
								<Button
									variant="outline"
									role="combobox"
									aria-expanded={providerPopoverOpen}
									className="w-full justify-between"
								>
									{selectedProvider ? (
										<span className="flex items-center gap-2">
											{(() => {
												const Icon = getProviderIcon(selectedProvider.id);
												return <Icon className="h-4 w-4" />;
											})()}
											{selectedProvider.name}
										</span>
									) : (
										"All Providers"
									)}
									<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
								</Button>
							</PopoverTrigger>
							<PopoverContent className="w-[300px] p-0" align="start">
								<Command>
									<CommandInput placeholder="Search providers..." />
									<CommandList>
										<CommandEmpty>No provider found.</CommandEmpty>
										<CommandGroup>
											<CommandItem
												value="__all__"
												onSelect={() => {
													setProvider("__all__");
													setProviderPopoverOpen(false);
												}}
											>
												<Check
													className={cn(
														"mr-2 h-4 w-4",
														provider === "__all__"
															? "opacity-100"
															: "opacity-0",
													)}
												/>
												All Providers
											</CommandItem>
											{providers.map((p) => {
												const Icon = getProviderIcon(p.id);
												return (
													<CommandItem
														key={p.id}
														value={p.id}
														onSelect={() => {
															setProvider(p.id);
															setProviderPopoverOpen(false);
														}}
													>
														<Check
															className={cn(
																"mr-2 h-4 w-4",
																provider === p.id ? "opacity-100" : "opacity-0",
															)}
														/>
														<Icon className="mr-2 h-4 w-4" />
														{p.name}
													</CommandItem>
												);
											})}
										</CommandGroup>
									</CommandList>
								</Command>
							</PopoverContent>
						</Popover>
					</div>

					<div className="space-y-2">
						<Label htmlFor="model">Model</Label>
						<Popover open={modelPopoverOpen} onOpenChange={setModelPopoverOpen}>
							<PopoverTrigger asChild>
								<Button
									variant="outline"
									role="combobox"
									aria-expanded={modelPopoverOpen}
									className="w-full justify-between"
								>
									{selectedModel
										? `${selectedModel.name} (${selectedModel.family})`
										: "All Models"}
									<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
								</Button>
							</PopoverTrigger>
							<PopoverContent className="w-[400px] p-0" align="start">
								<Command>
									<CommandInput placeholder="Search models..." />
									<CommandList>
										<CommandEmpty>No model found.</CommandEmpty>
										<CommandGroup>
											<CommandItem
												value="__all__"
												onSelect={() => {
													setModel("__all__");
													setModelPopoverOpen(false);
												}}
											>
												<Check
													className={cn(
														"mr-2 h-4 w-4",
														model === "__all__" ? "opacity-100" : "opacity-0",
													)}
												/>
												All Models
											</CommandItem>
											{models.map((m) => (
												<CommandItem
													key={m.id}
													value={`${m.id} ${m.name} ${m.family}`}
													onSelect={() => {
														setModel(m.id);
														setModelPopoverOpen(false);
													}}
												>
													<Check
														className={cn(
															"mr-2 h-4 w-4",
															model === m.id ? "opacity-100" : "opacity-0",
														)}
													/>
													<span className="truncate">
														{m.name}{" "}
														<span className="text-muted-foreground">
															({m.family})
														</span>
													</span>
												</CommandItem>
											))}
										</CommandGroup>
									</CommandList>
								</Command>
							</PopoverContent>
						</Popover>
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

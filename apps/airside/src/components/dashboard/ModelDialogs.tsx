"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useApi } from "@/lib/fetch-client";

import type { AirsideModel } from "@/app/dashboard/fleet/page";
import type { ReactNode } from "react";

function useInvalidateModels(providerCompanyId: string) {
	const api = useApi();
	const queryClient = useQueryClient();
	return async () => {
		await queryClient.invalidateQueries({
			queryKey: api.queryOptions("get", "/airside/models", {
				params: { query: { providerCompanyId } },
			}).queryKey,
		});
		await queryClient.invalidateQueries({
			queryKey: api.queryOptions("get", "/airside/filings", {
				params: { query: { providerCompanyId } },
			}).queryKey,
		});
	};
}

const CAPABILITIES = [
	{ key: "streaming", label: "Streaming" },
	{ key: "tools", label: "Tool calls" },
	{ key: "vision", label: "Vision" },
	{ key: "jsonOutput", label: "JSON output" },
	{ key: "reasoning", label: "Reasoning" },
] as const;

type CapabilityKey = (typeof CAPABILITIES)[number]["key"];

export function RegisterModelDialog({
	providerCompanyId,
	providerIds,
	children,
}: {
	providerCompanyId: string;
	providerIds: string[];
	children: ReactNode;
}) {
	const api = useApi();
	const invalidate = useInvalidateModels(providerCompanyId);
	const [open, setOpen] = useState(false);
	const [modelName, setModelName] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [contextSize, setContextSize] = useState("128000");
	const [inputPrice, setInputPrice] = useState("");
	const [outputPrice, setOutputPrice] = useState("");
	const [note, setNote] = useState("");
	const [capabilities, setCapabilities] = useState<
		Record<CapabilityKey, boolean>
	>({
		streaming: true,
		tools: false,
		vision: false,
		jsonOutput: false,
		reasoning: false,
	});
	const sortedProviderIds = [...providerIds].sort();
	const [providerId, setProviderId] = useState(sortedProviderIds[0] ?? "");
	const effectiveProviderId = sortedProviderIds.includes(providerId)
		? providerId
		: (sortedProviderIds[0] ?? "");

	const createModel = api.useMutation("post", "/airside/models", {
		onSuccess: async () => {
			await invalidate();
			toast.success(
				"Aircraft registered. It enters service once the regulator approves the initial fare.",
			);
			setOpen(false);
			setModelName("");
			setDisplayName("");
			setInputPrice("");
			setOutputPrice("");
			setNote("");
		},
		onError: (error) => {
			toast.error(
				(error as { message?: string })?.message ?? "Failed to add the model",
			);
		},
	});

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="font-display">
						Register an aircraft
					</DialogTitle>
					<DialogDescription>
						List a model on{" "}
						<span className="font-mono">{effectiveProviderId}</span>. The
						listing is drafted until we approve its initial fare — prices per
						token, exponent notation welcome (e.g.{" "}
						<span className="font-mono">2e-6</span> = $2/M).
					</DialogDescription>
				</DialogHeader>
				<form
					className="space-y-4"
					onSubmit={(e) => {
						e.preventDefault();
						createModel.mutate({
							body: {
								providerCompanyId,
								providerId,
								modelName,
								displayName: displayName || undefined,
								contextSize: Number(contextSize) || undefined,
								...capabilities,
								pricing: { inputPrice, outputPrice },
								note: note || undefined,
							},
						});
					}}
				>
					{sortedProviderIds.length > 1 ? (
						<div className="space-y-2">
							<Label>Carrier</Label>
							<div className="flex flex-wrap gap-2">
								{sortedProviderIds.map((id) => (
									<Button
										key={id}
										type="button"
										size="sm"
										variant={id === effectiveProviderId ? "default" : "outline"}
										className="font-mono"
										onClick={() => setProviderId(id)}
									>
										{id}
									</Button>
								))}
							</div>
						</div>
					) : null}
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="model-name">Model ID</Label>
							<Input
								id="model-name"
								data-testid="model-name-input"
								value={modelName}
								onChange={(e) => setModelName(e.target.value)}
								placeholder="acme-large-2"
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="model-display">Display name</Label>
							<Input
								id="model-display"
								value={displayName}
								onChange={(e) => setDisplayName(e.target.value)}
								placeholder="Acme Large 2"
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="model-context">Context size</Label>
							<Input
								id="model-context"
								value={contextSize}
								onChange={(e) => setContextSize(e.target.value)}
								type="number"
								min={1}
							/>
						</div>
					</div>

					<div className="space-y-2">
						<Label>Capabilities</Label>
						<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
							{CAPABILITIES.map((cap) => (
								<label
									key={cap.key}
									className="border-border flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
								>
									{cap.label}
									<Switch
										checked={capabilities[cap.key]}
										onCheckedChange={(checked) =>
											setCapabilities((prev) => ({
												...prev,
												[cap.key]: checked,
											}))
										}
									/>
								</label>
							))}
						</div>
					</div>

					<div className="border-primary/40 bg-primary/5 space-y-4 rounded-lg border border-dashed p-4">
						<div className="text-primary font-mono text-[0.65rem] tracking-[0.25em] uppercase">
							Initial tariff — requires approval
						</div>
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="model-input-price">Input $/token</Label>
								<Input
									id="model-input-price"
									data-testid="input-price"
									value={inputPrice}
									onChange={(e) => setInputPrice(e.target.value)}
									placeholder="2e-6"
									required
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="model-output-price">Output $/token</Label>
								<Input
									id="model-output-price"
									data-testid="output-price"
									value={outputPrice}
									onChange={(e) => setOutputPrice(e.target.value)}
									placeholder="6e-6"
									required
								/>
							</div>
						</div>
						<div className="space-y-2">
							<Label htmlFor="model-note">Note to the regulator</Label>
							<Textarea
								id="model-note"
								value={note}
								onChange={(e) => setNote(e.target.value)}
								placeholder="Anything that helps us review faster."
								rows={2}
							/>
						</div>
					</div>

					<DialogFooter>
						<Button
							type="submit"
							disabled={createModel.isPending || !effectiveProviderId}
							data-testid="register-model-submit"
							className="font-semibold"
						>
							{createModel.isPending ? "Filing…" : "File for approval"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export function EditModelDialog({
	model,
	children,
}: {
	model: AirsideModel;
	children: ReactNode;
}) {
	const api = useApi();
	const invalidate = useInvalidateModels(model.providerCompanyId);
	const [open, setOpen] = useState(false);
	const [displayName, setDisplayName] = useState(model.displayName ?? "");
	const [description, setDescription] = useState(model.description ?? "");
	const [contextSize, setContextSize] = useState(
		model.contextSize ? String(model.contextSize) : "",
	);
	const [capabilities, setCapabilities] = useState<
		Record<CapabilityKey, boolean>
	>({
		streaming: model.streaming,
		tools: model.tools,
		vision: model.vision,
		jsonOutput: model.jsonOutput,
		reasoning: model.reasoning,
	});

	function resetFromModel() {
		setDisplayName(model.displayName ?? "");
		setDescription(model.description ?? "");
		setContextSize(model.contextSize ? String(model.contextSize) : "");
		setCapabilities({
			streaming: model.streaming,
			tools: model.tools,
			vision: model.vision,
			jsonOutput: model.jsonOutput,
			reasoning: model.reasoning,
		});
	}

	const updateModel = api.useMutation("patch", "/airside/models/{id}", {
		onSuccess: async () => {
			await invalidate();
			toast.success("Model updated.");
			setOpen(false);
		},
		onError: (error) => {
			toast.error(
				(error as { message?: string })?.message ?? "Failed to update model",
			);
		},
	});

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (next) {
					// Re-seed from the latest server state; the component stays
					// mounted across refetches, so mount-time state goes stale.
					resetFromModel();
				}
				setOpen(next);
			}}
		>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="font-display">
						Edit {model.modelName}
					</DialogTitle>
					<DialogDescription>
						Everything here applies immediately. Pricing is the exception — it
						only changes through an approved fare filing.
					</DialogDescription>
				</DialogHeader>
				<form
					className="space-y-4"
					onSubmit={(e) => {
						e.preventDefault();
						updateModel.mutate({
							params: { path: { id: model.id } },
							body: {
								displayName: displayName || null,
								description: description || null,
								contextSize: contextSize ? Number(contextSize) : null,
								...capabilities,
							},
						});
					}}
				>
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="edit-display">Display name</Label>
							<Input
								id="edit-display"
								data-testid="edit-display-name"
								value={displayName}
								onChange={(e) => setDisplayName(e.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="edit-context">Context size</Label>
							<Input
								id="edit-context"
								value={contextSize}
								onChange={(e) => setContextSize(e.target.value)}
								type="number"
								min={1}
							/>
						</div>
					</div>
					<div className="space-y-2">
						<Label htmlFor="edit-description">Description</Label>
						<Textarea
							id="edit-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							rows={2}
						/>
					</div>
					<div className="space-y-2">
						<Label>Capabilities</Label>
						<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
							{CAPABILITIES.map((cap) => (
								<label
									key={cap.key}
									className="border-border flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
								>
									{cap.label}
									<Switch
										checked={capabilities[cap.key]}
										onCheckedChange={(checked) =>
											setCapabilities((prev) => ({
												...prev,
												[cap.key]: checked,
											}))
										}
									/>
								</label>
							))}
						</div>
					</div>
					<DialogFooter>
						<Button
							type="submit"
							disabled={updateModel.isPending}
							data-testid="edit-model-submit"
							className="font-semibold"
						>
							{updateModel.isPending ? "Saving…" : "Save changes"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export function FileFareDialog({
	model,
	children,
}: {
	model: AirsideModel;
	children: ReactNode;
}) {
	const api = useApi();
	const invalidate = useInvalidateModels(model.providerCompanyId);
	const [open, setOpen] = useState(false);
	const [inputPrice, setInputPrice] = useState(
		model.currentPricing?.inputPrice ?? "",
	);
	const [outputPrice, setOutputPrice] = useState(
		model.currentPricing?.outputPrice ?? "",
	);
	const [note, setNote] = useState("");

	function resetFromModel() {
		setInputPrice(model.currentPricing?.inputPrice ?? "");
		setOutputPrice(model.currentPricing?.outputPrice ?? "");
		setNote("");
	}

	const fileFare = api.useMutation(
		"post",
		"/airside/models/{id}/price-filings",
		{
			onSuccess: async () => {
				await invalidate();
				toast.success("Fare filed — it takes effect once approved.");
				setOpen(false);
				setNote("");
			},
			onError: (error) => {
				toast.error(
					(error as { message?: string })?.message ?? "Failed to file the fare",
				);
			},
		},
	);

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (next) {
					resetFromModel();
				}
				setOpen(next);
			}}
		>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="font-display">
						File a fare for {model.modelName}
					</DialogTitle>
					<DialogDescription>
						New prices are drafted as a tariff filing and only take effect after
						regulator approval.
					</DialogDescription>
				</DialogHeader>
				<form
					className="space-y-4"
					onSubmit={(e) => {
						e.preventDefault();
						fileFare.mutate({
							params: { path: { id: model.id } },
							body: { inputPrice, outputPrice, note: note || undefined },
						});
					}}
				>
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="fare-input">Input $/token</Label>
							<Input
								id="fare-input"
								data-testid="fare-input-price"
								value={inputPrice}
								onChange={(e) => setInputPrice(e.target.value)}
								placeholder="2e-6"
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="fare-output">Output $/token</Label>
							<Input
								id="fare-output"
								data-testid="fare-output-price"
								value={outputPrice}
								onChange={(e) => setOutputPrice(e.target.value)}
								placeholder="6e-6"
								required
							/>
						</div>
					</div>
					<div className="space-y-2">
						<Label htmlFor="fare-note">Note</Label>
						<Textarea
							id="fare-note"
							value={note}
							onChange={(e) => setNote(e.target.value)}
							placeholder="Why the change?"
							rows={2}
						/>
					</div>
					<DialogFooter>
						<Button
							type="submit"
							disabled={fileFare.isPending}
							data-testid="file-fare-submit"
							className="font-semibold"
						>
							{fileFare.isPending ? "Filing…" : "File fare"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

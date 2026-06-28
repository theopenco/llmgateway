"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/lib/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/lib/components/dialog";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

import type { CustomModel } from "./custom-models-client";

interface PriceFieldDef {
	key:
		| "inputPrice"
		| "outputPrice"
		| "cachedInputPrice"
		| "cacheReadInputPrice"
		| "cacheWriteInputPrice"
		| "cacheWriteInputPrice1h"
		| "requestPrice"
		| "webSearchPrice"
		| "imageInputPrice"
		| "audioInputPrice";
	label: string;
}

const PRICE_FIELDS: PriceFieldDef[] = [
	{ key: "inputPrice", label: "Input price (USD / token)" },
	{ key: "outputPrice", label: "Output price (USD / token)" },
	{ key: "cachedInputPrice", label: "Cached input price" },
	{ key: "cacheReadInputPrice", label: "Cache read input price" },
	{ key: "cacheWriteInputPrice", label: "Cache write input price" },
	{ key: "cacheWriteInputPrice1h", label: "Cache write input price (1h)" },
	{ key: "requestPrice", label: "Per-request price" },
	{ key: "webSearchPrice", label: "Web search price" },
	{ key: "imageInputPrice", label: "Image input price" },
	{ key: "audioInputPrice", label: "Audio input price" },
];

const BOOL_CAPABILITIES: { key: CapabilityKey; label: string }[] = [
	{ key: "vision", label: "Vision" },
	{ key: "tools", label: "Tools" },
	{ key: "reasoning", label: "Reasoning" },
	{ key: "jsonOutput", label: "JSON output" },
	{ key: "audio", label: "Audio" },
];

type CapabilityKey = "vision" | "tools" | "reasoning" | "jsonOutput" | "audio";

type FormState = Record<string, string>;

function buildInitialState(model?: CustomModel): FormState {
	const s: FormState = {
		modelName: model?.modelName ?? "",
		displayName: model?.displayName ?? "",
		contextSize:
			model?.contextSize !== null && model?.contextSize !== undefined
				? String(model.contextSize)
				: "",
		maxOutput:
			model?.maxOutput !== null && model?.maxOutput !== undefined
				? String(model.maxOutput)
				: "",
		streaming: model?.streaming ?? "unset",
		supportedParameters: model?.supportedParameters?.join(", ") ?? "",
	};
	for (const { key } of PRICE_FIELDS) {
		s[key] = (model?.[key] as string | null) ?? "";
	}
	for (const { key } of BOOL_CAPABILITIES) {
		const v = model?.[key];
		s[key] = v === null || v === undefined ? "unset" : v ? "true" : "false";
	}
	return s;
}

function boolFromTriState(value: string): boolean | undefined {
	if (value === "true") {
		return true;
	}
	if (value === "false") {
		return false;
	}
	return undefined;
}

export function CustomModelDialog({
	providerKeyId,
	model,
	children,
}: {
	providerKeyId: string;
	model?: CustomModel;
	children: React.ReactNode;
}) {
	const api = useApi();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [form, setForm] = useState<FormState>(() => buildInitialState(model));

	const listKey = api.queryOptions("get", "/custom-models", {
		params: { query: { providerKeyId } },
	}).queryKey;

	const createMutation = api.useMutation("post", "/custom-models");
	const updateMutation = api.useMutation("patch", "/custom-models/{id}");

	const isEdit = Boolean(model);
	const isPending = createMutation.isPending || updateMutation.isPending;

	const set = (key: string, value: string) =>
		setForm((prev) => ({ ...prev, [key]: value }));

	const handleOpenChange = (next: boolean) => {
		setOpen(next);
		if (next) {
			setForm(buildInitialState(model));
		}
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();

		if (!form.modelName.trim()) {
			toast({
				title: "Model name required",
				description: "Enter the model id used after the provider prefix.",
				variant: "destructive",
			});
			return;
		}

		const str = (v: string) => (v.trim() === "" ? null : v.trim());

		const parsePositiveInt = (
			v: string,
			label: string,
		): number | null | undefined => {
			if (v.trim() === "") {
				return null;
			}
			const n = Number(v);
			if (!Number.isInteger(n) || n <= 0) {
				toast({
					title: `Invalid ${label}`,
					description: `${label} must be a positive whole number.`,
					variant: "destructive",
				});
				return undefined;
			}
			return n;
		};

		const contextSize = parsePositiveInt(form.contextSize, "context size");
		if (contextSize === undefined) {
			return;
		}
		const maxOutput = parsePositiveInt(form.maxOutput, "max output");
		if (maxOutput === undefined) {
			return;
		}

		const body: Record<string, unknown> = {
			modelName: form.modelName.trim(),
			displayName: str(form.displayName),
			contextSize,
			maxOutput,
			streaming: form.streaming === "unset" ? null : form.streaming,
			supportedParameters:
				form.supportedParameters.trim() === ""
					? null
					: form.supportedParameters
							.split(",")
							.map((p) => p.trim())
							.filter(Boolean),
		};
		for (const { key } of PRICE_FIELDS) {
			body[key] = str(form[key]);
		}
		for (const { key } of BOOL_CAPABILITIES) {
			body[key] = boolFromTriState(form[key]) ?? null;
		}

		const onSuccess = () => {
			toast({
				title: isEdit ? "Custom model updated" : "Custom model created",
			});
			void queryClient.invalidateQueries({ queryKey: listKey });
			setOpen(false);
		};
		const onError = (error: unknown) => {
			toast({
				title: "Error",
				description:
					error instanceof Error
						? error.message
						: "Failed to save custom model",
				variant: "destructive",
			});
		};

		if (isEdit && model) {
			updateMutation.mutate(
				{ params: { path: { id: model.id } }, body: body as never },
				{ onSuccess, onError },
			);
		} else {
			createMutation.mutate(
				{ body: { providerKeyId, ...body } as never },
				{ onSuccess, onError },
			);
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>
							{isEdit ? "Edit custom model" : "Add custom model"}
						</DialogTitle>
						<DialogDescription>
							Define pricing, limits and capabilities for a text-output model
							served through this custom provider. Multi-modal input (images,
							audio) is supported. All fields except the model id are optional.
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-6 py-4">
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="modelName">Model id</Label>
								<Input
									id="modelName"
									placeholder="gpt-5.5"
									value={form.modelName}
									onChange={(e) => set("modelName", e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="displayName">Display name</Label>
								<Input
									id="displayName"
									placeholder="Optional"
									value={form.displayName}
									onChange={(e) => set("displayName", e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="contextSize">Context size (tokens)</Label>
								<Input
									id="contextSize"
									type="number"
									min={1}
									placeholder="e.g. 200000"
									value={form.contextSize}
									onChange={(e) => set("contextSize", e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="maxOutput">Max output (tokens)</Label>
								<Input
									id="maxOutput"
									type="number"
									min={1}
									placeholder="e.g. 8192"
									value={form.maxOutput}
									onChange={(e) => set("maxOutput", e.target.value)}
								/>
							</div>
						</div>

						<div className="space-y-3">
							<h4 className="text-sm font-medium">Pricing</h4>
							<p className="text-xs text-muted-foreground">
								Prices are per token in USD. Accepts decimal or exponent format
								(e.g. <code>0.000003</code> or <code>3.0e-6</code>).
							</p>
							<div className="grid gap-4 sm:grid-cols-2">
								{PRICE_FIELDS.map(({ key, label }) => (
									<div key={key} className="space-y-2">
										<Label htmlFor={key}>{label}</Label>
										<Input
											id={key}
											placeholder="0"
											value={form[key]}
											onChange={(e) => set(key, e.target.value)}
										/>
									</div>
								))}
							</div>
						</div>

						<div className="space-y-3">
							<h4 className="text-sm font-medium">Capabilities</h4>
							<div className="grid gap-4 sm:grid-cols-2">
								<div className="space-y-2">
									<Label htmlFor="streaming">Streaming</Label>
									<Select
										value={form.streaming}
										onValueChange={(v) => set("streaming", v)}
									>
										<SelectTrigger id="streaming">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="unset">Default</SelectItem>
											<SelectItem value="true">Supported</SelectItem>
											<SelectItem value="false">Not supported</SelectItem>
											<SelectItem value="only">Streaming only</SelectItem>
										</SelectContent>
									</Select>
								</div>
								{BOOL_CAPABILITIES.map(({ key, label }) => (
									<div key={key} className="space-y-2">
										<Label htmlFor={key}>{label}</Label>
										<Select
											value={form[key]}
											onValueChange={(v) => set(key, v)}
										>
											<SelectTrigger id={key}>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="unset">Default</SelectItem>
												<SelectItem value="true">Yes</SelectItem>
												<SelectItem value="false">No</SelectItem>
											</SelectContent>
										</Select>
									</div>
								))}
							</div>
							<div className="space-y-2">
								<Label htmlFor="supportedParameters">
									Supported parameters
								</Label>
								<Input
									id="supportedParameters"
									placeholder="temperature, max_tokens, top_p"
									value={form.supportedParameters}
									onChange={(e) => set("supportedParameters", e.target.value)}
								/>
								<p className="text-xs text-muted-foreground">
									Comma-separated list. Leave empty to allow all.
								</p>
							</div>
						</div>
					</div>

					<DialogFooter>
						<Button type="submit" disabled={isPending}>
							{isEdit ? "Save changes" : "Add model"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

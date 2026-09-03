"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	CheckCircle2,
	Clock3,
	Loader2,
	ShieldCheck,
	XCircle,
} from "lucide-react";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useApi } from "@/lib/fetch-client";
import { perMillionToPerToken, perTokenToPerMillion } from "@/lib/format";

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
	{ key: "audio", label: "Audio input" },
	{ key: "jsonOutput", label: "JSON output" },
	{ key: "jsonOutputSchema", label: "Structured JSON" },
	{ key: "reasoning", label: "Reasoning" },
	{ key: "reasoningMaxTokens", label: "Reasoning budget" },
	{ key: "webSearch", label: "Web search" },
] as const;

type Verification = NonNullable<AirsideModel["latestVerification"]>;

function VerificationResults({ verification }: { verification: Verification }) {
	const statusLabel =
		verification.status === "queued"
			? "Queued"
			: verification.status === "running"
				? "Running"
				: verification.status === "passed"
					? "Passed"
					: "Failed";
	return (
		<div
			className="border-border bg-muted/25 space-y-3 rounded-lg border p-3"
			aria-live="polite"
			data-testid="verification-results"
		>
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-2 text-sm font-semibold">
					<ShieldCheck className="text-primary size-4" aria-hidden="true" />
					Preflight verification
				</div>
				<span className="text-muted-foreground font-mono text-[0.65rem] tracking-wider uppercase">
					{statusLabel}
				</span>
			</div>
			<ul className="divide-border divide-y">
				{verification.checks.map((check) => (
					<li key={check.id} className="flex items-start gap-2 py-2 text-xs">
						{check.status === "passed" ? (
							<CheckCircle2 className="text-signal mt-0.5 size-3.5 shrink-0" />
						) : check.status === "failed" ? (
							<XCircle className="text-destructive mt-0.5 size-3.5 shrink-0" />
						) : check.status === "running" ? (
							<Loader2 className="text-primary mt-0.5 size-3.5 shrink-0 animate-spin" />
						) : (
							<Clock3 className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
						)}
						<div>
							<p className="font-medium">{check.label}</p>
							{check.feedback ? (
								<p className="text-muted-foreground mt-0.5">{check.feedback}</p>
							) : null}
						</div>
					</li>
				))}
			</ul>
			{verification.summary ? (
				<p className="text-muted-foreground text-xs">{verification.summary}</p>
			) : null}
		</div>
	);
}

// Unified reasoning_effort tiers a deployment can accept, in ascending order.
const REASONING_EFFORTS = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
type ReasoningEffortOption = (typeof REASONING_EFFORTS)[number];

type CapabilityKey = (typeof CAPABILITIES)[number]["key"];

type RateLimitScope = "global" | "per_org";

/**
 * How a carrier's own caps are counted. Most carriers mean "my deployment
 * takes N req/min" — one counter for everyone — so that is the default; the
 * per-organization bucketing is there for carriers who sell per-tenant quota.
 */
function RateLimitScopeField({
	id,
	value,
	onChange,
}: {
	id: string;
	value: RateLimitScope;
	onChange: (value: RateLimitScope) => void;
}) {
	return (
		<div className="space-y-2 sm:col-span-2">
			<Label htmlFor={id}>Cap applies</Label>
			<Select
				value={value}
				onValueChange={(next) => onChange(next as RateLimitScope)}
			>
				<SelectTrigger id={id} data-testid={id}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="global">
						Across all organizations (one shared counter)
					</SelectItem>
					<SelectItem value="per_org">
						Per organization (each gets its own counter)
					</SelectItem>
				</SelectContent>
			</Select>
			<p className="text-muted-foreground text-xs">
				{value === "global"
					? "Total traffic we send your deployment stays under the cap."
					: "Every organization may reach the cap, so total upstream load grows with the number of customers."}{" "}
				Platform-set limits always take precedence.
			</p>
		</div>
	);
}

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
	const [externalId, setExternalId] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [contextSize, setContextSize] = useState("128000");
	const [description, setDescription] = useState("");
	const [family, setFamily] = useState("");
	const [maxOutput, setMaxOutput] = useState("");
	const [inputPrice, setInputPrice] = useState("");
	const [outputPrice, setOutputPrice] = useState("");
	const [cachedInputPrice, setCachedInputPrice] = useState("");
	const [requestPrice, setRequestPrice] = useState("");
	const [note, setNote] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [verificationId, setVerificationId] = useState("");
	const [maxRpm, setMaxRpm] = useState("");
	const [maxRpd, setMaxRpd] = useState("");
	const [rateLimitScope, setRateLimitScope] =
		useState<RateLimitScope>("global");
	const [capabilities, setCapabilities] = useState<
		Record<CapabilityKey, boolean>
	>({
		streaming: true,
		tools: false,
		vision: false,
		audio: false,
		jsonOutput: false,
		jsonOutputSchema: false,
		reasoning: false,
		reasoningMaxTokens: false,
		webSearch: false,
	});
	const [reasoningEfforts, setReasoningEfforts] = useState<
		ReasoningEffortOption[]
	>([]);
	const sortedProviderIds = [...providerIds].sort();
	const [providerId, setProviderId] = useState(sortedProviderIds[0] ?? "");
	const effectiveProviderId = sortedProviderIds.includes(providerId)
		? providerId
		: (sortedProviderIds[0] ?? "");
	const verificationQuery = api.useQuery(
		"get",
		"/airside/model-verifications/{id}",
		{ params: { path: { id: verificationId } } },
		{
			enabled: Boolean(verificationId),
			refetchInterval: (query) => {
				const status = query.state.data?.verification.status;
				return status === "queued" || status === "running" ? 1_000 : false;
			},
		},
	);
	const verification = verificationQuery.data?.verification;
	const verificationInProgress =
		verification?.status === "queued" || verification?.status === "running";
	const resetVerification = () => {
		if (verificationId) {
			setVerificationId("");
		}
	};
	const queueVerification = api.useMutation(
		"post",
		"/airside/model-verifications",
		{
			onSuccess: (data) => {
				setVerificationId(data.verification.id);
				setApiKey("");
				toast.success("Preflight queued. Results will update here.");
			},
			onError: (error) => {
				toast.error(
					(error as { message?: string })?.message ??
						"Failed to queue verification",
				);
			},
		},
	);

	const createModel = api.useMutation("post", "/airside/models", {
		onSuccess: async () => {
			await invalidate();
			toast.success(
				"Aircraft registered. It enters service once the regulator approves the initial fare.",
			);
			setOpen(false);
			setModelName("");
			setExternalId("");
			setDisplayName("");
			setInputPrice("");
			setOutputPrice("");
			setNote("");
			setApiKey("");
			setVerificationId("");
		},
		onError: (error) => {
			const message =
				(error as { message?: string })?.message ?? "Failed to add the model";
			if (message.includes("changed after verification")) {
				setVerificationId("");
			}
			toast.error(message);
		},
	});

	const verificationMapping = {
		providerCompanyId,
		providerId: effectiveProviderId,
		modelName,
		externalId: externalId || undefined,
		...capabilities,
		reasoningEfforts:
			capabilities.reasoning && reasoningEfforts.length > 0
				? reasoningEfforts
				: undefined,
	};

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
						listing is drafted until we approve its initial fare. Token prices
						are in dollars per million tokens.
					</DialogDescription>
				</DialogHeader>
				<form
					className="space-y-4"
					onSubmit={(e) => {
						e.preventDefault();
						if (verification?.status !== "passed") {
							queueVerification.mutate({
								body: {
									...verificationMapping,
									apiKey: apiKey || undefined,
								},
							});
							return;
						}
						createModel.mutate({
							body: {
								verificationId: verification.id,
								providerCompanyId,
								providerId: effectiveProviderId,
								modelName,
								externalId: externalId || undefined,
								displayName: displayName || undefined,
								description: description || undefined,
								family,
								contextSize: Number(contextSize) || undefined,
								maxOutput: Number(maxOutput) || undefined,
								...capabilities,
								reasoningEfforts:
									capabilities.reasoning && reasoningEfforts.length > 0
										? reasoningEfforts
										: undefined,
								maxRpm: Number(maxRpm) || undefined,
								maxRpd: Number(maxRpd) || undefined,
								rateLimitScope,
								pricing: {
									inputPrice: perMillionToPerToken(inputPrice),
									outputPrice: perMillionToPerToken(outputPrice),
									cachedInputPrice: cachedInputPrice
										? perMillionToPerToken(cachedInputPrice)
										: undefined,
									requestPrice: requestPrice || undefined,
								},
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
										disabled={verificationInProgress}
										onClick={() => {
											setProviderId(id);
											resetVerification();
										}}
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
								onChange={(e) => {
									setModelName(e.target.value);
									resetVerification();
								}}
								disabled={verificationInProgress}
								placeholder="acme-large-2"
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="model-external-id">Upstream model ID</Label>
							<Input
								id="model-external-id"
								data-testid="model-external-id-input"
								value={externalId}
								onChange={(e) => {
									setExternalId(e.target.value);
									resetVerification();
								}}
								disabled={verificationInProgress}
								placeholder={modelName || "same as model ID"}
							/>
							<p className="text-muted-foreground text-xs">
								The id your API expects. Fixed once listed.
							</p>
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
						<div className="space-y-2">
							<Label htmlFor="model-max-output">Max output tokens</Label>
							<Input
								id="model-max-output"
								value={maxOutput}
								onChange={(e) => setMaxOutput(e.target.value)}
								type="number"
								min={1}
								placeholder="optional"
							/>
						</div>
						<div className="space-y-2 sm:col-span-2">
							<Label htmlFor="model-family">Family</Label>
							<Input
								id="model-family"
								value={family}
								onChange={(e) => setFamily(e.target.value)}
								placeholder="e.g. acme (groups related models)"
								required
							/>
						</div>
					</div>

					<div className="space-y-2">
						<Label htmlFor="model-description">Description</Label>
						<Textarea
							id="model-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="What is this model good at?"
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
										disabled={verificationInProgress}
										onCheckedChange={(checked) => {
											setCapabilities((prev) => ({
												...prev,
												[cap.key]: checked,
											}));
											resetVerification();
										}}
									/>
								</label>
							))}
						</div>
						{capabilities.reasoning ? (
							<div className="space-y-1 pt-1">
								<Label className="text-muted-foreground text-xs">
									Supported reasoning efforts
								</Label>
								<div className="flex flex-wrap gap-1.5">
									{REASONING_EFFORTS.map((effort) => {
										const active = reasoningEfforts.includes(effort);
										return (
											<button
												key={effort}
												type="button"
												aria-pressed={active}
												disabled={verificationInProgress}
												data-testid={`effort-${effort}`}
												onClick={() => {
													setReasoningEfforts((prev) =>
														prev.includes(effort)
															? prev.filter((e) => e !== effort)
															: [...prev, effort],
													);
													resetVerification();
												}}
												className={
													active
														? "bg-primary/15 text-primary border-primary/40 rounded-full border px-2.5 py-1 font-mono text-xs"
														: "border-border text-muted-foreground hover:text-foreground rounded-full border px-2.5 py-1 font-mono text-xs"
												}
											>
												{effort}
											</button>
										);
									})}
								</div>
							</div>
						) : null}
					</div>

					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="model-rpm">Rate limit (req/min, optional)</Label>
							<Input
								id="model-rpm"
								type="number"
								min={1}
								value={maxRpm}
								onChange={(e) => setMaxRpm(e.target.value)}
								placeholder="e.g. 60"
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="model-rpd">Rate limit (req/day, optional)</Label>
							<Input
								id="model-rpd"
								type="number"
								min={1}
								value={maxRpd}
								onChange={(e) => setMaxRpd(e.target.value)}
								placeholder="e.g. 20000"
							/>
						</div>
						<RateLimitScopeField
							id="model-rate-limit-scope"
							value={rateLimitScope}
							onChange={setRateLimitScope}
						/>
					</div>

					<div className="border-primary/40 bg-primary/5 space-y-4 rounded-lg border border-dashed p-4">
						<div className="text-primary font-mono text-[0.65rem] tracking-[0.25em] uppercase">
							Initial tariff — requires approval
						</div>
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="model-input-price">Input $/1M tokens</Label>
								<Input
									id="model-input-price"
									data-testid="input-price"
									value={inputPrice}
									onChange={(e) => setInputPrice(e.target.value)}
									placeholder="2"
									required
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="model-output-price">Output $/1M tokens</Label>
								<Input
									id="model-output-price"
									data-testid="output-price"
									value={outputPrice}
									onChange={(e) => setOutputPrice(e.target.value)}
									placeholder="6"
									required
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="model-cached-price">
									Cached input $/1M tokens
								</Label>
								<Input
									id="model-cached-price"
									data-testid="cached-input-price"
									value={cachedInputPrice}
									onChange={(e) => setCachedInputPrice(e.target.value)}
									placeholder="0.5"
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="model-request-price">Per-request $</Label>
								<Input
									id="model-request-price"
									data-testid="request-price"
									value={requestPrice}
									onChange={(e) => setRequestPrice(e.target.value)}
									placeholder="0.002"
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

					<div className="border-border space-y-2 rounded-lg border p-3">
						<Label htmlFor="verification-api-key">
							Provider API key{" "}
							<span className="text-muted-foreground">(if needed)</span>
						</Label>
						<Input
							id="verification-api-key"
							type="password"
							autoComplete="off"
							value={apiKey}
							onChange={(event) => setApiKey(event.target.value)}
							placeholder="Uses the managed carrier key when left blank"
							disabled={verificationInProgress}
						/>
						<p className="text-muted-foreground text-xs">
							Used only by the queued preflight and erased when it finishes.
						</p>
					</div>

					{verification ? (
						<VerificationResults verification={verification} />
					) : null}

					<DialogFooter>
						<Button
							type="submit"
							disabled={
								createModel.isPending ||
								queueVerification.isPending ||
								verificationInProgress ||
								!effectiveProviderId
							}
							data-testid="register-model-submit"
							className="font-semibold"
						>
							{createModel.isPending
								? "Filing…"
								: queueVerification.isPending
									? "Queueing…"
									: verification?.status === "passed"
										? "File for approval"
										: verification?.status === "failed"
											? "Run preflight again"
											: "Run preflight"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export function VerifyModelDialog({
	model,
	children,
}: {
	model: AirsideModel;
	children: ReactNode;
}) {
	const api = useApi();
	const invalidate = useInvalidateModels(model.providerCompanyId);
	const [open, setOpen] = useState(false);
	const [apiKey, setApiKey] = useState("");
	const [verificationId, setVerificationId] = useState(
		model.latestVerification?.id ?? "",
	);
	const verificationQuery = api.useQuery(
		"get",
		"/airside/model-verifications/{id}",
		{ params: { path: { id: verificationId } } },
		{
			enabled: open && Boolean(verificationId),
			refetchInterval: (query) => {
				const status = query.state.data?.verification.status;
				return status === "queued" || status === "running" ? 1_000 : false;
			},
		},
	);
	const verification = verificationQuery.data?.verification;
	const queueVerification = api.useMutation(
		"post",
		"/airside/models/{id}/verifications",
		{
			onSuccess: async (data) => {
				setVerificationId(data.verification.id);
				setApiKey("");
				await invalidate();
				toast.success("Mapping verification queued.");
			},
			onError: (error) => {
				toast.error(
					(error as { message?: string })?.message ??
						"Failed to queue verification",
				);
			},
		},
	);

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) {
					setVerificationId(model.latestVerification?.id ?? "");
				} else {
					void invalidate();
				}
			}}
		>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="font-display">
						Verify {model.modelName}
					</DialogTitle>
					<DialogDescription>
						Run the declared capabilities against the upstream model. Checks run
						in the background and do not change the listing.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor={`verify-api-key-${model.id}`}>
							Provider API key{" "}
							<span className="text-muted-foreground">(if needed)</span>
						</Label>
						<Input
							id={`verify-api-key-${model.id}`}
							type="password"
							autoComplete="off"
							value={apiKey}
							onChange={(event) => setApiKey(event.target.value)}
							placeholder="Uses the managed carrier key when left blank"
						/>
						<p className="text-muted-foreground text-xs">
							The key is scoped to this run and erased at completion.
						</p>
					</div>
					{verification ? (
						<VerificationResults verification={verification} />
					) : model.latestVerification ? (
						<VerificationResults verification={model.latestVerification} />
					) : null}
				</div>
				<DialogFooter>
					<Button
						type="button"
						disabled={
							queueVerification.isPending ||
							verification?.status === "queued" ||
							verification?.status === "running"
						}
						onClick={() =>
							queueVerification.mutate({
								params: { path: { id: model.id } },
								body: { apiKey: apiKey || undefined },
							})
						}
					>
						<ShieldCheck className="size-4" />
						{queueVerification.isPending ? "Queueing…" : "Run verification"}
					</Button>
				</DialogFooter>
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
	const [family, setFamily] = useState(model.family ?? "");
	const [maxOutput, setMaxOutput] = useState(
		model.maxOutput ? String(model.maxOutput) : "",
	);
	const [capabilities, setCapabilities] = useState<
		Record<CapabilityKey, boolean>
	>({
		streaming: model.streaming,
		tools: model.tools,
		vision: model.vision,
		audio: model.audio,
		jsonOutput: model.jsonOutput,
		jsonOutputSchema: model.jsonOutputSchema,
		reasoning: model.reasoning,
		reasoningMaxTokens: model.reasoningMaxTokens,
		webSearch: model.webSearch,
	});
	const [reasoningEfforts, setReasoningEfforts] = useState<
		ReasoningEffortOption[]
	>((model.reasoningEfforts ?? []) as ReasoningEffortOption[]);
	const [maxRpm, setMaxRpm] = useState(
		model.maxRpm ? String(model.maxRpm) : "",
	);
	const [maxRpd, setMaxRpd] = useState(
		model.maxRpd ? String(model.maxRpd) : "",
	);
	const [rateLimitScope, setRateLimitScope] = useState<RateLimitScope>(
		model.rateLimitScope,
	);

	function resetFromModel() {
		setDisplayName(model.displayName ?? "");
		setDescription(model.description ?? "");
		setContextSize(model.contextSize ? String(model.contextSize) : "");
		setFamily(model.family ?? "");
		setMaxOutput(model.maxOutput ? String(model.maxOutput) : "");
		setCapabilities({
			streaming: model.streaming,
			tools: model.tools,
			vision: model.vision,
			audio: model.audio,
			jsonOutput: model.jsonOutput,
			jsonOutputSchema: model.jsonOutputSchema,
			reasoning: model.reasoning,
			reasoningMaxTokens: model.reasoningMaxTokens,
			webSearch: model.webSearch,
		});
		setReasoningEfforts(
			(model.reasoningEfforts ?? []) as ReasoningEffortOption[],
		);
		setMaxRpm(model.maxRpm ? String(model.maxRpm) : "");
		setMaxRpd(model.maxRpd ? String(model.maxRpd) : "");
		setRateLimitScope(model.rateLimitScope);
	}

	const updateModel = api.useMutation("patch", "/airside/models/{id}", {
		onSuccess: async () => {
			await invalidate();
			toast.success(
				model.status === "active"
					? "Change filed for review."
					: "Model updated.",
			);
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
						{model.status === "active"
							? "Changes to a live listing are filed for review and apply once we approve them. Pricing goes through a separate fare filing."
							: "Everything here applies to the draft immediately; the initial fare filing covers it. Pricing only changes through a fare filing."}
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
								family,
								contextSize: contextSize ? Number(contextSize) : null,
								maxOutput: maxOutput ? Number(maxOutput) : null,
								...capabilities,
								reasoningEfforts:
									capabilities.reasoning && reasoningEfforts.length > 0
										? reasoningEfforts
										: null,
								maxRpm: maxRpm ? Number(maxRpm) : null,
								maxRpd: maxRpd ? Number(maxRpd) : null,
								rateLimitScope,
							},
						});
					}}
				>
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="edit-external-id">Upstream model ID</Label>
							<Input
								id="edit-external-id"
								className="font-mono"
								value={model.externalId}
								readOnly
								disabled
							/>
							<p className="text-muted-foreground text-xs">
								The id sent to your API. Delist and re-register to change it.
							</p>
						</div>
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
						<div className="space-y-2">
							<Label htmlFor="edit-max-output">Max output tokens</Label>
							<Input
								id="edit-max-output"
								value={maxOutput}
								onChange={(e) => setMaxOutput(e.target.value)}
								type="number"
								min={1}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="edit-family">Family</Label>
							<Input
								id="edit-family"
								value={family}
								onChange={(e) => setFamily(e.target.value)}
								required
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
						{capabilities.reasoning ? (
							<div className="space-y-1 pt-1">
								<Label className="text-muted-foreground text-xs">
									Supported reasoning efforts
								</Label>
								<div className="flex flex-wrap gap-1.5">
									{REASONING_EFFORTS.map((effort) => {
										const active = reasoningEfforts.includes(effort);
										return (
											<button
												key={effort}
												type="button"
												aria-pressed={active}
												data-testid={`effort-${effort}`}
												onClick={() =>
													setReasoningEfforts((prev) =>
														prev.includes(effort)
															? prev.filter((e) => e !== effort)
															: [...prev, effort],
													)
												}
												className={
													active
														? "bg-primary/15 text-primary border-primary/40 rounded-full border px-2.5 py-1 font-mono text-xs"
														: "border-border text-muted-foreground hover:text-foreground rounded-full border px-2.5 py-1 font-mono text-xs"
												}
											>
												{effort}
											</button>
										);
									})}
								</div>
							</div>
						) : null}
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="edit-rpm">Rate limit (req/min)</Label>
							<Input
								id="edit-rpm"
								data-testid="edit-max-rpm"
								type="number"
								min={1}
								value={maxRpm}
								onChange={(e) => setMaxRpm(e.target.value)}
								placeholder="unlimited"
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="edit-rpd">Rate limit (req/day)</Label>
							<Input
								id="edit-rpd"
								type="number"
								min={1}
								value={maxRpd}
								onChange={(e) => setMaxRpd(e.target.value)}
								placeholder="unlimited"
							/>
						</div>
						<RateLimitScopeField
							id="edit-rate-limit-scope"
							value={rateLimitScope}
							onChange={setRateLimitScope}
						/>
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
		perTokenToPerMillion(model.currentPricing?.inputPrice),
	);
	const [outputPrice, setOutputPrice] = useState(
		perTokenToPerMillion(model.currentPricing?.outputPrice),
	);
	const [cachedInputPrice, setCachedInputPrice] = useState(
		perTokenToPerMillion(model.currentPricing?.cachedInputPrice),
	);
	const [requestPrice, setRequestPrice] = useState(
		model.currentPricing?.requestPrice ?? "",
	);
	const [note, setNote] = useState("");

	function resetFromModel() {
		setInputPrice(perTokenToPerMillion(model.currentPricing?.inputPrice));
		setOutputPrice(perTokenToPerMillion(model.currentPricing?.outputPrice));
		setCachedInputPrice(
			perTokenToPerMillion(model.currentPricing?.cachedInputPrice),
		);
		setRequestPrice(model.currentPricing?.requestPrice ?? "");
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
							body: {
								inputPrice: perMillionToPerToken(inputPrice),
								outputPrice: perMillionToPerToken(outputPrice),
								cachedInputPrice: cachedInputPrice
									? perMillionToPerToken(cachedInputPrice)
									: undefined,
								requestPrice: requestPrice || undefined,
								note: note || undefined,
							},
						});
					}}
				>
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="fare-input">Input $/1M tokens</Label>
							<Input
								id="fare-input"
								data-testid="fare-input-price"
								value={inputPrice}
								onChange={(e) => setInputPrice(e.target.value)}
								placeholder="2"
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="fare-output">Output $/1M tokens</Label>
							<Input
								id="fare-output"
								data-testid="fare-output-price"
								value={outputPrice}
								onChange={(e) => setOutputPrice(e.target.value)}
								placeholder="6"
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="fare-cached">Cached input $/1M tokens</Label>
							<Input
								id="fare-cached"
								data-testid="fare-cached-input-price"
								value={cachedInputPrice}
								onChange={(e) => setCachedInputPrice(e.target.value)}
								placeholder="0.5"
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="fare-request">Per-request $</Label>
							<Input
								id="fare-request"
								data-testid="fare-request-price"
								value={requestPrice}
								onChange={(e) => setRequestPrice(e.target.value)}
								placeholder="0.002"
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

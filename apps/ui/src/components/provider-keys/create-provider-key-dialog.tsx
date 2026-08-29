"use client";
import { useQueryClient } from "@tanstack/react-query";
import { usePostHog } from "posthog-js/react";
import React, { useMemo, useState } from "react";

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

import {
	providers,
	isStealthProvider,
	regionEndpointRequiresWorkspaceId,
	regionEndpointUsesWorkspaceId,
	type ProviderDefinition,
} from "@llmgateway/models";
import { getProviderModelIds } from "@llmgateway/shared";
import { MultiModelIdSelector } from "@llmgateway/shared/components";

import { ProviderSelect } from "./provider-select";

import type { Organization } from "@/lib/types";

interface CreateProviderKeyDialogProps {
	children: React.ReactNode;
	selectedOrganization: Organization;
	preselectedProvider?: string;
}

export function CreateProviderKeyDialog({
	children,
	selectedOrganization,
	preselectedProvider,
}: CreateProviderKeyDialogProps) {
	const posthog = usePostHog();
	const [open, setOpen] = useState(false);
	const [selectedProvider, setSelectedProvider] = useState(
		preselectedProvider ?? "",
	);
	const [baseUrl, setBaseUrl] = useState("");
	const [customName, setCustomName] = useState("");
	const [token, setToken] = useState("");
	const [description, setDescription] = useState("");
	const [azureResource, setAzureResource] = useState("");
	const [azureApiVersion, setAzureApiVersion] = useState("2024-10-21");
	const [azureDeploymentType, setAzureDeploymentType] = useState<
		"openai" | "ai-foundry"
	>("ai-foundry");
	const [azureValidationModel, setAzureValidationModel] =
		useState("gpt-4o-mini");
	const [azureAiFoundryResource, setAzureAiFoundryResource] = useState("");
	const [azureAnthropicResource, setAzureAnthropicResource] = useState("");
	const [azureAiFoundryApiVersion, setAzureAiFoundryApiVersion] =
		useState("2024-05-01-preview");
	const [selectedRegion, setSelectedRegion] = useState("");
	const [alibabaWorkspaceId, setAlibabaWorkspaceId] = useState("");
	const [googleVertexProjectId, setGoogleVertexProjectId] = useState("");
	const [vertexTokenType, setVertexTokenType] = useState<"api-key" | "oauth">(
		"api-key",
	);
	const [usageLimit, setUsageLimit] = useState("");
	const [allowedModels, setAllowedModels] = useState<string[]>([]);
	const [isValidating, setIsValidating] = useState(false);

	const api = useApi();
	const queryKey = api.queryOptions("get", "/keys/provider").queryKey;
	const queryClient = useQueryClient();

	const createMutation = api.useMutation("post", "/keys/provider");

	const selectedProviderDef = providers.find(
		(p) => p.id === selectedProvider,
	) as ProviderDefinition | undefined;

	const availableModelIds = useMemo(
		() => (selectedProvider ? getProviderModelIds(selectedProvider) : []),
		[selectedProvider],
	);

	// Sentinel for "let the gateway pick". Radix Select cannot hold an empty
	// string value, so the no-preference choice needs its own id.
	const ANY_REGION = "__any__";

	// When one credential works in every region (AWS), don't pre-select a region:
	// storing one pins the key to it and forfeits cross-region failover, for no
	// gain when the regions are priced identically. Providers whose keys are
	// region-scoped (Alibaba — a Singapore key does not work in Beijing) keep
	// defaulting, since the key really does belong to one region.
	const regionOptional =
		selectedProviderDef?.regionConfig?.sharedCredentialAcrossRegions === true;

	const effectiveRegion =
		(selectedRegion ||
			(regionOptional
				? ANY_REGION
				: selectedProviderDef?.regionConfig?.defaultRegion)) ??
		"";

	// Regions with a workspace-dedicated host (Alibaba Frankfurt) offer the
	// field so a credential can use its own endpoint instead of the shared,
	// trial-grade one. It is only mandatory where no shared host exists.
	const workspaceIdRegion =
		selectedProvider && effectiveRegion && effectiveRegion !== ANY_REGION
			? effectiveRegion
			: undefined;
	const usesWorkspaceId = Boolean(
		workspaceIdRegion &&
		regionEndpointUsesWorkspaceId(selectedProvider, workspaceIdRegion),
	);
	const requiresWorkspaceId = Boolean(
		workspaceIdRegion &&
		regionEndpointRequiresWorkspaceId(selectedProvider, workspaceIdRegion),
	);

	// Exclude the gateway itself and stealth providers (no default base URL):
	// users can't configure a stealth provider key because the platform behind
	// it is undisclosed, so hide them from the selector entirely.
	const availableProviders = providers.filter(
		(provider) => provider.id !== "llmgateway" && !isStealthProvider(provider),
	);

	// Update selectedProvider when preselectedProvider changes or dialog opens
	React.useEffect(() => {
		if (open && preselectedProvider) {
			setSelectedProvider(preselectedProvider);
		}
	}, [open, preselectedProvider]);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();

		// Strip whitespace and zero-width characters that get pasted in when a key
		// is copied from wrapped text (newlines, non-breaking / zero-width spaces).
		const trimmedToken = token.replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, "");

		if (!selectedProvider || !trimmedToken) {
			toast({
				title: "Error",
				description: !selectedProvider
					? "Please select a provider"
					: "Please enter the provider API key",
				variant: "destructive",
			});
			return;
		}

		if (selectedProvider === "llmgateway" && !baseUrl) {
			toast({
				title: "Error",
				description: "Base URL is required for LLM Gateway provider",
				variant: "destructive",
			});
			return;
		}

		if (selectedProvider === "custom" && (!baseUrl || !customName)) {
			toast({
				title: "Error",
				description:
					"Base URL and custom name are required for custom provider",
				variant: "destructive",
			});
			return;
		}

		if (
			selectedProvider === "custom" &&
			!/^[a-z]+(-[a-z]+)*$/.test(customName)
		) {
			toast({
				title: "Error",
				description:
					"Custom name must contain only lowercase letters a-z and single hyphens between them",
				variant: "destructive",
			});
			return;
		}

		const trimmedUsageLimit = usageLimit.trim();
		if (trimmedUsageLimit && !/^\d+(?:\.\d+)?$/.test(trimmedUsageLimit)) {
			toast({
				title: "Error",
				description: "Max spend must be a non-negative number",
				variant: "destructive",
			});
			return;
		}

		const payload: {
			provider: string;
			token: string;
			name?: string;
			description?: string;
			baseUrl?: string;
			options?: Record<string, string | undefined>;
			organizationId: string;
			usageLimit?: string;
			allowedModels?: string[];
		} = {
			provider: selectedProvider,
			token: trimmedToken,
			organizationId: selectedOrganization.id,
		};
		if (description.trim()) {
			payload.description = description.trim();
		}
		if (baseUrl) {
			payload.baseUrl = baseUrl;
		}
		if (trimmedUsageLimit) {
			payload.usageLimit = trimmedUsageLimit;
		}
		if (selectedProvider === "custom" && customName) {
			payload.name = customName;
		}
		// A custom provider's models live in the organization's own catalogue, so
		// there is nothing for a canonical-id restriction to match; the API rejects
		// one, and the field is hidden for it.
		if (selectedProvider !== "custom" && allowedModels.length > 0) {
			payload.allowedModels = allowedModels;
		}
		// Include region in options for providers that support it. Storing a
		// region locks routing to it (a data-residency guarantee), so the
		// no-preference choice deliberately stores nothing.
		if (
			selectedProviderDef?.regionConfig &&
			effectiveRegion &&
			effectiveRegion !== ANY_REGION
		) {
			payload.options = {
				...payload.options,
				[selectedProviderDef.regionConfig.optionsKey]: effectiveRegion,
			};
		}

		if (usesWorkspaceId) {
			if (!alibabaWorkspaceId && requiresWorkspaceId) {
				toast({
					title: "Error",
					description: "Workspace ID is required for this region",
					variant: "destructive",
				});
				return;
			}
			if (
				alibabaWorkspaceId &&
				!/^[a-zA-Z0-9-]{1,64}$/.test(alibabaWorkspaceId)
			) {
				toast({
					title: "Error",
					description:
						"Workspace ID must be 1-64 characters of letters, numbers, and hyphens",
					variant: "destructive",
				});
				return;
			}
			if (alibabaWorkspaceId) {
				payload.options = {
					...payload.options,
					alibaba_workspace_id: alibabaWorkspaceId,
				};
			}
		}

		if (selectedProvider === "azure") {
			if (!azureResource) {
				toast({
					title: "Error",
					description: "Azure resource name is required",
					variant: "destructive",
				});
				return;
			}
			payload.options = {
				azure_resource: azureResource,
				azure_api_version: azureApiVersion,
				azure_deployment_type: azureDeploymentType,
				azure_validation_model: azureValidationModel,
			};
		}

		if (selectedProvider === "azure-ai-foundry") {
			if (!azureAiFoundryResource) {
				toast({
					title: "Error",
					description: "Azure AI Foundry resource name is required",
					variant: "destructive",
				});
				return;
			}
			if (!/^[a-zA-Z0-9-]{1,64}$/.test(azureAiFoundryResource)) {
				toast({
					title: "Error",
					description:
						"Resource name must be 1-64 characters and contain only letters, numbers, and hyphens",
					variant: "destructive",
				});
				return;
			}
			payload.options = {
				...payload.options,
				azure_ai_foundry_resource: azureAiFoundryResource,
				...(azureAiFoundryApiVersion
					? { azure_ai_foundry_api_version: azureAiFoundryApiVersion }
					: {}),
			};
		}

		if (selectedProvider === "azure-anthropic") {
			if (!azureAnthropicResource) {
				toast({
					title: "Error",
					description: "Azure Anthropic resource name is required",
					variant: "destructive",
				});
				return;
			}
			if (!/^[a-zA-Z0-9-]{1,64}$/.test(azureAnthropicResource)) {
				toast({
					title: "Error",
					description:
						"Resource name must be 1-64 characters and contain only letters, numbers, and hyphens",
					variant: "destructive",
				});
				return;
			}
			payload.options = {
				...payload.options,
				azure_anthropic_resource: azureAnthropicResource,
			};
		}

		if (selectedProvider === "google-vertex") {
			payload.options = {
				...payload.options,
				...(googleVertexProjectId
					? { google_vertex_project_id: googleVertexProjectId }
					: {}),
				google_vertex_token_type: vertexTokenType,
			};
		}

		setIsValidating(true);
		toast({ title: "Validating API Key", description: "Please wait..." });

		createMutation.mutate(
			{ body: payload },
			{
				onSuccess: () => {
					setIsValidating(false);
					posthog.capture("provider_key_added", {
						provider: selectedProvider,
						hasBaseUrl: !!baseUrl,
					});
					toast({
						title: "Provider Key Created",
						description: "The provider key has been validated and saved.",
					});
					void queryClient.invalidateQueries({ queryKey });
					setOpen(false);
				},
				onError: (error: unknown) => {
					setIsValidating(false);
					let description =
						"Failed to validate the API key. Please check your key and region.";
					if (typeof error === "object" && error !== null) {
						const err = error as Record<string, unknown>;
						const nested =
							err.error && typeof err.error === "object"
								? (err.error as Record<string, unknown>)
								: err;
						const issues = Array.isArray(nested.issues)
							? (nested.issues as { message?: unknown }[])
							: undefined;
						if (typeof nested.message === "string") {
							description = nested.message;
						} else if (
							issues?.length &&
							typeof issues[0]?.message === "string"
						) {
							description = issues[0].message;
						}
					} else if (error instanceof Error) {
						description = error.message;
					}
					toast({
						title: "Validation Failed",
						description,
						variant: "destructive",
					});
				},
			},
		);
	};

	const handleClose = () => {
		setOpen(false);
		setTimeout(() => {
			setSelectedProvider(preselectedProvider ?? "");
			setBaseUrl("");
			setCustomName("");
			setToken("");
			setDescription("");
			setAzureResource("");
			setAzureApiVersion("2024-10-21");
			setAzureDeploymentType("ai-foundry");
			setAzureValidationModel("gpt-4o-mini");
			setAzureAiFoundryResource("");
			setAzureAiFoundryApiVersion("2024-05-01-preview");
			setSelectedRegion("");
			setAlibabaWorkspaceId("");
			setGoogleVertexProjectId("");
			setVertexTokenType("api-key");
			setUsageLimit("");
			setAllowedModels([]);
		}, 300);
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>
						{preselectedProvider
							? `Add ${providers.find((p) => p.id === preselectedProvider)?.name} Key`
							: "Add Provider Key"}
					</DialogTitle>
					<DialogDescription>
						{preselectedProvider
							? `Add an API key for ${providers.find((p) => p.id === preselectedProvider)?.name} to enable direct access.`
							: "Create a new provider key to connect to an LLM provider."}
						<span className="block mt-1">
							Organization: {selectedOrganization.name}
						</span>
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="space-y-4 py-4">
					<div className="space-y-2">
						<Label htmlFor="provider">Provider</Label>
						<ProviderSelect
							onValueChange={(value) => {
								setSelectedProvider(value);
								setSelectedRegion("");
								// Model ids are provider-specific, so a list picked for the
								// previous provider would only ever be rejected on save.
								setAllowedModels([]);
							}}
							value={selectedProvider}
							providers={availableProviders}
							loading={false}
							disabled={!!preselectedProvider}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="token">Provider API Key</Label>
						<Input
							id="token"
							type="password"
							placeholder="sk-..."
							value={token}
							onChange={(e) => setToken(e.target.value)}
							required
						/>
						{(() => {
							const provider = providers.find((p) => p.id === selectedProvider);
							const instructions = (provider as ProviderDefinition)
								?.apiKeyInstructions;
							const learnMoreUrl = (provider as ProviderDefinition)?.learnMore;

							if (!instructions) {
								return null;
							}

							return (
								<p className="text-sm text-muted-foreground">
									{instructions}
									{learnMoreUrl && (
										<>
											{" "}
											<a
												href={learnMoreUrl}
												target="_blank"
												rel="noopener noreferrer"
												className="text-primary hover:underline"
											>
												Learn more
											</a>
										</>
									)}
								</p>
							);
						})()}
					</div>

					<div className="space-y-2">
						<Label htmlFor="provider-key-description">
							Description (optional)
						</Label>
						<Input
							id="provider-key-description"
							placeholder="Production workloads"
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							maxLength={200}
						/>
						<p className="text-sm text-muted-foreground">
							Shown in request logs and routing details so you can identify
							which key was used.
						</p>
					</div>

					{selectedProvider === "llmgateway" && (
						<div className="space-y-2">
							<Label htmlFor="base-url">Base URL</Label>
							<Input
								id="base-url"
								type="url"
								placeholder="https://api.llmgateway.com"
								value={baseUrl}
								onChange={(e) => setBaseUrl(e.target.value)}
								required
							/>
						</div>
					)}

					{selectedProvider === "azure" && (
						<>
							<div className="space-y-2">
								<Label htmlFor="azure-resource">Resource Name</Label>
								<Input
									id="azure-resource"
									type="text"
									placeholder="my-resource"
									value={azureResource}
									onChange={(e) => setAzureResource(e.target.value)}
									required
								/>
								<p className="text-sm text-muted-foreground">
									Your Azure resource name from the base URL:
									https://&lt;resource-name&gt;.openai.azure.com
								</p>
							</div>
							<div className="space-y-2">
								<Label htmlFor="azure-deployment-type">Deployment Type</Label>
								<Select
									value={azureDeploymentType}
									onValueChange={(value) =>
										setAzureDeploymentType(value as "openai" | "ai-foundry")
									}
								>
									<SelectTrigger id="azure-deployment-type">
										<SelectValue placeholder="Select deployment type" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="ai-foundry">Azure AI Foundry</SelectItem>
										<SelectItem value="openai">Azure OpenAI</SelectItem>
									</SelectContent>
								</Select>
								<p className="text-sm text-muted-foreground">
									Choose Azure AI Foundry (unified endpoint) or Azure OpenAI
									(deployment-based)
								</p>
							</div>
							{azureDeploymentType === "openai" && (
								<div className="space-y-2">
									<Label htmlFor="azure-api-version">API Version</Label>
									<Input
										id="azure-api-version"
										type="text"
										placeholder="2024-10-21"
										value={azureApiVersion}
										onChange={(e) => setAzureApiVersion(e.target.value)}
									/>
									<p className="text-sm text-muted-foreground">
										Azure API version (default: 2024-10-21 GA)
									</p>
								</div>
							)}
							<div className="space-y-2">
								<Label htmlFor="azure-validation-model">Validation Model</Label>
								<Input
									id="azure-validation-model"
									type="text"
									placeholder="gpt-4o-mini"
									value={azureValidationModel}
									onChange={(e) => setAzureValidationModel(e.target.value)}
								/>
								<p className="text-sm text-muted-foreground">
									Model deployment name to use for validating the API key
									(default: gpt-4o-mini)
								</p>
							</div>
						</>
					)}

					{selectedProvider === "azure-ai-foundry" && (
						<>
							<div className="space-y-2">
								<Label htmlFor="azure-ai-foundry-resource">Resource Name</Label>
								<Input
									id="azure-ai-foundry-resource"
									type="text"
									placeholder="my-resource"
									value={azureAiFoundryResource}
									onChange={(e) => setAzureAiFoundryResource(e.target.value)}
									required
								/>
								<p className="text-sm text-muted-foreground">
									Your Azure AI Foundry resource name from the base URL:
									https://&lt;resource-name&gt;.services.ai.azure.com
								</p>
							</div>
							<div className="space-y-2">
								<Label htmlFor="azure-ai-foundry-api-version">
									API Version
								</Label>
								<Input
									id="azure-ai-foundry-api-version"
									type="text"
									placeholder="2024-05-01-preview"
									value={azureAiFoundryApiVersion}
									onChange={(e) => setAzureAiFoundryApiVersion(e.target.value)}
								/>
								<p className="text-sm text-muted-foreground">
									Azure AI Foundry API version (default: 2024-05-01-preview)
								</p>
							</div>
						</>
					)}

					{selectedProvider === "azure-anthropic" && (
						<div className="space-y-2">
							<Label htmlFor="azure-anthropic-resource">Resource Name</Label>
							<Input
								id="azure-anthropic-resource"
								type="text"
								placeholder="my-resource"
								value={azureAnthropicResource}
								onChange={(e) => setAzureAnthropicResource(e.target.value)}
								required
							/>
							<p className="text-sm text-muted-foreground">
								Your Microsoft Foundry resource name from the base URL:
								https://&lt;resource-name&gt;.services.ai.azure.com
							</p>
						</div>
					)}

					{selectedProvider === "google-vertex" && (
						<div className="space-y-2">
							<Label htmlFor="google-vertex-project-id">
								Google Cloud Project ID
							</Label>
							<Input
								id="google-vertex-project-id"
								type="text"
								placeholder="my-project-id"
								value={googleVertexProjectId}
								onChange={(e) => setGoogleVertexProjectId(e.target.value)}
							/>
							<p className="text-sm text-muted-foreground">
								Optional for API-key chat, embedding, and speech requests.
								Required for OAuth and video generation.
							</p>
						</div>
					)}

					{selectedProvider === "google-vertex" && (
						<div className="space-y-2">
							<Label htmlFor="vertex-token-type">Token Type</Label>
							<Select
								value={vertexTokenType}
								onValueChange={(value) =>
									setVertexTokenType(value as "api-key" | "oauth")
								}
							>
								<SelectTrigger id="vertex-token-type">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="api-key">API Key</SelectItem>
									<SelectItem value="oauth">OAuth2 Bearer</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-sm text-muted-foreground">
								Use <strong>API Key</strong> for Google API keys (sent as{" "}
								<code>?key=</code>). Use <strong>OAuth2 Bearer</strong> for
								service account access tokens (sent as{" "}
								<code>Authorization: Bearer</code>).
							</p>
						</div>
					)}

					{selectedProviderDef?.regionConfig && (
						<div className="space-y-2">
							<Label htmlFor="provider-region">Region</Label>
							<Select value={effectiveRegion} onValueChange={setSelectedRegion}>
								<SelectTrigger id="provider-region">
									<SelectValue placeholder="Select region" />
								</SelectTrigger>
								<SelectContent>
									{regionOptional && (
										<SelectItem value={ANY_REGION}>
											Any region (recommended)
										</SelectItem>
									)}
									{selectedProviderDef.regionConfig.regions.map((r) => (
										<SelectItem key={r.id} value={r.id}>
											{r.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<p className="text-sm text-muted-foreground">
								{regionOptional
									? "One key works across every region. Leave this on “Any region” to let the gateway route across all of them; pick one to keep requests in a single region."
									: "API keys are region-specific. Make sure your key matches the selected region."}
							</p>
						</div>
					)}

					{usesWorkspaceId && (
						<div className="space-y-2">
							<Label htmlFor="provider-workspace-id">
								Workspace ID{requiresWorkspaceId ? "" : " (optional)"}
							</Label>
							<Input
								id="provider-workspace-id"
								type="text"
								placeholder="ws-xxxxxxxxxxxxxxxx"
								value={alibabaWorkspaceId}
								onChange={(e) => setAlibabaWorkspaceId(e.target.value.trim())}
								required={requiresWorkspaceId}
							/>
							<p className="text-sm text-muted-foreground">
								{requiresWorkspaceId
									? "This region is served only by your workspace's own endpoint. Copy the workspace ID from the API Host shown on the Model Studio workspace management page."
									: "Without it, requests use the provider's shared endpoint, which is rate-limited and carries no SLA. Copy the workspace ID from the API Host shown on the Model Studio workspace management page to use your own."}
							</p>
						</div>
					)}

					{selectedProvider === "custom" && (
						<>
							<div className="space-y-2">
								<Label htmlFor="custom-name">Custom Provider Name</Label>
								<Input
									id="custom-name"
									type="text"
									placeholder="myprovider"
									value={customName}
									onChange={(e) => setCustomName(e.target.value.toLowerCase())}
									pattern="[a-z]+(-[a-z]+)*"
									required
								/>
								<p className="text-sm text-muted-foreground">
									Used in model names like: {customName || "myprovider"}/gpt-4o
								</p>
							</div>
							<div className="space-y-2">
								<Label htmlFor="custom-base-url">Base URL</Label>
								<Input
									id="custom-base-url"
									type="url"
									placeholder="https://api.example.com"
									value={baseUrl}
									onChange={(e) => setBaseUrl(e.target.value)}
									required
								/>
							</div>
						</>
					)}

					{selectedProvider && selectedProvider !== "custom" && (
						<div className="space-y-2">
							<Label htmlFor="provider-key-allowed-models">
								Allowed models
							</Label>
							<MultiModelIdSelector
								availableIds={availableModelIds}
								value={allowedModels}
								onChange={setAllowedModels}
								placeholder="All models (no restriction)"
							/>
							<p className="text-sm text-muted-foreground">
								{allowedModels.length === 0
									? "Optional: leave empty to use this key for every model of the provider."
									: "The key is validated against one of these models and routing only uses it for them. In hybrid mode, other models fall back to credits."}
							</p>
						</div>
					)}

					<div className="space-y-2">
						<Label htmlFor="provider-key-usage-limit">Max spend (USD)</Label>
						<div className="relative">
							<span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
								$
							</span>
							<Input
								id="provider-key-usage-limit"
								className="pl-6"
								type="number"
								min={0}
								step="0.01"
								placeholder="No limit"
								value={usageLimit}
								onChange={(e) => setUsageLimit(e.target.value)}
							/>
						</div>
						<p className="text-sm text-muted-foreground">
							Optional security fuse: the key is automatically disabled once the
							spend attributed to it reaches this amount.
						</p>
					</div>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={handleClose}>
							Cancel
						</Button>
						<Button type="submit" disabled={isValidating}>
							{isValidating ? "Validating..." : "Add Key"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

"use client";
import { useQueryClient } from "@tanstack/react-query";
import { usePostHog } from "posthog-js/react";
import React, { useState } from "react";

import { UpgradeToProDialog } from "@/components/shared/upgrade-to-pro-dialog";
import { Alert, AlertDescription } from "@/lib/components/alert";
import { Badge } from "@/lib/components/badge";
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
import { useAppConfig } from "@/lib/config";
import { useApi } from "@/lib/fetch-client";

import { providers, type ProviderDefinition } from "@llmgateway/models";

import { ProviderSelect } from "./provider-select";

import type { Organization } from "@/lib/types";

interface CreateProviderKeyDialogProps {
	children: React.ReactNode;
	selectedOrganization: Organization;
	preselectedProvider?: string;
	existingProviderKeys?: {
		id: string;
		createdAt: string;
		updatedAt: string;
		provider: string;
		name: string | null;
		baseUrl: string | null;
		status: "active" | "inactive" | "deleted" | null;
		organizationId: string;
		maskedToken: string;
	}[];
}

export function CreateProviderKeyDialog({
	children,
	selectedOrganization,
	preselectedProvider,
	existingProviderKeys = [],
}: CreateProviderKeyDialogProps) {
	const config = useAppConfig();
	const posthog = usePostHog();
	const [open, setOpen] = useState(false);
	const [selectedProvider, setSelectedProvider] = useState(
		preselectedProvider || "",
	);
	const [baseUrl, setBaseUrl] = useState("");
	const [customName, setCustomName] = useState("");
	const [token, setToken] = useState("");
	const [awsBedrockRegionPrefix, setAwsBedrockRegionPrefix] = useState<
		"us." | "global." | "eu."
	>("us.");
	const [azureResource, setAzureResource] = useState("");
	const [azureApiVersion, setAzureApiVersion] = useState("2024-10-21");
	const [azureDeploymentType, setAzureDeploymentType] = useState<
		"openai" | "ai-foundry"
	>("ai-foundry");
	const [azureValidationModel, setAzureValidationModel] =
		useState("gpt-4o-mini");
	const [isValidating, setIsValidating] = useState(false);

	const api = useApi();
	const queryKey = api.queryOptions("get", "/keys/provider").queryKey;
	const queryClient = useQueryClient();

	const isProPlan = selectedOrganization.plan === "pro";

	const createMutation = api.useMutation("post", "/keys/provider");

	// Filter provider keys by selected organization
	const organizationProviderKeys = existingProviderKeys.filter(
		(key) => key.organizationId === selectedOrganization.id,
	);

	const availableProviders = providers.filter((provider) => {
		if (provider.id === "llmgateway") {
			return false;
		}

		// Filter out custom provider for non-Pro users in hosted mode
		if (provider.id === "custom" && config.hosted && !isProPlan) {
			return false;
		}

		// If a provider is preselected, always include it even if it has a key
		if (preselectedProvider && provider.id === preselectedProvider) {
			return true;
		}

		const existingKey = organizationProviderKeys.find(
			(key) => key.provider === provider.id && key.status !== "deleted",
		);
		return !existingKey;
	});

	// Update selectedProvider when preselectedProvider changes or dialog opens
	React.useEffect(() => {
		if (open && preselectedProvider) {
			setSelectedProvider(preselectedProvider);
		}
	}, [open, preselectedProvider]);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();

		// Only enforce pro plan requirement if paid mode is enabled
		if (config.hosted && !isProPlan) {
			toast({
				title: "Upgrade Required",
				description:
					"Provider keys are only available on the Pro plan. Please upgrade to use your own API keys.",
				variant: "destructive",
			});
			return;
		}

		// Additional check for custom providers specifically
		if (selectedProvider === "custom" && config.hosted && !isProPlan) {
			toast({
				title: "Upgrade Required",
				description:
					"Custom providers are only available on the Pro plan. Please upgrade to use custom OpenAI-compatible providers.",
				variant: "destructive",
			});
			return;
		}

		if (!selectedProvider || !token) {
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

		if (selectedProvider === "custom" && !/^[a-z]+$/.test(customName)) {
			toast({
				title: "Error",
				description: "Custom name must contain only lowercase letters a-z",
				variant: "destructive",
			});
			return;
		}

		const payload: {
			provider: string;
			token: string;
			name?: string;
			baseUrl?: string;
			options?: {
				aws_bedrock_region_prefix?: "us." | "global." | "eu.";
				azure_resource?: string;
				azure_api_version?: string;
				azure_deployment_type?: "openai" | "ai-foundry";
				azure_validation_model?: string;
			};
			organizationId: string;
		} = {
			provider: selectedProvider,
			token,
			organizationId: selectedOrganization.id,
		};
		if (baseUrl) {
			payload.baseUrl = baseUrl;
		}
		if (selectedProvider === "custom" && customName) {
			payload.name = customName;
		}
		if (selectedProvider === "aws-bedrock") {
			payload.options = {
				aws_bedrock_region_prefix: awsBedrockRegionPrefix,
			};
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
			},
		);
	};

	const handleClose = () => {
		setOpen(false);
		setTimeout(() => {
			setSelectedProvider(preselectedProvider || "");
			setBaseUrl("");
			setCustomName("");
			setToken("");
			setAwsBedrockRegionPrefix("us.");
			setAzureResource("");
			setAzureApiVersion("2024-10-21");
			setAzureDeploymentType("ai-foundry");
			setAzureValidationModel("gpt-4o-mini");
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
				{config.hosted && !isProPlan && (
					<div className="space-y-3">
						<Alert>
							<AlertDescription className="flex items-center justify-between gap-2">
								<span>Provider keys are only available on the Pro plan.</span>
								<div className="flex items-center gap-2">
									<Badge variant="outline">Pro Only</Badge>
									<UpgradeToProDialog>
										<Button size="sm" variant="outline">
											Upgrade
										</Button>
									</UpgradeToProDialog>
								</div>
							</AlertDescription>
						</Alert>
						<Alert>
							<AlertDescription>
								<span className="font-medium">Custom Providers:</span> Custom
								OpenAI-compatible providers are also restricted to Pro plan
								users for advanced integration capabilities.
							</AlertDescription>
						</Alert>
					</div>
				)}
				<form onSubmit={handleSubmit} className="space-y-4 py-4">
					<div className="space-y-2">
						<Label htmlFor="provider">Provider</Label>
						<ProviderSelect
							onValueChange={setSelectedProvider}
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

					{selectedProvider === "aws-bedrock" && (
						<div className="space-y-2">
							<Label htmlFor="region-prefix">Region Prefix</Label>
							<Select
								value={awsBedrockRegionPrefix}
								onValueChange={(value) =>
									setAwsBedrockRegionPrefix(value as "us." | "global." | "eu.")
								}
							>
								<SelectTrigger id="region-prefix">
									<SelectValue placeholder="Select region prefix" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="us.">us. (US regions)</SelectItem>
									<SelectItem value="global.">
										global. (Global regions)
									</SelectItem>
									<SelectItem value="eu.">eu. (EU regions)</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-sm text-muted-foreground">
								Region prefix for AWS Bedrock model endpoints
							</p>
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

					{selectedProvider === "custom" && (
						<>
							<div className="space-y-2">
								<Label htmlFor="custom-name">Custom Provider Name</Label>
								<Input
									id="custom-name"
									type="text"
									placeholder="my-provider"
									value={customName}
									onChange={(e) => setCustomName(e.target.value.toLowerCase())}
									pattern="[a-z]+"
									required
								/>
								<p className="text-sm text-muted-foreground">
									Used in model names like: {customName || "my-provider"}/gpt-4o
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

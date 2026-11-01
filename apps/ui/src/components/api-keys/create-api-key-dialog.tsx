import { useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useState } from "react";

import { useMyMemberBudget } from "@/hooks/useTeam";
import { getApiErrorMessage } from "@/lib/api-error";
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
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/lib/components/tooltip";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";
import { usePostHog } from "@/lib/posthog";

import {
	ApiKeyLimitFields,
	buildApiKeyLimitPayload,
	createApiKeyLimitFormValue,
	validateApiKeyLimitPayloadWithinMemberBudget,
} from "./api-key-limit-fields";
import {
	ApiKeyTtlFields,
	buildApiKeyTtlExpiresAt,
	createApiKeyTtlFormValue,
} from "./api-key-ttl-fields";

import type { Project } from "@/lib/types";
import type React from "react";

type CreateApiKeyDialogProps = {
	children: React.ReactNode;
	disabled?: boolean;
	disabledMessage?: string;
} & (
	| { selectedProject: Project; projects?: never }
	// Organization-wide pages pick the project inside the dialog.
	| { selectedProject?: never; projects: Project[] }
);

export function CreateApiKeyDialog({
	children,
	selectedProject: fixedProject,
	projects,
	disabled = false,
	disabledMessage,
}: CreateApiKeyDialogProps) {
	const queryClient = useQueryClient();
	const posthog = usePostHog();
	const [open, setOpen] = useState(false);
	const [pickedProjectId, setPickedProjectId] = useState(
		() => projects?.[0]?.id ?? "",
	);
	const selectedProject =
		fixedProject ??
		projects?.find((project) => project.id === pickedProjectId) ??
		projects?.[0];
	const [step, setStep] = useState<"form" | "created">("form");
	const [name, setName] = useState("");
	const [limitValue, setLimitValue] = useState(() =>
		createApiKeyLimitFormValue(),
	);
	const [ttlValue, setTtlValue] = useState(() => createApiKeyTtlFormValue());
	const [apiKey, setApiKey] = useState("");
	const api = useApi();

	const { data: memberBudgetData } = useMyMemberBudget(
		selectedProject?.organizationId ?? "",
	);
	const memberBudget = memberBudgetData?.budget ?? null;
	const teamBudget = memberBudgetData?.teamBudget ?? null;

	const createApiKeyMutation = api.useMutation("post", "/keys/api");

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (createApiKeyMutation.isPending) {
			return;
		}

		if (!selectedProject) {
			toast({ title: "Please select a project.", variant: "destructive" });
			return;
		}

		if (!name.trim()) {
			toast({ title: "Please enter an API key name.", variant: "destructive" });
			return;
		}

		const { error, payload } = buildApiKeyLimitPayload(limitValue);
		if (error) {
			toast({ title: error, variant: "destructive" });
			return;
		}

		const budgetError = [teamBudget, memberBudget]
			.map((budget) =>
				validateApiKeyLimitPayloadWithinMemberBudget(payload, budget),
			)
			.find((error): error is string => error !== null);
		if (budgetError) {
			toast({ title: budgetError, variant: "destructive" });
			return;
		}

		const { error: ttlError, expiresAt } = buildApiKeyTtlExpiresAt(ttlValue);
		if (ttlError) {
			toast({ title: ttlError, variant: "destructive" });
			return;
		}

		try {
			const data = await createApiKeyMutation.mutateAsync({
				body: {
					description: name.trim(),
					projectId: selectedProject.id,
					expiresAt,
					...payload,
				},
			});

			const createdKey = data.apiKey;

			posthog.capture("api_key_created", {
				description: createdKey.description,
				keyId: createdKey.id,
			});

			setApiKey(createdKey.token);
			setStep("created");
		} catch (error) {
			toast({
				title: "Failed to create API key.",
				description: getApiErrorMessage(error, "Please try again."),
				variant: "destructive",
			});
		}
	};

	const copyToClipboard = () => {
		void navigator.clipboard.writeText(apiKey);
		toast({
			title: "API Key Copied",
			description: "The API key has been copied to your clipboard.",
		});
	};

	const handleClose = () => {
		setOpen(false);
		setTimeout(() => {
			void queryClient.invalidateQueries({ queryKey: ["get", "/keys/api"] });

			setStep("form");
			setName("");
			setApiKey("");
			setLimitValue(createApiKeyLimitFormValue());
			setTtlValue(createApiKeyTtlFormValue());
		}, 300);
	};

	const triggerElement = disabled ? (
		<Tooltip>
			<TooltipTrigger asChild>
				<div>{children}</div>
			</TooltipTrigger>
			<TooltipContent>
				<p>{disabledMessage ?? "API key limit reached"}</p>
			</TooltipContent>
		</Tooltip>
	) : (
		children
	);

	return (
		<Dialog
			open={open}
			onOpenChange={
				disabled
					? undefined
					: (nextOpen) => {
							if (createApiKeyMutation.isPending) {
								return;
							}

							if (!nextOpen) {
								handleClose();
								return;
							}

							setOpen(true);
						}
			}
		>
			{!disabled && <DialogTrigger asChild>{triggerElement}</DialogTrigger>}
			{disabled && triggerElement}
			<DialogContent className="sm:max-w-[500px]">
				{step === "form" ? (
					<>
						<DialogHeader>
							<DialogTitle>Create API Key</DialogTitle>
							<DialogDescription>
								Create a new API key to access LLM Gateway.
								{fixedProject && (
									<span className="block mt-1">
										Project: {fixedProject.name}
									</span>
								)}
								<span className="block mt-2 text-xs">
									💡 After creation, you can configure IAM rules to control
									access to specific models, providers, or pricing tiers.
								</span>
							</DialogDescription>
						</DialogHeader>
						<form onSubmit={handleSubmit} className="space-y-4 py-4">
							{projects && (
								<div className="space-y-2">
									<Label htmlFor="create-api-key-project">Project</Label>
									<Select
										value={selectedProject?.id ?? ""}
										onValueChange={setPickedProjectId}
										disabled={createApiKeyMutation.isPending}
									>
										<SelectTrigger
											id="create-api-key-project"
											className="w-full"
										>
											<SelectValue placeholder="Select a project" />
										</SelectTrigger>
										<SelectContent>
											{projects.map((project) => (
												<SelectItem key={project.id} value={project.id}>
													{project.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							)}
							<div className="space-y-2">
								<Label htmlFor="name">API Key Name</Label>
								<Input
									id="name"
									placeholder="e.g. Production API Key"
									value={name}
									onChange={(e) => setName(e.target.value)}
									disabled={createApiKeyMutation.isPending}
									required
								/>
							</div>
							<ApiKeyTtlFields
								idPrefix="create-api-key"
								value={ttlValue}
								onChange={setTtlValue}
							/>
							<ApiKeyLimitFields
								idPrefix="create-api-key"
								value={limitValue}
								onChange={setLimitValue}
								memberBudget={memberBudget}
								memberBudgetLabel="Your personal or organization default policy"
								additionalBudgets={
									teamBudget
										? [
												{
													budget: teamBudget,
													label: `${memberBudgetData?.team?.name ?? "Your team"} policy`,
												},
											]
										: []
								}
							/>
							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									disabled={createApiKeyMutation.isPending}
									onClick={handleClose}
								>
									Cancel
								</Button>
								<Button type="submit" disabled={createApiKeyMutation.isPending}>
									{createApiKeyMutation.isPending
										? "Creating..."
										: "Create API Key"}
								</Button>
							</DialogFooter>
						</form>
					</>
				) : (
					<>
						<DialogHeader>
							<DialogTitle>API Key Created</DialogTitle>
							<DialogDescription>
								Your API key has been created. Please copy it now as you won't
								be able to see it again.
								<span className="block mt-2 text-xs">
									💡 You can now configure IAM rules for this key to control
									model access from the API Keys page.
								</span>
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-4 py-4">
							<div className="space-y-2">
								<Label htmlFor="api-key">API Key</Label>
								<div className="flex items-center space-x-2">
									<Input
										id="api-key"
										value={apiKey}
										readOnly
										className="font-mono text-xs"
									/>
									<Button
										variant="outline"
										size="icon"
										onClick={copyToClipboard}
									>
										<Copy className="h-4 w-4" />
										<span className="sr-only">Copy API key</span>
									</Button>
								</div>
								<p className="text-muted-foreground text-xs">
									Make sure to store this API key securely. You won't be able to
									see it again.
								</p>
							</div>
							<DialogFooter>
								<Button onClick={handleClose}>Done</Button>
							</DialogFooter>
						</div>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

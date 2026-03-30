import { useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { usePostHog } from "posthog-js/react";
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
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/lib/components/tooltip";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

import {
	ApiKeyLimitFields,
	buildApiKeyLimitPayload,
	createApiKeyLimitFormValue,
} from "./api-key-limit-fields";

import type { Project } from "@/lib/types";
import type React from "react";

interface CreateApiKeyDialogProps {
	children: React.ReactNode;
	selectedProject: Project;
	disabled?: boolean;
	disabledMessage?: string;
}

export function CreateApiKeyDialog({
	children,
	selectedProject,
	disabled = false,
	disabledMessage,
}: CreateApiKeyDialogProps) {
	const queryClient = useQueryClient();
	const posthog = usePostHog();
	const [open, setOpen] = useState(false);
	const [step, setStep] = useState<"form" | "created">("form");
	const [name, setName] = useState("");
	const [limitValue, setLimitValue] = useState(() =>
		createApiKeyLimitFormValue(),
	);
	const [apiKey, setApiKey] = useState("");
	const api = useApi();

	const createApiKeyMutation = api.useMutation("post", "/keys/api");

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (createApiKeyMutation.isPending) {
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

		try {
			const data = await createApiKeyMutation.mutateAsync({
				body: {
					description: name.trim(),
					projectId: selectedProject.id,
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
		} catch {
			toast({
				title: "Failed to create API key.",
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
			const queryKey = api.queryOptions("get", "/keys/api", {
				params: { query: { projectId: selectedProject.id } },
			}).queryKey;

			void queryClient.invalidateQueries({ queryKey });

			setStep("form");
			setName("");
			setApiKey("");
			setLimitValue(createApiKeyLimitFormValue());
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
								<span className="block mt-1">
									Project: {selectedProject.name}
								</span>
								<span className="block mt-2 text-xs">
									💡 After creation, you can configure IAM rules to control
									access to specific models, providers, or pricing tiers.
								</span>
							</DialogDescription>
						</DialogHeader>
						<form onSubmit={handleSubmit} className="space-y-4 py-4">
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
							<ApiKeyLimitFields
								idPrefix="create-api-key"
								value={limitValue}
								onChange={setLimitValue}
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

import { useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";

import { Button } from "@/lib/components/button";
import { Checkbox } from "@/lib/components/checkbox";
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
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

import type { Project } from "@/lib/types";
import type React from "react";

interface CreateApiKeyDialogProps {
	children: React.ReactNode;
	selectedProject: Project;
}

export function CreateApiKeyDialog({
	children,
	selectedProject,
}: CreateApiKeyDialogProps) {
	const queryClient = useQueryClient();
	const posthog = usePostHog();
	const [open, setOpen] = useState(false);
	const [step, setStep] = useState<"form" | "created">("form");
	const [name, setName] = useState("");
	const [limit, setLimit] = useState<string>("0");
	const [limitChecked, setLimitChecked] = useState<boolean>(false);
	const [apiKey, setApiKey] = useState("");
	const api = useApi();

	const { mutate: createApiKey } = api.useMutation("post", "/keys/api");

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!name.trim()) {
			toast({ title: "Please enter an API key name.", variant: "destructive" });
			return;
		}

		createApiKey(
			{
				body: {
					description: name.trim(),
					projectId: selectedProject.id,
					usageLimit: limitChecked ? limit : null,
				},
			},
			{
				onSuccess: (data) => {
					const createdKey = data.apiKey;

					const queryKey = api.queryOptions("get", "/keys/api", {
						params: { query: { projectId: selectedProject.id } },
					}).queryKey;

					void queryClient.invalidateQueries({ queryKey });

					posthog.capture("api_key_created", {
						description: createdKey.description,
						keyId: createdKey.id,
					});

					setApiKey(createdKey.token);
					setStep("created");
				},
				onError: () => {
					toast({ title: "Failed to create API key.", variant: "destructive" });
				},
			},
		);
	};

	const copyToClipboard = () => {
		navigator.clipboard.writeText(apiKey);
		toast({
			title: "API Key Copied",
			description: "The API key has been copied to your clipboard.",
		});
	};

	const handleClose = () => {
		setOpen(false);
		setTimeout(() => {
			setStep("form");
			setName("");
			setApiKey("");
			setLimit("");
		}, 300);
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{children}</DialogTrigger>
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
									required
								/>
							</div>
							<div className="space-y-2">
								<div className="flex items-center gap-2">
									<Checkbox
										id="limit-checkbox"
										checked={limitChecked}
										onCheckedChange={(v) => {
											if (v !== "indeterminate") {
												setLimitChecked(v);
											}
										}}
									/>
									<Label htmlFor="limit-checkbox">
										Set API Key Usage Limit
									</Label>
								</div>
								<div
									className={`text-muted-foreground text-sm ${limitChecked ? "block" : "hidden"}`}
								>
									Usage includes both usage from LLM Gateway credits and usage
									from your own provider keys when applicable.
								</div>
								<div
									className={`relative ${limitChecked ? "block" : "hidden"}`}
								>
									<span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
										$
									</span>
									<Input
										className="pl-6"
										id="limit"
										value={limit}
										onChange={(e) => setLimit(e.target.value)}
										type="number"
										min={0}
										required={limitChecked}
									/>
								</div>
							</div>
							<DialogFooter>
								<Button type="button" variant="outline" onClick={handleClose}>
									Cancel
								</Button>
								<Button type="submit">Create API Key</Button>
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

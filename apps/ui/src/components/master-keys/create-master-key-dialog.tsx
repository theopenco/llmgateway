"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
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

import type React from "react";

interface CreateMasterKeyDialogProps {
	children: React.ReactNode;
	organizationId: string;
	disabled?: boolean;
	disabledMessage?: string;
}

export function CreateMasterKeyDialog({
	children,
	organizationId,
	disabled = false,
	disabledMessage,
}: CreateMasterKeyDialogProps) {
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [step, setStep] = useState<"form" | "created">("form");
	const [name, setName] = useState("");
	const [token, setToken] = useState("");
	const api = useApi();

	const createMutation = api.useMutation("post", "/master-keys");

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (createMutation.isPending) {
			return;
		}

		if (!name.trim()) {
			toast({
				title: "Please enter a master key name.",
				variant: "destructive",
			});
			return;
		}

		try {
			const data = await createMutation.mutateAsync({
				body: { description: name.trim(), organizationId },
			});

			setToken(data.masterKey.token);
			setStep("created");
		} catch {
			toast({
				title: "Failed to create master key.",
				variant: "destructive",
			});
		}
	};

	const copyToClipboard = () => {
		void navigator.clipboard.writeText(token);
		toast({
			title: "Master Key Copied",
			description: "The master key has been copied to your clipboard.",
		});
	};

	const handleClose = () => {
		setOpen(false);
		setTimeout(() => {
			const queryKey = api.queryOptions("get", "/master-keys", {
				params: { query: { organizationId } },
			}).queryKey;

			void queryClient.invalidateQueries({ queryKey });

			setStep("form");
			setName("");
			setToken("");
		}, 300);
	};

	const triggerElement = disabled ? (
		<Tooltip>
			<TooltipTrigger asChild>
				<div>{children}</div>
			</TooltipTrigger>
			<TooltipContent>
				<p>{disabledMessage ?? "Master key limit reached"}</p>
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
							if (createMutation.isPending) {
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
							<DialogTitle>Create Master Key</DialogTitle>
							<DialogDescription>
								Master keys let you create projects and gateway API keys
								programmatically via the /v1/master/* API.
							</DialogDescription>
						</DialogHeader>
						<form onSubmit={handleSubmit} className="space-y-4 py-4">
							<div className="space-y-2">
								<Label htmlFor="master-key-name">Name</Label>
								<Input
									id="master-key-name"
									placeholder="e.g. Tenant Provisioning"
									value={name}
									onChange={(e) => setName(e.target.value)}
									disabled={createMutation.isPending}
									required
								/>
							</div>
							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									disabled={createMutation.isPending}
									onClick={handleClose}
								>
									Cancel
								</Button>
								<Button type="submit" disabled={createMutation.isPending}>
									{createMutation.isPending
										? "Creating..."
										: "Create Master Key"}
								</Button>
							</DialogFooter>
						</form>
					</>
				) : (
					<>
						<DialogHeader>
							<DialogTitle>Master Key Created</DialogTitle>
							<DialogDescription>
								Your master key has been created. Copy it now — for security,
								you won&apos;t be able to see it again.
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-4 py-4">
							<div className="space-y-2">
								<Label htmlFor="master-key-token">Master Key</Label>
								<div className="flex items-center space-x-2">
									<Input
										id="master-key-token"
										value={token}
										readOnly
										className="font-mono text-xs"
									/>
									<Button
										variant="outline"
										size="icon"
										onClick={copyToClipboard}
									>
										<Copy className="h-4 w-4" />
										<span className="sr-only">Copy master key</span>
									</Button>
								</div>
								<p className="text-muted-foreground text-xs">
									Store this master key securely. It will not be displayed
									again.
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

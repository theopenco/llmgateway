import { useEffect, useState } from "react";

import { Button } from "@/lib/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
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

import type { providers } from "@llmgateway/models";
import type React from "react";

interface Provider {
	id: string;
	name: ProviderName;
	baseUrl: string;
	models: never[];
	status: string;
	priority: string;
}

type ProviderName = (typeof providers)[number]["name"];

interface UpdatedProvider {
	id: string;
	name: ProviderName;
	baseUrl: string;
	models: never[];
	status: string;
	priority: string;
}

interface EditProviderDialogProps {
	provider: Provider;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSave: (updatedProvider: UpdatedProvider) => void;
}

export function EditProviderDialog({
	provider,
	open,
	onOpenChange,
	onSave,
}: EditProviderDialogProps) {
	const [name, setName] = useState<ProviderName>(provider.name);
	const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
	const [apiKey, setApiKey] = useState("");
	const [priority, setPriority] = useState(provider.priority);
	const [status, setStatus] = useState(provider.status);

	useEffect(() => {
		if (open) {
			setName(provider.name);
			setBaseUrl(provider.baseUrl);
			setApiKey("");
			setPriority(provider.priority);
			setStatus(provider.status);
		}
	}, [open, provider]);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();

		const updatedProvider = {
			...provider,
			name,
			baseUrl,
			priority,
			status,
		};

		onSave(updatedProvider);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>Edit Provider</DialogTitle>
					<DialogDescription>Update the provider settings.</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="space-y-4 py-4">
					<div className="space-y-2">
						<Label htmlFor="name">Provider Name</Label>
						<Input
							id="name"
							value={name}
							onChange={(e) => setName(e.target.value as ProviderName)}
							required
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="base-url">Base URL</Label>
						<Input
							id="base-url"
							value={baseUrl}
							onChange={(e) => setBaseUrl(e.target.value)}
							required
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="api-key">
							API Key (leave blank to keep current)
						</Label>
						<Input
							id="api-key"
							type="password"
							value={apiKey}
							onChange={(e) => setApiKey(e.target.value)}
							placeholder="••••••••••••••••••••••"
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="priority">Priority</Label>
						<Select value={priority} onValueChange={setPriority}>
							<SelectTrigger id="priority">
								<SelectValue placeholder="Select priority" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="high">High</SelectItem>
								<SelectItem value="medium">Medium</SelectItem>
								<SelectItem value="low">Low</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-2">
						<Label htmlFor="status">Status</Label>
						<Select value={status} onValueChange={setStatus}>
							<SelectTrigger id="status">
								<SelectValue placeholder="Select status" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="connected">Connected</SelectItem>
								<SelectItem value="disconnected">Disconnected</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button type="submit">Save Changes</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

"use client";

import {
	EyeIcon,
	EyeOffIcon,
	PencilIcon,
	PlusIcon,
	TrashIcon,
	WrenchIcon,
} from "lucide-react";
import { useState } from "react";

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
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";

import type { McpServer } from "@/hooks/useMcpServers";

interface McpServersDialogProps {
	servers: McpServer[];
	onAddServer: (server: Omit<McpServer, "id">) => McpServer;
	onUpdateServer: (id: string, updates: Partial<Omit<McpServer, "id">>) => void;
	onRemoveServer: (id: string) => void;
	onToggleServer: (id: string) => void;
}

export function McpServersDialog({
	servers,
	onAddServer,
	onUpdateServer,
	onRemoveServer,
	onToggleServer,
}: McpServersDialogProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [isAddingNew, setIsAddingNew] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});

	// Form state for new/editing server
	const [formName, setFormName] = useState("");
	const [formUrl, setFormUrl] = useState("");
	const [formApiKey, setFormApiKey] = useState("");

	const enabledCount = servers.filter((s) => s.enabled).length;

	const resetForm = () => {
		setFormName("");
		setFormUrl("");
		setFormApiKey("");
		setIsAddingNew(false);
		setEditingId(null);
	};

	const handleStartAdd = () => {
		resetForm();
		setIsAddingNew(true);
	};

	const handleStartEdit = (server: McpServer) => {
		setFormName(server.name);
		setFormUrl(server.url);
		setFormApiKey(server.apiKey);
		setEditingId(server.id);
		setIsAddingNew(false);
	};

	const handleSave = () => {
		if (!formName.trim() || !formUrl.trim()) {
			return;
		}

		if (editingId) {
			onUpdateServer(editingId, {
				name: formName.trim(),
				url: formUrl.trim(),
				apiKey: formApiKey.trim(),
			});
		} else {
			onAddServer({
				name: formName.trim(),
				url: formUrl.trim(),
				apiKey: formApiKey.trim(),
				enabled: true,
			});
		}

		resetForm();
	};

	const handleDelete = (id: string) => {
		onRemoveServer(id);
		if (editingId === id) {
			resetForm();
		}
	};

	const toggleApiKeyVisibility = (id: string) => {
		setShowApiKey((prev) => ({ ...prev, [id]: !prev[id] }));
	};

	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<Tooltip>
				<TooltipTrigger asChild>
					<DialogTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="relative h-8 w-8"
							aria-label="MCP Servers"
						>
							<WrenchIcon className="h-4 w-4" />
							{enabledCount > 0 && (
								<span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-medium">
									{enabledCount}
								</span>
							)}
						</Button>
					</DialogTrigger>
				</TooltipTrigger>
				<TooltipContent>
					<p>MCP Servers ({enabledCount} active)</p>
				</TooltipContent>
			</Tooltip>

			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>MCP Servers</DialogTitle>
					<DialogDescription>
						Connect to Model Context Protocol servers to extend AI capabilities
						with external tools.
					</DialogDescription>
				</DialogHeader>

				<div className="max-h-[400px] space-y-4 overflow-y-auto py-4">
					{/* Existing servers list */}
					{servers.length > 0 && !isAddingNew && !editingId && (
						<div className="space-y-2">
							{servers.map((server) => (
								<div
									key={server.id}
									className="bg-muted/50 flex items-center justify-between rounded-lg border p-3"
								>
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2">
											<span className="font-medium">{server.name}</span>
											<Switch
												checked={server.enabled}
												onCheckedChange={() => onToggleServer(server.id)}
												className="scale-75"
											/>
										</div>
										<p className="text-muted-foreground truncate text-xs">
											{server.url}
										</p>
									</div>
									<div className="flex items-center gap-1">
										<Button
											variant="ghost"
											size="icon"
											className="h-7 w-7"
											onClick={() => handleStartEdit(server)}
											aria-label="Edit server"
											title="Edit server"
										>
											<PencilIcon className="h-3.5 w-3.5" />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											className="text-destructive h-7 w-7"
											onClick={() => handleDelete(server.id)}
											aria-label="Delete server"
											title="Delete server"
										>
											<TrashIcon className="h-3.5 w-3.5" />
										</Button>
									</div>
								</div>
							))}
						</div>
					)}

					{/* Add/Edit form */}
					{(isAddingNew || editingId) && (
						<div className="space-y-4 rounded-lg border p-4">
							<div className="space-y-2">
								<Label htmlFor="mcp-name">Name</Label>
								<Input
									id="mcp-name"
									placeholder="My MCP Server"
									value={formName}
									onChange={(e) => setFormName(e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="mcp-url">URL</Label>
								<Input
									id="mcp-url"
									placeholder="https://api.example.com/mcp"
									value={formUrl}
									onChange={(e) => setFormUrl(e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="mcp-api-key">API Key (optional)</Label>
								<div className="relative">
									<Input
										id="mcp-api-key"
										type={showApiKey["form"] ? "text" : "password"}
										placeholder="sk-..."
										value={formApiKey}
										onChange={(e) => setFormApiKey(e.target.value)}
										className="pr-10"
									/>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										className="absolute top-1/2 right-1 h-7 w-7 -translate-y-1/2"
										onClick={() => toggleApiKeyVisibility("form")}
										aria-label={
											showApiKey["form"] ? "Hide API key" : "Show API key"
										}
										title={showApiKey["form"] ? "Hide API key" : "Show API key"}
									>
										{showApiKey["form"] ? (
											<EyeOffIcon className="h-4 w-4" />
										) : (
											<EyeIcon className="h-4 w-4" />
										)}
									</Button>
								</div>
							</div>
							<div className="flex justify-end gap-2">
								<Button variant="outline" size="sm" onClick={resetForm}>
									Cancel
								</Button>
								<Button
									size="sm"
									onClick={handleSave}
									disabled={!formName.trim() || !formUrl.trim()}
								>
									{editingId ? "Save" : "Add Server"}
								</Button>
							</div>
						</div>
					)}

					{/* Empty state */}
					{servers.length === 0 && !isAddingNew && (
						<div className="text-muted-foreground py-8 text-center text-sm">
							<WrenchIcon className="mx-auto mb-2 h-8 w-8 opacity-50" />
							<p>No MCP servers configured</p>
							<p className="mt-1 text-xs">
								Add a server to extend AI capabilities
							</p>
						</div>
					)}
				</div>

				<DialogFooter>
					{!isAddingNew && !editingId && (
						<Button onClick={handleStartAdd} className="gap-2">
							<PlusIcon className="h-4 w-4" />
							Add MCP Server
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

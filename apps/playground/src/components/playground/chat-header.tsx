import { ThemeToggle } from "@/components/landing/theme-toggle";
import { ModelSelector } from "@/components/model-selector";
import { McpServersDialog } from "@/components/playground/mcp-servers-dialog";
import { Label } from "@/components/ui/label";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { TooltipProvider } from "@/components/ui/tooltip";

import type { McpServer } from "@/hooks/useMcpServers";
import type { ApiModel, ApiProvider } from "@/lib/fetch-models";

interface ChatHeaderProps {
	models: ApiModel[];
	providers: ApiProvider[];
	selectedModel: string;
	setSelectedModel: (model: string) => void;
	comparisonEnabled: boolean;
	onComparisonEnabledChange: (enabled: boolean) => void;
	showGlobalModelSelector: boolean;
	// MCP servers props
	mcpServers: McpServer[];
	onAddMcpServer: (server: Omit<McpServer, "id">) => McpServer;
	onUpdateMcpServer: (
		id: string,
		updates: Partial<Omit<McpServer, "id">>,
	) => void;
	onRemoveMcpServer: (id: string) => void;
	onToggleMcpServer: (id: string) => void;
}

export const ChatHeader = ({
	models,
	providers,
	selectedModel,
	setSelectedModel,
	comparisonEnabled,
	onComparisonEnabledChange,
	showGlobalModelSelector,
	mcpServers,
	onAddMcpServer,
	onUpdateMcpServer,
	onRemoveMcpServer,
	onToggleMcpServer,
}: ChatHeaderProps) => {
	return (
		<header className="bg-background flex items-center border-b p-4">
			<div className="flex min-w-0 flex-1 items-center gap-3">
				<SidebarTrigger />
				{showGlobalModelSelector ? (
					<div className="flex w-full min-w-0 max-w-[360px] items-center gap-2 sm:max-w-[420px]">
						<ModelSelector
							models={models}
							providers={providers}
							value={selectedModel}
							onValueChange={setSelectedModel}
							placeholder="Search and select a model..."
						/>
					</div>
				) : null}
			</div>
			<div className="ml-3 flex items-center gap-3">
				<TooltipProvider>
					<McpServersDialog
						servers={mcpServers}
						onAddServer={onAddMcpServer}
						onUpdateServer={onUpdateMcpServer}
						onRemoveServer={onRemoveMcpServer}
						onToggleServer={onToggleMcpServer}
					/>
				</TooltipProvider>
				<div className="hidden items-center gap-2 md:flex">
					<Label
						htmlFor="comparison-mode"
						className="text-muted-foreground text-xs"
					>
						Comparison mode
					</Label>
					<Switch
						id="comparison-mode"
						checked={comparisonEnabled}
						onCheckedChange={onComparisonEnabledChange}
					/>
				</div>
				<ThemeToggle />
				<a
					href={
						process.env.NODE_ENV === "development"
							? "http://localhost:3002/dashboard"
							: "https://llmgateway.io/dashboard"
					}
					target="_blank"
					rel="noopener noreferrer"
					className="hidden sm:inline"
				>
					<span className="text-nowrap">Dashboard</span>
				</a>
			</div>
		</header>
	);
};

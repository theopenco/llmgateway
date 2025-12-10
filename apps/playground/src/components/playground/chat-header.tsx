import { ThemeToggle } from "@/components/landing/theme-toggle";
import { ModelSelector } from "@/components/model-selector";
import { Label } from "@/components/ui/label";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";

import type { ModelDefinition, ProviderDefinition } from "@llmgateway/models";

interface ChatHeaderProps {
	models: ModelDefinition[];
	providers: ProviderDefinition[];
	selectedModel: string;
	setSelectedModel: (model: string) => void;
	comparisonEnabled: boolean;
	onComparisonEnabledChange: (enabled: boolean) => void;
	showGlobalModelSelector: boolean;
}

export const ChatHeader = ({
	models,
	providers,
	selectedModel,
	setSelectedModel,
	comparisonEnabled,
	onComparisonEnabledChange,
	showGlobalModelSelector,
}: ChatHeaderProps) => {
	return (
		<header className="flex items-center p-4 border-b bg-background">
			<div className="flex items-center gap-3 min-w-0 flex-1">
				<SidebarTrigger />
				{showGlobalModelSelector ? (
					<div className="flex items-center gap-2 w-full max-w-[360px] sm:max-w-[420px] min-w-0">
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
			<div className="flex items-center gap-3 ml-3">
				<div className="flex items-center gap-2">
					<Label
						htmlFor="comparison-mode"
						className="text-xs text-muted-foreground"
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

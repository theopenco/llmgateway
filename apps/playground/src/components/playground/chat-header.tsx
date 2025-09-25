import { Key } from "lucide-react";

import { ThemeToggle } from "@/components/landing/theme-toggle";
import { ModelSelector } from "@/components/model-selector";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";

import type { ModelDefinition, ProviderDefinition } from "@llmgateway/models";

interface ChatHeaderProps {
	models: ModelDefinition[];
	providers: ProviderDefinition[];
	selectedModel: string;
	onManageApiKey: () => void;
	setSelectedModel: (model: string) => void;
}

export const ChatHeader = ({
	models,
	providers,
	selectedModel,
	onManageApiKey,
	setSelectedModel,
}: ChatHeaderProps) => {
	return (
		<header className="flex items-center p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
			<div className="flex items-center gap-4">
				<SidebarTrigger />
				<div className="flex items-center gap-2 w-60">
					<ModelSelector
						models={models}
						providers={providers}
						value={selectedModel}
						onValueChange={setSelectedModel}
						placeholder="Search and select a model..."
					/>
				</div>
			</div>
			<div className="flex items-center gap-4 ml-auto">
				<Button
					variant="outline"
					className="flex items-center gap-2"
					onClick={onManageApiKey}
				>
					<Key className="h-4 w-4" />
					API Key
				</Button>
				<ThemeToggle />
				<a
					href={
						process.env.NODE_ENV === "development"
							? "http://localhost:3002/dashboard"
							: "https://llmgateway.io/dashboard"
					}
					target="_blank"
					rel="noopener noreferrer"
				>
					<span className="text-nowrap">Dashboard</span>
				</a>
			</div>
		</header>
	);
};

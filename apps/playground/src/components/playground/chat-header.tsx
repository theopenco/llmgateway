import { ThemeToggle } from "@/components/landing/theme-toggle";
import { ModelSelector } from "@/components/model-selector";
import { SidebarTrigger } from "@/components/ui/sidebar";

import type { ModelDefinition, ProviderDefinition } from "@llmgateway/models";

interface ChatHeaderProps {
	models: ModelDefinition[];
	providers: ProviderDefinition[];
	selectedModel: string;
	setSelectedModel: (model: string) => void;
}

export const ChatHeader = ({
	models,
	providers,
	selectedModel,
	setSelectedModel,
}: ChatHeaderProps) => {
	return (
		<header className="flex items-center p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
			<div className="flex items-center gap-3 min-w-0 flex-1">
				<SidebarTrigger />
				<div className="flex items-center gap-2 w-full max-w-[360px] sm:max-w-[420px] min-w-0">
					<ModelSelector
						models={models}
						providers={providers}
						value={selectedModel}
						onValueChange={setSelectedModel}
						placeholder="Search and select a model..."
					/>
				</div>
			</div>
			<div className="flex items-center gap-3 ml-3">
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

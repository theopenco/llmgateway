import { Key } from "lucide-react";
import Link from "next/link";

import { ModelSelector } from "./model-selector";
import { Button } from "@/lib/components/button";
import { SidebarTrigger } from "@/lib/components/sidebar";
import { cn } from "@/lib/utils";

interface ChatHeaderProps {
	selectedModel: string;
	onModelSelect: (model: string) => void;
	onManageApiKey: () => void;
	className?: string;
}

export function ChatHeader({
	selectedModel,
	onModelSelect,
	onManageApiKey,
	className,
}: ChatHeaderProps) {
	const handleModelSelect = (model: string) => {
		onModelSelect(model);
	};

	return (
		<header
			className={cn(
				"border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60",
				className,
			)}
		>
			<div className="flex items-center p-4 overflow-x-auto scrollbar-hide">
				<div className="flex items-center gap-4 min-w-0 flex-shrink-0">
					<SidebarTrigger />
					<ModelSelector
						selectedModel={selectedModel}
						onModelSelect={handleModelSelect}
					/>
					<Button
						variant="outline"
						className="flex items-center gap-2 whitespace-nowrap"
						onClick={onManageApiKey}
					>
						<Key className="h-4 w-4" />
						<span className="hidden sm:inline">Manage API Key</span>
						<span className="sm:hidden">API Key</span>
					</Button>
					<Link href="/dashboard" prefetch={true} className="flex-shrink-0">
						<span className="text-nowrap text-sm text-muted-foreground hover:text-foreground transition-colors">
							Go to Dashboard
						</span>
					</Link>
				</div>
			</div>
		</header>
	);
}

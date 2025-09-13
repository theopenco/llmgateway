import { Key } from "lucide-react";
import Link from "next/link";

import { Button } from "@/lib/components/button";
import { SidebarTrigger } from "@/lib/components/sidebar";
import { cn } from "@/lib/utils";

import { ModelSelector } from "./model-selector";

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
				"flex items-center p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60",
				className,
			)}
		>
			<div className="flex items-center gap-4">
				<SidebarTrigger />
				<ModelSelector
					selectedModel={selectedModel}
					onModelSelect={handleModelSelect}
				/>
				<Button
					variant="outline"
					className="flex items-center gap-2"
					onClick={onManageApiKey}
				>
					<Key className="h-4 w-4" />
					Manage API Key
				</Button>
			</div>
			<div className="flex items-center gap-4 ml-auto">
				<Link href="/dashboard" prefetch={true}>
					<span className="text-nowrap">Go to Dashboard</span>
				</Link>
			</div>
		</header>
	);
}

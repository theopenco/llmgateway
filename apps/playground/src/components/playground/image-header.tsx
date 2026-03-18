"use client";

import { Plus, X } from "lucide-react";

import { ThemeToggle } from "@/components/landing/theme-toggle";
import { ModelSelector } from "@/components/model-selector";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";

import type { ApiModel, ApiProvider } from "@/lib/fetch-models";

interface ImageHeaderProps {
	models: ApiModel[];
	providers: ApiProvider[];
	selectedModels: string[];
	onModelChange: (index: number, model: string) => void;
	onAddModel: () => void;
	onRemoveModel: (index: number) => void;
	comparisonMode: boolean;
	onComparisonModeChange: (enabled: boolean) => void;
}

export function ImageHeader({
	models,
	providers,
	selectedModels,
	onModelChange,
	onAddModel,
	onRemoveModel,
	comparisonMode,
	onComparisonModeChange,
}: ImageHeaderProps) {
	return (
		<header className="bg-background flex items-center border-b p-4">
			<div className="flex min-w-0 flex-1 items-center gap-3">
				<SidebarTrigger />
				{comparisonMode ? (
					<div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
						{selectedModels.map((model, index) => (
							<div key={index} className="flex items-center gap-1 shrink-0">
								<div className="w-[200px] min-w-[200px]">
									<ModelSelector
										models={models}
										providers={providers}
										value={model}
										onValueChange={(v) => onModelChange(index, v)}
										placeholder="Select model..."
									/>
								</div>
								{selectedModels.length > 1 && (
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7 shrink-0"
										onClick={() => onRemoveModel(index)}
									>
										<X className="h-3.5 w-3.5" />
									</Button>
								)}
							</div>
						))}
						{selectedModels.length < 3 && (
							<Button
								variant="outline"
								size="sm"
								className="shrink-0"
								onClick={onAddModel}
							>
								<Plus className="h-3.5 w-3.5 mr-1" />
								Add
							</Button>
						)}
					</div>
				) : (
					<div className="flex w-full min-w-0 max-w-[360px] items-center gap-2 sm:max-w-[420px]">
						<ModelSelector
							models={models}
							providers={providers}
							value={selectedModels[0] ?? ""}
							onValueChange={(v) => onModelChange(0, v)}
							placeholder="Select an image model..."
						/>
					</div>
				)}
			</div>
			<div className="ml-3 flex items-center gap-3">
				<div className="hidden items-center gap-2 md:flex">
					<Label
						htmlFor="comparison-mode-img"
						className="text-muted-foreground text-xs"
					>
						Compare
					</Label>
					<Switch
						id="comparison-mode-img"
						checked={comparisonMode}
						onCheckedChange={onComparisonModeChange}
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
}

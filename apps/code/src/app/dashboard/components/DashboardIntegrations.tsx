"use client";

import { ArrowRight } from "lucide-react";

import { useAppConfig } from "@/lib/config";

import {
	AnthropicIcon,
	ClineIcon,
	CursorIcon,
	OpenCodeIcon,
} from "@llmgateway/shared/components";

const integrations = [
	{
		name: "Claude Code",
		description: "Terminal AI assistant",
		href: "/guides/claude-code",
		icon: AnthropicIcon,
		external: false,
	},
	{
		name: "Cursor",
		description: "AI-powered IDE",
		href: "https://docs.llmgateway.io/guides/cursor",
		icon: CursorIcon,
		external: true,
	},
	{
		name: "Cline",
		description: "VS Code AI coding",
		href: "https://docs.llmgateway.io/guides/cline",
		icon: ClineIcon,
		external: true,
	},
	{
		name: "OpenCode",
		description: "AI dev workflows",
		href: "/guides/opencode",
		icon: OpenCodeIcon,
		external: false,
	},
];

export default function DashboardIntegrations() {
	const config = useAppConfig();

	return (
		<div>
			<h2 className="mb-4 font-semibold">Integrations</h2>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{integrations.map((integration) => (
					<a
						key={integration.name}
						href={
							integration.external
								? integration.href
								: `${config.uiUrl}${integration.href}`
						}
						target="_blank"
						rel="noopener noreferrer"
						className="group flex items-center gap-3 rounded-xl border p-4 transition-all hover:border-foreground/15 hover:shadow-sm"
					>
						<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
							<integration.icon className="h-4.5 w-4.5" />
						</div>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-1">
								<span className="text-sm font-medium">{integration.name}</span>
								<ArrowRight className="h-3 w-3 text-muted-foreground opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
							</div>
							<p className="text-xs text-muted-foreground truncate">
								{integration.description}
							</p>
						</div>
					</a>
				))}
			</div>
		</div>
	);
}

"use client";

import { ArrowRight, Code } from "lucide-react";

import { useAppConfig } from "@/lib/config";

import {
	AnthropicIcon,
	ClineIcon,
	OpenCodeIcon,
} from "@llmgateway/shared/components";

const integrations = [
	{
		name: "Claude Code",
		description: "AI-powered terminal assistance and coding",
		href: "/guides/claude-code",
		icon: AnthropicIcon,
		external: false,
	},
	{
		name: "OpenCode",
		description: "AI-powered development workflows",
		href: "/guides/opencode",
		icon: OpenCodeIcon,
		external: false,
	},
	{
		name: "Cline",
		description: "AI-powered coding in VS Code",
		href: "https://docs.llmgateway.io/guides/cline",
		icon: ClineIcon,
		external: true,
	},
];

export default function DashboardIntegrations() {
	const config = useAppConfig();

	return (
		<div className="rounded-lg border p-6">
			<div className="flex items-center gap-2 mb-4">
				<Code className="h-5 w-5" />
				<h3 className="font-semibold">Common Use Cases</h3>
			</div>
			<p className="text-sm text-muted-foreground mb-4">
				Popular integrations for AI-powered coding.
			</p>
			<div className="grid gap-3 sm:grid-cols-3">
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
						className="group flex items-start gap-3 rounded-lg border p-4 transition-all hover:border-primary/50 hover:shadow-sm"
					>
						<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
							<integration.icon className="h-5 w-5" />
						</div>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-1">
								<span className="font-medium text-sm">{integration.name}</span>
								<ArrowRight className="h-3 w-3 text-muted-foreground opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
							</div>
							<p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
								{integration.description}
							</p>
						</div>
					</a>
				))}
			</div>
		</div>
	);
}

"use client";

import { ArrowRight, ArrowUpRight } from "lucide-react";

import {
	AnthropicIcon,
	EmpryoIcon,
	KiloCodeIcon,
	OpenCodeIcon,
	SoulForgeIcon,
} from "@llmgateway/shared/components";

import type { ComponentType, SVGProps } from "react";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

interface Integration {
	name: string;
	path: string;
	description: string;
	icon: IconComponent;
	external?: string;
}

const integrations: Integration[] = [
	{
		name: "OpenCode",
		description: "AI dev workflows",
		path: "/guides/opencode",
		icon: OpenCodeIcon,
	},
	{
		name: "Claude Code",
		description: "Terminal AI assistant",
		path: "/guides/claude-code",
		icon: AnthropicIcon,
	},
	{
		name: "Empryo",
		description: "Edits symbols, not strings",
		path: "",
		external: "https://empryo.com/",
		icon: EmpryoIcon,
	},
	{
		name: "SoulForge",
		description: "Soul AI coding agent",
		path: "",
		external: "https://soulforge.proxysoul.com/",
		icon: SoulForgeIcon,
	},
	{
		name: "Kilo Code",
		description: "VS Code autonomous agent",
		path: "/guides/kilo-code",
		icon: KiloCodeIcon,
	},
];

export default function DashboardIntegrations({ uiUrl }: { uiUrl: string }) {
	return (
		<div>
			<div className="mb-4 flex items-end justify-between gap-3">
				<h2 className="font-semibold tracking-tight">Integrations</h2>
				<a
					href={`${uiUrl}/guides`}
					target="_blank"
					rel="noopener noreferrer"
					className="group inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
				>
					See more guides
					<ArrowRight className="h-3 w-3 transition-transform duration-300 group-hover:translate-x-0.5" />
				</a>
			</div>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{integrations.map((integration) => {
					const Icon = integration.icon;
					const href = integration.external ?? `${uiUrl}${integration.path}`;
					return (
						<a
							key={integration.name}
							href={href}
							target="_blank"
							rel="noopener noreferrer"
							className="group relative flex items-center gap-3 overflow-hidden rounded-xl border border-border/50 bg-card p-4 transition-all duration-500 ease-out hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.12)] dark:hover:shadow-[0_8px_30px_-12px_rgba(255,255,255,0.06)]"
						>
							<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-gradient-to-br from-muted/40 to-muted/10 transition-all duration-500 group-hover:border-foreground/20 group-hover:from-muted/60">
								<Icon className="h-4.5 w-4.5" />
							</div>
							<div className="min-w-0 flex-1">
								<div className="flex items-center justify-between gap-2">
									<span className="text-sm font-medium tracking-tight">
										{integration.name}
									</span>
									<ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-all duration-500 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
								</div>
								<p className="truncate text-xs text-muted-foreground">
									{integration.description}
								</p>
							</div>
						</a>
					);
				})}
			</div>
		</div>
	);
}

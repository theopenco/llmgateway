import { ArrowRight, Clock } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/lib/components/badge";
import { Card } from "@/lib/components/card";
import { AnthropicIcon } from "@/lib/components/providers-icons";

import type { ComponentType, SVGProps } from "react";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const N8nIcon: IconComponent = (props) => (
	<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" {...props}>
		<path
			clipRule="evenodd"
			d="M24 8.4c0 1.325-1.102 2.4-2.462 2.4-1.146 0-2.11-.765-2.384-1.8h-3.436c-.602 0-1.115.424-1.214 1.003l-.101.592a2.38 2.38 0 0 1-.8 1.405c.412.354.704.844.8 1.405l.1.592A1.222 1.222 0 0 0 15.719 15h.975c.273-1.035 1.237-1.8 2.384-1.8 1.36 0 2.461 1.075 2.461 2.4S20.436 18 19.078 18c-1.147 0-2.11-.765-2.384-1.8h-.975c-1.204 0-2.23-.848-2.428-2.005l-.101-.592a1.222 1.222 0 0 0-1.214-1.003H10.97c-.308.984-1.246 1.7-2.356 1.7-1.11 0-2.048-.716-2.355-1.7H4.817c-.308.984-1.246 1.7-2.355 1.7C1.102 14.3 0 13.225 0 11.9s1.102-2.4 2.462-2.4c1.183 0 2.172.815 2.408 1.9h1.337c.236-1.085 1.225-1.9 2.408-1.9 1.184 0 2.172.815 2.408 1.9h.952c.601 0 1.115-.424 1.213-1.003l.102-.592c.198-1.157 1.225-2.005 2.428-2.005h3.436c.274-1.035 1.238-1.8 2.384-1.8C22.898 6 24 7.075 24 8.4zm-1.23 0c0 .663-.552 1.2-1.232 1.2-.68 0-1.23-.537-1.23-1.2 0-.663.55-1.2 1.23-1.2.68 0 1.231.537 1.231 1.2zM2.461 13.1c.68 0 1.23-.537 1.23-1.2 0-.663-.55-1.2-1.23-1.2-.68 0-1.231.537-1.231 1.2 0 .663.55 1.2 1.23 1.2zm6.153 0c.68 0 1.231-.537 1.231-1.2 0-.663-.55-1.2-1.23-1.2-.68 0-1.231.537-1.231 1.2 0 .663.55 1.2 1.23 1.2zm10.462 3.7c.68 0 1.23-.537 1.23-1.2 0-.663-.55-1.2-1.23-1.2-.68 0-1.23.537-1.23 1.2 0 .663.55 1.2 1.23 1.2z"
			fill="#EA4B71"
			fillRule="evenodd"
		/>
	</svg>
);

const CursorIcon: IconComponent = (props) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 466.73 532.09"
		{...props}
	>
		<path
			d="M457.43 125.94 244.42 2.96c-6.84-3.95-15.28-3.95-22.12 0L9.3 125.94C3.55 129.26 0 135.4 0 142.05v247.99c0 6.65 3.55 12.79 9.3 16.11l213.01 122.98c6.84 3.95 15.28 3.95 22.12 0l213.01-122.98c5.75-3.32 9.3-9.46 9.3-16.11V142.05c0-6.65-3.55-12.79-9.3-16.11zm-13.38 26.05L238.42 508.15c-1.39 2.4-5.06 1.42-5.06-1.36V273.58c0-4.66-2.49-8.97-6.53-11.31L24.87 145.67c-2.4-1.39-1.42-5.06 1.36-5.06h411.26c5.84 0 9.49 6.33 6.57 11.39h-.01Z"
			fill="currentColor"
		/>
	</svg>
);

const ClineIcon: IconComponent = (props) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 466.73 487.04"
		{...props}
	>
		<path
			d="m463.6 275.08-29.26-58.75V182.5c0-56.08-45.01-101.5-100.53-101.5H283.8c3.62-7.43 5.61-15.79 5.61-24.61C289.41 25.22 264.33 0 233.34 0s-56.07 25.22-56.07 56.39c0 8.82 1.99 17.17 5.61 24.61h-50.01C77.36 81 32.35 126.42 32.35 182.5v33.83L2.48 274.92c-3.01 5.9-3.01 12.92 0 18.81l29.87 57.93v33.83c0 56.08 45.01 101.5 100.52 101.5h200.95c55.51 0 100.53-45.42 100.53-101.5v-33.83l29.21-58.13c2.9-5.79 2.9-12.61.05-18.46Zm-260.85 47.88c0 25.48-20.54 46.14-45.88 46.14s-45.88-20.66-45.88-46.14v-82.02c0-25.48 20.54-46.14 45.88-46.14s45.88 20.66 45.88 46.14zm147.83 0c0 25.48-20.54 46.14-45.88 46.14s-45.88-20.66-45.88-46.14v-82.02c0-25.48 20.54-46.14 45.88-46.14s45.88 20.66 45.88 46.14z"
			fill="currentColor"
		/>
	</svg>
);

const VSCodeIcon: IconComponent = (props) => (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" {...props}>
		<path
			d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"
			fill="currentColor"
		/>
	</svg>
);

const OpenCodeIcon: IconComponent = (props) => (
	<svg
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 240 300"
		{...props}
	>
		<path d="M180 240H60V120h120z" fill="currentColor" fillOpacity={0.5} />
		<path d="M180 60H60v180h120zm60 240H0V0h240z" fill="currentColor" />
	</svg>
);

interface Integration {
	name: string;
	description: string;
	href: string;
	icon: IconComponent;
	comingSoon: boolean;
	badge?: string;
}

const integrations: Integration[] = [
	{
		name: "Claude Code",
		description:
			"Use LLM Gateway with Claude Code for AI-powered terminal assistance and coding.",
		href: "/guides/claude-code",
		icon: AnthropicIcon,
		comingSoon: false,
	},
	{
		name: "Cursor",
		description:
			"Use LLM Gateway with Cursor IDE for AI-powered code editing and chat.",
		href: "https://docs.llmgateway.io/guides/cursor",
		icon: CursorIcon,
		comingSoon: false,
		badge: "Plan mode only",
	},
	{
		name: "Cline",
		description:
			"Use LLM Gateway with Cline for AI-powered coding assistance in VS Code.",
		href: "https://docs.llmgateway.io/guides/cline",
		icon: ClineIcon,
		comingSoon: false,
	},
	{
		name: "n8n",
		description:
			"Connect n8n workflow automation to LLM Gateway for AI-powered workflows.",
		href: "https://docs.llmgateway.io/guides/n8n",
		icon: N8nIcon,
		comingSoon: false,
	},
	{
		name: "OpenCode",
		description:
			"Use LLM Gateway with OpenCode for AI-powered development workflows.",
		href: "/guides/opencode",
		icon: OpenCodeIcon,
		comingSoon: false,
	},
	{
		name: "VS Code",
		description:
			"Native VS Code integration for AI-powered code completion and chat.",
		href: "#",
		icon: VSCodeIcon,
		comingSoon: true,
	},
];

export function IntegrationCards() {
	return (
		<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
			{integrations.map((integration) => {
				const isExternal = integration.href.startsWith("http");
				const cardContent = (
					<Card
						className={`relative h-full p-6 transition-all duration-300 ${
							integration.comingSoon
								? "opacity-60 cursor-not-allowed"
								: "hover:border-primary/50 hover:shadow-lg"
						}`}
					>
						{integration.comingSoon && (
							<Badge
								variant="secondary"
								className="absolute top-4 right-4 gap-1"
							>
								<Clock className="h-3 w-3" />
								Coming Soon
							</Badge>
						)}
						{integration.badge && !integration.comingSoon && (
							<Badge variant="outline" className="absolute top-4 right-4">
								{integration.badge}
							</Badge>
						)}
						<div className="flex items-start gap-4">
							<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
								<integration.icon className="h-6 w-6" />
							</div>
							<div className="flex-1 space-y-2">
								<div className="flex items-center gap-2">
									<h3 className="font-semibold">{integration.name}</h3>
									{!integration.comingSoon && (
										<ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 -translate-x-2 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
									)}
								</div>
								<p className="text-sm text-muted-foreground leading-relaxed">
									{integration.description}
								</p>
							</div>
						</div>
					</Card>
				);

				if (integration.comingSoon) {
					return <div key={integration.name}>{cardContent}</div>;
				}

				if (isExternal) {
					return (
						<a
							key={integration.name}
							href={integration.href}
							target="_blank"
							rel="noopener noreferrer"
							className="group"
						>
							{cardContent}
						</a>
					);
				}

				return (
					<Link
						key={integration.name}
						href={integration.href as any}
						className="group"
					>
						{cardContent}
					</Link>
				);
			})}
		</div>
	);
}

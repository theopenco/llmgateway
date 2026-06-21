"use client";

import { ArrowRight, Cloud, Container, Layers, Ship } from "lucide-react";
import Link from "next/link";
import { usePostHog } from "posthog-js/react";

import type { ReactNode } from "react";

interface Option {
	title: string;
	description: string;
	href: string;
	icon: ReactNode;
}

interface Group {
	label: string;
	options: Option[];
}

const groups: Group[] = [
	{
		label: "Single host",
		options: [
			{
				title: "Docker",
				description:
					"Run every service in one container. The fastest way to a working instance.",
				href: "/self-host/docker",
				icon: <Container className="size-5" />,
			},
			{
				title: "Docker Compose",
				description:
					"Run each service in its own container for more control over scaling and config.",
				href: "/self-host/docker-compose",
				icon: <Layers className="size-5" />,
			},
		],
	},
	{
		label: "Cloud",
		options: [
			{
				title: "Kubernetes (Helm)",
				description:
					"Deploy the official Helm chart to any cluster — EKS, GKE, AKS, or your own.",
				href: "/self-host/kubernetes",
				icon: <Ship className="size-5" />,
			},
			{
				title: "AWS",
				description: "EKS, RDS for Postgres, ElastiCache, and Secrets Manager.",
				href: "/self-host/aws",
				icon: <Cloud className="size-5" />,
			},
			{
				title: "Google Cloud",
				description: "GKE, Cloud SQL, Memorystore, and Secret Manager.",
				href: "/self-host/gcp",
				icon: <Cloud className="size-5" />,
			},
			{
				title: "Azure",
				description:
					"AKS, Azure Database for PostgreSQL, Azure Cache for Redis, and Key Vault.",
				href: "/self-host/azure",
				icon: <Cloud className="size-5" />,
			},
		],
	},
];

export function SelfHostCards() {
	const posthog = usePostHog();

	return (
		<div className="not-prose flex flex-col gap-8">
			{groups.map((group) => (
				<div key={group.label} className="flex flex-col gap-3">
					<h3 className="text-xs font-semibold uppercase tracking-wide text-fd-muted-foreground">
						{group.label}
					</h3>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{group.options.map((option) => (
							<Link
								key={option.href}
								href={option.href}
								onClick={() => {
									posthog.capture("docs_self_host_card_click", {
										option: option.title,
										href: option.href,
									});
								}}
								className="group relative flex flex-col gap-3 rounded-xl border border-fd-border bg-fd-card p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-fd-primary/40"
							>
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-3">
										<div className="rounded-lg bg-fd-primary/10 p-2 text-fd-primary transition-colors duration-200 group-hover:bg-fd-primary/20">
											{option.icon}
										</div>
										<h4 className="text-sm font-semibold tracking-tight text-fd-foreground">
											{option.title}
										</h4>
									</div>
									<ArrowRight className="size-4 -translate-x-1 text-fd-muted-foreground opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 group-hover:text-fd-primary" />
								</div>
								<p className="text-[13px] leading-relaxed text-fd-muted-foreground">
									{option.description}
								</p>
							</Link>
						))}
					</div>
				</div>
			))}
		</div>
	);
}

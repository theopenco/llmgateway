import {
	ArrowUpRight,
	FileCheck,
	Receipt,
	ScrollText,
	ShieldQuestion,
} from "lucide-react";
import Link from "next/link";

import type { LucideIcon } from "lucide-react";
import type { Route } from "next";

interface ProcurementItem {
	icon: LucideIcon;
	title: string;
	description: string;
	href?: string;
	linkLabel?: string;
	external?: boolean;
}

const items: ProcurementItem[] = [
	{
		icon: FileCheck,
		title: "SOC 2 Type II report",
		description:
			"Independently audited controls, verified in operation. The full report and evidence are one request away.",
		href: "https://security.llmgateway.io/",
		linkLabel: "Request the report",
		external: true,
	},
	{
		icon: ScrollText,
		title: "DPA & subprocessor list",
		description:
			"GDPR-aligned data processing agreement and a current subprocessor list, ready for your legal team.",
		href: "/enterprise#contact",
		linkLabel: "Request the DPA",
		external: false,
	},
	{
		icon: ShieldQuestion,
		title: "Security questionnaires",
		description:
			"Vendor forms and security reviews answered by the engineers who run the gateway — not a sales bot.",
	},
	{
		icon: Receipt,
		title: "Flexible commercial terms",
		description:
			"Invoicing, MSA review, and payment terms that fit your procurement process instead of fighting it.",
	},
];

export function ProcurementEnterprise() {
	return (
		<section className="py-20 sm:py-28">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-2xl text-center mb-14">
					<p className="mb-4 text-xs font-mono font-semibold uppercase tracking-[0.2em] text-muted-foreground">
						Procurement
					</p>
					<h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl text-balance">
						Cleared for procurement before the first call
					</h2>
					<p className="text-lg text-muted-foreground text-balance leading-relaxed">
						The paperwork that usually stalls an infrastructure deal, prepared
						up front.
					</p>
				</div>
				<div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2">
					{items.map((item) => (
						<div
							key={item.title}
							className="flex flex-col rounded-xl border border-border bg-card p-6"
						>
							<div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted">
								<item.icon className="h-5 w-5 text-muted-foreground" />
							</div>
							<h3 className="mb-1.5 text-base font-semibold">{item.title}</h3>
							<p className="text-sm leading-relaxed text-muted-foreground">
								{item.description}
							</p>
							{item.href ? (
								item.external ? (
									<a
										href={item.href}
										target="_blank"
										rel="noopener noreferrer"
										className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-blue-500"
									>
										{item.linkLabel}
										<ArrowUpRight className="h-4 w-4" />
									</a>
								) : (
									<Link
										href={item.href as Route}
										className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-blue-500"
									>
										{item.linkLabel}
										<ArrowUpRight className="h-4 w-4" />
									</Link>
								)
							) : null}
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

"use client";

import { ArrowRight, Shield } from "lucide-react";
import Link from "next/link";
import { usePostHog } from "posthog-js/react";

export function EnterpriseCTA() {
	const posthog = usePostHog();

	return (
		<Link
			href="https://llmgateway.io/enterprise"
			target="_blank"
			rel="noopener noreferrer"
			onClick={() => {
				posthog.capture("docs_enterprise_cta_click", {
					location: "toc",
				});
			}}
			className="group relative flex flex-col gap-3 rounded-xl border border-fd-border bg-fd-card p-4 transition-all duration-200 hover:border-fd-primary/40 hover:shadow-md"
		>
			<div className="flex items-center gap-2.5">
				<div className="flex size-8 items-center justify-center rounded-lg bg-fd-primary/10 text-fd-primary transition-colors duration-200 group-hover:bg-fd-primary/20">
					<Shield className="size-4" />
				</div>
				<span className="text-sm font-semibold tracking-tight text-fd-foreground">
					Ready for production?
				</span>
			</div>
			<p className="text-[13px] leading-relaxed text-fd-muted-foreground">
				Ship to production with SSO, audit logs, spend controls, and guardrails
				your security team will approve.
			</p>
			<span className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-fd-primary px-3 py-1.5 text-xs font-medium text-fd-primary-foreground transition-all duration-200 group-hover:gap-2.5">
				Explore Enterprise
				<ArrowRight className="size-3" />
			</span>
		</Link>
	);
}

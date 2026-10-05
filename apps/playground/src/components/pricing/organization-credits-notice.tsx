"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { CHAT_CONTEXT_COOKIE } from "@/lib/constants";
import { useApi } from "@/lib/fetch-client";
import { formatCredits } from "@/lib/format-credits";

export function OrganizationCreditsNotice() {
	const api = useApi();
	const pathname = usePathname();
	const { data } = useQuery(api.queryOptions("get", "/orgs"));
	const organizations = data?.organizations.filter(
		(org) =>
			org.kind === "default" &&
			org.status === "active" &&
			Number(org.credits) > 0,
	);
	if (!organizations?.length) {
		return null;
	}

	return (
		<section
			aria-label="Available organization credits"
			className="mb-8 rounded-2xl border border-lounge-gold/30 bg-lounge-gold/[0.06] p-5 sm:p-6"
		>
			<div className="flex items-start gap-3">
				<Wallet className="mt-0.5 size-5 shrink-0 text-lounge-gold" />
				<div>
					<h2 className="font-display text-xl font-semibold">
						You already have credits
					</h2>
					<p className="mt-1 text-sm leading-relaxed text-muted-foreground">
						Your organization credits are separate from your Chat plan
						allowance. Switch to an organization below to use its balance in
						Lounge, without a membership.
					</p>
				</div>
			</div>
			<ul className="mt-4 divide-y divide-border">
				{organizations.map((org) => (
					<li
						key={org.id}
						className="flex flex-wrap items-center justify-between gap-3 py-3 last:pb-0"
					>
						<div className="min-w-0">
							<p className="break-words text-sm font-medium">{org.name}</p>
							<p className="text-sm text-muted-foreground">
								<span className="font-medium tabular-nums text-foreground">
									${formatCredits(Number(org.credits))}
								</span>{" "}
								in pay-as-you-go credits
							</p>
						</div>
						<Button asChild variant="outline" size="sm">
							<Link
								href={`${pathname === "/pricing" ? "/" : pathname}?orgId=${encodeURIComponent(org.id)}`}
								onClick={() => {
									document.cookie = `${CHAT_CONTEXT_COOKIE}=; path=/; max-age=0; samesite=lax`;
								}}
								aria-label={`Use credits from ${org.name}`}
							>
								Use these credits <ArrowUpRight className="size-4" />
							</Link>
						</Button>
					</li>
				))}
			</ul>
		</section>
	);
}

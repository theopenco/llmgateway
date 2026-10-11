import { ArrowLeft, Gauge, Tag } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
	DeleteRateLimitButton,
	RateLimitForm,
} from "@/components/rate-limit-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	getOrganizationRateLimits,
	getRateLimitOptions,
} from "@/lib/admin-rate-limits";
import { canWrite } from "@/lib/admin-role";
import { getSessionAdminRole } from "@/lib/get-admin-role";
import { createServerApiClient } from "@/lib/server-api";

import { formatNumber } from "@llmgateway/shared/number-format";

const LIMIT_HIT_TYPE_LABELS: Record<string, string> = {
	rpm: "Endpoint RPM",
	concurrency: "Concurrency",
	spend_cap_daily: "Daily spend cap",
	spend_cap_monthly: "Monthly spend cap",
	topup_velocity: "Top-up velocity",
};

function formatDate(dateString: string) {
	return new Date(dateString).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

function SignInPrompt() {
	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<div className="w-full max-w-md text-center">
				<div className="mb-8">
					<h1 className="text-3xl font-semibold tracking-tight">
						Admin Dashboard
					</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						Sign in to access the admin dashboard
					</p>
				</div>
				<Button asChild size="lg" className="w-full">
					<Link href="/login">Sign In</Link>
				</Button>
			</div>
		</div>
	);
}

export default async function OrganizationRateLimitsPage({
	params,
}: {
	params: Promise<{ orgId: string }>;
}) {
	const { orgId } = await params;

	const isAdmin = canWrite(await getSessionAdminRole());
	const $api = await createServerApiClient();
	const [rateLimitsData, options, metricsRes, limitHitsRes] = await Promise.all(
		[
			getOrganizationRateLimits(orgId),
			getRateLimitOptions(),
			$api.GET("/admin/organizations/{orgId}", {
				params: { path: { orgId } },
			}),
			$api.GET("/admin/organizations/{orgId}/limit-hits", {
				params: { path: { orgId } },
			}),
		],
	);
	const metrics = metricsRes.data;
	const limitHits = limitHitsRes.data?.hits ?? [];

	if (rateLimitsData === null) {
		return <SignInPrompt />;
	}

	if (!metrics) {
		notFound();
	}

	const rateLimits = rateLimitsData?.rateLimits ?? [];
	const org = metrics.organization;

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<div className="flex items-center gap-2">
				<Button variant="ghost" size="sm" asChild>
					<Link href={`/organizations/${orgId}`}>
						<ArrowLeft className="h-4 w-4" />
						Back to Organization
					</Link>
				</Button>
			</div>

			<header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
				<div className="space-y-1">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
							<Gauge className="h-5 w-5" />
						</div>
						<div>
							<h1 className="text-2xl font-semibold tracking-tight">
								Rate Limits
							</h1>
							<p className="text-sm text-muted-foreground">{org.name}</p>
						</div>
					</div>
				</div>
				{isAdmin && options && (
					<RateLimitForm
						providers={options.providers}
						mappings={options.mappings}
						orgId={orgId}
					/>
				)}
			</header>

			<div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Provider</TableHead>
							<TableHead>Model</TableHead>
							<TableHead>Limit</TableHead>
							<TableHead>Mode</TableHead>
							<TableHead>Reason</TableHead>
							<TableHead>Created</TableHead>
							{isAdmin ? <TableHead className="w-[130px]" /> : null}
						</TableRow>
					</TableHeader>
					<TableBody>
						{rateLimits.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={isAdmin ? 7 : 6}
									className="h-24 text-center text-muted-foreground"
								>
									<div className="flex flex-col items-center gap-2">
										<Tag className="h-8 w-8 text-muted-foreground/50" />
										<p>No rate limits configured for this organization</p>
										{isAdmin ? (
											<p className="text-xs">
												Add an RPM or RPD cap for this organization
											</p>
										) : null}
									</div>
								</TableCell>
							</TableRow>
						) : (
							rateLimits.map((rateLimit) => (
								<TableRow key={rateLimit.id}>
									<TableCell>
										{rateLimit.provider ? (
											<Badge variant="outline">{rateLimit.provider}</Badge>
										) : (
											<span className="text-muted-foreground">All</span>
										)}
									</TableCell>
									<TableCell>
										{rateLimit.model ? (
											<Badge variant="secondary">{rateLimit.model}</Badge>
										) : (
											<span className="text-muted-foreground">All</span>
										)}
									</TableCell>
									<TableCell>
										<span className="font-medium">
											{formatNumber(rateLimit.maxRequests)}{" "}
											{rateLimit.limitType.toUpperCase()}
										</span>
									</TableCell>
									<TableCell>
										{rateLimit.mode !== "strict" ? (
											<Badge variant="secondary">
												{rateLimit.mode === "lax" ? "Lax" : "Soft"}
											</Badge>
										) : (
											<Badge variant="outline">Strict</Badge>
										)}
									</TableCell>
									<TableCell className="max-w-[200px] truncate text-muted-foreground">
										{rateLimit.reason ?? "\u2014"}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{formatDate(rateLimit.createdAt)}
									</TableCell>
									{isAdmin ? (
										<TableCell>
											<div className="flex items-center gap-1">
												{options && (
													<RateLimitForm
														providers={options.providers}
														mappings={options.mappings}
														orgId={orgId}
														rateLimit={rateLimit}
													/>
												)}
												<DeleteRateLimitButton
													rateLimitId={rateLimit.id}
													orgId={orgId}
												/>
											</div>
										</TableCell>
									) : null}
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			<section className="space-y-3">
				<div>
					<h2 className="text-lg font-semibold tracking-tight">
						Anti-abuse limit hits (last 30 days)
					</h2>
					<p className="text-sm text-muted-foreground">
						Rejections recorded by the tiered endpoint RPM limits, concurrency
						limits, spend caps, and top-up velocity caps. Tracking only —
						nothing is blocked from here.
					</p>
				</div>
				<div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Day (UTC)</TableHead>
								<TableHead>Limit</TableHead>
								<TableHead>Endpoint</TableHead>
								<TableHead className="text-right">Hits</TableHead>
								<TableHead className="text-right">Blocked top-up $</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{limitHits.length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={5}
										className="h-16 text-center text-muted-foreground"
									>
										No anti-abuse limit hits in the last 30 days
									</TableCell>
								</TableRow>
							) : (
								limitHits.map((hit) => (
									<TableRow
										key={`${hit.day}-${hit.limitType}-${hit.endpointKey}`}
									>
										<TableCell className="whitespace-nowrap">
											{formatDate(hit.day)}
										</TableCell>
										<TableCell>
											<Badge variant="outline">
												{LIMIT_HIT_TYPE_LABELS[hit.limitType] ?? hit.limitType}
											</Badge>
										</TableCell>
										<TableCell className="text-muted-foreground font-mono text-xs">
											{hit.endpointKey || "—"}
										</TableCell>
										<TableCell className="text-right font-medium tabular-nums">
											{formatNumber(hit.hitCount)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{hit.blockedUsd > 0
												? hit.blockedUsd.toLocaleString("en-US", {
														style: "currency",
														currency: "USD",
													})
												: "—"}
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</div>
			</section>

			<div className="rounded-lg border border-border/60 bg-muted/30 p-4">
				<h3 className="text-sm font-medium">How rate limits work</h3>
				<ul className="mt-2 space-y-1 text-sm text-muted-foreground">
					<li>
						Organization rate limits take precedence over global rate limits
					</li>
					<li>
						More specific rate limits (provider + model) take precedence over
						broader ones
					</li>
					<li>
						Rate limits cap the maximum requests per minute (RPM) or per day
						(RPD) for matching providers and models
					</li>
					<li>
						<strong>Lax</strong> limits also allow explicit provider requests
						past the cap; automatic routing and fallback respect it
					</li>
					<li>
						When a rate limit is hit, the gateway falls back to other providers
						when possible; otherwise it returns 429 Too Many Requests
					</li>
				</ul>
			</div>
		</div>
	);
}

import { Gauge, Tag } from "lucide-react";
import Link from "next/link";

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
	createGlobalRateLimit,
	deleteGlobalRateLimit,
	getGlobalRateLimits,
	getRateLimitOptions,
} from "@/lib/admin-rate-limits";

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

export default async function GlobalRateLimitsPage() {
	const [rateLimitsData, options] = await Promise.all([
		getGlobalRateLimits(),
		getRateLimitOptions(),
	]);

	if (rateLimitsData === null) {
		return <SignInPrompt />;
	}

	const rateLimits = rateLimitsData?.rateLimits ?? [];

	// Server action to create rate limit
	async function handleCreateRateLimit(data: {
		provider: string | null;
		model: string | null;
		limitType: "rpm" | "rpd";
		maxRequests: number;
		reason: string | null;
	}): Promise<{ success: boolean; error?: string }> {
		"use server";

		try {
			const result = await createGlobalRateLimit({
				provider: data.provider,
				model: data.model,
				limitType: data.limitType,
				maxRequests: data.maxRequests,
				reason: data.reason,
			});

			if (!result) {
				return {
					success: false,
					error: "Failed to create rate limit. It may already exist.",
				};
			}

			return { success: true };
		} catch (error) {
			console.error("Error creating rate limit:", error);
			return {
				success: false,
				error: "An error occurred while creating the rate limit",
			};
		}
	}

	// Server action to delete rate limit
	async function handleDeleteRateLimit(
		rateLimitId: string,
	): Promise<{ success: boolean }> {
		"use server";

		const success = await deleteGlobalRateLimit(rateLimitId);
		return { success };
	}

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
				<div className="space-y-1">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
							<Gauge className="h-5 w-5" />
						</div>
						<div>
							<h1 className="text-2xl font-semibold tracking-tight">
								Global Rate Limits
							</h1>
							<p className="text-sm text-muted-foreground">
								RPM caps that apply to all organizations
							</p>
						</div>
					</div>
				</div>
				{options && (
					<RateLimitForm
						providers={options.providers}
						mappings={options.mappings}
						onSubmit={handleCreateRateLimit}
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
							<TableHead>Reason</TableHead>
							<TableHead>Created</TableHead>
							<TableHead className="w-[50px]" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{rateLimits.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={6}
									className="h-24 text-center text-muted-foreground"
								>
									<div className="flex flex-col items-center gap-2">
										<Tag className="h-8 w-8 text-muted-foreground/50" />
										<p>No global rate limits configured</p>
										<p className="text-xs">
											Global rate limits cap the maximum requests per minute or
											per day for specific providers/models
										</p>
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
											{rateLimit.maxRequests.toLocaleString()}{" "}
											{rateLimit.limitType.toUpperCase()}
										</span>
									</TableCell>
									<TableCell className="max-w-[200px] truncate text-muted-foreground">
										{rateLimit.reason ?? "\u2014"}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{formatDate(rateLimit.createdAt)}
									</TableCell>
									<TableCell>
										<DeleteRateLimitButton
											rateLimitId={rateLimit.id}
											onDelete={handleDeleteRateLimit}
										/>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			<div className="rounded-lg border border-border/60 bg-muted/30 p-4">
				<h3 className="text-sm font-medium">How global rate limits work</h3>
				<ul className="mt-2 space-y-1 text-sm text-muted-foreground">
					<li>
						Global rate limits apply to ALL organizations unless overridden by
						org-specific rate limits
					</li>
					<li>
						More specific rate limits (provider + model) take precedence over
						broader ones
					</li>
					<li>
						Rate limits are enforced per organization - each org gets their own
						counter
					</li>
					<li>
						Caps can be defined as requests per minute (RPM) or per day (RPD)
					</li>
					<li>
						When a cap is hit, the gateway prefers other eligible providers
						before returning 429
					</li>
				</ul>
			</div>
		</div>
	);
}

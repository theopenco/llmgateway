"use client";

import { useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Building2, Loader2, PlaneTakeoff } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { EmailVerificationBanner } from "@/components/EmailVerificationBanner";
import { Logo } from "@/components/Logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUser } from "@/hooks/useUser";
import { useApi } from "@/lib/fetch-client";

export default function OnboardingPage() {
	const { user, isLoading } = useUser({
		redirectTo: "/login?returnUrl=/onboarding",
		redirectWhen: "unauthenticated",
	});
	const api = useApi();
	const queryClient = useQueryClient();

	const companiesQuery = api.useQuery("get", "/airside/companies", {});
	const claimableQuery = api.useQuery("get", "/airside/claimable", {});

	const [companyName, setCompanyName] = useState("");
	const [companyWebsite, setCompanyWebsite] = useState("");

	const createCompany = api.useMutation("post", "/airside/companies", {
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/airside/companies", {}).queryKey,
			});
			toast.success("Company registered.");
		},
		onError: (error) => {
			toast.error(
				(error as { message?: string })?.message ??
					"Failed to create the company",
			);
		},
	});

	const createClaim = api.useMutation("post", "/airside/claims", {
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: api.queryOptions("get", "/airside/companies", {}).queryKey,
				}),
				queryClient.invalidateQueries({
					queryKey: api.queryOptions("get", "/airside/claimable", {}).queryKey,
				}),
			]);
			toast.success("Carrier claimed — welcome airside.");
		},
		onError: (error) => {
			toast.error(
				(error as { message?: string })?.message ?? "Failed to claim carrier",
			);
		},
	});

	const companies = companiesQuery.data?.companies ?? [];
	const claimable = claimableQuery.data?.providers ?? [];
	const company = companies[0];
	const hasClaim = companies.some((c) => c.claims.length > 0);

	if (isLoading || !user) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<Loader2 className="text-muted-foreground size-5 animate-spin" />
			</div>
		);
	}

	return (
		<div className="radar-grid min-h-screen px-4 py-12">
			<div className="mx-auto w-full max-w-2xl">
				<Link href="/" className="mb-8 flex items-center justify-center gap-2">
					<Logo />
					<span className="font-display text-lg font-black tracking-tight">
						AIRSIDE
					</span>
				</Link>

				<div className="space-y-4">
					<EmailVerificationBanner />

					{/* Step 1 — company */}
					<section className="border-border bg-card rounded-xl border p-6">
						<div className="mb-4 flex items-center gap-3">
							<Building2 className="text-primary size-5" />
							<div>
								<h2 className="font-display font-bold">
									1 · Register your company
								</h2>
								<p className="text-muted-foreground text-sm">
									One company can operate several carriers.
								</p>
							</div>
						</div>
						{company ? (
							<div className="flex items-center justify-between">
								<div>
									<div className="font-medium">{company.name}</div>
									{company.website ? (
										<div className="text-muted-foreground text-sm">
											{company.website}
										</div>
									) : null}
								</div>
								<Badge variant="success">
									<BadgeCheck className="size-3" /> Registered
								</Badge>
							</div>
						) : (
							<form
								className="grid gap-4 sm:grid-cols-2"
								onSubmit={(e) => {
									e.preventDefault();
									createCompany.mutate({
										body: {
											name: companyName,
											website: companyWebsite || undefined,
										},
									});
								}}
							>
								<div className="space-y-2">
									<Label htmlFor="company-name">Company name</Label>
									<Input
										id="company-name"
										value={companyName}
										required
										minLength={2}
										onChange={(e) => setCompanyName(e.target.value)}
										placeholder="Acme Inference Inc."
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="company-website">Website (optional)</Label>
									<Input
										id="company-website"
										value={companyWebsite}
										type="url"
										onChange={(e) => setCompanyWebsite(e.target.value)}
										placeholder="https://acme.ai"
									/>
								</div>
								<div className="sm:col-span-2">
									<Button
										type="submit"
										disabled={createCompany.isPending || !user.emailVerified}
										className="font-semibold"
									>
										{createCompany.isPending
											? "Registering…"
											: "Register company"}
									</Button>
									{!user.emailVerified ? (
										<p className="text-muted-foreground mt-2 text-xs">
											Verify your email first.
										</p>
									) : null}
								</div>
							</form>
						)}
					</section>

					{/* Step 2 — claim */}
					<section className="border-border bg-card rounded-xl border p-6">
						<div className="mb-4 flex items-center gap-3">
							<PlaneTakeoff className="text-primary size-5" />
							<div>
								<h2 className="font-display font-bold">
									2 · Claim your carrier
								</h2>
								<p className="text-muted-foreground text-sm">
									Providers whose endpoint domain matches{" "}
									<span className="font-mono">@{user.email.split("@")[1]}</span>
									.
								</p>
							</div>
						</div>
						{claimable.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								No catalogue provider matches your email domain. Sign up with an
								address on your provider&apos;s API domain (e.g.{" "}
								<span className="font-mono">ops@yourprovider.ai</span>), or
								contact us to get your provider listed first.
							</p>
						) : (
							<ul className="space-y-3">
								{claimable.map((p) => (
									<li
										key={p.providerId}
										className="border-border flex items-center justify-between rounded-lg border px-4 py-3"
									>
										<div>
											<div className="font-medium">{p.name}</div>
											<div className="text-muted-foreground font-mono text-xs">
												{p.providerId} · matched {p.matchedDomain}
											</div>
										</div>
										{p.claimedByMyCompany ? (
											<Badge variant="success">
												<BadgeCheck className="size-3" /> Claimed
											</Badge>
										) : p.claimed ? (
											<Badge variant="secondary">Claimed by another team</Badge>
										) : (
											<Button
												size="sm"
												disabled={
													!company ||
													!user.emailVerified ||
													createClaim.isPending
												}
												onClick={() => {
													if (!company) {
														return;
													}
													createClaim.mutate({
														body: {
															providerCompanyId: company.id,
															providerId: p.providerId,
														},
													});
												}}
											>
												Claim
											</Button>
										)}
									</li>
								))}
							</ul>
						)}
					</section>

					<div className="flex justify-end">
						<Button
							asChild
							size="lg"
							variant={hasClaim ? "default" : "outline"}
							className="font-semibold"
						>
							<Link href="/dashboard">
								{hasClaim ? "Enter operations →" : "Skip to operations"}
							</Link>
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}

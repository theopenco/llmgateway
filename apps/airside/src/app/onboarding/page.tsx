"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	BadgeCheck,
	Building2,
	CreditCard,
	Hourglass,
	Loader2,
	PlaneTakeoff,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { CrewChannelCard } from "@/components/CrewChannelCard";
import { EmailVerificationBanner } from "@/components/EmailVerificationBanner";
import { Logo } from "@/components/Logo";
import { ProviderBrandingFields } from "@/components/ProviderBrandingFields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { WebsiteVerificationCard } from "@/components/WebsiteVerificationCard";
import { useUser } from "@/hooks/useUser";
import { useApi } from "@/lib/fetch-client";

function ClaimDialog({
	providerName,
	disabled,
	pending,
	onClaim,
}: {
	providerName: string;
	disabled: boolean;
	pending: boolean;
	onClaim: (branding: { logoUrl?: string; iconUrl?: string }) => void;
}) {
	const [open, setOpen] = useState(false);
	const [logoUrl, setLogoUrl] = useState<string | undefined>(undefined);
	const [iconUrl, setIconUrl] = useState<string | undefined>(undefined);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button size="sm" disabled={disabled} data-testid="open-claim-dialog">
					Claim
				</Button>
			</DialogTrigger>
			<DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle className="font-display">
						Claim {providerName}
					</DialogTitle>
					<DialogDescription>
						Optionally upload your carrier branding — it appears on the public
						providers and models pages once your claim is approved.
					</DialogDescription>
				</DialogHeader>
				<ProviderBrandingFields
					logoInputId="claim-logo"
					iconInputId="claim-icon"
					providerName={providerName}
					logoUrl={logoUrl}
					iconUrl={iconUrl}
					onLogoChange={(value) => setLogoUrl(value ?? undefined)}
					onIconChange={(value) => setIconUrl(value ?? undefined)}
				/>
				<DialogFooter>
					<Button
						className="font-semibold"
						disabled={pending}
						data-testid="confirm-claim"
						onClick={() => {
							onClaim({ logoUrl, iconUrl });
							setOpen(false);
						}}
					>
						{pending ? "Filing…" : "File the claim"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Whether the URL's host sits on one of the domains the registrant proved.
 * A suffix test, not the server's public-suffix parse — close enough to tell
 * someone they typed the wrong domain before they submit, while the server
 * stays the authority on what is actually accepted.
 */
function endpointDomainState(
	baseUrl: string,
	domains: string[],
): "empty" | "invalid-url" | "wrong-domain" | "ok" {
	const trimmed = baseUrl.trim();
	if (!trimmed) {
		return "empty";
	}
	let host: string;
	try {
		host = new URL(trimmed).hostname.toLowerCase();
	} catch {
		return "invalid-url";
	}
	return domains.some(
		(domain) => host === domain || host.endsWith(`.${domain}`),
	)
		? "ok"
		: "wrong-domain";
}

function RegisterCarrierDialog({
	claimDomains,
	disabled,
	pending,
	onRegister,
}: {
	claimDomains: string[];
	disabled: boolean;
	pending: boolean;
	onRegister: (values: {
		providerId: string;
		name: string;
		baseUrl: string;
		description?: string;
		logoUrl?: string;
		iconUrl?: string;
	}) => void;
}) {
	const [open, setOpen] = useState(false);
	const [providerId, setProviderId] = useState("");
	const [name, setName] = useState("");
	const [baseUrl, setBaseUrl] = useState("");
	const [description, setDescription] = useState("");
	const [logoUrl, setLogoUrl] = useState<string | undefined>(undefined);
	const [iconUrl, setIconUrl] = useState<string | undefined>(undefined);
	const domainState = endpointDomainState(baseUrl, claimDomains);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button
					size="sm"
					variant="outline"
					disabled={disabled}
					data-testid="open-register-carrier"
				>
					Register a new carrier
				</Button>
			</DialogTrigger>
			<DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle className="font-display">
						Register a new carrier
					</DialogTitle>
					<DialogDescription>
						List a provider that is not in the catalogue yet. Each model can use
						its carrier-default API, OpenAI Chat Completions or Responses, or
						the Google Vertex format, hosted on{" "}
						{claimDomains.map((domain, i) => (
							<span key={domain}>
								{i > 0 ? " or " : ""}
								<span className="font-mono">{domain}</span>
							</span>
						))}
						{claimDomains.length > 1
							? " — the domains you verified."
							: ", the domain of your verified email."}{" "}
						Registrations are reviewed by our team.
					</DialogDescription>
				</DialogHeader>
				<form
					className="space-y-4"
					onSubmit={(e) => {
						e.preventDefault();
						onRegister({
							providerId,
							name,
							baseUrl,
							description: description || undefined,
							logoUrl,
							iconUrl,
						});
						setOpen(false);
					}}
				>
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="carrier-id">Carrier id</Label>
							<Input
								id="carrier-id"
								data-testid="carrier-id-input"
								value={providerId}
								onChange={(e) => setProviderId(e.target.value)}
								placeholder="acme-ai"
								pattern={"[a-z][a-z0-9\\-]{2,31}"}
								title="3-32 chars: lowercase letters, digits and hyphens, starting with a letter"
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="carrier-name">Display name</Label>
							<Input
								id="carrier-name"
								data-testid="carrier-name-input"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="Acme AI"
								required
							/>
						</div>
					</div>
					<div className="space-y-2">
						<Label htmlFor="carrier-base-url">API base URL</Label>
						<Input
							id="carrier-base-url"
							data-testid="carrier-base-url-input"
							value={baseUrl}
							onChange={(e) => setBaseUrl(e.target.value)}
							placeholder={`https://api.${claimDomains[0] ?? "example.com"}`}
							aria-invalid={domainState === "wrong-domain" || undefined}
							aria-describedby="carrier-base-url-hint"
							required
						/>
						<p
							id="carrier-base-url-hint"
							data-testid="carrier-base-url-hint"
							className={
								domainState === "wrong-domain"
									? "text-destructive text-xs"
									: "text-muted-foreground text-xs"
							}
						>
							{domainState === "wrong-domain" ? (
								<>
									Must be on{" "}
									<span className="font-mono">{claimDomains.join(" or ")}</span>{" "}
									— we only list an endpoint on a domain you proved.
								</>
							) : (
								<>
									Must be on{" "}
									<span className="font-mono">{claimDomains.join(" or ")}</span>
									.
								</>
							)}
						</p>
					</div>
					<div className="space-y-2">
						<Label htmlFor="carrier-description">Description</Label>
						<Textarea
							id="carrier-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="What do you fly?"
							rows={2}
						/>
					</div>
					<ProviderBrandingFields
						logoInputId="carrier-logo"
						iconInputId="carrier-icon"
						providerName={name}
						logoUrl={logoUrl}
						iconUrl={iconUrl}
						onLogoChange={(value) => setLogoUrl(value ?? undefined)}
						onIconChange={(value) => setIconUrl(value ?? undefined)}
					/>
					<DialogFooter>
						<Button
							type="submit"
							className="font-semibold"
							disabled={pending || domainState !== "ok"}
							data-testid="confirm-register-carrier"
						>
							{pending ? "Filing…" : "File the registration"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function OnboardingContent() {
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
			toast.success(
				"Claim filed — we review every new carrier before it goes live.",
			);
		},
		onError: (error) => {
			toast.error(
				(error as { message?: string })?.message ?? "Failed to claim carrier",
			);
		},
	});

	const registerCarrier = api.useMutation("post", "/airside/carriers", {
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/airside/companies", {}).queryKey,
			});
			toast.success(
				"Registration filed — we review every new carrier before it goes live.",
			);
		},
		onError: (error) => {
			toast.error(
				(error as { message?: string })?.message ??
					"Failed to register the carrier",
			);
		},
	});

	const startCheckout = api.useMutation(
		"post",
		"/airside/companies/{id}/listing-checkout",
		{
			onSuccess: (data) => {
				window.location.href = data.checkoutUrl;
			},
			onError: (error) => {
				toast.error(
					(error as { message?: string })?.message ??
						"Failed to start the checkout",
				);
			},
		},
	);

	const [inviteCode, setInviteCode] = useState("");
	const redeemInviteCode = api.useMutation(
		"post",
		"/airside/companies/{id}/invite-code",
		{
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: api.queryOptions("get", "/airside/companies", {}).queryKey,
				});
				toast.success("Code accepted — the listing fee is waived.");
			},
			onError: (error) => {
				toast.error(
					(error as { message?: string })?.message ?? "Invalid invite code",
				);
			},
		},
	);

	// Returning from Stripe: the webhook can lag the redirect by a moment, so
	// poll the companies query briefly until the paid flag lands.
	const searchParams = useSearchParams();
	const paymentParam = searchParams.get("payment");
	const paymentToastShown = useRef(false);
	useEffect(() => {
		if (paymentParam === "canceled" && !paymentToastShown.current) {
			paymentToastShown.current = true;
			toast.info("Checkout canceled — you can pay the listing fee anytime.");
			return;
		}
		if (paymentParam !== "success" || paymentToastShown.current) {
			return;
		}
		paymentToastShown.current = true;
		toast.success("Payment received — welcome aboard.");
		let attempts = 0;
		const timer = setInterval(() => {
			attempts += 1;
			void queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/airside/companies", {}).queryKey,
			});
			if (attempts >= 5) {
				clearInterval(timer);
			}
		}, 1500);
		return () => clearInterval(timer);
	}, [paymentParam, queryClient, api]);

	const companies = companiesQuery.data?.companies ?? [];
	const claimable = claimableQuery.data?.providers ?? [];
	const isFreemail = claimableQuery.data?.emailDomainIsFreemail ?? false;
	const company = companies[0];
	const hasClaim = companies.some((c) => c.claims.length > 0);
	const paymentDue =
		!!company && company.paymentRequired && company.paymentStatus === "unpaid";
	const emailDomain = user?.email.split("@")[1] ?? "";
	// Every domain this account may claim on: the verified email's, plus a
	// company domain proved over DNS.
	const claimDomains = Array.from(
		new Set(
			[
				isFreemail ? null : emailDomain,
				company?.websiteVerifiedDomain ?? null,
			].filter((d): d is string => !!d),
		),
	);
	// Why "Register a new carrier" is unavailable, if it is — shown next to
	// the disabled button instead of leaving it silently dead.
	const registerBlockedReason =
		claimDomains.length === 0
			? "You signed up with a personal email address — carrier registration needs an address on your company's domain, or a company domain verified over DNS."
			: !company
				? "Register your company first."
				: !user?.emailVerified
					? "Verify your email first."
					: paymentDue
						? "Pay the listing fee first."
						: null;

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
							<>
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
								<WebsiteVerificationCard companyId={company.id} />
							</>
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
									<p className="text-muted-foreground text-xs">
										You can verify this domain over DNS after registering.
									</p>
								</div>
								<div
									className="border-border text-muted-foreground rounded-lg border border-dashed p-3 text-xs sm:col-span-2"
									data-testid="domain-rule-notice"
								>
									{isFreemail ? (
										<>
											You signed up with{" "}
											<span className="font-mono">@{emailDomain}</span>, a
											personal email domain. Carriers are matched by domain, so
											you will need an address on your company&apos;s domain —
											or a company website verified over DNS — to claim or
											register one.
										</>
									) : (
										<>
											Carriers are matched by domain: you can claim a catalogue
											provider, or register a new one, whose API runs on{" "}
											<span className="font-mono">@{emailDomain}</span> — the
											domain of your verified email. Adding a website you verify
											over DNS lets you use that domain too.
										</>
									)}
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

					{/* Step 2 — listing fee */}
					{company && company.paymentRequired ? (
						<section className="border-border bg-card rounded-xl border p-6">
							<div className="mb-4 flex items-center gap-3">
								<CreditCard className="text-primary size-5" />
								<div>
									<h2 className="font-display font-bold">
										2 · Pay the listing fee
									</h2>
									<p className="text-muted-foreground text-sm">
										A one-time fee
										{company.listingFeeAmount !== null ? (
											<>
												{" "}
												of{" "}
												<span
													className="text-foreground font-mono font-semibold"
													data-testid="listing-fee-amount"
												>
													${company.listingFeeAmount.toLocaleString("en-US")}
												</span>
											</>
										) : null}{" "}
										unlocks carrier claims for your company.
									</p>
								</div>
							</div>
							{company.paymentStatus === "paid" ? (
								<Badge variant="success" data-testid="payment-paid-badge">
									<BadgeCheck className="size-3" />{" "}
									{company.listingInviteCodeUsed ? "Fee waived" : "Paid"}
								</Badge>
							) : (
								<div className="space-y-4">
									<Button
										className="font-semibold"
										disabled={startCheckout.isPending}
										data-testid="pay-listing-fee"
										onClick={() =>
											startCheckout.mutate({
												params: { path: { id: company.id } },
											})
										}
									>
										{startCheckout.isPending
											? "Opening checkout…"
											: "Pay the listing fee"}
									</Button>
									<div className="border-border border-t pt-4">
										<p className="text-muted-foreground mb-2 text-xs">
											Already working with us? Enter your invite code to skip
											the fee.
										</p>
										<form
											className="flex max-w-sm gap-2"
											onSubmit={(event) => {
												event.preventDefault();
												redeemInviteCode.mutate({
													params: { path: { id: company.id } },
													body: { code: inviteCode },
												});
											}}
										>
											<Input
												value={inviteCode}
												onChange={(event) =>
													setInviteCode(event.target.value.toUpperCase())
												}
												placeholder="AIR-XXXX-XXXX"
												className="font-mono uppercase"
												data-testid="invite-code-input"
											/>
											<Button
												type="submit"
												variant="outline"
												className="font-semibold"
												disabled={
													!inviteCode.trim() || redeemInviteCode.isPending
												}
												data-testid="apply-invite-code"
											>
												{redeemInviteCode.isPending ? "Checking…" : "Apply"}
											</Button>
										</form>
									</div>
								</div>
							)}
						</section>
					) : null}

					{/* Step 3 — claim */}
					<section className="border-border bg-card rounded-xl border p-6">
						<div className="mb-4 flex items-center gap-3">
							<PlaneTakeoff className="text-primary size-5" />
							<div>
								<h2 className="font-display font-bold">
									{company?.paymentRequired
										? "3 · Claim your carrier"
										: "2 · Claim your carrier"}
								</h2>
								<p className="text-muted-foreground text-sm">
									{claimDomains.length === 0 ? (
										"Carriers are matched by domain, so this needs your company address or a DNS-verified company domain."
									) : (
										<>
											Claim catalogue providers whose endpoint domain matches{" "}
											{claimDomains.map((domain, i) => (
												<span key={domain}>
													{i > 0 ? " or " : ""}
													<span className="font-mono">@{domain}</span>
												</span>
											))}
											, or register a new carrier hosted there. Both are
											reviewed by our team before going live.
										</>
									)}
								</p>
							</div>
						</div>
						{claimable.length === 0 ? (
							claimDomains.length === 0 ? (
								<p className="text-muted-foreground text-sm">
									<span className="font-mono">@{emailDomain}</span> is a
									personal email provider, so it can&apos;t claim or host a
									carrier API. Sign in with your company email (e.g.{" "}
									<span className="font-mono">ops@yourprovider.ai</span>), or
									verify your company website&apos;s domain over DNS above, to
									claim or register a carrier.
								</p>
							) : (
								<p className="text-muted-foreground text-sm">
									No catalogue provider matches{" "}
									<span className="font-mono">
										{claimDomains.map((d) => `@${d}`).join(" or ")}
									</span>
									. If your provider is not on LLM Gateway yet, register it as a
									new carrier below — all you need is an inference API on that
									domain.
								</p>
							)
						) : (
							<ul className="space-y-3">
								{claimable.map((p) => {
									const rejectedClaim = company?.claims.find(
										(claim) =>
											claim.providerId === p.providerId &&
											claim.status === "rejected",
									);
									return (
										<li
											key={p.providerId}
											className="border-border flex items-center justify-between rounded-lg border px-4 py-3"
										>
											<div>
												<div className="font-medium">{p.name}</div>
												<div className="text-muted-foreground font-mono text-xs">
													{p.providerId} · matched {p.matchedDomain}
												</div>
												{rejectedClaim && !p.claimedByMyCompany ? (
													<div className="text-destructive mt-1 text-xs">
														Previous claim rejected
														{rejectedClaim.reviewNote
															? `: ${rejectedClaim.reviewNote}`
															: ""}
														{" — you can file again."}
													</div>
												) : null}
											</div>
											{p.claimedByMyCompany && p.myClaimStatus === "active" ? (
												<Badge variant="success">
													<BadgeCheck className="size-3" /> Claimed
												</Badge>
											) : p.claimedByMyCompany &&
											  p.myClaimStatus === "pending" ? (
												<Badge variant="pending">
													<Hourglass className="size-3" /> Under review
												</Badge>
											) : p.claimed && !p.claimedByMyCompany ? (
												<Badge variant="secondary">
													Claimed by another team
												</Badge>
											) : (
												<ClaimDialog
													providerName={p.name}
													disabled={
														!company ||
														!user.emailVerified ||
														paymentDue ||
														createClaim.isPending
													}
													pending={createClaim.isPending}
													onClaim={(branding) => {
														if (!company) {
															return;
														}
														createClaim.mutate({
															body: {
																providerCompanyId: company.id,
																providerId: p.providerId,
																...branding,
															},
														});
													}}
												/>
											)}
										</li>
									);
								})}
							</ul>
						)}
						{(company?.claims ?? [])
							.filter((claim) => claim.kind === "custom")
							.map((claim) => (
								<div
									key={claim.id}
									className="border-border mt-3 flex items-center justify-between rounded-lg border px-4 py-3"
								>
									<div>
										<div className="font-medium">{claim.providerName}</div>
										<div className="text-muted-foreground font-mono text-xs">
											{claim.providerId} · {claim.customBaseUrl}
										</div>
										{claim.status === "rejected" ? (
											<div className="text-destructive mt-1 text-xs">
												Registration rejected
												{claim.reviewNote ? `: ${claim.reviewNote}` : ""}
												{" — you can file again."}
											</div>
										) : null}
									</div>
									{claim.status === "active" ? (
										<Badge variant="success">
											<BadgeCheck className="size-3" /> Registered
										</Badge>
									) : claim.status === "pending" ? (
										<Badge variant="pending">
											<Hourglass className="size-3" /> Under review
										</Badge>
									) : (
										<Badge variant="secondary">{claim.status}</Badge>
									)}
								</div>
							))}
						{claimDomains.length > 0 ? (
							<div className="mt-4 flex items-center justify-between gap-3">
								<p className="text-muted-foreground text-xs">
									{registerBlockedReason ??
										`Not in the catalogue? Register your own carrier — an inference API on ${claimDomains
											.map((d) => `@${d}`)
											.join(" or ")} is all it takes.`}
								</p>
								<RegisterCarrierDialog
									claimDomains={claimDomains}
									disabled={
										registerBlockedReason !== null || registerCarrier.isPending
									}
									pending={registerCarrier.isPending}
									onRegister={(values) => {
										if (!company) {
											return;
										}
										registerCarrier.mutate({
											body: { providerCompanyId: company.id, ...values },
										});
									}}
								/>
							</div>
						) : null}
					</section>

					<CrewChannelCard companyId={company?.id} email={user.email} />

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

export default function OnboardingPage() {
	return (
		<Suspense>
			<OnboardingContent />
		</Suspense>
	);
}

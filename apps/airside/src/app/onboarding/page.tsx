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

import { EmailVerificationBanner } from "@/components/EmailVerificationBanner";
import { Logo } from "@/components/Logo";
import { SlackCard } from "@/components/SlackCard";
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
import { useUser } from "@/hooks/useUser";
import { useApi } from "@/lib/fetch-client";

const LOGO_MAX_BYTES = 200 * 1024;
const ICON_MAX_BYTES = 64 * 1024;

function readImageAsDataUrl(file: File, maxBytes: number): Promise<string> {
	return new Promise((resolve, reject) => {
		if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) {
			reject(new Error("Use a PNG, JPEG, WebP or SVG image."));
			return;
		}
		if (file.size > maxBytes) {
			reject(
				new Error(
					`Image must be smaller than ${Math.round(maxBytes / 1024)}KB.`,
				),
			);
			return;
		}
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(new Error("Failed to read the image."));
		reader.readAsDataURL(file);
	});
}

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

	async function handleFile(
		file: File | undefined,
		maxBytes: number,
		set: (v: string | undefined) => void,
	) {
		if (!file) {
			set(undefined);
			return;
		}
		try {
			set(await readImageAsDataUrl(file, maxBytes));
		} catch (error) {
			toast.error((error as Error).message);
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button size="sm" disabled={disabled} data-testid="open-claim-dialog">
					Claim
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="font-display">
						Claim {providerName}
					</DialogTitle>
					<DialogDescription>
						Optionally upload your carrier branding — it appears on the public
						providers and models pages once your claim is approved.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="claim-logo">Logo (max 200KB)</Label>
						<Input
							id="claim-logo"
							type="file"
							accept="image/png,image/jpeg,image/webp,image/svg+xml"
							onChange={(e) =>
								void handleFile(e.target.files?.[0], LOGO_MAX_BYTES, setLogoUrl)
							}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="claim-icon">Square icon (max 64KB)</Label>
						<Input
							id="claim-icon"
							type="file"
							accept="image/png,image/jpeg,image/webp,image/svg+xml"
							onChange={(e) =>
								void handleFile(e.target.files?.[0], ICON_MAX_BYTES, setIconUrl)
							}
						/>
					</div>
					{logoUrl ? (
						<div className="border-border flex items-center gap-3 rounded-md border p-3">
							<img src={logoUrl} alt="Logo preview" className="max-h-10" />
							<span className="text-muted-foreground text-xs">
								Logo preview
							</span>
						</div>
					) : null}
				</div>
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

function RegisterCarrierDialog({
	emailDomain,
	disabled,
	pending,
	onRegister,
}: {
	emailDomain: string;
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

	async function handleFile(
		file: File | undefined,
		maxBytes: number,
		set: (v: string | undefined) => void,
	) {
		if (!file) {
			set(undefined);
			return;
		}
		try {
			set(await readImageAsDataUrl(file, maxBytes));
		} catch (error) {
			toast.error((error as Error).message);
		}
	}

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
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="font-display">
						Register a new carrier
					</DialogTitle>
					<DialogDescription>
						List a provider that is not in the catalogue yet. Your API must be
						OpenAI-compatible (we call{" "}
						<span className="font-mono">/v1/chat/completions</span> under the
						base URL) and hosted on{" "}
						<span className="font-mono">{emailDomain}</span>, the domain of your
						verified email. Registrations are reviewed by our team.
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
								pattern="[a-z][a-z0-9-]{2,31}"
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
							placeholder={`https://api.${emailDomain}`}
							required
						/>
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
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="carrier-logo">Logo (max 200KB)</Label>
							<Input
								id="carrier-logo"
								type="file"
								accept="image/png,image/jpeg,image/webp,image/svg+xml"
								onChange={(e) =>
									void handleFile(
										e.target.files?.[0],
										LOGO_MAX_BYTES,
										setLogoUrl,
									)
								}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="carrier-icon">Square icon (max 64KB)</Label>
							<Input
								id="carrier-icon"
								type="file"
								accept="image/png,image/jpeg,image/webp,image/svg+xml"
								onChange={(e) =>
									void handleFile(
										e.target.files?.[0],
										ICON_MAX_BYTES,
										setIconUrl,
									)
								}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							type="submit"
							className="font-semibold"
							disabled={pending}
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
	// Why "Register a new carrier" is unavailable, if it is — shown next to
	// the disabled button instead of leaving it silently dead.
	const registerBlockedReason = isFreemail
		? "You signed up with a personal email address — carrier registration needs an address on your company's domain."
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
										A one-time fee unlocks carrier claims for your company.
									</p>
								</div>
							</div>
							{company.paymentStatus === "paid" ? (
								<Badge variant="success" data-testid="payment-paid-badge">
									<BadgeCheck className="size-3" /> Paid
								</Badge>
							) : (
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
									{isFreemail
										? "Carriers are matched by email domain, so this needs your company address."
										: "Claim catalogue providers whose endpoint domain matches "}
									{!isFreemail ? (
										<>
											<span className="font-mono">
												@{user.email.split("@")[1]}
											</span>
											, or register a new carrier hosted on that domain. Both
											are reviewed by our team before going live.
										</>
									) : null}
								</p>
							</div>
						</div>
						{claimable.length === 0 ? (
							isFreemail ? (
								<p className="text-muted-foreground text-sm">
									<span className="font-mono">@{user.email.split("@")[1]}</span>{" "}
									is a personal email provider, so it can&apos;t claim or host a
									carrier API. Create an account with your company email (e.g.{" "}
									<span className="font-mono">ops@yourprovider.ai</span>) to
									claim or register a carrier.
								</p>
							) : (
								<p className="text-muted-foreground text-sm">
									No catalogue provider matches your email domain. If your
									provider is not on LLM Gateway yet, register it as a new
									carrier below — all you need is an OpenAI-compatible API on{" "}
									<span className="font-mono">@{user.email.split("@")[1]}</span>
									.
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
						{!isFreemail ? (
							<div className="mt-4 flex items-center justify-between gap-3">
								<p className="text-muted-foreground text-xs">
									{registerBlockedReason ??
										"Not in the catalogue? Register your own carrier — an OpenAI-compatible API on your email domain is all it takes."}
								</p>
								<RegisterCarrierDialog
									emailDomain={user.email.split("@")[1] ?? ""}
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

					<SlackCard />

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

import { ShieldAlert } from "lucide-react";
import Link from "next/link";

import { BlockedSignupCountriesForm } from "@/components/blocked-signup-countries-form";
import { BlockedSignupEmailDomainsForm } from "@/components/blocked-signup-email-domains-form";
import { CreditPurchaseBlockToggle } from "@/components/credit-purchase-block-toggle";
import { ForceThreeDSecureForm } from "@/components/force-three-d-secure-form";
import { ModelErrorRateAlertsForm } from "@/components/model-error-rate-alerts-form";
import { SystemBannerForm } from "@/components/system-banner-form";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	getBlockedSignupCountries,
	getBlockedSignupEmailDomains,
	getCreditPurchaseBlock,
	getForceThreeDSecure,
	getModelErrorRateAlerts,
	getSystemBanner,
} from "@/lib/admin-settings";

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

export default async function SettingsPage() {
	const [
		creditPurchaseBlock,
		blockedSignupCountries,
		blockedSignupEmailDomains,
		forceThreeDSecure,
		systemBanner,
		modelErrorRateAlerts,
	] = await Promise.all([
		getCreditPurchaseBlock(),
		getBlockedSignupCountries(),
		getBlockedSignupEmailDomains(),
		getForceThreeDSecure(),
		getSystemBanner(),
		getModelErrorRateAlerts(),
	]);

	if (
		creditPurchaseBlock === null ||
		blockedSignupCountries === null ||
		blockedSignupEmailDomains === null ||
		forceThreeDSecure === null ||
		systemBanner === null ||
		modelErrorRateAlerts === null
	) {
		return <SignInPrompt />;
	}

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex items-center gap-3">
				<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<ShieldAlert className="h-5 w-5" />
				</div>
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
					<p className="text-sm text-muted-foreground">
						Platform-wide announcements, alerts and emergency switches
					</p>
				</div>
			</header>

			<Card>
				<CardHeader>
					<CardTitle>Announcement banner</CardTitle>
					<CardDescription>
						Shown at the top of the main dashboard and landing pages, DevPass,
						the docs and Airside. Use it for incidents and short-lived notices —
						switch it off as soon as it stops being true.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<SystemBannerForm banner={systemBanner} />
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Model error-rate alerts</CardTitle>
					<CardDescription>
						Posts to Discord when a model/provider mapping&apos;s gateway and
						upstream error rate over a rule&apos;s window reaches its threshold.
						Credit traffic only, checked every minute; each mapping alerts once
						per cooldown. Needs MODEL_ERROR_RATE_DISCORD_URL on the worker.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<ModelErrorRateAlertsForm settings={modelErrorRateAlerts} />
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Credit purchases for new accounts</CardTitle>
					<CardDescription>
						When blocked, organizations that have never completed a Stripe
						payment cannot buy credits and see an attack-mitigation notice.
						Existing customers, automatic top-ups, and subscription renewals are
						unaffected.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<CreditPurchaseBlockToggle
						blocked={creditPurchaseBlock.blocked}
						envForced={creditPurchaseBlock.envForced}
					/>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Sign-ups by country</CardTitle>
					<CardDescription>
						Comma-separated ISO 3166-1 alpha-2 codes. New accounts from these
						countries are rejected, using the country the load balancer reports
						for the request. Sign-in is unaffected, so existing users keep
						working even while travelling through a blocked country.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<BlockedSignupCountriesForm
						countries={blockedSignupCountries.countries}
					/>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Blocked sign-up email domains</CardTitle>
					<CardDescription>
						In hosted mode, email sign-ups from these domains and their
						subdomains are rejected. Existing users can still sign in.
						Disposable email and plus-address checks remain active.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<BlockedSignupEmailDomainsForm
						domains={blockedSignupEmailDomains.domains}
					/>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>3D Secure when a card is added</CardTitle>
					<CardDescription>
						Requests issuer authentication when a customer saves a card or
						starts a subscription — never on a charge. Later top-ups and
						scheduled auto top-ups run on the card authenticated here, so they
						are never challenged and cannot break. The issuer still decides, so
						neither level guarantees a challenge, and forcing one costs some
						conversion on the add-card step.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<ForceThreeDSecureForm
						mode={forceThreeDSecure.mode}
						envOverride={forceThreeDSecure.envOverride}
					/>
				</CardContent>
			</Card>
		</div>
	);
}

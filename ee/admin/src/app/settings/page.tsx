import { ShieldAlert } from "lucide-react";
import Link from "next/link";

import { BlockedSignupCountriesForm } from "@/components/blocked-signup-countries-form";
import { CreditPurchaseBlockToggle } from "@/components/credit-purchase-block-toggle";
import { ForceThreeDSecureForm } from "@/components/force-three-d-secure-form";
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
	getCreditPurchaseBlock,
	getForceThreeDSecure,
	updateBlockedSignupCountries,
	updateCreditPurchaseBlock,
	updateForceThreeDSecure,
} from "@/lib/admin-settings";

import type { ForceThreeDSecureMode } from "@/lib/admin-settings";

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
	const [creditPurchaseBlock, blockedSignupCountries, forceThreeDSecure] =
		await Promise.all([
			getCreditPurchaseBlock(),
			getBlockedSignupCountries(),
			getForceThreeDSecure(),
		]);

	if (
		creditPurchaseBlock === null ||
		blockedSignupCountries === null ||
		forceThreeDSecure === null
	) {
		return <SignInPrompt />;
	}

	async function handleToggle(blocked: boolean): Promise<{ success: boolean }> {
		"use server";

		const result = await updateCreditPurchaseBlock(blocked);
		return { success: result !== null };
	}

	async function handleSaveCountries(countries: string[]) {
		"use server";

		return await updateBlockedSignupCountries(countries);
	}

	async function handleSaveThreeDSecure(mode: ForceThreeDSecureMode) {
		"use server";

		const result = await updateForceThreeDSecure(mode);
		return { ok: result.state !== null, message: result.message };
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
						Platform-wide emergency switches
					</p>
				</div>
			</header>

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
						onToggle={handleToggle}
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
						onSave={handleSaveCountries}
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
						onSave={handleSaveThreeDSecure}
					/>
				</CardContent>
			</Card>
		</div>
	);
}

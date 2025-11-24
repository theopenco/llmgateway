"use client";

import { Copy, Gift, Check, AlertCircle } from "lucide-react";
import { useState, useEffect } from "react";

import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { useDashboardContext } from "@/lib/dashboard-context";

interface Transaction {
	id: string;
	createdAt: string;
	type:
		| "credit_topup"
		| "subscription_start"
		| "subscription_cancel"
		| "subscription_end";
	creditAmount: string | null;
	amount: string | null;
	status: "pending" | "completed" | "failed";
	description: string | null;
}

interface ReferralsClientProps {
	transactions: Transaction[];
	referredCount: number;
}

export function ReferralsClient({
	transactions,
	referredCount,
}: ReferralsClientProps) {
	const { selectedOrganization } = useDashboardContext();
	const [copied, setCopied] = useState(false);
	const [origin, setOrigin] = useState("https://llmgateway.io");

	useEffect(() => {
		setOrigin(window.location.origin);
	}, []);

	const totalTopUps = transactions
		.filter(
			(t) =>
				t.type === "credit_topup" && t.status === "completed" && t.creditAmount,
		)
		.reduce((sum, t) => sum + Number(t.creditAmount || 0), 0);

	const isEligible = totalTopUps >= 100;

	const referralLink = selectedOrganization
		? `${origin}/?ref=${selectedOrganization.id}`
		: "";

	const referralEarnings = selectedOrganization
		? Number(selectedOrganization.referralEarnings).toFixed(8)
		: "0.00";

	const copyToClipboard = async () => {
		await navigator.clipboard.writeText(referralLink);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between">
					<h2 className="text-3xl font-bold tracking-tight">Referrals</h2>
				</div>
				<div className="space-y-6">
					{!isEligible ? (
						<Card>
							<CardHeader>
								<CardTitle className="flex items-center gap-2">
									<AlertCircle className="h-5 w-5 text-yellow-500" />
									Not Eligible Yet
								</CardTitle>
								<CardDescription>
									You need to top up at least $100 in credits to become eligible
									for the referral program
								</CardDescription>
							</CardHeader>
							<CardContent>
								<div className="space-y-4">
									<div className="rounded-lg bg-muted p-4">
										<div className="flex justify-between items-center">
											<span className="text-sm text-muted-foreground">
												Your total top-ups
											</span>
											<span className="font-semibold">
												${totalTopUps.toFixed(2)}
											</span>
										</div>
										<div className="mt-2 h-2 rounded-full bg-background overflow-hidden">
											<div
												className="h-full bg-primary transition-all duration-300"
												style={{
													width: `${Math.min((totalTopUps / 100) * 100, 100)}%`,
												}}
											/>
										</div>
										<p className="mt-2 text-xs text-muted-foreground">
											${Math.max(0, 100 - totalTopUps).toFixed(2)} more to
											unlock referrals
										</p>
									</div>
									<p className="text-sm text-muted-foreground">
										Once eligible, you&apos;ll earn 1% of all LLM spending from
										users you refer. The credits are added directly to your
										account balance.
									</p>
								</div>
							</CardContent>
						</Card>
					) : (
						<>
							<Card>
								<CardHeader>
									<CardTitle className="flex items-center gap-2">
										<Gift className="h-5 w-5 text-primary" />
										Your Referral Link
									</CardTitle>
									<CardDescription>
										Share this link with others to earn referral credits
									</CardDescription>
								</CardHeader>
								<CardContent>
									<div className="space-y-4">
										<div className="flex gap-2">
											<div className="flex-1 rounded-md border bg-muted px-3 py-2 text-sm font-mono break-all">
												{referralLink}
											</div>
											<Button
												variant="outline"
												size="icon"
												onClick={copyToClipboard}
												className="shrink-0"
											>
												{copied ? (
													<Check className="h-4 w-4 text-green-500" />
												) : (
													<Copy className="h-4 w-4" />
												)}
											</Button>
										</div>
									</div>
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<CardTitle>Your Stats</CardTitle>
									<CardDescription>
										Referral performance and earnings
									</CardDescription>
								</CardHeader>
								<CardContent>
									<div className="grid gap-4 md:grid-cols-2">
										<div className="rounded-lg border p-4">
											<div className="text-sm text-muted-foreground">
												Users Referred
											</div>
											<div className="text-2xl font-bold">{referredCount}</div>
										</div>
										<div className="rounded-lg border p-4">
											<div className="text-sm text-muted-foreground">
												Total Earnings
											</div>
											<div className="text-2xl font-bold">
												${referralEarnings}
											</div>
										</div>
									</div>
									<p className="mt-4 text-sm text-muted-foreground">
										Lifetime stats from your referral program
									</p>
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<CardTitle>How It Works</CardTitle>
									<CardDescription>
										Earn credits by referring new users
									</CardDescription>
								</CardHeader>
								<CardContent>
									<div className="space-y-4">
										<div className="grid gap-4 md:grid-cols-3">
											<div className="rounded-lg border p-4">
												<div className="text-2xl font-bold text-primary">1</div>
												<h4 className="mt-2 font-semibold">Share Your Link</h4>
												<p className="mt-1 text-sm text-muted-foreground">
													Send your referral link to friends and colleagues
												</p>
											</div>
											<div className="rounded-lg border p-4">
												<div className="text-2xl font-bold text-primary">2</div>
												<h4 className="mt-2 font-semibold">They Sign Up</h4>
												<p className="mt-1 text-sm text-muted-foreground">
													When they create an account using your link
												</p>
											</div>
											<div className="rounded-lg border p-4">
												<div className="text-2xl font-bold text-primary">3</div>
												<h4 className="mt-2 font-semibold">Earn Credits</h4>
												<p className="mt-1 text-sm text-muted-foreground">
													Get 1% of their LLM spending as credits
												</p>
											</div>
										</div>
										<div className="rounded-lg bg-muted p-4">
											<h4 className="font-semibold">Important Notes</h4>
											<ul className="mt-2 space-y-1 text-sm text-muted-foreground list-disc list-inside">
												<li>
													Earnings are calculated after any discounts are
													applied
												</li>
												<li>Credits are added to your account automatically</li>
												<li>
													Referral credits can be used for LLM usage but cannot
													be paid out
												</li>
												<li>
													There is no limit to how many users you can refer
												</li>
											</ul>
										</div>
									</div>
								</CardContent>
							</Card>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

"use client";

import {
	AlertCircle,
	ArrowLeft,
	Check,
	Copy,
	DollarSign,
	Gift,
	Sparkles,
	Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { Button } from "@/lib/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/lib/components/dialog";
import { Slider } from "@/lib/components/slider";

import type { Organization } from "@/lib/types";
import type { ReactElement, ReactNode } from "react";

interface ReferralDialogProps {
	children: ReactNode;
	selectedOrganization: Organization | null;
}

export function ReferralDialog({
	children,
	selectedOrganization,
}: ReferralDialogProps) {
	const router = useRouter();
	const { buildOrgUrl } = useDashboardNavigation();
	const [open, setOpen] = useState(false);
	const [mode, setMode] = useState<"overview" | "simulation">("overview");
	const [origin, setOrigin] = useState<string>("https://llmgateway.io");
	const [copied, setCopied] = useState(false);
	const [referredTeams, setReferredTeams] = useState(5);
	const [avgMonthlySpend, setAvgMonthlySpend] = useState(500);

	useEffect(() => {
		if (typeof window !== "undefined") {
			setOrigin(window.location.origin);
		}
	}, []);

	if (!selectedOrganization) {
		return children as ReactElement;
	}

	const referralLink = `${origin}/?ref=${selectedOrganization.id}`;
	const referralEarnings =
		Number(selectedOrganization.referralEarnings ?? 0) || 0;

	const monthlyGoal = 100;
	const progressPercent =
		monthlyGoal > 0 ? Math.min((referralEarnings / monthlyGoal) * 100, 100) : 0;

	const estimatedCredits = referredTeams * avgMonthlySpend * 0.01;

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(referralLink);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// ignore
		}
	};

	const handleOpenChange = (isOpen: boolean) => {
		setOpen(isOpen);
		if (!isOpen) {
			setMode("overview");
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="sm:max-w-[480px] md:max-w-[560px]">
				{mode === "overview" ? (
					<>
						<DialogHeader className="items-center space-y-3">
							<div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
								<Gift className="h-8 w-8 text-primary" />
							</div>
							<DialogTitle className="text-center text-2xl font-bold">
								Invite &amp; earn credits
							</DialogTitle>
							<DialogDescription className="text-center text-sm">
								Earn{" "}
								<span className="font-semibold text-foreground">
									1% of all LLM spending
								</span>{" "}
								from every user you refer.
							</DialogDescription>
						</DialogHeader>

						<div className="mt-2 space-y-4">
							<div className="space-y-2">
								<div className="flex items-center justify-between text-xs text-muted-foreground">
									<span>This month</span>
									<span>Goal: ${monthlyGoal.toFixed(0)}</span>
								</div>
								<div className="relative h-4 overflow-hidden rounded-full bg-muted">
									<div className="absolute inset-0 bg-primary/20" />
									<div
										className="relative h-full rounded-full bg-primary"
										style={{ width: `${progressPercent}%` }}
									/>
									<div className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-primary-foreground/80">
										Track your monthly earnings
									</div>
								</div>
								<div className="flex items-center justify-between text-xs text-muted-foreground">
									<span>${referralEarnings.toFixed(2)}</span>
									<span>${monthlyGoal.toFixed(0)}+</span>
								</div>
							</div>

							<div className="space-y-2 rounded-xl border bg-muted/40 p-3">
								<div className="text-xs font-medium text-muted-foreground">
									Share your link
								</div>
								<div className="flex gap-2">
									<div className="flex-1 truncate rounded-md bg-background/80 px-3 py-2 text-xs font-mono">
										{referralLink}
									</div>
									<Button
										type="button"
										variant="outline"
										size="icon"
										onClick={handleCopy}
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

							<div className="space-y-2 rounded-xl border bg-muted/40 p-3 text-xs">
								<div className="mb-1 font-medium">How it works</div>
								<ul className="space-y-2">
									<li className="flex items-start gap-2">
										<Sparkles className="mt-[2px] h-3.5 w-3.5 text-primary" />
										<span>
											Top up at least{" "}
											<span className="font-semibold">$100</span> in credits on
											your organization to become eligible and access your
											unique referral link.
										</span>
									</li>
									<li className="flex items-start gap-2">
										<Users className="mt-[2px] h-3.5 w-3.5 text-primary" />
										<span>
											Copy your personalized referral link from the dashboard
											and share it with users and teams who could benefit from
											LLM Gateway.
										</span>
									</li>
									<li className="flex items-start gap-2">
										<DollarSign className="mt-[2px] h-3.5 w-3.5 text-primary" />
										<span>
											Automatically earn{" "}
											<span className="font-semibold">1% of their LLM </span>
											spending as credits. Track earnings in real-time from your
											dashboard.
										</span>
									</li>
								</ul>
							</div>

							<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="w-full sm:w-auto"
									onClick={() => setMode("simulation")}
								>
									<AlertCircle className="mr-2 h-4 w-4" />
									Run the numbers
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="w-full justify-center text-xs text-muted-foreground underline underline-offset-4 sm:w-auto"
									onClick={() => {
										router.push(buildOrgUrl("/org/referrals"));
										setOpen(false);
									}}
								>
									Manage referral settings
								</Button>
							</div>
						</div>
					</>
				) : (
					<>
						<DialogHeader className="items-start space-y-3">
							<div className="flex items-center gap-2">
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="h-7 w-7 -ml-1"
									onClick={() => setMode("overview")}
								>
									<ArrowLeft className="h-4 w-4" />
								</Button>
							</div>
							<DialogTitle className="text-xl font-bold">
								See your credits stack
							</DialogTitle>
							<DialogDescription className="text-sm">
								Estimate how much you could earn each month with your referral
								link.
							</DialogDescription>
						</DialogHeader>

						<div className="mt-2 space-y-6">
							<div className="rounded-xl border bg-muted/60 p-5 text-center">
								<div className="text-xs uppercase tracking-wide text-muted-foreground">
									Estimated monthly credits
								</div>
								<div className="mt-2 text-4xl font-bold">
									${estimatedCredits.toFixed(0)}
								</div>
								<div className="mt-1 text-xs text-muted-foreground">
									1% of referred users&apos; LLM spending
								</div>
							</div>

							<div className="space-y-4 text-xs">
								<div className="space-y-2">
									<div className="flex items-center justify-between">
										<span className="font-medium">Referred Users</span>
										<span>{referredTeams}</span>
									</div>
									<Slider
										min={0}
										max={50}
										step={1}
										value={[referredTeams]}
										onValueChange={([value]) =>
											setReferredTeams(typeof value === "number" ? value : 0)
										}
									/>
								</div>
								<div className="space-y-2">
									<div className="flex items-center justify-between">
										<span className="font-medium">
											Avg monthly spend per user
										</span>
										<span>${avgMonthlySpend}</span>
									</div>
									<Slider
										min={50}
										max={5000}
										step={50}
										value={[avgMonthlySpend]}
										onValueChange={([value]) =>
											setAvgMonthlySpend(typeof value === "number" ? value : 0)
										}
									/>
								</div>
							</div>

							<div className="rounded-lg border bg-muted/40 p-3 text-[11px] text-muted-foreground space-y-1">
								<div className="flex items-center gap-1 font-medium text-xs">
									<Sparkles className="h-3.5 w-3.5 text-primary" />
									<span>Example</span>
								</div>
								<p>
									{referredTeams} users × ${avgMonthlySpend.toFixed(0)} monthly
									spend × 1% = ${estimatedCredits.toFixed(0)} in credits every
									month.
								</p>
								<p>
									This is a simplified estimate. Actual credits depend on real
									usage and discounts.
								</p>
							</div>
						</div>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

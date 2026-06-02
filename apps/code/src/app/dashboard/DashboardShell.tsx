"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	BarChart3,
	Code,
	CreditCard,
	Loader2,
	LogOut,
	Settings,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { EmailVerificationBanner } from "@/components/EmailVerificationBanner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/useUser";
import { useAuth } from "@/lib/auth-client";
import { useAppConfig } from "@/lib/config";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import { plans } from "./plans";
import { useDevPlanStatus } from "./useDevPlanStatus";

import type { PlanTier } from "./types";
import type { DevPlanCycle } from "@llmgateway/shared";
import type { Route } from "next";

const InactivePlanChooser = dynamic(
	() => import("./components/InactivePlanChooser"),
);

const navItems: Array<{ label: string; href: Route; icon: typeof BarChart3 }> =
	[
		{ label: "Usage", href: "/dashboard" as Route, icon: BarChart3 },
		{ label: "Billing", href: "/dashboard/billing" as Route, icon: CreditCard },
		{ label: "Settings", href: "/dashboard/settings" as Route, icon: Settings },
	];

export default function DashboardShell({
	children,
}: {
	children: React.ReactNode;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const posthog = usePostHog();
	const { signOut } = useAuth();
	const config = useAppConfig();
	const { posthogKey } = config;
	const api = useApi();
	const queryClient = useQueryClient();

	const { user } = useUser({
		redirectTo: "/login?returnUrl=/dashboard",
		redirectWhen: "unauthenticated",
	});

	const { data: devPlanStatus, isLoading: statusLoading } = useDevPlanStatus();

	const subscribeMutation = api.useMutation("post", "/dev-plans/subscribe");
	const finalizeMutation = api.useMutation("post", "/dev-plans/finalize");

	const [subscribingTier, setSubscribingTier] = useState<PlanTier | null>(null);
	const [duplicateCardError, setDuplicateCardError] = useState<string | null>(
		null,
	);
	const finalizedSessions = useRef<Set<string>>(new Set());

	useEffect(() => {
		const sessionId = searchParams.get("setup_session_id");
		if (!sessionId || finalizedSessions.current.has(sessionId)) {
			return;
		}
		finalizedSessions.current.add(sessionId);

		const clearParam = () => {
			const params = new URLSearchParams(searchParams.toString());
			params.delete("setup_session_id");
			const query = params.toString();
			router.replace(query ? `/dashboard?${query}` : "/dashboard");
		};

		finalizeMutation
			.mutateAsync({ body: { sessionId } })
			.then((result) => {
				if (result?.status === "ok" || result?.status === "already_processed") {
					toast.success("DevPass activated");
					void queryClient.invalidateQueries({
						predicate: (query) => {
							const key = query.queryKey;
							return Array.isArray(key) && key[1] === "/dev-plans/status";
						},
					});
				}
			})
			.catch((error: unknown) => {
				const errCode =
					error && typeof error === "object" && "error" in error
						? (error as { error?: unknown }).error
						: undefined;
				if (errCode === "duplicate_card") {
					const msg =
						error && typeof error === "object" && "message" in error
							? (error as { message?: unknown }).message
							: undefined;
					setDuplicateCardError(
						typeof msg === "string" && msg.length > 0
							? msg
							: "This card is already associated with another DevPass account. Please use a different payment method.",
					);
				} else {
					const apiMessage =
						error && typeof error === "object" && "message" in error
							? (error as { message?: unknown }).message
							: undefined;
					toast.error(
						typeof apiMessage === "string" && apiMessage.length > 0
							? apiMessage
							: "Failed to activate DevPass",
					);
				}
			})
			.finally(() => {
				clearParam();
			});
	}, [searchParams, finalizeMutation, queryClient, router]);

	const handleSubscribe = async (
		tier: PlanTier,
		cycle: DevPlanCycle = "monthly",
	): Promise<void> => {
		setSubscribingTier(tier);
		try {
			const result = await subscribeMutation.mutateAsync({
				body: { tier, cycle },
			});

			if (!result?.checkoutUrl) {
				toast.error("Failed to start subscription");
				return;
			}

			if (posthogKey) {
				posthog.capture("dev_plan_subscribe_started", { tier, cycle });
			}
			window.location.href = result.checkoutUrl;
		} catch (error: unknown) {
			const apiMessage =
				error && typeof error === "object" && "message" in error
					? (error as { message?: unknown }).message
					: undefined;
			toast.error(
				typeof apiMessage === "string" && apiMessage.length > 0
					? apiMessage
					: "Failed to start subscription",
			);
		} finally {
			setSubscribingTier(null);
		}
	};

	const handleSignOut = async () => {
		await signOut();
		router.push("/");
	};

	const hasActivePlan =
		devPlanStatus?.devPlan && devPlanStatus.devPlan !== "none";
	const currentPlanName = devPlanStatus?.devPlan?.toUpperCase() ?? "";

	return (
		<div className="min-h-screen bg-background">
			<AlertDialog
				open={duplicateCardError !== null}
				onOpenChange={(open) => {
					if (!open) {
						setDuplicateCardError(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Card already in use</AlertDialogTitle>
						<AlertDialogDescription>
							{duplicateCardError ??
								"This card is already associated with another DevPass account."}
							<br />
							<br />
							You were not charged. Please try again with a different payment
							method.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction onClick={() => setDuplicateCardError(null)}>
							Got it
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Header */}
			<header className="border-b border-border/50">
				<div className="container mx-auto flex items-center justify-between px-4 py-3">
					<div className="flex items-center gap-6">
						<Link href="/" className="flex items-center gap-2">
							<Code className="h-5 w-5" />
							<span className="font-semibold">DevPass</span>
						</Link>
						{hasActivePlan && (
							<span className="hidden sm:inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium">
								{currentPlanName}
							</span>
						)}
					</div>
					<div className="flex items-center gap-3">
						<span className="hidden sm:block text-sm text-muted-foreground">
							{user?.email}
						</span>
						<Button
							variant="ghost"
							size="sm"
							onClick={handleSignOut}
							className="gap-1.5 text-muted-foreground"
						>
							<LogOut className="h-3.5 w-3.5" />
							<span className="hidden sm:inline">Sign out</span>
						</Button>
					</div>
				</div>
			</header>

			<EmailVerificationBanner />

			{statusLoading ? (
				<div className="flex min-h-[60vh] items-center justify-center">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			) : hasActivePlan ? (
				<div className="container mx-auto flex flex-col gap-8 px-4 py-8 lg:flex-row">
					{/* Sidebar */}
					<aside className="lg:w-56 lg:shrink-0">
						<nav className="flex gap-1 overflow-x-auto lg:sticky lg:top-8 lg:flex-col lg:overflow-visible">
							{navItems.map((item) => {
								const isActive = pathname === item.href;
								const Icon = item.icon;
								return (
									<Link
										key={item.href}
										href={item.href}
										prefetch
										className={cn(
											"flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
											isActive
												? "bg-foreground/5 text-foreground"
												: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
										)}
									>
										<Icon className="h-4 w-4" />
										{item.label}
									</Link>
								);
							})}
						</nav>
					</aside>

					{/* Page content */}
					<main className="min-w-0 flex-1">{children}</main>
				</div>
			) : (
				<main className="container mx-auto max-w-6xl px-4 py-8">
					<div className="space-y-10">
						<div className="mx-auto max-w-md text-center pt-4">
							<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
								<Code className="h-6 w-6 text-muted-foreground" />
							</div>
							<h1 className="text-xl font-semibold mb-2">
								Choose your Dev Plan
							</h1>
							<p className="text-sm text-muted-foreground leading-relaxed">
								Pick a plan to get your API key and start coding with 200+
								models. Every dollar gives you 3x in usage.
							</p>
						</div>

						<InactivePlanChooser
							plans={plans}
							subscribingTier={subscribingTier}
							onSubscribe={handleSubscribe}
							initialCycle={
								searchParams.get("cycle") === "annual" ? "annual" : "monthly"
							}
						/>
					</div>
				</main>
			)}
		</div>
	);
}

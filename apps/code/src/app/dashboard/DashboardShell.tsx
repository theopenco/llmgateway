"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	BarChart3,
	Code,
	CreditCard,
	Loader2,
	LogOut,
	Settings,
	UserRound,
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
import { Skeleton } from "@/components/ui/skeleton";
import { useUser } from "@/hooks/useUser";
import { useAuth } from "@/lib/auth-client";
import { useAppConfig } from "@/lib/config";
import { useApi } from "@/lib/fetch-client";
import { trackPurchaseConversion } from "@/lib/google-tag";
import { useStripe } from "@/lib/stripe";
import { cn } from "@/lib/utils";

import { plans } from "./plans";
import { useDevPlanStatus } from "./useDevPlanStatus";

import type { PlanTier } from "./types";
import type { DevPlanStatus } from "./useDevPlanStatus";
import type { UserMe } from "@/hooks/useUser";
import type { Route } from "next";

const InactivePlanChooser = dynamic(
	() => import("./components/InactivePlanChooser"),
);

const navItems: Array<{ label: string; href: Route; icon: typeof BarChart3 }> =
	[
		{ label: "Usage", href: "/dashboard" as Route, icon: BarChart3 },
		{ label: "Billing", href: "/dashboard/billing" as Route, icon: CreditCard },
		{ label: "Profile", href: "/profile" as Route, icon: UserRound },
		{ label: "Settings", href: "/dashboard/settings" as Route, icon: Settings },
	];

type SetupActivationStatus =
	| "loading_stripe"
	| "finalizing"
	| "authenticating"
	| "processing"
	| "success"
	| "error";

const setupActivationCopy: Record<
	SetupActivationStatus,
	{ title: string; description: string }
> = {
	loading_stripe: {
		title: "Preparing payment",
		description: "Loading secure payment confirmation.",
	},
	finalizing: {
		title: "Activating DevPass",
		description: "Creating your subscription and checking payment status.",
	},
	authenticating: {
		title: "Confirming payment",
		description: "Complete the secure authentication prompt to continue.",
	},
	processing: {
		title: "Payment is processing",
		description:
			"DevPass will activate as soon as Stripe confirms the payment.",
	},
	success: {
		title: "DevPass activated",
		description: "Refreshing your dashboard.",
	},
	error: {
		title: "Activation failed",
		description: "Refresh this page to retry DevPass activation.",
	},
};

const wait = async (ms: number, signal: AbortSignal) => {
	if (signal.aborted) {
		throw new DOMException("Aborted", "AbortError");
	}

	await new Promise<void>((resolve, reject) => {
		const timeoutId = window.setTimeout(() => {
			signal.removeEventListener("abort", handleAbort);
			resolve();
		}, ms);
		function handleAbort() {
			window.clearTimeout(timeoutId);
			reject(new DOMException("Aborted", "AbortError"));
		}
		signal.addEventListener("abort", handleAbort, { once: true });
	});
};

export default function DashboardShell({
	children,
	initialUser,
	initialDevPlanStatus,
}: {
	children: React.ReactNode;
	initialUser?: UserMe | null;
	initialDevPlanStatus?: DevPlanStatus | null;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const posthog = usePostHog();
	const { signOut } = useAuth();
	const config = useAppConfig();
	const { posthogKey, googleAdsPurchaseConversion } = config;
	const api = useApi();
	const { stripe, isLoading: stripeLoading } = useStripe();
	const queryClient = useQueryClient();

	const { user } = useUser({
		redirectTo: "/login?returnUrl=/dashboard",
		redirectWhen: "unauthenticated",
		initialData: initialUser,
	});

	const { data: devPlanStatus, isLoading: statusLoading } =
		useDevPlanStatus(initialDevPlanStatus);

	const subscribeMutation = api.useMutation("post", "/dev-plans/subscribe");
	const finalizeMutation = api.useMutation("post", "/dev-plans/finalize");
	const setupSessionId = searchParams.get("setup_session_id");

	const [subscribingTier, setSubscribingTier] = useState<PlanTier | null>(null);
	const [duplicateCardError, setDuplicateCardError] = useState<string | null>(
		null,
	);
	const [setupActivationStatus, setSetupActivationStatus] =
		useState<SetupActivationStatus | null>(null);
	const activeSetupSession = useRef<string | null>(null);
	const finalizeDevPlanRef = useRef(finalizeMutation.mutateAsync);
	const purchaseTrackedSession = useRef<string | null>(null);
	const devPlanStatusRef = useRef(devPlanStatus);
	const userEmailRef = useRef(user?.email);

	useEffect(() => {
		finalizeDevPlanRef.current = finalizeMutation.mutateAsync;
	}, [finalizeMutation.mutateAsync]);

	useEffect(() => {
		devPlanStatusRef.current = devPlanStatus;
	}, [devPlanStatus]);

	useEffect(() => {
		userEmailRef.current = user?.email;
	}, [user?.email]);

	useEffect(() => {
		const sessionId = setupSessionId;
		if (!sessionId) {
			setSetupActivationStatus(null);
			return;
		}
		if (stripeLoading) {
			setSetupActivationStatus("loading_stripe");
			return;
		}
		if (activeSetupSession.current === sessionId) {
			return;
		}
		activeSetupSession.current = sessionId;
		setSetupActivationStatus("finalizing");
		const abortController = new AbortController();
		const { signal } = abortController;
		let shouldClearSetupParam = true;

		const clearParam = () => {
			const params = new URLSearchParams(searchParams.toString());
			params.delete("setup_session_id");
			const query = params.toString();
			router.replace(query ? `/dashboard?${query}` : "/dashboard");
		};

		const finalizeOnce = async () => {
			return await finalizeDevPlanRef.current({
				body: { sessionId },
			});
		};

		const waitForFinalization = async (
			initialResult: Awaited<ReturnType<typeof finalizeOnce>>,
		) => {
			let result = initialResult;
			for (let attempt = 0; attempt < 60; attempt++) {
				if (result?.status !== "payment_pending") {
					return result;
				}
				setSetupActivationStatus("processing");
				await wait(2000, signal);
				result = await finalizeOnce();
			}
			return result;
		};

		const finalizeDevPlan = async () => {
			const result = await finalizeOnce();
			if (result?.status === "requires_action") {
				if (!stripe) {
					throw new Error("Stripe is not ready. Please refresh and try again.");
				}
				setSetupActivationStatus("authenticating");
				const confirmation = await stripe.confirmCardPayment(
					result.clientSecret,
					result.paymentMethodId
						? { payment_method: result.paymentMethodId }
						: undefined,
				);
				if (confirmation.error) {
					throw new Error(
						confirmation.error.message ?? "Payment authentication failed",
					);
				}

				setSetupActivationStatus("processing");
				return await waitForFinalization(await finalizeOnce());
			}
			return await waitForFinalization(result);
		};

		finalizeDevPlan()
			.then((result) => {
				if (signal.aborted) {
					return;
				}
				if (result?.status === "ok" || result?.status === "already_processed") {
					setSetupActivationStatus("success");
					toast.success("DevPass activated");
					if (purchaseTrackedSession.current !== sessionId) {
						purchaseTrackedSession.current = sessionId;
						const tier = devPlanStatusRef.current?.devPlan;
						const planData =
							tier && tier !== "none"
								? plans.find((plan) => plan.tier === tier)
								: undefined;
						trackPurchaseConversion({
							email: userEmailRef.current ?? "",
							value: planData?.price,
							currency: "USD",
							transactionId: sessionId,
							sendTo: googleAdsPurchaseConversion,
						});
					}
					void queryClient.invalidateQueries({
						predicate: (query) => {
							const key = query.queryKey;
							return Array.isArray(key) && key[1] === "/dev-plans/status";
						},
					});
				} else if (result?.status === "payment_pending") {
					shouldClearSetupParam = false;
					setSetupActivationStatus("processing");
					toast.info("Payment is processing. DevPass will activate shortly.");
				}
			})
			.catch((error: unknown) => {
				if (signal.aborted) {
					return;
				}
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
					shouldClearSetupParam = false;
					setSetupActivationStatus("error");
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
				if (!signal.aborted && shouldClearSetupParam) {
					clearParam();
				}
				if (activeSetupSession.current === sessionId) {
					activeSetupSession.current = null;
				}
			});

		return () => {
			abortController.abort();
			if (activeSetupSession.current === sessionId) {
				activeSetupSession.current = null;
			}
		};
	}, [
		setupSessionId,
		searchParams,
		queryClient,
		router,
		stripe,
		stripeLoading,
		googleAdsPurchaseConversion,
	]);

	const handleSubscribe = async (tier: PlanTier): Promise<void> => {
		setSubscribingTier(tier);
		try {
			const result = await subscribeMutation.mutateAsync({
				body: { tier },
			});

			if (!result?.checkoutUrl) {
				toast.error("Failed to start subscription");
				return;
			}

			if (posthogKey) {
				posthog.capture("dev_plan_subscribe_started", { tier });
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
	const activeSetupActivationStatus =
		setupActivationStatus ?? (setupSessionId ? "finalizing" : null);
	const activeSetupActivationCopy = activeSetupActivationStatus
		? setupActivationCopy[activeSetupActivationStatus]
		: null;

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

			{activeSetupActivationCopy ? (
				<main className="container mx-auto flex min-h-[calc(100vh-120px)] max-w-3xl items-center justify-center px-4 py-12">
					<div className="w-full rounded-xl border bg-background p-8 text-center shadow-sm sm:p-12">
						<div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-muted">
							<Loader2
								className={cn(
									"h-10 w-10 text-foreground",
									activeSetupActivationStatus !== "error" && "animate-spin",
								)}
							/>
						</div>
						<h1 className="text-2xl font-semibold sm:text-3xl">
							{activeSetupActivationCopy.title}
						</h1>
						<p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground sm:text-base">
							{activeSetupActivationCopy.description}
						</p>
					</div>
				</main>
			) : statusLoading ? (
				<div className="container mx-auto flex flex-col gap-8 px-4 py-8 lg:flex-row">
					<aside className="lg:w-56 lg:shrink-0">
						<div className="flex gap-1 lg:flex-col">
							{navItems.map((item) => (
								<Skeleton key={item.href} className="h-9 w-full lg:w-full" />
							))}
						</div>
					</aside>
					<main className="min-w-0 flex-1 space-y-10">
						<div className="space-y-2">
							<Skeleton className="h-6 w-32" />
							<Skeleton className="h-4 w-64" />
						</div>
						<Skeleton className="h-40 w-full rounded-xl" />
						<Skeleton className="h-32 w-full rounded-xl" />
					</main>
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
						/>
					</div>
				</main>
			)}
		</div>
	);
}

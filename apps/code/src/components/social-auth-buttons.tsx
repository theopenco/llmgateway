"use client";

import { WebAuthnAbortService } from "@simplewebauthn/browser";
import { Github, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-client";
import { useAppConfig } from "@/lib/config";

type SocialProvider = "github" | "google";

const PROVIDER_LABELS: Record<SocialProvider, string> = {
	github: "GitHub",
	google: "Google",
};

// Remembers which provider started the OAuth round trip so the login page can
// offer to retry it as an explicit sign-up when no account exists yet.
const PENDING_PROVIDER_KEY = "llmgateway-social-signin-provider";

interface SocialAuthButtonsProps {
	isLoading: boolean;
	setIsLoading: (loading: boolean) => void;
	callbackPath: string;
	errorCallbackPath: string;
	newUserCallbackPath?: string;
	/**
	 * Explicitly allow creating a new account (signup pages). Without it, social
	 * sign-in only signs in existing users: when no account matches, the OAuth
	 * callback redirects back with `?error=signup_disabled` and a confirmation
	 * dialog asks the user whether they want to create a new account.
	 */
	requestSignUp?: boolean;
}

export function SocialAuthButtons({
	isLoading,
	setIsLoading,
	callbackPath,
	errorCallbackPath,
	newUserCallbackPath,
	requestSignUp,
}: SocialAuthButtonsProps) {
	const router = useRouter();
	const { signIn } = useAuth();
	const { githubAuth, googleAuth } = useAppConfig();

	// Captured lazily during the first render, before any effect strips
	// `?error=` from the URL. `provider: null` means the round trip that failed
	// with `signup_disabled` can't be retried (no stored provider), so the dialog
	// sends the user to the signup page instead of re-running the same provider.
	const [signupDisabledState, setSignupDisabledState] = useState<{
		provider: SocialProvider | null;
	} | null>(() => {
		if (typeof window === "undefined" || requestSignUp) {
			return null;
		}
		const params = new URLSearchParams(window.location.search);
		if (params.get("error") !== "signup_disabled") {
			return null;
		}
		const stored = sessionStorage.getItem(PENDING_PROVIDER_KEY);
		return {
			provider: stored === "github" || stored === "google" ? stored : null,
		};
	});

	useEffect(() => {
		if (!signupDisabledState) {
			return;
		}
		sessionStorage.removeItem(PENDING_PROVIDER_KEY);
		const params = new URLSearchParams(window.location.search);
		if (params.get("error") === "signup_disabled") {
			params.delete("error");
			const query = params.toString();
			router.replace(window.location.pathname + (query ? `?${query}` : ""));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	if (!githubAuth && !googleAuth) {
		return null;
	}

	async function handleSocialSignIn(
		provider: SocialProvider,
		options?: { requestSignUp?: boolean },
	) {
		setIsLoading(true);
		// Abort the pending conditional (autofill) passkey ceremony so it can't pop a
		// native passkey/biometric prompt after a successful social sign-in + redirect.
		WebAuthnAbortService.cancelCeremony();
		try {
			sessionStorage.setItem(PENDING_PROVIDER_KEY, provider);
			const origin = location.protocol + "//" + location.host;
			const res = await signIn.social({
				provider,
				requestSignUp: requestSignUp || options?.requestSignUp,
				callbackURL: origin + callbackPath,
				errorCallbackURL: origin + errorCallbackPath,
				// New accounts land with a signup_method param so DashboardShell can
				// fire the signup analytics + ads conversion that the email path
				// fires inline (OAuth redirects away before we could capture here).
				newUserCallbackURL: newUserCallbackPath
					? origin +
						newUserCallbackPath +
						(newUserCallbackPath.includes("?") ? "&" : "?") +
						"signup_method=" +
						provider
					: undefined,
			});
			if (res?.error) {
				toast.error(res.error.message ?? `Failed to sign in with ${provider}`, {
					style: {
						backgroundColor: "var(--destructive)",
						color: "var(--destructive-foreground)",
					},
				});
			}
		} finally {
			setIsLoading(false);
		}
	}

	const confirmProvider = signupDisabledState?.provider ?? null;

	return (
		<>
			<AlertDialog
				open={Boolean(signupDisabledState)}
				onOpenChange={(open) => {
					if (!open) {
						setSignupDisabledState(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>No account found</AlertDialogTitle>
						<AlertDialogDescription>
							{confirmProvider
								? `There is no account for the ${PROVIDER_LABELS[confirmProvider]} login you used. You need to sign up first — we can create your account with that ${PROVIDER_LABELS[confirmProvider]} login right now.`
								: "There is no account for the login you used. You need to sign up first to create one."}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (confirmProvider) {
									void handleSocialSignIn(confirmProvider, {
										requestSignUp: true,
									});
								} else {
									router.push("/signup");
								}
								setSignupDisabledState(null);
							}}
						>
							{confirmProvider
								? `Sign up with ${PROVIDER_LABELS[confirmProvider]}`
								: "Go to sign up"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<div className="grid gap-3 sm:grid-cols-2">
				{githubAuth && (
					<Button
						onClick={() => handleSocialSignIn("github")}
						variant="outline"
						className="w-full"
						disabled={isLoading}
					>
						{isLoading ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<Github className="mr-2 h-4 w-4" />
						)}
						GitHub
					</Button>
				)}
				{googleAuth && (
					<Button
						onClick={() => handleSocialSignIn("google")}
						variant="outline"
						className="w-full"
						disabled={isLoading}
					>
						{isLoading ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
								<path
									d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
									fill="#4285F4"
								/>
								<path
									d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
									fill="#34A853"
								/>
								<path
									d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
									fill="#FBBC05"
								/>
								<path
									d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
									fill="#EA4335"
								/>
							</svg>
						)}
						Google
					</Button>
				)}
			</div>
		</>
	);
}

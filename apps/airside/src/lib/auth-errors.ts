"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

// Error codes emitted by better-auth's social OAuth callback as the `?error=`
// query param. The callback derives them from `result.error.split(" ").join("_")`
// (see better-auth dist/api/routes/callback.mjs and dist/oauth2/link-account.mjs).
const authErrorMessages: Record<string, string> = {
	account_not_linked:
		"An account with this email already exists. Please sign in with your email and password, or use the provider you originally signed up with.",
	account_already_linked_to_different_user:
		"This provider account is already linked to a different user.",
	unable_to_link_account:
		"We couldn't link this account. Please try a different sign-in method.",
	signup_disabled:
		"No account exists for that sign-in. Please sign up first to create one.",
	unable_to_create_user: "We couldn't create your account. Please try again.",
	unable_to_create_session:
		"We couldn't start your session. Please try signing in again.",
	email_not_found:
		"Your provider didn't share an email address, which is required to sign in.",
	unable_to_get_user_info:
		"We couldn't retrieve your account details from the provider. Please try again.",
	oauth_provider_not_found: "This sign-in provider is not available.",
	invalid_code: "Sign-in failed. Please try again.",
	no_code: "Sign-in was interrupted. Please try again.",
	no_callback_url:
		"Sign-in failed due to a misconfiguration. Please try again.",
	invalid_callback_request: "Sign-in failed. Please try again.",
};

export function getAuthErrorMessage(code: string | null | undefined): string {
	if (!code) {
		return "An unknown error occurred during sign-in. Please try again.";
	}
	return (
		authErrorMessages[code] ??
		"An error occurred during sign-in. Please try again."
	);
}

/**
 * Surfaces the `?error=` code a failed OAuth callback redirects back with, then
 * strips it from the URL so a reload doesn't repeat it. Without this the user
 * silently lands back on the login page as if nothing happened.
 *
 * `ignoredCodes` is for codes a page renders itself — login pages pass
 * `signup_disabled`, which SocialAuthButtons turns into a "you need to sign up"
 * dialog offering to create the account.
 */
export function useAuthErrorToast(ignoredCodes: string[] = []): void {
	const router = useRouter();
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const error = params.get("error");
		if (!error || ignoredCodes.includes(error)) {
			return;
		}
		toast.error(getAuthErrorMessage(error), {
			style: {
				backgroundColor: "var(--destructive)",
				color: "var(--destructive-foreground)",
			},
		});
		params.delete("error");
		const query = params.toString();
		router.replace(window.location.pathname + (query ? `?${query}` : ""));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [router]);
}

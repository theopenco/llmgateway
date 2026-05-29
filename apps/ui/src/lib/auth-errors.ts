const authErrorMessages: Record<string, string> = {
	account_not_linked:
		"An account with this email already exists. Please sign in with your email and password, or use the provider you originally signed up with.",
	signup_disabled: "Sign ups are currently disabled.",
	unable_to_create_user: "We couldn't create your account. Please try again.",
	email_not_verified:
		"Please verify your email address before signing in. Check your inbox for the verification link.",
	account_deactivated:
		"Your account has been deactivated. Please contact support.",
	state_mismatch: "Your sign-in session expired. Please try signing in again.",
	please_restart_the_process:
		"Something went wrong during sign-in. Please try again.",
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

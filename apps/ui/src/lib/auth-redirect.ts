import { getSafeRedirectPath } from "@llmgateway/shared/safe-redirect";

const validationOrigin = "https://llmgateway.invalid";

/** Keep authentication callbacks on the current application origin. */
export function getAuthRedirect(target: string | null | undefined): string {
	return getSafeRedirectPath(target, "/dashboard");
}

export function getAuthPagePath(
	page: "/login" | "/signup" | "/onboarding",
	target: string,
) {
	const redirect = getAuthRedirect(target);
	return redirect === "/dashboard"
		? page
		: `${page}?${new URLSearchParams({ redirect })}`;
}

/** Device approval is independent of completing dashboard onboarding. */
export function isCliAuthRedirect(target: string): boolean {
	return ["/connect/device", "/connect/cli"].includes(
		new URL(getAuthRedirect(target), validationOrigin).pathname,
	);
}

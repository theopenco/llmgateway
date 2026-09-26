const validationOrigin = "https://llmgateway.invalid";

/** Keep authentication callbacks on the current application origin. */
export function getAuthRedirect(target: string | null | undefined): string {
	if (
		!target?.startsWith("/") ||
		target.startsWith("//") ||
		target.includes("\\")
	) {
		return "/dashboard";
	}
	try {
		const url = new URL(target, validationOrigin);
		return url.origin === validationOrigin
			? `${url.pathname}${url.search}${url.hash}`
			: "/dashboard";
	} catch {
		return "/dashboard";
	}
}

export function getAuthPagePath(page: "/login" | "/signup", target: string) {
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

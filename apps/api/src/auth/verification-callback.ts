export function verificationCallback(
	verificationUrl: string,
	callbackBase: string,
) {
	const fallback = `${callbackBase}/dashboard?emailVerified=true`;
	const requested = new URL(verificationUrl).searchParams.get("callbackURL");
	if (!requested || requested === "/") {
		return fallback;
	}
	try {
		const target = new URL(requested, callbackBase);
		return target.origin === new URL(callbackBase).origin &&
			!target.username &&
			!target.password
			? target.toString()
			: fallback;
	} catch {
		return fallback;
	}
}

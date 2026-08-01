export function inferNameFromEmail(email: string): string {
	const localPart = email.split("@")[0] ?? "";
	const cleaned = localPart.replace(/\+.*$/, "");
	const tokens = cleaned
		.split(/[._-]+/)
		.map((token) => token.trim())
		.filter((token) => token.length > 0);

	if (tokens.length === 0) {
		return "";
	}

	return tokens
		.map(
			(token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase(),
		)
		.join(" ");
}

export function resolveSignupName(
	name: string | null | undefined,
	email: string,
): string {
	const trimmed = name?.trim();
	if (trimmed) {
		return trimmed;
	}
	return inferNameFromEmail(email);
}

/**
 * How an account was created, read from the auth route that created the user:
 * `email`, `sso`, `scim`, or the OAuth provider id (`google`, `github`).
 */
export function resolveSignupMethod(path: string | null | undefined): string {
	if (!path) {
		return "unknown";
	}
	if (path.startsWith("/sign-up/email")) {
		return "email";
	}
	if (path.startsWith("/sso/")) {
		return "sso";
	}
	if (path.startsWith("/scim/")) {
		return "scim";
	}
	const social = /^\/(?:oauth2\/)?callback\/([a-z0-9_-]+)/i.exec(path);
	return social ? social[1].toLowerCase() : "other";
}

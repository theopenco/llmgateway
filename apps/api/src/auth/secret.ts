const DEV_AUTH_SECRET = "dev-secret-key-must-be-32-chars!";

// Defaults and placeholders published in this repository's code, docs and
// deployment templates. Anyone can forge sessions signed with these.
const PUBLIC_AUTH_SECRETS = new Set([
	DEV_AUTH_SECRET,
	"your-secret",
	"your-secret-key",
	"your-secret-key-here",
	"your-secret-key-here-must-be-32+",
	"change-me-to-a-random-32-char-secret",
]);

/** better-auth signing secret; fails closed in production. */
export function getAuthSecret(): string {
	const secret = process.env.AUTH_SECRET?.trim();
	if (process.env.NODE_ENV !== "production") {
		return secret || DEV_AUTH_SECRET;
	}
	if (!secret) {
		throw new Error("AUTH_SECRET is required in production");
	}
	if (PUBLIC_AUTH_SECRETS.has(secret)) {
		throw new Error(
			"AUTH_SECRET is set to a publicly known placeholder; generate a random secret",
		);
	}
	return secret;
}

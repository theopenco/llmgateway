// samlify (used by the @better-auth/sso SAML flow) emits a hardcoded
// `console.warn` every time it constructs an IdP from field config that has no
// SingleLogoutService endpoint:
//   "Construct identity  provider - missing endpoint of SingleLogoutService"
// We register IdPs from `entryPoint`/`cert` fields and do not use SAML Single
// Logout, so this fires on every SSO sign-in and every SP-metadata fetch. Node
// writes `console.warn` to stderr, which Cloud Logging classifies as ERROR, so
// the benign notice floods the error logs. Drop exactly that one message and
// leave every other warning untouched.

const SAMLIFY_SLO_WARNING = "missing endpoint of SingleLogoutService";

let patched = false;

export function silenceSamlifySloWarning(): void {
	if (patched) {
		return;
	}
	patched = true;

	// eslint-disable-next-line no-console -- intentional interception of samlify's raw console.warn
	const original = console.warn.bind(console);
	// eslint-disable-next-line no-console -- see above
	console.warn = (...args: unknown[]): void => {
		if (typeof args[0] === "string" && args[0].includes(SAMLIFY_SLO_WARNING)) {
			return;
		}
		original(...args);
	};
}

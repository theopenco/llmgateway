import { betterAuth } from "better-auth";
import { passkey } from "better-auth/plugins/passkey";

const apiUrl = process.env.API_URL || "http://localhost:4002";
const cookieDomain = process.env.COOKIE_DOMAIN || "localhost";
const uiUrl = process.env.UI_URL || "http://localhost:3002";
const originUrls =
	process.env.ORIGIN_URL || "http://localhost:3002,http://localhost:4002";

export const authConfig = {
	advanced: {
		crossSubDomainCookies: {
			enabled: true,
			domain: cookieDomain,
		},
		defaultCookieAttributes: {
			domain: cookieDomain,
		},
	},
	session: {
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60,
		},
		expiresIn: 60 * 60 * 24 * 30, // 30 days
		updateAge: 60 * 60 * 24, // 1 day (every 1 day the session expiration is updated)
	},
	basePath: "/auth",
	trustedOrigins: originUrls.split(","),
	plugins: [
		passkey({
			rpID: process.env.PASSKEY_RP_ID || "localhost",
			rpName: process.env.PASSKEY_RP_NAME || "LLMGateway",
			origin: uiUrl,
		}),
	],
	emailAndPassword: {
		enabled: true,
	},
	baseURL: apiUrl || "http://localhost:4002",
};

export const auth = betterAuth(authConfig);

export interface Variables {
	user: typeof auth.$Infer.Session.user | null;
	session: typeof auth.$Infer.Session.session | null;
	traceId?: string;
	spanId?: string;
}

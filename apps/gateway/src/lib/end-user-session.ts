/**
 * Embeddable SDK: shared helpers for billing requests authenticated with an
 * ephemeral end-user session token (`es_…`) to the bound wallet instead of the
 * developer's organization credits.
 *
 * The approach (see apps/gateway/src/chat/chat.ts for the canonical use): an
 * ephemeral session presents an *effective* project (forced `credits` mode) and
 * organization (credits mirror the wallet balance), so all existing credit
 * gating bills the wallet. The log's `endCustomerWalletId` (stamped from the api
 * key in create-log-entry) redirects the worker's debit to that wallet.
 */
import { HTTPException } from "hono/http-exception";

import { findWalletById } from "./cached-queries.js";

import type { InferSelectModel } from "@llmgateway/db";
import type {
	apiKey as apiKeyTable,
	organization as organizationTable,
	project as projectTable,
	wallet as walletTable,
} from "@llmgateway/db";
import type { Context } from "hono";

type ApiKey = InferSelectModel<typeof apiKeyTable>;
type Project = InferSelectModel<typeof projectTable>;
type Organization = InferSelectModel<typeof organizationTable>;
type Wallet = InferSelectModel<typeof walletTable>;

/**
 * Validate an ephemeral session key and load its wallet. Returns null for normal
 * developer keys. Throws on expired / unbound / frozen sessions.
 */
export async function loadEndUserWallet(
	apiKey: ApiKey,
): Promise<Wallet | null> {
	if (apiKey.keyType !== "ephemeral_session") {
		return null;
	}
	if (!apiKey.expiresAt || apiKey.expiresAt.getTime() < Date.now()) {
		throw new HTTPException(401, {
			message:
				"Ephemeral session expired. Mint a fresh session token from your backend.",
		});
	}
	if (!apiKey.endCustomerWalletId) {
		throw new HTTPException(500, {
			message: "Session token is not bound to a wallet",
		});
	}
	const wallet = await findWalletById(apiKey.endCustomerWalletId);
	if (!wallet || wallet.status !== "active") {
		throw new HTTPException(402, {
			message: "End-user wallet not found or frozen",
		});
	}
	return wallet;
}

/**
 * Defense-in-depth origin allowlist: if the project configured allowedOrigins,
 * reject browser requests from other origins.
 */
export function assertOriginAllowed(
	c: Pick<Context, "req">,
	project: Project,
): void {
	const origin = c.req.header("Origin");
	const allowed = project.allowedOrigins;
	if (origin && allowed && allowed.length > 0 && !allowed.includes(origin)) {
		throw new HTTPException(403, {
			message: "Origin not allowed for this project",
		});
	}
}

/** Force credits mode for an end-user session (never use the developer's BYO keys). */
export function withCreditsMode(project: Project): Project {
	return { ...project, mode: "credits" };
}

/**
 * Present the wallet balance as the organization's credits so downstream credit
 * gating evaluates the wallet, not the developer's org. Dev-plan credits are
 * zeroed so they can't subsidize end-user traffic. The real org row is untouched
 * — the worker debits the wallet.
 */
export function withWalletCredits(
	organization: Organization,
	wallet: Wallet,
): Organization {
	return {
		...organization,
		credits: wallet.balance,
		devPlan: "none",
		devPlanCreditsLimit: "0",
		devPlanCreditsUsed: "0",
	};
}

/**
 * Convenience composition for endpoints that load project + organization up
 * front and then run credit checks (embeddings, moderations). Returns the
 * effective project/organization plus the wallet (null for normal keys).
 */
export async function applyEndUserSession(
	c: Pick<Context, "req">,
	apiKey: ApiKey,
	project: Project,
	organization: Organization,
): Promise<{
	project: Project;
	organization: Organization;
	wallet: Wallet | null;
}> {
	const wallet = await loadEndUserWallet(apiKey);
	if (!wallet) {
		return { project, organization, wallet: null };
	}
	assertOriginAllowed(c, project);
	return {
		project: withCreditsMode(project),
		organization: withWalletCredits(organization, wallet),
		wallet,
	};
}

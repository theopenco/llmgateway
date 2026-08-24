import { db, tables } from "@llmgateway/db";

import type Stripe from "stripe";

export type ThreeDSecureRequest =
	Stripe.PaymentIntentCreateParams.PaymentMethodOptions.Card.RequestThreeDSecure;

/**
 * The levels we ever request. Stripe also accepts `automatic`, but that is its
 * default and sending it explicitly buys nothing, so it is never produced here.
 */
export type ForcedThreeDSecureLevel = Extract<
	ThreeDSecureRequest,
	"any" | "challenge"
>;

/** What the admin dashboard stores: `off` plus the two requestable levels. */
export type ForcedThreeDSecureMode = ForcedThreeDSecureLevel | "off";

/** Admin-configurable 3DS level, edited in the admin dashboard settings. */
export const FORCE_3DS_SETTING_ID = "force_3ds";

/**
 * Parses a stored or configured 3DS level. `true` is accepted as an alias for
 * `challenge`; anything else — including Stripe's own `automatic`, which is
 * the default and buys nothing when sent explicitly — yields undefined.
 */
export function parseThreeDSecureRequest(
	value: string | null | undefined,
): ForcedThreeDSecureLevel | undefined {
	const normalized = value?.trim().toLowerCase();

	if (normalized === "any" || normalized === "challenge") {
		return normalized;
	}
	if (normalized === "true") {
		return "challenge";
	}
	return undefined;
}

/**
 * `STRIPE_FORCE_3DS`, which overrides the admin setting so a deployment can
 * force authentication on without dashboard access. Sync, so the admin API can
 * report whether the toggle is currently overridden.
 */
export function getThreeDSecureEnvOverride():
	ForcedThreeDSecureLevel | undefined {
	return parseThreeDSecureRequest(process.env.STRIPE_FORCE_3DS);
}

/**
 * How aggressively 3D Secure is requested when a card is first set up: the env
 * override if set, otherwise the admin dashboard setting. Undefined means
 * Stripe's SCA engine decides on its own, which is the default and the
 * recommended setting.
 *
 * The issuer always has the final word: `any` asks it to authenticate whenever
 * it can, `challenge` additionally asks for an interactive challenge rather
 * than a frictionless approval, but neither guarantees one — an issuer may
 * still approve silently or acknowledge the attempt without authenticating.
 *
 * Apply this ONLY where a customer is present *and* the card is being stored
 * for later use: SetupIntents, `mode: "setup"` Checkout, and the first payment
 * of a subscription. That one authentication is what lets Stripe claim an SCA
 * exemption on the merchant-initiated charges that follow, so authenticating
 * once here makes later off-session charges more likely to succeed, not less.
 *
 * Never apply it to a charge itself:
 *   - Off-session charges (auto top-up, DevPass PAYG top-ups, Reset Passes)
 *     have nobody present to answer a challenge, so requesting one would turn
 *     them into `authentication_required` declines.
 *   - Repeat on-session charges (credit top-ups on a saved card) were already
 *     authenticated when the card was saved, so a second challenge adds
 *     friction without adding protection.
 */
export async function getForcedThreeDSecure(): Promise<
	ForcedThreeDSecureLevel | undefined
> {
	const envOverride = getThreeDSecureEnvOverride();
	if (envOverride) {
		return envOverride;
	}

	const setting = await db.query.systemSetting.findFirst({
		where: { id: FORCE_3DS_SETTING_ID },
	});
	if (!setting?.enabled) {
		return undefined;
	}
	return parseThreeDSecureRequest(setting.value);
}

/** The stored admin setting alone, ignoring any env override. */
export async function getForcedThreeDSecureMode(): Promise<ForcedThreeDSecureMode> {
	const setting = await db.query.systemSetting.findFirst({
		where: { id: FORCE_3DS_SETTING_ID },
	});
	if (!setting?.enabled) {
		return "off";
	}
	return parseThreeDSecureRequest(setting.value) ?? "off";
}

export async function setForcedThreeDSecureMode(
	mode: ForcedThreeDSecureMode,
): Promise<ForcedThreeDSecureMode> {
	const enabled = mode !== "off";

	await db
		.insert(tables.systemSetting)
		.values({ id: FORCE_3DS_SETTING_ID, enabled, value: mode })
		.onConflictDoUpdate({
			target: tables.systemSetting.id,
			set: { enabled, value: mode, updatedAt: new Date() },
		});

	return mode;
}

/**
 * Spreadable `payment_method_options` for PaymentIntents, SetupIntents and
 * Checkout Sessions. Empty when 3DS is not forced, so the parameter is omitted
 * entirely rather than sent as `automatic`.
 */
export function threeDSecureOptions(request: ThreeDSecureRequest | undefined): {
	payment_method_options?: {
		card: { request_three_d_secure: ThreeDSecureRequest };
	};
} {
	if (!request) {
		return {};
	}
	return {
		payment_method_options: { card: { request_three_d_secure: request } },
	};
}

/** Same, in the nested shape `subscriptions.create` expects. */
export function threeDSecureSubscriptionSettings(
	request: ThreeDSecureRequest | undefined,
): {
	payment_settings?: {
		payment_method_options: {
			card: { request_three_d_secure: ThreeDSecureRequest };
		};
	};
} {
	if (!request) {
		return {};
	}
	return {
		payment_settings: {
			payment_method_options: { card: { request_three_d_secure: request } },
		},
	};
}

/**
 * Resolves the configured 3DS level and shapes it for a card-setup
 * SetupIntent or Checkout Session. Await this before building the params
 * object and spread the result into it.
 */
export async function forcedThreeDSecureOptions(): Promise<
	ReturnType<typeof threeDSecureOptions>
> {
	return threeDSecureOptions(await getForcedThreeDSecure());
}

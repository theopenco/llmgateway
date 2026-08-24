import { HTTPException } from "hono/http-exception";

import { notifyTopUpVelocityLimit } from "@/utils/discord.js";

import {
	checkAndReserveTopUp,
	releaseTopUpReservation,
	type TopUpVelocityOrg,
} from "@llmgateway/actions";
import { redisClient } from "@llmgateway/cache";
import { TOPUP_VELOCITY_WINDOW_MS } from "@llmgateway/shared";

const round2 = (n: number) => Math.round(n * 100) / 100;

function notifyTopUpVelocityLimitBestEffort(args: {
	email: string;
	name?: string | null;
	organizationId: string;
	capUsd: number;
	usedUsd: number;
	attemptedUsd: number;
}): void {
	const windowId = Math.floor(Date.now() / TOPUP_VELOCITY_WINDOW_MS);
	const key = `topup_velocity:notification:${args.organizationId}:${windowId}`;

	void redisClient
		.set(key, "1", "EX", TOPUP_VELOCITY_WINDOW_MS / 1000, "NX")
		.then((reserved) => {
			if (reserved === "OK") {
				return notifyTopUpVelocityLimit(args);
			}
			return undefined;
		})
		.catch(() => notifyTopUpVelocityLimit(args));
}

/**
 * Enforce the org's tier-based top-up velocity cap before creating a Stripe
 * charge, reserving the attempted amount against concurrent initiations.
 *
 * On success the amount stays reserved (self-expiring TTL) — call
 * {@link releaseTopUpReservation} from the call site's catch block if the
 * subsequent Stripe call fails, so an aborted attempt doesn't consume headroom.
 */
export async function assertTopUpVelocityAllowed(
	org: TopUpVelocityOrg,
	grossAmountUsd: number,
	options?: {
		reservationTtlSeconds?: number;
		user?: { email: string; name?: string | null };
	},
): Promise<void> {
	const result = await checkAndReserveTopUp({
		org,
		amountUsd: grossAmountUsd,
		reservationTtlSeconds: options?.reservationTtlSeconds,
	});
	if (!result.allowed) {
		notifyTopUpVelocityLimitBestEffort({
			email: options?.user?.email ?? "Unknown",
			name: options?.user?.name,
			organizationId: org.id,
			capUsd: result.capUsd,
			usedUsd: result.usedUsd,
			attemptedUsd: grossAmountUsd,
		});
		throw new HTTPException(429, {
			message: `Top-up limit reached: your account can top up at most $${result.capUsd} per 24 hours (already used $${round2(result.usedUsd)}). Try again later or contact support to raise your limit.`,
		});
	}
}

export async function getTopUpVelocityAllowance(org: TopUpVelocityOrg) {
	return await checkAndReserveTopUp({
		org,
		amountUsd: 0,
		reserve: false,
	});
}

export { releaseTopUpReservation };

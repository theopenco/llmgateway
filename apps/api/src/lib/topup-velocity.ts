import { HTTPException } from "hono/http-exception";

import {
	checkAndReserveTopUp,
	releaseTopUpReservation,
	type TopUpVelocityOrg,
} from "@llmgateway/actions";

const round2 = (n: number) => Math.round(n * 100) / 100;

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
	options?: { reservationTtlSeconds?: number },
): Promise<void> {
	const result = await checkAndReserveTopUp({
		org,
		amountUsd: grossAmountUsd,
		reservationTtlSeconds: options?.reservationTtlSeconds,
	});
	if (!result.allowed) {
		throw new HTTPException(429, {
			message: `Top-up limit reached: your account can top up at most $${result.capUsd} per 24 hours (already used $${round2(result.usedUsd)}). Try again later or contact support to raise your limit.`,
		});
	}
}

export { releaseTopUpReservation };

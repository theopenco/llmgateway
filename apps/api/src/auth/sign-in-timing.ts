import { hashPassword, verifyPassword } from "better-auth/crypto";

// An unknown email must answer as slowly as a wrong password, or sign-in
// timing enumerates accounts. Better Auth equalizes with a throwaway scrypt
// hash, which lets credential stuffing with unknown emails pin the API CPU.
// Sleeping for as long as real password checks take keeps the latency
// without the CPU.

const SMOOTHING = 0.2;
// The first scrypt call in a process runs several times slower than the
// rest, so calibrate on the fastest of a few.
const CALIBRATION_HASHES = 3;

let verifyDurationMs: number | undefined;
let calibration: Promise<number> | undefined;

async function calibrate(): Promise<number> {
	let fastest = Infinity;
	for (let i = 0; i < CALIBRATION_HASHES; i++) {
		const start = performance.now();
		await hashPassword("sign-in-timing-calibration");
		fastest = Math.min(fastest, performance.now() - start);
	}
	return fastest;
}

export async function timedVerifyPassword(data: {
	hash: string;
	password: string;
}): Promise<boolean> {
	const start = performance.now();
	const valid = await verifyPassword(data);
	const ms = performance.now() - start;
	const previous = verifyDurationMs ?? ms;
	const step = (ms - previous) * SMOOTHING;
	verifyDurationMs = previous + step;
	return valid;
}

export async function delayLikePasswordHash(): Promise<void> {
	const ms = verifyDurationMs ?? (await (calibration ??= calibrate()));
	await new Promise((resolve) => setTimeout(resolve, ms));
}

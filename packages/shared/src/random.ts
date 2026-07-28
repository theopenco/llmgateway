const UINT32_RANGE = 0x1_0000_0000;
const UINT53_RANGE = 9007199254740992;
// 2^24 — the largest power of two a float32 mantissa represents exactly.
const FLOAT32_FRACTION_RANGE = 16777216;
// crypto.getRandomValues rejects requests larger than 65536 bytes.
const MAX_RANDOM_BYTES = 65536;

function nextUint32(): number {
	const buffer = new Uint32Array(1);
	crypto.getRandomValues(buffer);
	return buffer[0]!;
}

function nextUint53(): number {
	const buffer = new Uint32Array(2);
	crypto.getRandomValues(buffer);
	// 27 high bits + 26 low bits: the 53 a double represents exactly.
	return (buffer[0]! >>> 5) * 67108864 + (buffer[1]! >>> 6); // eslint-disable-line no-mixed-operators
}

/**
 * Cryptographically secure drop-in replacement for `Math.random()`.
 * Returns a float in [0, 1) with the same 53 bits of precision.
 */
export function randomFloat(): number {
	return nextUint53() / UINT53_RANGE;
}

/**
 * Cryptographically secure integer in [minInclusive, maxExclusive).
 * Uses rejection sampling so every value in the range is equally likely.
 */
export function randomInt(minInclusive: number, maxExclusive: number): number {
	const min = Math.ceil(minInclusive);
	const range = Math.floor(maxExclusive) - min;

	if (!Number.isFinite(range) || range <= 0) {
		throw new RangeError(
			`randomInt requires maxExclusive > minInclusive, got ${minInclusive} and ${maxExclusive}`,
		);
	}

	if (!Number.isSafeInteger(min) || !Number.isSafeInteger(min + range)) {
		throw new RangeError(
			`randomInt requires bounds within the safe integer range, got ${minInclusive} and ${maxExclusive}`,
		);
	}

	// Sample from the smallest space that covers the range, then discard the
	// incomplete final bucket so the modulo cannot favour the low end.
	const wide = range > UINT32_RANGE;
	const space = wide ? UINT53_RANGE : UINT32_RANGE;
	const next = wide ? nextUint53 : nextUint32;
	const limit = space - (space % range);

	let value = next();
	while (value >= limit) {
		value = next();
	}

	return min + (value % range);
}

/**
 * Cryptographically secure float in [min, max).
 */
export function randomFloatBetween(min: number, max: number): number {
	return min + randomFloat() * (max - min); // eslint-disable-line no-mixed-operators
}

/**
 * Picks one item uniformly at random. Returns `undefined` for an empty list.
 */
export function randomItem<T>(items: readonly T[]): T | undefined {
	if (items.length === 0) {
		return undefined;
	}

	return items[randomInt(0, items.length)];
}

/**
 * Fills the target with floats in [0, 1), using one `getRandomValues` call per
 * 16384 values. Prefer this over calling `randomFloat()` in a loop on a hot
 * path such as an animation frame, where per-value crypto calls dominate.
 */
export function fillRandomFloats(target: Float32Array): void {
	if (target.length === 0) {
		return;
	}

	const chunkLength = Math.min(Math.floor(MAX_RANDOM_BYTES / 4), target.length);
	const scratch = new Uint32Array(chunkLength);

	for (let offset = 0; offset < target.length; offset += chunkLength) {
		const count = Math.min(chunkLength, target.length - offset);
		crypto.getRandomValues(
			count === chunkLength ? scratch : scratch.subarray(0, count),
		);

		for (let i = 0; i < count; i++) {
			// 24-bit fractions land exactly on the float32 mantissa grid. A full
			// uint32 divided by 2^32 would round up to 1 for the top 128 values,
			// breaking the [0, 1) contract once stored in a Float32Array.
			target[offset + i] = (scratch[i]! >>> 8) / FLOAT32_FRACTION_RANGE;
		}
	}
}

const TOKEN_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * Cryptographically secure lowercase alphanumeric token of the given length.
 */
export function randomToken(length = 12): string {
	if (length <= 0) {
		return "";
	}

	// A fractional length would truncate to a zero-byte request part way
	// through and spin forever, so reject it before allocating anything.
	if (!Number.isSafeInteger(length)) {
		throw new RangeError(
			`randomToken requires a safe integer length, got ${length}`,
		);
	}

	// Bytes at or above the last whole multiple of the alphabet size are
	// rejected so every character is uniformly distributed.
	const limit = 256 - (256 % TOKEN_ALPHABET.length);

	let token = "";
	while (token.length < length) {
		const bytes = new Uint8Array(
			Math.min(length - token.length, MAX_RANDOM_BYTES),
		);
		crypto.getRandomValues(bytes);

		bytes.forEach((byte) => {
			if (byte < limit) {
				token += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
			}
		});
	}

	return token;
}

/**
 * Collision-resistant identifier, e.g. `test-1753699200000-k3f9zq1xs`.
 * Intended for tests and seed data that need a unique-but-readable id.
 */
export function uniqueId(prefix = "id"): string {
	return `${prefix}-${Date.now()}-${randomToken(9)}`;
}

const UINT32_RANGE = 0x1_0000_0000;

function nextUint32(): number {
	const buffer = new Uint32Array(1);
	crypto.getRandomValues(buffer);
	return buffer[0]!;
}

/**
 * Cryptographically secure drop-in replacement for `Math.random()`.
 * Returns a float in [0, 1) with the same 53 bits of precision.
 */
export function randomFloat(): number {
	const buffer = new Uint32Array(2);
	crypto.getRandomValues(buffer);
	const high = buffer[0]! >>> 5;
	const low = buffer[1]! >>> 6;
	return (high * 67108864 + low) / 9007199254740992; // eslint-disable-line no-mixed-operators
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

	if (range > UINT32_RANGE) {
		return min + Math.floor(randomFloat() * range);
	}

	// Discard values from the incomplete final bucket to avoid modulo bias.
	const limit = UINT32_RANGE - (UINT32_RANGE % range);
	let value = nextUint32();
	while (value >= limit) {
		value = nextUint32();
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

const TOKEN_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * Cryptographically secure lowercase alphanumeric token of the given length.
 */
export function randomToken(length = 12): string {
	if (length <= 0) {
		return "";
	}

	// Bytes at or above the last whole multiple of the alphabet size are
	// rejected so every character is uniformly distributed.
	const limit = 256 - (256 % TOKEN_ALPHABET.length);

	let token = "";
	while (token.length < length) {
		const bytes = new Uint8Array(length - token.length);
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

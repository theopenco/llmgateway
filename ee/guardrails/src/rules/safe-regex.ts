// Maximum pattern length to prevent resource exhaustion
const MAX_PATTERN_LENGTH = 1000;

/**
 * Most unbounded quantifiers over broad atoms (`.`, `[^…]`, `\S`, `\W`, `\D`)
 * a pattern may hold. Each overlaps the others and adds a polynomial degree
 * of backtracking: a global `.*a.*a$` takes seconds on 2 KB of text.
 */
const MAX_BROAD_UNBOUNDED = 1;

/** Most unbounded quantifiers a bounded group repetition may multiply. */
const MAX_REPEATED_UNBOUNDED = 3;

const BRACE_QUANTIFIER = /^\{(\d+)(,(\d*))?\}\??/;
const LITERAL_ESCAPES: Record<string, string> = {
	f: "\f",
	n: "\n",
	r: "\r",
	t: "\t",
	v: "\v",
};
const BROAD_ESCAPES = new Set(["S", "W", "D"]);

type Atom =
	{ kind: "literal"; value: string } | { kind: "other"; broad: boolean };

interface Quantifier {
	length: number;
	unbounded: boolean;
	max: number;
	variable: boolean;
}

interface GroupFrame {
	unbounded: number;
	broad: number;
	hasBroadAtom: boolean;
	ambiguous: boolean;
	branches: (string | null)[];
	branch: string | null;
}

function newFrame(): GroupFrame {
	return {
		unbounded: 0,
		broad: 0,
		hasBroadAtom: false,
		ambiguous: false,
		branches: [],
		branch: "",
	};
}

function quantifierAt(pattern: string, index: number): Quantifier | null {
	const char = pattern[index];
	const lazy = pattern[index + 1] === "?" ? 1 : 0;
	if (char === "+" || char === "*") {
		return { length: 1 + lazy, unbounded: true, max: Infinity, variable: true };
	}
	if (char === "?") {
		return { length: 1 + lazy, unbounded: false, max: 1, variable: true };
	}
	if (char !== "{") {
		return null;
	}
	const brace = BRACE_QUANTIFIER.exec(pattern.slice(index));
	if (!brace) {
		return null;
	}
	const min = Number(brace[1]);
	const unbounded = brace[2] !== undefined && brace[3] === "";
	const max = unbounded
		? Infinity
		: brace[2] === undefined
			? min
			: Number(brace[3]);
	return { length: brace[0].length, unbounded, max, variable: max > min };
}

/** Length of the group opener at `index`: `(`, `(?:`, `(?=`, `(?<name>`, … */
function groupOpenLength(pattern: string, index: number): number {
	if (pattern[index + 1] !== "?") {
		return 1;
	}
	const kind = pattern[index + 2];
	if (
		kind === "<" &&
		pattern[index + 3] !== "=" &&
		pattern[index + 3] !== "!"
	) {
		const close = pattern.indexOf(">", index);
		return close === -1 ? 3 : close - index + 1;
	}
	return kind === "<" ? 4 : 3;
}

/** Reads the escape or character class at `index` as one atom. */
function readAtom(
	pattern: string,
	index: number,
): { atom: Atom; length: number } {
	const char = pattern[index];
	if (char === "\\") {
		const next = pattern[index + 1] ?? "";
		if (next in LITERAL_ESCAPES) {
			return {
				atom: { kind: "literal", value: LITERAL_ESCAPES[next] },
				length: 2,
			};
		}
		if (!/[a-z0-9]/i.test(next)) {
			return { atom: { kind: "literal", value: next }, length: 2 };
		}
		return {
			atom: { kind: "other", broad: BROAD_ESCAPES.has(next) },
			length: 2,
		};
	}
	if (char === "[") {
		let end = index + 1;
		let broad = pattern[end] === "^";
		while (end < pattern.length && pattern[end] !== "]") {
			if (pattern[end] === "\\") {
				broad ||= BROAD_ESCAPES.has(pattern[end + 1]);
				end++;
			}
			end++;
		}
		return { atom: { kind: "other", broad }, length: end - index + 1 };
	}
	if (char === ".") {
		return { atom: { kind: "other", broad: true }, length: 1 };
	}
	if (char === "^" || char === "$") {
		return { atom: { kind: "other", broad: false }, length: 1 };
	}
	return { atom: { kind: "literal", value: char.toLowerCase() }, length: 1 };
}

/**
 * Alternatives overlap unless every branch is a fixed literal and none is a
 * prefix of another: `(foo|bar)+` is safe, `(a|aa)+` and `(\d|\w)+` are not.
 */
function alternativesOverlap(branches: (string | null)[]): boolean {
	if (branches.length < 2) {
		return false;
	}
	return branches.some(
		(branch, index) =>
			branch === null ||
			branches.some(
				(other, otherIndex) =>
					otherIndex !== index && other !== null && other.startsWith(branch),
			),
	);
}

/**
 * Walks the pattern and reports why it could backtrack catastrophically
 * (ReDoS), or null when it is safe:
 * - an unbounded group repetition (`+`, `*`, `{n,}`) whose body holds an
 *   unbounded or variable-width quantifier or overlapping alternatives, e.g.
 *   `(a+)+`, `(a{1,3})+`, `(a|aa)+`;
 * - a bounded group repetition multiplying more than
 *   MAX_REPEATED_UNBOUNDED unbounded quantifiers, e.g. `(a+){2,10}`;
 * - more than MAX_BROAD_UNBOUNDED broad unbounded quantifiers, e.g. `.*a.*b`.
 * Bounded bodies such as `(?:\d{1,3}\.){3}` and fixed literal alternatives
 * such as `(foo|bar)+` are allowed.
 */
function backtrackingRisk(pattern: string): string | null {
	const stack: GroupFrame[] = [newFrame()];
	let index = 0;
	while (index < pattern.length) {
		const char = pattern[index];
		const current = stack[stack.length - 1];
		if (char === "(") {
			current.branch = null;
			stack.push(newFrame());
			index += groupOpenLength(pattern, index);
			continue;
		}
		if (char === "|") {
			current.branches.push(current.branch);
			current.branch = "";
			index++;
			continue;
		}
		if (char === ")" && stack.length > 1) {
			const group = stack.pop()!;
			const parent = stack[stack.length - 1];
			group.branches.push(group.branch);
			const ambiguous = group.ambiguous || alternativesOverlap(group.branches);
			const quantifier = quantifierAt(pattern, index + 1);
			if (quantifier?.unbounded && (group.unbounded > 0 || ambiguous)) {
				return "nested or overlapping repetition inside a repeated group";
			}
			const repeats = quantifier && !quantifier.unbounded ? quantifier.max : 1;
			if (repeats > 1 && group.unbounded * repeats > MAX_REPEATED_UNBOUNDED) {
				return "a bounded group repetition multiplies unbounded quantifiers";
			}
			const bodyUnbounded = group.unbounded * repeats;
			const bodyBroad = group.broad * repeats;
			parent.unbounded += bodyUnbounded + (quantifier?.unbounded ? 1 : 0);
			parent.broad +=
				bodyBroad + (quantifier?.unbounded && group.hasBroadAtom ? 1 : 0);
			parent.hasBroadAtom ||= group.hasBroadAtom;
			parent.ambiguous ||=
				ambiguous ||
				(quantifier !== null && quantifier.variable && repeats > 1);
			index += 1 + (quantifier?.length ?? 0);
			continue;
		}
		const { atom, length } = readAtom(pattern, index);
		index += length;
		const quantifier = quantifierAt(pattern, index);
		const broad = atom.kind === "other" && atom.broad;
		current.hasBroadAtom ||= broad;
		if (quantifier) {
			index += quantifier.length;
			current.branch = null;
			current.unbounded += quantifier.unbounded ? 1 : 0;
			current.broad += quantifier.unbounded && broad ? 1 : 0;
			current.ambiguous ||= quantifier.variable && quantifier.max > 1;
		} else if (current.branch !== null) {
			current.branch =
				atom.kind === "literal" ? current.branch + atom.value : null;
		}
	}
	if (stack[0].broad > MAX_BROAD_UNBOUNDED) {
		return `more than ${MAX_BROAD_UNBOUNDED} unbounded wildcard`;
	}
	return null;
}

/**
 * Explains why a user-supplied pattern cannot be used, or returns null when
 * it is valid and cannot backtrack catastrophically (ReDoS).
 */
export function userRegexError(pattern: string): string | null {
	if (!pattern) {
		return "Pattern is empty";
	}
	if (pattern.length > MAX_PATTERN_LENGTH) {
		return `Pattern is longer than ${MAX_PATTERN_LENGTH} characters`;
	}
	const compiled = tryCompile(pattern, "");
	if (typeof compiled === "string") {
		return compiled;
	}
	const risk = backtrackingRisk(pattern);
	return risk ? `Pattern could backtrack catastrophically: ${risk}` : null;
}

/**
 * Compiles a user-supplied pattern, or returns null when it is invalid or
 * could backtrack catastrophically (ReDoS).
 */
export function compileUserRegex(
	pattern: string,
	flags: string,
): RegExp | null {
	if (userRegexError(pattern)) {
		return null;
	}
	const compiled = tryCompile(pattern, flags);
	return typeof compiled === "string" ? null : compiled;
}

export function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** Compiles a pattern, or returns the syntax error message. */
function tryCompile(pattern: string, flags: string): RegExp | string {
	try {
		return new RegExp(pattern, flags);
	} catch (error) {
		return `Invalid regular expression: ${(error as Error).message}`;
	}
}

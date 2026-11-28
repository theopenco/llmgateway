// Maximum pattern length to prevent resource exhaustion
const MAX_PATTERN_LENGTH = 1000;

/**
 * Most unbounded quantifiers over broad atoms (`.`, `[^…]`, `\S`, `\W`, `\D`)
 * a pattern may hold. Each overlaps the others and adds a polynomial degree
 * of backtracking: a global `.*a.*a$` takes seconds on 2 KB of text.
 */
const MAX_BROAD_UNBOUNDED = 1;

/**
 * Most variable-width quantifiers (unbounded ones, `a{1,3}`, overlapping
 * alternatives such as `(a|aa)`) a bounded group repetition may multiply.
 */
const MAX_REPEATED_VARIABLE = 3;

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
	| { kind: "literal"; value: string }
	| { kind: "other"; broad: boolean; zeroWidth: boolean; source: string };

/** Bits 0–127 stand for ASCII characters, NON_ASCII for every other one. */
const NON_ASCII = 1n << 128n;
const ANY_CHAR = (NON_ASCII << 1n) - 1n;
const NON_ASCII_SAMPLES = [
	"\u00a0",
	"\u00e9",
	"\u0130",
	"\u2028",
	"\u3000",
	"\u4e2d",
	"\uffff",
];

interface Quantifier {
	length: number;
	unbounded: boolean;
	min: number;
	max: number;
	variable: boolean;
}

interface Tally {
	unbounded: number;
	broad: number;
	choices: number;
}

interface GroupFrame {
	/** Tally of the current alternative. */
	tally: Tally;
	/** Highest tally of the finished alternatives; a match takes one of them. */
	widest: Tally;
	hasBroadAtom: boolean;
	branches: (string | null)[];
	branch: string | null;
	chars: bigint;
	unboundedChars: bigint;
	lookaround: boolean;
	/** Unbounded runs open before the group; each alternative starts with them. */
	entry: bigint[];
	/** Unbounded runs that can still consume the next character. */
	runs: bigint[];
	/** Runs still open at the end of the finished alternatives. */
	exits: bigint[];
}

function emptyTally(): Tally {
	return { unbounded: 0, broad: 0, choices: 0 };
}

function newFrame(entry: bigint[], lookaround: boolean): GroupFrame {
	return {
		tally: emptyTally(),
		widest: emptyTally(),
		hasBroadAtom: false,
		branches: [],
		branch: "",
		chars: 0n,
		unboundedChars: 0n,
		lookaround,
		entry,
		runs: [...entry],
		exits: [],
	};
}

function endAlternative(frame: GroupFrame) {
	frame.widest = {
		unbounded: Math.max(frame.widest.unbounded, frame.tally.unbounded),
		broad: Math.max(frame.widest.broad, frame.tally.broad),
		choices: Math.max(frame.widest.choices, frame.tally.choices),
	};
	frame.tally = emptyTally();
	frame.branches.push(frame.branch);
	frame.exits.push(...frame.runs);
	frame.runs = [...frame.entry];
}

function overlaps(runs: bigint[], chars: bigint): boolean {
	return runs.some((run) => (run & chars) !== 0n);
}

function charBits(char: string): bigint {
	const code = char.charCodeAt(0);
	return code < 128 ? 1n << BigInt(code) : NON_ASCII;
}

/** Over-approximates the characters an atom can match, ignoring case. */
function atomChars(atom: Atom): bigint {
	if (atom.kind === "literal") {
		return (
			charBits(atom.value.toLowerCase()) | charBits(atom.value.toUpperCase())
		);
	}
	if (atom.zeroWidth) {
		return 0n;
	}
	if (/^\\[1-9k]/.test(atom.source)) {
		return ANY_CHAR;
	}
	let regex: RegExp;
	try {
		regex = new RegExp(`^(?:${atom.source})$`, "i");
	} catch {
		return ANY_CHAR;
	}
	const nonAscii =
		/\\[ux]/.test(atom.source) ||
		/[\u0080-\uffff]/.test(atom.source) ||
		NON_ASCII_SAMPLES.some((char) => regex.test(char));
	let bits = nonAscii ? NON_ASCII : 0n;
	for (let code = 0; code < 128; code++) {
		if (regex.test(String.fromCharCode(code))) {
			bits |= 1n << BigInt(code);
		}
	}
	return bits;
}

function quantifierAt(pattern: string, index: number): Quantifier | null {
	const char = pattern[index];
	const lazy = pattern[index + 1] === "?" ? 1 : 0;
	if (char === "+" || char === "*") {
		return {
			length: 1 + lazy,
			unbounded: true,
			min: char === "+" ? 1 : 0,
			max: Infinity,
			variable: true,
		};
	}
	if (char === "?") {
		return {
			length: 1 + lazy,
			unbounded: false,
			min: 0,
			max: 1,
			variable: true,
		};
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
	return { length: brace[0].length, unbounded, min, max, variable: max > min };
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
	const other = (length: number, broad: boolean, zeroWidth = false) => ({
		atom: {
			kind: "other" as const,
			broad,
			zeroWidth,
			source: pattern.slice(index, index + length),
		},
		length,
	});
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
		return other(2, BROAD_ESCAPES.has(next), next === "b" || next === "B");
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
		return other(end - index + 1, broad);
	}
	if (char === ".") {
		return other(1, true);
	}
	if (char === "^" || char === "$") {
		return other(1, false, true);
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
 * - a bounded group repetition multiplying more than MAX_REPEATED_VARIABLE
 *   variable-width quantifiers, e.g. `(a+){2,10}`, `(a|aa){1,30}`;
 * - an unbounded quantifier whose characters a still-open unbounded run can
 *   also match, e.g. `\d+\d+`, `\w+a\w+`, `(\d+\.\d+){2}`;
 * - more than MAX_BROAD_UNBOUNDED broad unbounded quantifiers in one
 *   alternative, e.g. `.*a.*b`.
 * Bounded bodies such as `(?:\d{1,3}\.){3}`, runs split by a delimiter they
 * cannot match such as `\d+\.\d+`, and fixed literal alternatives such as
 * `(foo|bar)+` are allowed.
 */
function backtrackingRisk(pattern: string): string | null {
	const stack: GroupFrame[] = [newFrame([], false)];
	let index = 0;
	while (index < pattern.length) {
		const char = pattern[index];
		const current = stack[stack.length - 1];
		if (char === "(") {
			current.branch = null;
			const lookaround = /^\(\?<?[=!]/.test(pattern.slice(index, index + 4));
			stack.push(newFrame(current.runs, lookaround));
			index += groupOpenLength(pattern, index);
			continue;
		}
		if (char === "|") {
			endAlternative(current);
			current.branch = "";
			index++;
			continue;
		}
		if (char === ")" && stack.length > 1) {
			const group = stack.pop()!;
			const parent = stack[stack.length - 1];
			endAlternative(group);
			const { unbounded, broad, choices } = group.widest;
			const bodyChoices =
				choices + (alternativesOverlap(group.branches) ? 1 : 0);
			const quantifier = quantifierAt(pattern, index + 1);
			if (quantifier?.unbounded && (unbounded > 0 || bodyChoices > 0)) {
				return "nested or overlapping repetition inside a repeated group";
			}
			const repeats = quantifier && !quantifier.unbounded ? quantifier.max : 1;
			if (
				repeats > 1 &&
				(unbounded + bodyChoices) * repeats > MAX_REPEATED_VARIABLE
			) {
				return "a bounded group repetition multiplies variable-width quantifiers";
			}
			if (
				(repeats > 1 && overlaps(group.exits, group.unboundedChars)) ||
				(quantifier?.unbounded && overlaps(parent.runs, group.chars))
			) {
				return "adjacent unbounded repetitions can match the same text";
			}
			if (!group.lookaround) {
				parent.runs = [
					...new Set([
						...(quantifier?.min === 0 ? parent.runs : []),
						...group.exits,
						...(quantifier?.unbounded ? [group.chars] : []),
					]),
				];
			}
			const repeatedUnbounded = unbounded * repeats;
			const repeatedBroad = broad * repeats;
			const repeatedChoices = bodyChoices * repeats;
			parent.tally.unbounded +=
				repeatedUnbounded + (quantifier?.unbounded ? 1 : 0);
			parent.tally.broad +=
				repeatedBroad + (quantifier?.unbounded && group.hasBroadAtom ? 1 : 0);
			parent.tally.choices +=
				repeatedChoices + (quantifier?.variable && repeats > 1 ? 1 : 0);
			parent.hasBroadAtom ||= group.hasBroadAtom;
			parent.chars |= group.chars;
			parent.unboundedChars |=
				group.unboundedChars | (quantifier?.unbounded ? group.chars : 0n);
			index += 1 + (quantifier?.length ?? 0);
			continue;
		}
		const { atom, length } = readAtom(pattern, index);
		index += length;
		const quantifier = quantifierAt(pattern, index);
		const broad = atom.kind === "other" && atom.broad;
		const chars = atomChars(atom);
		current.hasBroadAtom ||= broad;
		current.chars |= chars;
		if (quantifier) {
			index += quantifier.length;
			current.branch = null;
			if (quantifier.unbounded) {
				if (overlaps(current.runs, chars)) {
					return "adjacent unbounded repetitions can match the same text";
				}
				current.tally.unbounded++;
				current.tally.broad += broad ? 1 : 0;
				current.unboundedChars |= chars;
			} else if (quantifier.variable && quantifier.max > 1) {
				current.tally.choices++;
			}
		} else if (current.branch !== null) {
			current.branch =
				atom.kind === "literal" ? current.branch + atom.value : null;
		}
		if (chars !== 0n && (!quantifier || quantifier.min > 0)) {
			current.runs = current.runs.filter((run) => (run & chars) !== 0n);
		}
		if (quantifier?.unbounded && chars !== 0n) {
			current.runs.push(chars);
		}
	}
	endAlternative(stack[0]);
	if (stack[0].widest.broad > MAX_BROAD_UNBOUNDED) {
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

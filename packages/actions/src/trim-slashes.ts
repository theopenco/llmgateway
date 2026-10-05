/** Strips leading and/or trailing slashes in linear time (no regex backtracking). */
export function trimSlashes(
	value: string,
	sides: { start?: boolean; end?: boolean } = { start: true, end: true },
): string {
	let start = 0;
	let end = value.length;
	if (sides.start) {
		while (start < end && value[start] === "/") {
			start++;
		}
	}
	if (sides.end) {
		while (end > start && value[end - 1] === "/") {
			end--;
		}
	}
	return value.slice(start, end);
}

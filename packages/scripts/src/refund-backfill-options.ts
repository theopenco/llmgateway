export function parseRefundBackfillOptions(args: string[]) {
	const values = new Map<string, string>();
	for (const arg of args) {
		const match = /^(--commit|--json)$|^--(org|limit|out)=(.*)$/.exec(arg);
		if (!match) {
			throw new Error(`Invalid argument: ${arg}; use --name=value for options`);
		}
		const name = match[1] ?? match[2];
		if (values.has(name)) {
			throw new Error(`Duplicate argument: ${name}`);
		}
		values.set(name, match[3] ?? "");
	}
	const scopeOrg = values.get("org");
	if (scopeOrg !== undefined && scopeOrg.trim() === "") {
		throw new Error("--org must be a non-empty organization id");
	}
	const limitRaw = values.get("limit");
	const limit = limitRaw === undefined ? undefined : Number(limitRaw);
	if (
		limitRaw !== undefined &&
		(!Number.isSafeInteger(limit) || (limit ?? 0) <= 0)
	) {
		throw new Error(`--limit must be a positive integer, got "${limitRaw}"`);
	}
	const outPath = values.get("out");
	if (outPath !== undefined && outPath.trim() === "") {
		throw new Error("--out must be a non-empty path");
	}
	return {
		commit: values.has("--commit"),
		asJson: values.has("--json"),
		scopeOrg,
		limit,
		outPath,
	};
}

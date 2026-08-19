/**
 * Log rows store `used_model` as the fully qualified routing target
 * (`provider/model`, plus a `:region` suffix for regional mappings, e.g.
 * `alibaba/qwen-plus:us-virginia`). Consumers that need the bare catalogue id
 * or the served region have to split it back apart, because neither is stored
 * in its own column.
 */
export function parseUsedModel(
	usedModel: string,
	usedProvider?: string | null,
): { modelId: string; region: string | null } {
	let rest = usedModel;
	const prefix = usedProvider ? `${usedProvider}/` : null;
	if (prefix && rest.startsWith(prefix)) {
		rest = rest.slice(prefix.length);
	} else if (rest.includes("/")) {
		rest = rest.slice(rest.indexOf("/") + 1);
	}
	const regionIdx = rest.lastIndexOf(":");
	return regionIdx === -1
		? { modelId: rest, region: null }
		: { modelId: rest.slice(0, regionIdx), region: rest.slice(regionIdx + 1) };
}

/**
 * The region a log row was served from, or null for providers without regional
 * deployments (OpenAI, Anthropic, …), which never carry a `:region` suffix.
 */
export function regionFromUsedModel(
	usedModel: string | null | undefined,
	usedProvider?: string | null,
): string | null {
	if (!usedModel) {
		return null;
	}
	return parseUsedModel(usedModel, usedProvider).region;
}

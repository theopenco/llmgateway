const escapeRegExp = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether a custom provider's 4xx says it does not serve the model at all
 * (e.g. `Model 'x' is temporarily not supported`). Requires the model id as
 * the subject and nothing qualifying the statement after it, so capability
 * wording ("tools are not supported for model x", "model x is not supported
 * for tool calls") stays a client error.
 */
export function isCustomModelUnavailableError(
	errorText: string | undefined,
	modelName: string | undefined,
): boolean {
	if (!errorText || !modelName) {
		return false;
	}
	if (/\bmodel_not_found\b/i.test(errorText)) {
		return true;
	}
	return new RegExp(
		`model\\b[^a-z0-9]{0,6}${escapeRegExp(modelName)}[^a-z0-9]{0,6}(?:is\\s+)?(?:(?:temporarily|currently)\\s+)?(?:not\\s+(?:supported|available|found)|unavailable|unsupported|does\\s+not\\s+exist)(?=\\s*(?:$|[^\\sa-z0-9]|or\\b))`,
		"i",
	).test(errorText);
}

export interface PlaygroundMessageMetadata extends Record<string, unknown> {
	usedModel?: string;
	usage?: {
		inputTokens?: number;
		cachedInputTokens?: number;
		outputTokens?: number;
		totalCost?: number;
	};
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function readNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function parsePlaygroundMessageMetadata(
	value: unknown,
): PlaygroundMessageMetadata | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const usageValue = value.usage;
	const usage = isRecord(usageValue)
		? {
				inputTokens: readNumber(usageValue.inputTokens),
				cachedInputTokens: readNumber(usageValue.cachedInputTokens),
				outputTokens: readNumber(usageValue.outputTokens),
				totalCost: readNumber(usageValue.totalCost),
			}
		: undefined;

	const metadata: PlaygroundMessageMetadata = {
		usedModel: readString(value.usedModel),
		...(usage &&
		Object.values(usage).some((usageItem) => usageItem !== undefined)
			? { usage }
			: {}),
	};

	if (!metadata.usedModel && !metadata.usage) {
		return undefined;
	}

	return metadata;
}

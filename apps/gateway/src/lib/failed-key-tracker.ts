import { providerRetryKey } from "@/chat/tools/retry-with-fallback.js";

export interface FailedKeyOptions {
	envVarName?: string;
	configIndex?: number;
	providerKeyId?: string;
}

export interface FailedKeyTracker {
	remember: (
		providerId: string,
		region: string | undefined,
		options: FailedKeyOptions,
	) => void;
	envKeyIndicesFor: (
		providerId: string,
		region: string | undefined,
	) => ReadonlySet<number> | undefined;
	providerKeyIdsFor: (
		providerId: string,
		region: string | undefined,
	) => ReadonlySet<string> | undefined;
}

/**
 * Tracks env-var indices and BYOK provider-key ids that have already failed
 * during a single request, so the same key isn't retried twice. Shared by the
 * chat and embedding paths to drive same-provider key rotation.
 */
export function createFailedKeyTracker(): FailedKeyTracker {
	const envIndices = new Map<string, Set<number>>();
	const providerKeyIds = new Map<string, Set<string>>();

	return {
		remember(providerId, region, options) {
			const key = providerRetryKey(providerId, region);

			if (
				options.envVarName !== undefined &&
				options.configIndex !== undefined
			) {
				const set = envIndices.get(key) ?? new Set<number>();
				set.add(options.configIndex);
				envIndices.set(key, set);
			}

			if (options.providerKeyId) {
				const set = providerKeyIds.get(key) ?? new Set<string>();
				set.add(options.providerKeyId);
				providerKeyIds.set(key, set);
			}
		},
		envKeyIndicesFor(providerId, region) {
			const set = envIndices.get(providerRetryKey(providerId, region));
			return set ? new Set(set) : undefined;
		},
		providerKeyIdsFor(providerId, region) {
			const set = providerKeyIds.get(providerRetryKey(providerId, region));
			return set ? new Set(set) : undefined;
		},
	};
}

/**
 * Type guards for runtime type checking
 * These functions provide type-safe runtime validation
 */

import type { ProviderModelMapping } from "./models";

/**
 * Checks if an object has the required properties of a ProviderModelMapping
 */
export function isProviderModelMapping(
	obj: unknown,
): obj is ProviderModelMapping {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"providerId" in obj &&
		"modelName" in obj &&
		typeof (obj as any).providerId === "string" &&
		typeof (obj as any).modelName === "string"
	);
}

/**
 * Checks if a provider mapping supports reasoning
 */
export function isReasoningProvider(
	provider: ProviderModelMapping,
): provider is ProviderModelMapping & { reasoning: true } {
	return provider.reasoning === true;
}

/**
 * Checks if an error object has a code property
 */
export function hasErrorCode(error: unknown): error is { code: string } {
	return (
		error !== null &&
		typeof error === "object" &&
		"code" in error &&
		typeof (error as any).code === "string"
	);
}

/**
 * Checks if an object has message property (for error handling)
 */
export function hasMessageProperty(obj: unknown): obj is { message: string } {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"message" in obj &&
		typeof (obj as any).message === "string"
	);
}

/**
 * Checks if an object is a React element with props
 */
export function isReactElementWithProps(
	obj: unknown,
): obj is { props: { children?: string; className?: string } } {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"props" in obj &&
		typeof (obj as any).props === "object"
	);
}

/**
 * Checks if metadata has tool results
 */
export function hasToolResults(
	metadata: unknown,
): metadata is { toolResults: any } {
	return (
		typeof metadata === "object" &&
		metadata !== null &&
		"toolResults" in metadata
	);
}

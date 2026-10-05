import "@tanstack/react-query";

declare module "@tanstack/react-query" {
	interface Register {
		mutationMeta: {
			/** Fallback wording for the global error toast. */
			errorMessage?: string;
			/** The call site renders the error itself; skip the global toast. */
			inlineError?: boolean;
		};
	}
}

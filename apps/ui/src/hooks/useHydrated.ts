import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** False on the server and during hydration, true afterwards and on
 *  client-only renders. Lets a component match its server HTML on the first
 *  client render even when streamed data has already arrived. */
export function useHydrated() {
	return useSyncExternalStore(
		subscribe,
		() => true,
		() => false,
	);
}

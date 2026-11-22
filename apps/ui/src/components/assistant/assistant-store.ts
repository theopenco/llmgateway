import { useSyncExternalStore } from "react";

function createStore<T>(initial: T) {
	let value = initial;
	const listeners = new Set<() => void>();
	return {
		get: () => value,
		set: (next: T) => {
			value = next;
			listeners.forEach((listener) => listener());
		},
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

export interface Spotlight {
	element: HTMLElement;
	label: string;
}

/** A secret shown to the user once; it never enters the conversation. */
export interface AssistantReveal {
	title: string;
	secret: string;
}

export const spotlightStore = createStore<Spotlight | null>(null);
export const revealStore = createStore<AssistantReveal | null>(null);

export function useSpotlight() {
	return useSyncExternalStore(
		spotlightStore.subscribe,
		spotlightStore.get,
		() => null,
	);
}

export function useAssistantReveal() {
	return useSyncExternalStore(
		revealStore.subscribe,
		revealStore.get,
		() => null,
	);
}

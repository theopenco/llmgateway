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
const NO_REVEALS: AssistantReveal[] = [];
export const revealStore = createStore<AssistantReveal[]>(NO_REVEALS);

/** Queues a secret; earlier ones stay until the user dismisses them. */
export function addReveal(reveal: AssistantReveal) {
	revealStore.set([...revealStore.get(), reveal]);
}

export function dismissReveal(reveal: AssistantReveal) {
	revealStore.set(revealStore.get().filter((entry) => entry !== reveal));
}

export function clearReveals() {
	revealStore.set(NO_REVEALS);
}

export function useSpotlight() {
	return useSyncExternalStore(
		spotlightStore.subscribe,
		spotlightStore.get,
		() => null,
	);
}

export function useAssistantReveals() {
	return useSyncExternalStore(
		revealStore.subscribe,
		revealStore.get,
		() => NO_REVEALS,
	);
}

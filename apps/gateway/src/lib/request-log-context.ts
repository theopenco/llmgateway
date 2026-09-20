import { AsyncLocalStorage } from "node:async_hooks";

// Trusted internal forwards share their caller's state to avoid duplicate logs.
export const requestLogContext = new AsyncLocalStorage<{ logged: boolean }>();

export function markRequestLogged(): void {
	const context = requestLogContext.getStore();
	if (context) {
		context.logged = true;
	}
}

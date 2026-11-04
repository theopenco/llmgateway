import { AsyncLocalStorage } from "node:async_hooks";

const ssoRequest = new AsyncLocalStorage<{ providerId?: string }>();

export function withSsoRequest<T>(callback: () => T): T {
	return ssoRequest.run({}, callback);
}
export function setSsoProvider(providerId: string): void {
	const context = ssoRequest.getStore();
	if (context) {
		context.providerId = providerId;
	}
}
export function getSsoProvider(): string | undefined {
	return ssoRequest.getStore()?.providerId;
}

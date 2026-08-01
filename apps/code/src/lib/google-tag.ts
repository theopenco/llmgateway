declare global {
	interface Window {
		gtag?: (
			command: "config" | "event" | "js" | "set",
			...args: unknown[]
		) => void;
	}
}

export interface SignupConversionOptions {
	email: string;
	method: string;
	sendTo?: string;
}

export function trackSignupConversion({
	email,
	method,
	sendTo,
}: SignupConversionOptions): void {
	if (typeof window === "undefined" || typeof window.gtag !== "function") {
		return;
	}
	window.gtag("set", "user_data", { email });
	window.gtag("event", "sign_up", { method });
	if (sendTo) {
		window.gtag("event", "conversion", { send_to: sendTo });
	}
}

export interface PurchaseConversionOptions {
	email: string;
	value?: number;
	currency?: string;
	transactionId?: string;
	sendTo?: string;
}

export function trackPurchaseConversion({
	email,
	value,
	currency = "USD",
	transactionId,
	sendTo,
}: PurchaseConversionOptions): void {
	if (typeof window === "undefined" || typeof window.gtag !== "function") {
		return;
	}
	window.gtag("set", "user_data", { email });
	window.gtag("event", "purchase", {
		value,
		currency,
		transaction_id: transactionId,
	});
	if (sendTo) {
		window.gtag("event", "conversion", {
			send_to: sendTo,
			value,
			currency,
			transaction_id: transactionId,
		});
	}
}

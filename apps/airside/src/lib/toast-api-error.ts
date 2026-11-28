import { toast } from "sonner";

export function toastApiError(error: unknown, fallback: string) {
	const message =
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
			? error.message
			: fallback;
	toast.error(message);
}

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function formatUsd(amount: number): string {
	return Number.isInteger(amount)
		? `$${amount}`
		: `$${amount.toFixed(2).replace(/\.?0+$/, "")}`;
}

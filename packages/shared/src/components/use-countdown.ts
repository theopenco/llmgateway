"use client";

import { useEffect, useState } from "react";

export interface CountdownParts {
	expired: boolean;
	days: number;
	hours: number;
	minutes: number;
	seconds: number;
}

function getCountdownParts(endsAt: string): CountdownParts {
	const end = new Date(endsAt).getTime();
	const diff = end - Date.now();

	if (Number.isNaN(end) || diff <= 0) {
		return { expired: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
	}

	return {
		expired: false,
		days: Math.floor(diff / (1000 * 60 * 60 * 24)),
		hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
		minutes: Math.floor((diff / (1000 * 60)) % 60),
		seconds: Math.floor((diff / 1000) % 60),
	};
}

// Live countdown to an ISO timestamp, ticking once per second. The first
// render (including SSR) computes from the current clock, so wrap nodes that
// render these values with suppressHydrationWarning to tolerate the
// seconds-level drift between the server and client renders.
export function useCountdown(endsAt: string): CountdownParts {
	const [parts, setParts] = useState(() => getCountdownParts(endsAt));

	useEffect(() => {
		setParts(getCountdownParts(endsAt));

		const interval = setInterval(() => {
			setParts((previous) => {
				if (previous.expired) {
					clearInterval(interval);
					return previous;
				}
				return getCountdownParts(endsAt);
			});
		}, 1000);

		return () => clearInterval(interval);
	}, [endsAt]);

	return parts;
}

const pad = (value: number) => String(value).padStart(2, "0");

// Compact "29d 23:14:09" readout used by the promo banners.
export function formatCountdown(parts: CountdownParts): string {
	const clock = `${pad(parts.hours)}:${pad(parts.minutes)}:${pad(parts.seconds)}`;
	return parts.days > 0 ? `${parts.days}d ${clock}` : clock;
}

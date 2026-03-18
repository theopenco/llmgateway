"use client";

import { useEffect, useState } from "react";

interface CountdownProps {
	expiresAt: string;
}

function getTimeRemaining(expiresAt: string) {
	const now = Date.now();
	const end = new Date(expiresAt).getTime();
	const expired = {
		expired: true,
		days: 0,
		hours: 0,
		minutes: 0,
		seconds: 0,
		diff: 0,
	};

	if (Number.isNaN(end) || end <= now) {
		return expired;
	}

	const diff = end - now;
	const days = Math.floor(diff / (1000 * 60 * 60 * 24));
	const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
	const minutes = Math.floor((diff / (1000 * 60)) % 60);
	const seconds = Math.floor((diff / 1000) % 60);

	return { expired: false, days, hours, minutes, seconds, diff };
}

export function Countdown({ expiresAt }: CountdownProps) {
	const [time, setTime] = useState(() => getTimeRemaining(expiresAt));

	useEffect(() => {
		const current = getTimeRemaining(expiresAt);
		setTime(current);

		if (current.expired) {
			return;
		}

		const interval = setInterval(
			() => {
				setTime(getTimeRemaining(expiresAt));
			},
			current.diff < 60 * 60 * 1000 ? 1000 : 60000,
		);

		return () => clearInterval(interval);
	}, [expiresAt]);

	if (time.expired) {
		return <span className="text-destructive font-medium">Expired</span>;
	}

	if (time.days > 0) {
		return (
			<span className="tabular-nums">
				{time.days}d {time.hours}h {time.minutes}m remaining
			</span>
		);
	}

	return (
		<span className="tabular-nums text-orange-600 dark:text-orange-400">
			{time.hours}h {time.minutes}m {time.seconds}s remaining
		</span>
	);
}

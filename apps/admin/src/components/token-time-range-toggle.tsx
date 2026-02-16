"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import type { TokenWindow } from "@/lib/admin-organizations";

interface TimeRangeToggleProps {
	initial: TokenWindow;
}

export function TokenTimeRangeToggle({ initial }: TimeRangeToggleProps) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();

	const [current, setCurrent] = useState<TokenWindow>(initial);

	useEffect(() => {
		const param = searchParams.get("window");
		if (
			param === "1h" ||
			param === "4h" ||
			param === "12h" ||
			param === "1d" ||
			param === "7d" ||
			param === "30d" ||
			param === "90d" ||
			param === "365d"
		) {
			setCurrent(param);
		} else {
			setCurrent("1d");
		}
	}, [searchParams]);

	function setWindow(value: TokenWindow) {
		const params = new URLSearchParams(searchParams.toString());

		if (value === "1d") {
			params.delete("window");
		} else {
			params.set("window", value);
		}

		setCurrent(value);

		const query = params.toString();
		router.push(query ? `${pathname}?${query}` : pathname);
	}

	return (
		<div className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/60 p-1 text-xs text-muted-foreground backdrop-blur">
			<TimeRangeButton
				label="Last 1 hour"
				value="1h"
				current={current}
				onClick={setWindow}
			/>
			<TimeRangeButton
				label="Last 4 hours"
				value="4h"
				current={current}
				onClick={setWindow}
			/>
			<TimeRangeButton
				label="Last 12 hours"
				value="12h"
				current={current}
				onClick={setWindow}
			/>
			<TimeRangeButton
				label="Last 24 hours"
				value="1d"
				current={current}
				onClick={setWindow}
			/>
			<TimeRangeButton
				label="Last 7 days"
				value="7d"
				current={current}
				onClick={setWindow}
			/>
			<TimeRangeButton
				label="Last 30 days"
				value="30d"
				current={current}
				onClick={setWindow}
			/>
			<TimeRangeButton
				label="Last 90 days"
				value="90d"
				current={current}
				onClick={setWindow}
			/>
			<TimeRangeButton
				label="Last 365 days"
				value="365d"
				current={current}
				onClick={setWindow}
			/>
		</div>
	);
}

function TimeRangeButton({
	label,
	value,
	current,
	onClick,
}: {
	label: string;
	value: TokenWindow;
	current: TokenWindow;
	onClick: (value: TokenWindow) => void;
}) {
	const isActive = current === value;

	return (
		<button
			type="button"
			onClick={() => onClick(value)}
			className={cn(
				"rounded-full px-3 py-1 transition-colors",
				isActive
					? "bg-primary text-primary-foreground"
					: "text-muted-foreground hover:bg-muted",
			)}
			aria-pressed={isActive}
		>
			{label}
		</button>
	);
}

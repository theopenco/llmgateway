import {
	dayBarClass,
	formatUptime,
	hasEnoughDayData,
	indicatorDotClass,
	indicatorLabels,
	type OfficialIndicator,
	type StatusDay,
} from "@/lib/provider-status";
import { cn } from "@/lib/utils";

import { formatNumber } from "@llmgateway/shared/number-format";

const MOBILE_DAYS = 30;

const dateFormat = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	timeZone: "UTC",
});

function describeDay(day: StatusDay, incident: OfficialIndicator | undefined) {
	const date = dateFormat.format(new Date(`${day.date}T00:00:00Z`));
	const measured =
		day.uptime !== null && hasEnoughDayData(day.requestCount)
			? `${formatUptime(day.uptime)} uptime over ${formatNumber(day.requestCount)} requests`
			: "Not enough traffic to measure";
	const official = incident
		? `. Official incident: ${indicatorLabels[incident].toLowerCase()}`
		: "";
	return `${date}: ${measured}${official}`;
}

export function StatusHistoryBar({
	days,
	incidentsByDay,
}: {
	days: StatusDay[];
	incidentsByDay: Map<string, OfficialIndicator>;
}) {
	const mobileStart = Math.max(days.length - MOBILE_DAYS, 0);
	return (
		<div className="pt-2">
			<ol
				className="flex h-10 items-stretch gap-[2px]"
				aria-label={`Daily uptime for the last ${days.length} days`}
			>
				{days.map((day, index) => {
					const incident = incidentsByDay.get(day.date);
					const label = describeDay(day, incident);
					return (
						<li
							key={day.date}
							title={label}
							className={cn(
								"relative flex-1 rounded-[2px]",
								dayBarClass(day),
								index < mobileStart && "hidden md:block",
							)}
						>
							<span className="sr-only">{label}</span>
							{incident ? (
								<span
									aria-hidden
									className={cn(
										"absolute inset-x-0 -top-1.5 mx-auto h-1 w-1 rounded-full",
										indicatorDotClass[incident],
									)}
								/>
							) : null}
						</li>
					);
				})}
			</ol>
			<div className="mt-2 flex justify-between text-xs text-muted-foreground">
				<span className="md:hidden">{MOBILE_DAYS} days ago</span>
				<span className="hidden md:inline">{days.length} days ago</span>
				<span>Today</span>
			</div>
		</div>
	);
}

export function StatusLegend() {
	const items = [
		{ label: "≥ 99.5%", className: "bg-green-500" },
		{ label: "≥ 98%", className: "bg-lime-500" },
		{ label: "≥ 95%", className: "bg-amber-500" },
		{ label: "≥ 90%", className: "bg-orange-500" },
		{ label: "< 90%", className: "bg-red-500" },
		{ label: "No data", className: "bg-muted" },
	];
	return (
		<ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
			{items.map((item) => (
				<li key={item.label} className="flex items-center gap-1.5">
					<span
						aria-hidden
						className={cn("h-2.5 w-2.5 rounded-[2px]", item.className)}
					/>
					{item.label}
				</li>
			))}
			<li className="flex items-center gap-1.5">
				<span aria-hidden className="h-1 w-1 rounded-full bg-amber-500" />
				Official incident
			</li>
		</ul>
	);
}

export function IndicatorDot({
	indicator,
	className,
}: {
	indicator: OfficialIndicator | null;
	className?: string;
}) {
	return (
		<span
			aria-hidden
			className={cn(
				"inline-block h-2.5 w-2.5 shrink-0 rounded-full",
				indicator === null
					? "bg-muted-foreground/40"
					: indicatorDotClass[indicator],
				className,
			)}
		/>
	);
}

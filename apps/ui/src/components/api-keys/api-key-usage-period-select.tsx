"use client";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";

import {
	API_KEY_USAGE_PERIODS,
	parseApiKeyUsagePeriod,
	type ApiKeyUsagePeriod,
} from "./api-key-usage-period";

export function ApiKeyUsagePeriodSelect({
	value,
	onChange,
}: {
	value: ApiKeyUsagePeriod;
	onChange: (value: ApiKeyUsagePeriod) => void;
}) {
	return (
		<Select
			value={value}
			onValueChange={(next) => onChange(parseApiKeyUsagePeriod(next))}
		>
			<SelectTrigger
				size="sm"
				className="w-full md:w-40"
				aria-label="Usage period"
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{API_KEY_USAGE_PERIODS.map((period) => (
					<SelectItem key={period.value} value={period.value}>
						{period.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

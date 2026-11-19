import {
	formatAlertWindow,
	PROVIDER_ISSUE_ERROR_RATE_PERCENTS,
	PROVIDER_ISSUE_USAGE_HOURS,
	PROVIDER_ISSUE_WINDOW_MINUTES,
} from "@llmgateway/shared/provider-issue-alerts";

export interface ProviderIssueValue {
	issueWindowMinutes: (typeof PROVIDER_ISSUE_WINDOW_MINUTES)[number];
	issueErrorRatePercent: (typeof PROVIDER_ISSUE_ERROR_RATE_PERCENTS)[number];
	issueUsageHours: (typeof PROVIDER_ISSUE_USAGE_HOURS)[number];
}

interface FieldProps<T extends number> {
	label: string;
	value: number;
	options: readonly T[];
	format: (value: number) => string;
	disabled: boolean;
	onChange: (value: T) => void;
}

function Field<T extends number>({
	label,
	value,
	options,
	format,
	disabled,
	onChange,
}: FieldProps<T>) {
	return (
		<select
			aria-label={label}
			className="bg-background rounded-md border px-2 py-1"
			value={value}
			disabled={disabled}
			onChange={(e) => {
				const option = options.find((o) => o === Number(e.target.value));
				if (option !== undefined) {
					onChange(option);
				}
			}}
		>
			{options.map((option) => (
				<option key={option} value={option}>
					{format(option)}
				</option>
			))}
		</select>
	);
}

export function ProviderIssueSettings({
	value,
	disabled,
	onSave,
}: {
	value: Record<keyof ProviderIssueValue, number>;
	disabled: boolean;
	onSave: (value: Partial<ProviderIssueValue>) => void;
}) {
	return (
		<div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-2 text-xs">
			Alert at
			<Field<ProviderIssueValue["issueErrorRatePercent"]>
				label="Provider issue error rate"
				value={value.issueErrorRatePercent}
				options={PROVIDER_ISSUE_ERROR_RATE_PERCENTS}
				format={(v) => `${v}%`}
				disabled={disabled}
				onChange={(issueErrorRatePercent) => onSave({ issueErrorRatePercent })}
			/>
			errors over
			<Field<ProviderIssueValue["issueWindowMinutes"]>
				label="Provider issue error window"
				value={value.issueWindowMinutes}
				options={PROVIDER_ISSUE_WINDOW_MINUTES}
				format={formatAlertWindow}
				disabled={disabled}
				onChange={(issueWindowMinutes) => onSave({ issueWindowMinutes })}
			/>
			for models used in the last
			<Field<ProviderIssueValue["issueUsageHours"]>
				label="Provider issue usage window"
				value={value.issueUsageHours}
				options={PROVIDER_ISSUE_USAGE_HOURS}
				format={(v) => formatAlertWindow(v * 60)}
				disabled={disabled}
				onChange={(issueUsageHours) => onSave({ issueUsageHours })}
			/>
		</div>
	);
}

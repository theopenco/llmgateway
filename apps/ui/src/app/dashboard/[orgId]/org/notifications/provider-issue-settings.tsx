import {
	formatAlertWindow,
	PROVIDER_ISSUE_ERROR_RATE_PERCENTS,
	PROVIDER_ISSUE_USAGE_HOURS,
	PROVIDER_ISSUE_WINDOW_MINUTES,
} from "@llmgateway/shared/provider-issue-alerts";

export interface ProviderIssueValue {
	issueWindowMinutes: number;
	issueErrorRatePercent: number;
	issueUsageHours: number;
}

interface FieldProps {
	label: string;
	value: number;
	options: readonly number[];
	format: (value: number) => string;
	disabled: boolean;
	onChange: (value: number) => void;
}

function Field({
	label,
	value,
	options,
	format,
	disabled,
	onChange,
}: FieldProps) {
	return (
		<select
			aria-label={label}
			className="bg-background rounded-md border px-2 py-1"
			value={value}
			disabled={disabled}
			onChange={(e) => onChange(Number(e.target.value))}
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
	value: ProviderIssueValue;
	disabled: boolean;
	onSave: (value: ProviderIssueValue) => void;
}) {
	return (
		<div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-2 text-xs">
			Alert at
			<Field
				label="Provider issue error rate"
				value={value.issueErrorRatePercent}
				options={PROVIDER_ISSUE_ERROR_RATE_PERCENTS}
				format={(v) => `${v}%`}
				disabled={disabled}
				onChange={(issueErrorRatePercent) =>
					onSave({ ...value, issueErrorRatePercent })
				}
			/>
			errors over
			<Field
				label="Provider issue error window"
				value={value.issueWindowMinutes}
				options={PROVIDER_ISSUE_WINDOW_MINUTES}
				format={formatAlertWindow}
				disabled={disabled}
				onChange={(issueWindowMinutes) =>
					onSave({ ...value, issueWindowMinutes })
				}
			/>
			for models used in the last
			<Field
				label="Provider issue usage window"
				value={value.issueUsageHours}
				options={PROVIDER_ISSUE_USAGE_HOURS}
				format={(v) => formatAlertWindow(v * 60)}
				disabled={disabled}
				onChange={(issueUsageHours) => onSave({ ...value, issueUsageHours })}
			/>
		</div>
	);
}

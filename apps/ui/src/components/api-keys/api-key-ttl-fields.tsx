"use client";

import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { Switch } from "@/lib/components/switch";

export const apiKeyTtlUnits = ["minute", "hour", "day"] as const;

export type ApiKeyTtlUnit = (typeof apiKeyTtlUnits)[number];

const ttlUnitMs: Record<ApiKeyTtlUnit, number> = {
	minute: 60 * 1000,
	hour: 60 * 60 * 1000,
	day: 24 * 60 * 60 * 1000,
};

const ttlMaxValues: Record<ApiKeyTtlUnit, number> = {
	minute: 60 * 24 * 365,
	hour: 24 * 365,
	day: 365,
};

export interface ApiKeyTtlFormValue {
	enabled: boolean;
	unit: ApiKeyTtlUnit;
	value: string;
}

export function createApiKeyTtlFormValue(enabled = false): ApiKeyTtlFormValue {
	return { enabled, value: "30", unit: "day" };
}

export function buildApiKeyTtlExpiresAt(value: ApiKeyTtlFormValue): {
	error: string | null;
	expiresAt: string | null;
} {
	if (!value.enabled) {
		return { error: null, expiresAt: null };
	}

	const numeric = Number(value.value);
	const maxValue = ttlMaxValues[value.unit];
	if (!Number.isInteger(numeric) || numeric < 1 || numeric > maxValue) {
		return {
			error: `Expiration must be between 1 and ${maxValue} ${value.unit}${maxValue === 1 ? "" : "s"}.`,
			expiresAt: null,
		};
	}

	const ttlMs = numeric * ttlUnitMs[value.unit];
	const expiresAt = new Date(Date.now() + ttlMs);
	return { error: null, expiresAt: expiresAt.toISOString() };
}

export function formatApiKeyExpiry(
	expiresAt: string | null | undefined,
): { expired: boolean; label: string } | null {
	if (!expiresAt) {
		return null;
	}

	const date = new Date(expiresAt);
	if (Number.isNaN(date.getTime())) {
		return null;
	}

	return {
		expired: date.getTime() <= Date.now(),
		label: Intl.DateTimeFormat(undefined, {
			month: "short",
			day: "numeric",
			year: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		}).format(date),
	};
}

interface ApiKeyTtlFieldsProps {
	idPrefix: string;
	/** Hide the on/off switch and always treat the TTL as enabled. */
	lockEnabled?: boolean;
	onChange: (value: ApiKeyTtlFormValue) => void;
	value: ApiKeyTtlFormValue;
}

export function ApiKeyTtlFields({
	idPrefix,
	lockEnabled = false,
	onChange,
	value,
}: ApiKeyTtlFieldsProps) {
	const updateValue = <K extends keyof ApiKeyTtlFormValue>(
		key: K,
		fieldValue: ApiKeyTtlFormValue[K],
	) => {
		onChange({
			...value,
			[key]: fieldValue,
		});
	};

	const preview = buildApiKeyTtlExpiresAt(value);
	const previewLabel =
		value.enabled && preview.expiresAt
			? Intl.DateTimeFormat(undefined, {
					month: "short",
					day: "numeric",
					year: "numeric",
					hour: "2-digit",
					minute: "2-digit",
				}).format(new Date(preview.expiresAt))
			: null;

	return (
		<div className="rounded-md border p-4 space-y-3">
			{!lockEnabled && (
				<div className="flex items-center gap-2">
					<Switch
						id={`${idPrefix}-ttl-enabled`}
						checked={value.enabled}
						onCheckedChange={(checked) =>
							updateValue("enabled", checked === true)
						}
					/>
					<Label htmlFor={`${idPrefix}-ttl-enabled`}>
						Set expiration (TTL)
					</Label>
				</div>
			)}
			<div className="text-muted-foreground text-sm">
				The key is automatically disabled once it expires. You can reactivate it
				later by setting a new expiration.
			</div>
			{value.enabled && (
				<>
					<div className="grid gap-3 grid-cols-[1fr_132px]">
						<div className="space-y-2">
							<Label htmlFor={`${idPrefix}-ttl-value`}>Expires in</Label>
							<Input
								id={`${idPrefix}-ttl-value`}
								value={value.value}
								onChange={(event) => updateValue("value", event.target.value)}
								type="number"
								min={1}
								max={ttlMaxValues[value.unit]}
								step={1}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor={`${idPrefix}-ttl-unit`}>Unit</Label>
							<Select
								value={value.unit}
								onValueChange={(nextValue) =>
									updateValue("unit", nextValue as ApiKeyTtlUnit)
								}
							>
								<SelectTrigger id={`${idPrefix}-ttl-unit`} className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{apiKeyTtlUnits.map((unit) => (
										<SelectItem key={unit} value={unit}>
											{unit[0]?.toUpperCase()}
											{unit.slice(1)}s
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					{previewLabel && (
						<div className="text-muted-foreground text-xs">
							Expires on {previewLabel}.
						</div>
					)}
				</>
			)}
		</div>
	);
}

"use client";

import { Label } from "./ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "./ui/select";

export type RateLimitModeOption = "strict" | "soft" | "lax";

const MODE_LABELS: Record<RateLimitModeOption, string> = {
	strict: "Strict",
	soft: "Soft",
	lax: "Lax",
};

const MODE_DESCRIPTIONS: Record<
	"provider" | "key",
	Record<RateLimitModeOption, string>
> = {
	provider: {
		strict: "All traffic is routed away once the limit is reached",
		soft: "Sessions already pinned to the provider keep using it past the limit; new sessions are routed away",
		lax: "Explicit provider requests and existing pinned sessions may exceed the limit; automatic routing and fallback respect it.",
	},
	key: {
		strict: "The key is skipped for all traffic while it is at a cap",
		soft: "Sessions already pinned to this provider keep using the key past its caps, so encrypted reasoning keeps working; other traffic uses other keys or providers",
		lax: "Like soft, and explicit provider/model requests may also use the key past its caps; automatic routing and fallback respect them",
	},
};

export interface RateLimitModeFieldProps {
	id: string;
	value: RateLimitModeOption;
	onChange: (value: RateLimitModeOption) => void;
	/** Whether the caps belong to a provider/model rule or one provider key. */
	subject: "provider" | "key";
	disabled?: boolean;
	label?: string;
}

/** Strict / soft / lax choice shared by provider rate limits and key caps. */
export function RateLimitModeField({
	id,
	value,
	onChange,
	subject,
	disabled,
	label = "Mode",
}: RateLimitModeFieldProps) {
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
			<Select
				value={value}
				onValueChange={(next) => onChange(next as RateLimitModeOption)}
				disabled={disabled}
			>
				<SelectTrigger id={id} className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{(Object.keys(MODE_LABELS) as RateLimitModeOption[]).map((mode) => (
						<SelectItem key={mode} value={mode}>
							{MODE_LABELS[mode]}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p className="text-muted-foreground text-xs">
				{MODE_DESCRIPTIONS[subject][value]}
			</p>
		</div>
	);
}

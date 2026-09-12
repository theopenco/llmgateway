"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function NumberField({
	id,
	label,
	value,
	onChange,
	integer = false,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	integer?: boolean;
}) {
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
			<Input
				id={id}
				type="number"
				min="0"
				step={integer ? "1" : "any"}
				value={value}
				onChange={(event) => onChange(event.target.value)}
			/>
		</div>
	);
}

function validNumber(value: string, integer = false) {
	const number = Number(value);
	return (
		value.trim() !== "" &&
		Number.isFinite(number) &&
		number >= 0 &&
		(!integer || Number.isSafeInteger(number))
	);
}

const usd = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 8,
});

export function TokenCostCalculator() {
	const [values, setValues] = useState({
		input: "1000",
		cached: "0",
		output: "500",
		inputRate: "1",
		cachedRate: "1",
		outputRate: "2",
		requestRate: "0",
		requests: "10000",
	});
	const fields = [
		["input", "Total input tokens per request", true],
		["cached", "Cached input tokens (included in total)", true],
		["output", "Output tokens per request", true],
		["inputRate", "Input price (USD / million tokens)", false],
		["cachedRate", "Cached input price (USD / million tokens)", false],
		["outputRate", "Output price (USD / million tokens)", false],
		["requestRate", "Flat charge (USD / request)", false],
		["requests", "Requests per month", true],
	] as const;
	const valid =
		fields.every(([key, , integer]) => validNumber(values[key], integer)) &&
		Number(values.cached) <= Number(values.input);
	const inputCost =
		(Number(values.input) - Number(values.cached)) * Number(values.inputRate);
	const cachedCost = Number(values.cached) * Number(values.cachedRate);
	const outputCost = Number(values.output) * Number(values.outputRate);
	const tokenCost = (inputCost + cachedCost + outputCost) / 1_000_000;
	const cost = tokenCost + Number(values.requestRate);
	const monthly = cost * Number(values.requests);
	return (
		<section
			aria-label="Token cost calculator"
			className="border-border rounded-xl border p-5 sm:p-7"
		>
			<div className="grid gap-5 sm:grid-cols-2">
				{fields.map(([key, label, integer]) => (
					<NumberField
						key={key}
						id={`cost-${key}`}
						label={label}
						integer={integer}
						value={values[key]}
						onChange={(value) =>
							setValues((previous) => ({ ...previous, [key]: value }))
						}
					/>
				))}
			</div>
			<div aria-live="polite" className="bg-primary/5 mt-6 rounded-lg p-5">
				{valid && Number.isFinite(monthly) ? (
					<dl className="grid gap-5 sm:grid-cols-2">
						<div>
							<dt className="text-muted-foreground text-sm">
								Estimated cost per request
							</dt>
							<dd
								data-testid="request-cost"
								className="mt-1 font-mono text-2xl"
							>
								{usd.format(cost)}
							</dd>
						</div>
						<div>
							<dt className="text-muted-foreground text-sm">
								Estimated monthly cost
							</dt>
							<dd
								data-testid="monthly-cost"
								className="mt-1 font-mono text-2xl"
							>
								{usd.format(monthly)}
							</dd>
						</div>
					</dl>
				) : (
					<p role="alert">
						Enter finite, non-negative values and whole token and request
						counts. Cached input cannot exceed total input.
					</p>
				)}
			</div>
			<p className="text-muted-foreground mt-4 text-sm">
				Example rates only. Enter your own prices. Inputs stay in this page; no
				API key or request is sent.
			</p>
		</section>
	);
}

export function RateLimitCalculator() {
	const [rpm, setRpm] = useState("60");
	const [rpd, setRpd] = useState("20000");
	const [seconds, setSeconds] = useState("10");
	const valid =
		validNumber(rpm, true) &&
		(rpd === "" || validNumber(rpd, true)) &&
		validNumber(seconds);
	const daily = Math.min(
		Number(rpm) * 1440,
		rpd === "" ? Infinity : Number(rpd),
	);
	const concurrency = Math.ceil((Number(rpm) * Number(seconds)) / 60);
	return (
		<section
			aria-label="Rate limit calculator"
			className="border-border rounded-xl border p-5 sm:p-7"
		>
			<div className="grid gap-5 sm:grid-cols-2">
				<NumberField
					id="capacity-rpm"
					label="Requests per minute"
					value={rpm}
					onChange={setRpm}
					integer
				/>
				<NumberField
					id="capacity-rpd"
					label="Requests per day (optional)"
					value={rpd}
					onChange={setRpd}
					integer
				/>
				<NumberField
					id="capacity-duration"
					label="Average request duration (seconds)"
					value={seconds}
					onChange={setSeconds}
				/>
			</div>
			<div aria-live="polite" className="bg-primary/5 mt-6 rounded-lg p-5">
				{valid &&
				Number.isSafeInteger(daily) &&
				Number.isSafeInteger(concurrency) ? (
					<dl className="grid gap-5 sm:grid-cols-2">
						<div>
							<dt className="text-muted-foreground text-sm">
								Maximum requests per day
							</dt>
							<dd
								data-testid="daily-capacity"
								className="mt-1 font-mono text-2xl"
							>
								{daily.toLocaleString("en-US")}
							</dd>
						</div>
						<div>
							<dt className="text-muted-foreground text-sm">
								Concurrency at full minute rate
							</dt>
							<dd
								data-testid="capacity-concurrency"
								className="mt-1 font-mono text-2xl"
							>
								{concurrency.toLocaleString("en-US")}
							</dd>
						</div>
					</dl>
				) : (
					<p role="alert">
						Enter finite, non-negative values. Request limits must be whole
						numbers within the supported range.
					</p>
				)}
			</div>
			<p className="text-muted-foreground mt-4 text-sm">
				Capacity assumes steady traffic and continuous availability. It is not a
				traffic forecast or a recommended safety margin.
			</p>
		</section>
	);
}

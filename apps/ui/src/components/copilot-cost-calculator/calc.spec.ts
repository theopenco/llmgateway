import { describe, expect, it } from "vitest";

import {
	AGENT_TASK_TOKENS,
	CHAT_SESSION_TOKENS,
	MODEL_MIXES,
	WORKING_DAYS_PER_MONTH,
	copilotMonthlyCost,
	formatUsd,
	gatewayMonthlyCost,
	monthlyTokenUsage,
	rawUsageCost,
} from "./calc";

const premium = MODEL_MIXES.find((m) => m.id === "premium")!;
const efficient = MODEL_MIXES.find((m) => m.id === "efficient")!;

describe("monthlyTokenUsage", () => {
	it("sums chat and agent tokens across developers and working days", () => {
		const usage = monthlyTokenUsage(2, 10, 1);
		const sessions = 2 * 10 * WORKING_DAYS_PER_MONTH;
		const tasks = 2 * 1 * WORKING_DAYS_PER_MONTH;
		const chatInput = sessions * CHAT_SESSION_TOKENS.input;
		const chatOutput = sessions * CHAT_SESSION_TOKENS.output;
		const taskInput = tasks * AGENT_TASK_TOKENS.input;
		const taskOutput = tasks * AGENT_TASK_TOKENS.output;
		expect(usage.inputTokens).toBe(chatInput + taskInput);
		expect(usage.outputTokens).toBe(chatOutput + taskOutput);
	});

	it("returns zero usage for zero developers", () => {
		const usage = monthlyTokenUsage(0, 40, 8);
		expect(usage.inputTokens).toBe(0);
		expect(usage.outputTokens).toBe(0);
	});
});

describe("rawUsageCost", () => {
	it("reproduces the reported ~$0.016 mini-class chat session cost", () => {
		const session = rawUsageCost(
			{
				inputTokens: CHAT_SESSION_TOKENS.input,
				outputTokens: CHAT_SESSION_TOKENS.output,
			},
			efficient,
		);
		expect(session.total).toBeCloseTo(0.0155, 4);
	});

	it("prices premium sessions from per-token rates", () => {
		const session = rawUsageCost(
			{
				inputTokens: CHAT_SESSION_TOKENS.input,
				outputTokens: CHAT_SESSION_TOKENS.output,
			},
			premium,
		);
		expect(session.total).toBeCloseTo(0.25, 2);
	});
});

describe("copilotMonthlyCost", () => {
	it("adds seat fees and bills usage above included credits", () => {
		const cost = copilotMonthlyCost(5, 19, 0, 500);
		expect(cost.seatCost).toBe(95);
		expect(cost.overage).toBe(500);
		expect(cost.total).toBe(595);
	});

	it("clamps overage at zero when included credits cover usage", () => {
		const cost = copilotMonthlyCost(3, 10, 15, 30);
		expect(cost.includedCredits).toBe(45);
		expect(cost.overage).toBe(0);
		expect(cost.total).toBe(30);
	});
});

describe("gatewayMonthlyCost", () => {
	const usage = { inputTokens: 60_000_000, outputTokens: 8_000_000 };

	it("discounts cached input tokens and applies the credit fee", () => {
		const cost = gatewayMonthlyCost(usage, premium, 0.6, false);
		// input $300 -> 40% full + 60% at 10% = $138; output $200
		expect(cost.usageAfterCaching).toBeCloseTo(338, 5);
		expect(cost.fee).toBeCloseTo(338 * 0.05, 5);
		expect(cost.total).toBeCloseTo(338 * 1.05, 5);
	});

	it("waives the fee with BYOK", () => {
		const cost = gatewayMonthlyCost(usage, premium, 0.6, true);
		expect(cost.fee).toBe(0);
		expect(cost.total).toBeCloseTo(338, 5);
	});

	it("matches raw usage cost with zero cache hits and BYOK", () => {
		const cost = gatewayMonthlyCost(usage, premium, 0, true);
		expect(cost.total).toBeCloseTo(rawUsageCost(usage, premium).total, 5);
	});
});

describe("formatUsd", () => {
	it("keeps cents for small values and drops them for large ones", () => {
		expect(formatUsd(12.34)).toBe("$12.34");
		expect(formatUsd(1234.56)).toBe("$1,235");
	});
});

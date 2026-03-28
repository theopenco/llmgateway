import { describe, expect, test } from "vitest";

import { UnifiedFinishReason } from "@llmgateway/db";

import { getLogErrorHandling } from "./log-error-notifier.js";

describe("getLogErrorHandling", () => {
	test("marks provider errors as warn and Discord-notifiable", () => {
		expect(
			getLogErrorHandling({
				unifiedFinishReason: UnifiedFinishReason.UPSTREAM_ERROR,
			}),
		).toEqual({
			errorKind: "Provider Error",
			logLevel: "warn",
			shouldNotifyDiscord: true,
		});
	});

	test("marks gateway errors as warn and Discord-notifiable", () => {
		expect(
			getLogErrorHandling({
				unifiedFinishReason: UnifiedFinishReason.GATEWAY_ERROR,
			}),
		).toEqual({
			errorKind: "Gateway Error",
			logLevel: "warn",
			shouldNotifyDiscord: true,
		});
	});

	test("marks client errors as info without Discord", () => {
		expect(
			getLogErrorHandling({
				unifiedFinishReason: UnifiedFinishReason.CLIENT_ERROR,
			}),
		).toEqual({
			errorKind: "Client Error",
			logLevel: "info",
			shouldNotifyDiscord: false,
		});
	});

	test("marks content filters as info without Discord", () => {
		expect(
			getLogErrorHandling({
				unifiedFinishReason: UnifiedFinishReason.CONTENT_FILTER,
			}),
		).toEqual({
			errorKind: "Content Filter",
			logLevel: "info",
			shouldNotifyDiscord: false,
		});
	});
});

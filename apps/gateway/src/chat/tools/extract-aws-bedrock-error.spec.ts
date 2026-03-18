import { describe, expect, it } from "vitest";

import {
	extractAwsBedrockHttpError,
	extractAwsBedrockStreamError,
} from "./extract-aws-bedrock-error.js";

describe("extractAwsBedrockHttpError", () => {
	it("falls back to x-amzn headers when the body is empty json", () => {
		const response = new Response("{}", {
			status: 400,
			headers: {
				"x-amzn-errormessage":
					"The provided model identifier is invalid for this account.",
				"x-amzn-errortype": "ValidationException",
			},
		});

		expect(extractAwsBedrockHttpError(response, "{}")).toBe(
			JSON.stringify({
				message: "The provided model identifier is invalid for this account.",
				type: "ValidationException",
			}),
		);
	});
});

describe("extractAwsBedrockStreamError", () => {
	it("extracts exception metadata from aws eventstream frames", () => {
		expect(
			extractAwsBedrockStreamError({
				__aws_event_type: "modelStreamErrorException",
				message: "The stream failed before the first token.",
				originalStatusCode: 400,
			}),
		).toEqual({
			eventType: "modelStreamErrorException",
			message: "The stream failed before the first token.",
			statusCode: 400,
			responseText: JSON.stringify({
				message: "The stream failed before the first token.",
				type: "modelStreamErrorException",
				originalStatusCode: 400,
			}),
		});
	});
});

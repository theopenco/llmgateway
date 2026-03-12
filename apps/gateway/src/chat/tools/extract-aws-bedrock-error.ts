const AWS_BEDROCK_EVENT_STATUS_CODES: Record<string, number> = {
	accessDeniedException: 403,
	internalServerException: 500,
	modelNotReadyException: 503,
	modelStreamErrorException: 502,
	modelTimeoutException: 504,
	resourceNotFoundException: 404,
	serviceQuotaExceededException: 429,
	serviceUnavailableException: 503,
	throttlingException: 429,
	validationException: 400,
};

function extractJsonMessage(body: string): string | undefined {
	if (!body || body === "{}") {
		return undefined;
	}

	try {
		const json = JSON.parse(body);
		return (
			json?.message ??
			json?.Message ??
			json?.originalMessage ??
			json?.error?.message ??
			undefined
		);
	} catch {
		return undefined;
	}
}

export function extractAwsBedrockHttpError(
	response: Response,
	errorResponseText: string,
): string {
	const normalizedBody = errorResponseText.trim();
	const messageFromBody = extractJsonMessage(normalizedBody);

	if (messageFromBody) {
		return normalizedBody;
	}

	const headerMessage = response.headers.get("x-amzn-errormessage");
	const headerType = response.headers.get("x-amzn-errortype");

	if (headerMessage || headerType) {
		return JSON.stringify({
			message: headerMessage ?? `AWS Bedrock ${headerType ?? "error"}`,
			type: headerType ?? null,
		});
	}

	return normalizedBody;
}

export function extractAwsBedrockStreamError(data: any): {
	eventType: string;
	message: string;
	statusCode: number;
	responseText: string;
} | null {
	const eventType = data?.__aws_event_type;
	if (typeof eventType !== "string" || !eventType.endsWith("Exception")) {
		return null;
	}

	const message =
		data?.originalMessage ??
		data?.message ??
		data?.Message ??
		`AWS Bedrock ${eventType}`;
	const statusCode =
		typeof data?.originalStatusCode === "number"
			? data.originalStatusCode
			: (AWS_BEDROCK_EVENT_STATUS_CODES[eventType] ?? 500);

	return {
		eventType,
		message,
		statusCode,
		responseText: JSON.stringify({
			message,
			type: eventType,
			...(typeof data?.originalStatusCode === "number"
				? { originalStatusCode: data.originalStatusCode }
				: {}),
		}),
	};
}
